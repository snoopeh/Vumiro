import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source = path.resolve(import.meta.dirname, '..');
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'vumiro-scoped-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const put = (name, value) => {
    mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
    writeFileSync(path.join(root, name), value);
  };
  cpSync(path.join(source, 'scripts'), path.join(root, 'scripts'), {recursive: true});
  put('scripts/Check-ReleaseVersion.mjs', "console.log('versions passed');\n");
  put('scripts/Check-Syntax.mjs', "console.log('syntax passed');\n");
  put('tests/sample.test.mjs', "import test from 'node:test'; import assert from 'node:assert/strict'; test('fixture',()=>assert.equal(1,1));\n");
  put('cloudflare/package.json', JSON.stringify({scripts: {test: 'node check.cjs'}}));
  put('cloudflare/check.cjs', "console.log('backend passed');\n");
  const run = (args = [], extra = {}) => spawnSync(process.execPath, ['scripts/Check-Client.mjs', ...(args.includes('--tag') || extra.GITHUB_REF?.startsWith('refs/tags/') ? [] : ['--skip-backend']), ...args], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: {...process.env, CI: '', GITHUB_ACTIONS: '', GITHUB_REF: '', GITHUB_REF_TYPE: '', GITHUB_STEP_SUMMARY: '', ...extra}
  });
  const report = () => JSON.parse(readFileSync(path.join(root, 'dist/checks/checks-report.json'), 'utf8'));
  return {root, put, run, report};
}

test('runner reuses unchanged passing Node checks and invalidates edited input', t => {
  const f = fixture(t);
  const first = f.run(['--reuse']);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(f.report().checks.every(check => check.reused === false));
  const second = f.run(['--reuse']);
  assert.equal(second.status, 0, second.stderr);
    assert.ok(f.report().checks.every(check => check.reused === true));
  f.put('tests/sample.test.mjs', "throw Error('specific regression');\n");
  const failed = f.run(['--reuse']);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr + JSON.stringify(f.report()));
  assert.equal(f.report().state, 'failed');
  assert.equal(f.report().checks.at(-1).reused, false);
  assert.match(readFileSync(f.report().checks.at(-1).log, 'utf8'), /specific regression/);
  assert.ok(failed.stdout.length + failed.stderr.length < 7000);
});

test('CI, release tag and changed environment prevent local reuse', t => {
  const f = fixture(t);
  assert.equal(f.run(['--reuse']).status, 0);
  for (const [args, env] of [
    [[], {CI: 'true'}],
    [[], {GITHUB_ACTIONS: 'true'}],
    [['--tag', 'client-v1.2.3'], {}],
    [[], {GITHUB_REF: 'refs/tags/client-v1.2.3'}],
    [[], {VUMIRO_TEST_INPUT: 'changed'}]
  ]) {
    const r = f.run(['--reuse', ...args], env);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(f.report().checks.every(check => !check.reused));
  }
});

test('bad selection writes a failed receipt and plan mode never executes checks', t => {
  const f = fixture(t);
  const bad = f.run(['--group', 'does-not-exist']);
  assert.equal(bad.status, 1);
  assert.equal(f.report().state, 'failed');
  const typo = f.run(['--invalid-option']);
  assert.equal(typo.status, 1);
  assert.match(f.report().error, /invalid-option/);
  const plan = f.run(['--plan']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.ok(JSON.parse(plan.stdout).tests.includes('tests/sample.test.mjs'));
});

test('full default remains uncached and an empty test directory is not a passing suite', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.ok(f.report().checks.every(check => !check.reused));
  rmSync(path.join(f.root, 'tests/sample.test.mjs'));
  const empty = f.run();
  assert.equal(empty.status, 1);
  assert.equal(f.report().state, 'failed');
});

test('explicit groups union with changed-file selection through the real runner', t => {
  const f = fixture(t);
  const git = args => {
    const r = spawnSync('git', args, {cwd: f.root, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
  };
  f.put('tests/chat-pane.test.mjs', "import test from 'node:test'; test('chat fixture',()=>{});\n");
  git(['init', '-q']);
  git(['config', 'user.name', 'Check Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['add', '.']);
  git(['commit', '-qm', 'fixture']);
  f.put('docs/note.md', 'Documentation-only change.');
  const result = f.run(['--group', 'chat', '--changed-since', 'HEAD']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.report().scope.groups, ['chat']);
  assert.equal(f.report().scope.full, false);
  assert.equal(f.report().checks.find(check => check.name === 'client-tests').tests, 1);
});

test('release validation refuses focused groups or omitted backend checks', t => {
  const f = fixture(t);
  for (const args of [['--tag', 'client-v1.2.3', '--skip-backend'], ['--tag', 'client-v1.2.3', '--group', 'chat']]) {
    const result = f.run(args);
    assert.equal(result.status, 1);
    assert.match(f.report().error, /full uncached/);
  }
  const tagged = f.run(['--group', 'chat'], {GITHUB_REF: 'refs/tags/client-v1.2.3'});
  assert.equal(tagged.status, 1);
  assert.match(f.report().error, /full uncached/);
});
