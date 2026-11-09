import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = fileURLToPath(new URL('../scripts/Ship.ps1', import.meta.url));
const shell = process.env.SHIP_TEST_POWERSHELL || ['pwsh', 'powershell'].find(command => spawnSync(command, ['-NoProfile', '-Command', 'exit 0']).status === 0);
const origin = 'https://github.com/snoopeh/Vumiro.git';
const gitBinary = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['git'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0];

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'vumiro-ship-'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(base, 'no-global-config'), GIT_TERMINAL_PROMPT: '0' };
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path');
  const inheritedPath = env[pathKey];
  delete env[pathKey];
  env.PATH = inheritedPath;
  let transportPath;
  function run(command, args, cwd = repo) {
    return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 60_000 });
  }
  function git(...args) {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  }
  function put(path, content) {
    mkdirSync(resolve(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  assert.ok(existsSync(source), 'Ship.ps1 release command must exist');
  put('scripts/Ship.ps1', readFileSync(source));
  put('Vumiro.Client/Vumiro.Client.csproj', '<Project>\r\n  <PropertyGroup><Version>1.2.3</Version></PropertyGroup>\r\n</Project>\r\n');
  put('Vumiro.Client.Updater/Vumiro.Client.Updater.csproj', '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>\n');
  put('Vumiro.Linux/package.json', '{\n  "name": "fixture",\n  "version": "1.2.3"\n}\n');
  put('Vumiro.Linux/package-lock.json', '{\n  "version": "1.2.3",\n  "packages": {\n    "": { "version": "1.2.3" },\n    "node_modules/fixture": { "version": "1.2.3" }\n  }\n}\n');
  put('client.mjs', 'export const release = true;\n');
  put('.gitignore', 'generated/\n');
  git('init', '-b', 'main');
  git('config', 'user.name', 'Release Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'Fixture');
  git('remote', 'add', 'origin', origin);
  const files = ['Vumiro.Client/Vumiro.Client.csproj', 'Vumiro.Client.Updater/Vumiro.Client.Updater.csproj', 'Vumiro.Linux/package.json', 'Vumiro.Linux/package-lock.json'];
  function snapshot() {
    return { head: git('rev-parse', 'HEAD'), status: git('status', '--porcelain=v1', '--untracked-files=all'), tags: git('tag'), contents: files.map(path => readFileSync(join(repo, path), 'utf8')) };
  }
  function ship(...args) {
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(repo, 'scripts/Ship.ps1'), ...args], {
      cwd: repo, env: transportPath ? { ...env, PATH: transportPath + delimiter + env.PATH } : env, encoding: 'utf8', timeout: 60_000
    });
    assert.ifError(result.error);
    return { ...result, output: result.stdout + result.stderr };
  }
  function connectLocalRemote() {
    const remote = join(base, 'remote.git');
    const result = run('git', ['init', '--bare', remote]);
    assert.equal(result.status, 0, result.stderr);
    git('push', remote, 'main');
    // Keep the configured and effective origin real. Substitute only the transport boundary
    // so preflight and actual atomic Git pushes can be exercised entirely on disk.
    transportPath = join(base, 'transport');
    mkdirSync(transportPath);
    const shim = join(transportPath, 'git-transport.cjs');
    writeFileSync(shim, `const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const command = args[0] === '-C' ? args[2] : args[0];
if (command === 'ls-remote' || command === 'push') {
  const index = args.indexOf('origin');
  if (index >= 0) args[index] = ${JSON.stringify(remote)};
}
const result = spawnSync(${JSON.stringify(gitBinary)}, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
`);
    if (process.platform === 'win32') {
      writeFileSync(join(transportPath, 'git.cmd'), `@echo off\r\n"${process.execPath}" "${shim}" %*\r\n`);
    } else {
      writeFileSync(join(transportPath, 'git'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${shim.replaceAll("'", "'\\''")}' "$@"\n`, { mode: 0o755 });
    }
    return remote;
  }
  return { repo, put, git, snapshot, ship, connectLocalRemote, files };
}

test('preview computes each bump without changing files, Git state, or contacting origin', { skip: !shell }, t => {
  const f = fixture(t);
  const before = f.snapshot();
  for (const [bump, version] of [['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']]) {
    const result = f.ship('-Bump', bump);
    assert.equal(result.status, 0, result.output);
    assert.ok(result.output.includes(`client-v${version}`), result.output);
    assert.match(result.output, /preview/i);
    assert.deepEqual(f.snapshot(), before);
  }
});

test('dirty preview reports the publishing blocker and preserves untracked files', { skip: !shell }, t => {
  const f = fixture(t);
  f.put('untracked.txt', 'human QA edits');
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /blocked.*clean|blocked.*dirty|dirty.*blocked/i);
  assert.deepEqual(f.snapshot(), before);
});

test('publish rejects dirty worktree before mutation', { skip: !shell }, t => {
  const f = fixture(t);
  f.put('untracked.txt', 'human QA edits');
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /clean|dirty|untracked/i);
  assert.deepEqual(f.snapshot(), before);
});

test('publish requires explicit human QA acceptance before mutation', { skip: !shell }, t => {
  const f = fixture(t);
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch', '-Publish');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /QaAccepted|QA acceptance/i);
  assert.deepEqual(f.snapshot(), before);
});

test('preview rejects version disagreement', { skip: !shell }, t => {
  const f = fixture(t);
  f.put('Vumiro.Client.Updater/Vumiro.Client.Updater.csproj', '<Project><Version>9.8.7</Version></Project>');
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /align|match|version/i);
  assert.deepEqual(f.snapshot(), before);
});

