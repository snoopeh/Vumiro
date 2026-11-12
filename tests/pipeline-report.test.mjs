import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'vumiro-pipeline-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const put = (name, text) => {
    const target = path.join(directory, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, text);
  };
  const run = (script, args = [], env = {}) => spawnSync(process.execPath, [script, ...args], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env }, timeout: 15000
  });
  return { directory, put, run };
}

for (const [context, environment] of [
  ['branch', { GITHUB_REF_TYPE: 'branch', GITHUB_REF: 'refs/heads/main' }],
  ['tag', { GITHUB_REF_TYPE: 'tag', GITHUB_REF: 'refs/tags/client-v1.2.3' }]
]) test(`fast checker stops at the first failure and preserves its compact report and log (${context})`, t => {
  const f = fixture(t);
  f.put('scripts/Check-ReleaseVersion.mjs', "throw Error('unaligned release fixture');\n");
  f.put('scripts/Check-Syntax.mjs', "throw Error('this stage must not start');\n");
  copyFileSync(path.join(root, 'scripts/Check-Client.mjs'), path.join(f.directory, 'scripts/Check-Client.mjs'));
  cpSync(path.join(root, 'scripts/lib'), path.join(f.directory, 'scripts/lib'), { recursive: true });
  copyFileSync(path.join(root, 'scripts/feature-checks.json'), path.join(f.directory, 'scripts/feature-checks.json'));
  mkdirSync(path.join(f.directory, 'tests'));
  const result = f.run('scripts/Check-Client.mjs', [], environment);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(readFileSync(path.join(f.directory, 'dist/checks/checks-report.json')));
  assert.equal(report.state, 'failed');
  assert.deepEqual(report.checks.map(check => check.name), ['versions']);
  assert.match(readFileSync(path.join(f.directory, 'dist/checks/versions.log'), 'utf8'), /unaligned release fixture/);
  assert.equal(existsSync(path.join(f.directory, 'dist/checks/syntax.log')), false);
});

const success = Object.fromEntries(['checks', 'windows-client', 'linux-client', 'publish-release'].map(name => [name, { result: 'success' }]));
function summary(f, jobs = success) {
  return f.run(path.join(root, 'scripts/Write-ReleaseSummary.mjs'), [], {
    RELEASE_JOB_RESULTS: JSON.stringify(jobs), GITHUB_REF_NAME: 'client-v1.2.3',
    GITHUB_SHA: 'a'.repeat(40), GITHUB_REPOSITORY: 'fixture/client', GITHUB_RUN_ID: '123'
  });
}

test('release summary requires a passing verification report before claiming success', t => {
  const f = fixture(t);
  const result = summary(f);
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(readFileSync(path.join(f.directory, 'dist/pipeline-report/pipeline-report.json')));
  assert.equal(report.status, 'failed');
});

test('release summary includes verified success and fails skipped or failed stages', t => {
  const f = fixture(t);
  f.put('dist/verification/release-report.json', JSON.stringify({ status: 'passed', checks: [{ name: 'tag-source', status: 'passed' }] }));
  assert.equal(summary(f).status, 0);
  const markdown = readFileSync(path.join(f.directory, 'dist/pipeline-report/pipeline-report.md'), 'utf8');
  assert.match(markdown, /tag-source: passed/);
  assert.match(markdown, /actions\/runs\/123/);
  assert.equal(summary(f, { ...success, 'publish-release': { result: 'skipped' } }).status, 1);
  assert.equal(summary(f, { ...success, 'linux-client': { result: 'failure' } }).status, 1);
});
