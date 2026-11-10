import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, writeFile, appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {release as osRelease} from 'node:os';
import {snapshotInputs, checkKey, loadReceipt, saveReceipt} from './lib/check-receipt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let argumentError;
let values = {output: 'dist/checks', reuse: false, native: false, plan: false};
try {
  ({values} = parseArgs({options: {
  output: {type: 'string', default: 'dist/checks'}, tag: {type: 'string'},
  'skip-backend': {type: 'boolean', default: false}, group: {type: 'string', multiple: true},
  'changed-since': {type: 'string'}, reuse: {type: 'boolean', default: false},
  native: {type: 'boolean', default: false}, plan: {type: 'boolean', default: false}
  }}));
} catch (error) { argumentError = error; }
const output = path.resolve(root, values.output);
const relativeOutput = path.relative(root, output).split(path.sep).join('/');
if (!relativeOutput.startsWith('../') && !path.isAbsolute(relativeOutput) && !relativeOutput.startsWith('dist/')) {
  throw Error('In-checkout output must be inside dist/ so reports cannot hide or overwrite source inputs.');
}
const checks = [], pending = [];
let selection, snapshot, failure;
const enabled = value => Boolean(value && value !== 'false' && value !== '0');
const releaseContext = Boolean(values.tag || process.env.GITHUB_REF_TYPE === 'tag' || process.env.GITHUB_REF?.startsWith('refs/tags/'));
const release = releaseContext || values.group?.includes('release');
const allowReuse = values.reuse && !release && !enabled(process.env.CI) && !enabled(process.env.GITHUB_ACTIONS);
const environment = {
  node: process.version, platform: process.platform, arch: process.arch, osRelease: osRelease(),
  envHash: createHash('sha256').update(JSON.stringify(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
};
// Node regressions also exercise Git and PowerShell. Local reuse must notice
// tool upgrades at the same PATH, not just Node or environment changes.
if (allowReuse) {
  environment.tools = {};
  for (const [tool, args] of [['git', ['--version']], ['pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']], ['powershell', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']]]) {
    const result = spawnSync(tool, args, {encoding: 'utf8', timeout: 10000});
    environment.tools[tool] = result.status === 0 ? result.stdout.trim().slice(0, 160) : 'unavailable';
  }
}
// A checker invoked by a regression test must start a real child test runner.
const childEnvironment = {...process.env};
delete childEnvironment.NODE_TEST_CONTEXT;

async function run(name, command, args, {cwd = root, reusable = true} = {}) {
  const invocation = [command, ...args];
  const key = checkKey({root, fingerprint: snapshot.fingerprint, command: invocation, runtime: JSON.stringify(environment)});
  if (allowReuse && snapshot.cacheable && reusable) {
    const saved = await loadReceipt(path.join(output, 'cache'), name, key);
    if (saved) {
      checks.push({...saved, reused: true, durationMs: 0});
      console.log(`${name}: reused (passed ${saved.verifiedAt})`);
      return;
    }
  }
  const started = Date.now();
  const result = spawnSync(command, args, {cwd, env: childEnvironment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000, shell: process.platform === 'win32' && command === 'npm.cmd'});
  const log = (result.stdout || '') + (result.stderr || '') + (result.error?.message || '');
  const logFile = path.join(output, `${name}.log`);
  await writeFile(logFile, log);
  const record = {
    name, state: result.status === 0 && !result.error ? 'passed' : 'failed', reused: false,
    durationMs: Date.now() - started, verifiedAt: new Date().toISOString(), command: invocation, cwd, log: logFile
  };
  if (name === 'client-tests') for (const metric of ['tests', 'pass', 'fail', 'skipped']) {
    const match = new RegExp('^# ' + metric + ' (\\d+)', 'm').exec(log);
    if (match) record[metric] = Number(match[1]);
  }
  checks.push(record);
  console.log(`${name}: ${record.state}${record.tests !== undefined ? ` (${record.pass}/${record.tests})` : ''}`);
  if (record.state === 'failed') {
    console.error(log.split(/\r?\n/).slice(-20).map(line => line.slice(0, 300)).join('\n'));
    throw Error(`${name} failed; see ${logFile}`);
  }
  if (allowReuse && reusable && snapshot.cacheable) pending.push({key, record});
}

try {
  if (argumentError) throw argumentError;
  const {createCheckPlan, changedFilesSince} = await import('./lib/check-plan.mjs');
  if (releaseContext && (values.group?.length || values['changed-since'] || values['skip-backend'])) {
    throw Error('Release/tag verification requires the full uncached client and backend suite.');
  }
  const changedFiles = values['changed-since'] ? await changedFilesSince(root, values['changed-since']) : undefined;
  selection = await createCheckPlan({root, groups: values.group || [], changedFiles, skipBackend: values['skip-backend']});
  if (values.plan) {
    console.log(JSON.stringify({...selection, native: values.native ? selection.native : []}, null, 2));
  } else {
    await mkdir(output, {recursive: true});
    snapshot = await snapshotInputs(root);
    console.log(`Scope: ${selection.groups.join(', ') || 'no executable changes'} (${selection.reason})`);
    await run('versions', process.execPath, ['scripts/Check-ReleaseVersion.mjs', ...(values.tag ? ['--tag', values.tag] : [])]);
    await run('syntax', process.execPath, ['scripts/Check-Syntax.mjs']);
    if (selection.full && selection.tests.length === 0) throw Error('No client tests found; refusing an empty full-suite success.');
    if (selection.tests.length) await run('client-tests', process.execPath, ['--test', '--test-reporter=tap', ...selection.tests]);
    if (selection.backend) await run('backend-tests', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['test'], {cwd: path.join(root, 'cloudflare'), reusable: false});
    if (values.native) for (const native of selection.native) {
      await run(native.name, 'dotnet', ['run', '--project', native.project, '-c', 'Release', ...(native.args || [])], {reusable: false});
    }
    const after = await snapshotInputs(root);
    if (after.fingerprint !== snapshot.fingerprint) throw Error('Source inputs changed during verification; rerun checks for a coherent receipt.');
    for (const item of pending) await saveReceipt(path.join(output, 'cache'), item.key, item.record);
  }
} catch (error) {
  failure = error.message;
  console.error(failure);
  process.exitCode = 1;
}

if (!values.plan || failure) {
  await mkdir(output, {recursive: true});
  const report = {
    schema: 1, state: failure ? 'failed' : 'passed', root, source: snapshot?.source || null,
    fingerprint: snapshot?.fingerprint || null, environment,
    scope: selection ? {groups: selection.groups, reason: selection.reason, full: selection.full} : null,
    coverage: {backend: Boolean(selection?.backend), nativeRequested: values.native, tests: selection?.tests || []},
    cache: {requested: values.reuse, enabled: Boolean(allowReuse && snapshot?.cacheable), policy: 'local Node checks only; backend/native/CI/releases run fresh'},
    checks, ...(failure ? {error: failure} : {})
  };
  const markdown = `## Fast client checks: ${report.state}\n\nSource: ${report.source || 'uncommitted checkout'}\n\nScope: ${report.scope?.groups.join(', ') || 'none'}; full: ${Boolean(report.scope?.full)}\n\nFingerprint: ${report.fingerprint || 'unavailable'}\n\n| Check | Result | Reused | Seconds |\n|---|---|---|---|\n${checks.map(check => `| ${check.name} | ${check.state} | ${check.reused} | ${(check.durationMs / 1000).toFixed(1)} |`).join('\n')}\n${failure ? '\n' + failure + '\n' : ''}`;
  await writeFile(path.join(output, 'checks-report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(output, 'checks-report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(`Receipt: ${path.join(output, 'checks-report.json')}`);
}