test('preview handles a real-sized lockfile without native command line limits', { skip: !shell }, t => {
  const f = fixture(t);
  const lock = JSON.parse(readFileSync(join(f.repo, f.files[3]), 'utf8'));
  lock.packages['node_modules/fixture'].description = 'large lockfile content '.repeat(10_000);
  f.put(f.files[3], JSON.stringify(lock, null, 2));
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch');
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(f.snapshot(), before);
});

test('publish rejects a bump beyond the native build version limit before mutation', { skip: !shell }, t => {
  const f = fixture(t);
  for (const path of f.files) f.put(path, readFileSync(join(f.repo, path), 'utf8').replaceAll('1.2.3', '65534.1.2'));
  f.git('add', '.');
  f.git('commit', '-m', 'Maximum major version');
  f.connectLocalRemote();
  const before = f.snapshot();
  const result = f.ship('-Bump', 'major', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /version|65534|build/i);
  assert.deepEqual(f.snapshot(), before);
});

test('publish rejects another origin before mutation', { skip: !shell }, t => {
  const f = fixture(t);
  f.git('remote', 'set-url', 'origin', 'https://github.com/other/Vumiro.git');
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /origin/i);
  assert.deepEqual(f.snapshot(), before);
});

test('preview blocks origin URL rewrites to another destination without contacting it', { skip: !shell }, t => {
  const f = fixture(t);
  f.git('config', 'url.https://github.com/other/Vumiro.git.insteadOf', origin);
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Publishing blocked:.*origin/);
  assert.deepEqual(f.snapshot(), before);
});

test('publish rejects invalid JavaScript before metadata changes', { skip: !shell }, t => {
  const f = fixture(t);
  f.put('client.mjs', 'const = invalid;');
  f.git('add', '.');
  f.git('commit', '-m', 'Broken JavaScript');
  f.connectLocalRemote();
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /syntax|check|client.mjs/i);
  assert.deepEqual(f.snapshot(), before);
});

test('publish refuses an existing remote tag before mutation', { skip: !shell }, t => {
  const f = fixture(t);
  const remote = f.connectLocalRemote();
  f.git('--git-dir', remote, 'tag', 'client-v1.2.4', 'refs/heads/main');
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /tag[\s\S]*exist|exist[\s\S]*tag/i);
  assert.deepEqual(f.snapshot(), before);
});

test('publish refuses remote main divergence before mutation', { skip: !shell }, t => {
  const f = fixture(t);
  f.connectLocalRemote();
  f.put('change.txt', 'not pushed');
  f.git('add', '.');
  f.git('commit', '-m', 'Local ahead');
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /remote.*main|origin.*main/i);
  assert.deepEqual(f.snapshot(), before);
});

test('publish commits only version metadata, preserves formatting, and atomically pushes an annotated tag', { skip: !shell }, t => {
  const f = fixture(t);
  f.put('generated/ignored.txt', 'ignored output');
  const remote = f.connectLocalRemote();
  const before = f.snapshot();
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.equal(result.status, 0, result.output);
  const after = f.snapshot();
  assert.notEqual(after.head, before.head);
  assert.equal(after.status, '');
  assert.equal(after.tags, 'client-v1.2.4');
  assert.equal(f.git('cat-file', '-t', 'client-v1.2.4'), 'tag');
  assert.equal(f.git('--git-dir', remote, 'rev-parse', 'refs/heads/main'), after.head);
  assert.equal(f.git('--git-dir', remote, 'rev-parse', 'client-v1.2.4^{}'), after.head);
  assert.deepEqual(f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), f.files.slice().sort());
  for (let i = 0; i < 3; i++) assert.equal(after.contents[i], before.contents[i].replace('1.2.3', '1.2.4'));
  assert.equal(after.contents[3], before.contents[3].replace('1.2.3', '1.2.4').replace('1.2.3', '1.2.4'));
  assert.match(result.output, /https:\/\/github.com\/snoopeh\/Vumiro\/actions/);
  assert.ok(result.output.includes(after.head), result.output);
});

test('publish pushes only the requested tag even when push.followTags is configured', { skip: !shell }, t => {
  const f = fixture(t);
  const remote = f.connectLocalRemote();
  f.git('tag', '-a', 'unrelated-tag', '-m', 'Keep local');
  f.git('config', 'push.followTags', 'true');
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.equal(result.status, 0, result.output);
  assert.equal(f.git('--git-dir', remote, 'tag'), 'client-v1.2.4');
});

test('failed atomic push preserves local release and prints recovery instructions without remote changes', { skip: !shell }, t => {
  const f = fixture(t);
  const remote = f.connectLocalRemote();
  const originalHead = f.snapshot().head;
  writeFileSync(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /stopped after local changes/);
  assert.match(result.output, /git push --atomic/);
  assert.equal(f.git('--git-dir', remote, 'rev-parse', 'refs/heads/main'), originalHead);
  assert.equal(f.git('--git-dir', remote, 'tag'), '');
  assert.notEqual(f.snapshot().head, originalHead);
  assert.equal(f.git('cat-file', '-t', 'client-v1.2.4'), 'tag');
  assert.equal(f.snapshot().status, '');
});

test('failed version commit leaves reviewable metadata and prints recovery instructions', { skip: !shell }, t => {
  const f = fixture(t);
  f.connectLocalRemote();
  const originalHead = f.snapshot().head;
  writeFileSync(join(f.repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = f.ship('-Bump', 'patch', '-Publish', '-QaAccepted');
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /stopped after local changes/);
  assert.match(result.output, /finish the version commit and annotated tag/);
  assert.equal(f.snapshot().head, originalHead);
  assert.equal(f.snapshot().tags, '');
  assert.match(f.snapshot().status, /package.json/);
  assert.equal(JSON.parse(readFileSync(join(f.repo, 'Vumiro.Linux/package.json'), 'utf8')).version, '1.2.4');
});
