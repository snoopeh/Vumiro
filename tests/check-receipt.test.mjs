import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, readFile, unlink, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {snapshotInputs, checkKey, loadReceipt, saveReceipt} from '../scripts/lib/check-receipt.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'vumiro-receipt-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const put = async (name, value) => {
    await mkdir(path.dirname(path.join(root, name)), {recursive: true});
    await writeFile(path.join(root, name), value);
  };
  await put('source.js', 'export const value = 1;');
  return {root, put};
}

test('fingerprints detect edits, new files and deletion, ignoring generated outputs', async t => {
  const f = await fixture(t);
  const first = await snapshotInputs(f.root);
  await f.put('dist/checks/checks-report.json', 'generated');
  assert.equal((await snapshotInputs(f.root)).fingerprint, first.fingerprint);
  await f.put('source.js', 'export const value = 2;');
  const edited = await snapshotInputs(f.root);
  assert.notEqual(edited.fingerprint, first.fingerprint);
  await f.put('shared.json', '{}');
  const added = await snapshotInputs(f.root);
  assert.notEqual(added.fingerprint, edited.fingerprint);
  await unlink(path.join(f.root, 'source.js'));
  assert.notEqual((await snapshotInputs(f.root)).fingerprint, added.fingerprint);
});

test('keys bind inputs, command, checkout, runtime and environment without recording secrets', () => {
  const input = {root: '/repo', fingerprint: 'abc', command: ['node', '--test', 'a.test.mjs'], env: {TOKEN: 'private'}, runtime: 'node22/linux'};
  const key = checkKey(input);
  for (const patch of [{root: '/other'}, {fingerprint: 'def'}, {command: ['node', '--test', 'b.test.mjs']}, {env: {TOKEN: 'changed'}}, {runtime: 'node24/linux'}]) {
    assert.notEqual(checkKey({...input, ...patch}), key);
  }
  assert.doesNotMatch(key, /private/);
});

test('only successful matching receipts with intact logs are reusable', async t => {
  const f = await fixture(t);
  const log = path.join(f.root, 'dist/checks/tests.log');
  const directory = path.join(f.root, 'dist/checks/cache');
  await f.put('dist/checks/tests.log', 'passed');
  const record = {name: 'tests', state: 'passed', verifiedAt: '2026-11-10T00:00:00.000Z', log};
  await saveReceipt(directory, 'key1', record);
  assert.equal((await loadReceipt(directory, 'tests', 'key1')).verifiedAt, record.verifiedAt);
  assert.equal(await loadReceipt(directory, 'tests', 'other-key'), null);
  await f.put('dist/checks/tests.log', 'changed');
  assert.equal(await loadReceipt(directory, 'tests', 'key1'), null);
  await saveReceipt(directory, 'key1', {...record, state: 'failed'});
  assert.equal(await loadReceipt(directory, 'tests', 'key1'), null);
  await writeFile(path.join(directory, 'tests.json'), '{bad-json');
  assert.equal(await loadReceipt(directory, 'tests', 'key1'), null);
});

test('Git snapshots include ignored tracked files and exclude non-input build products', async t => {
  const f = await fixture(t);
  const {spawnSync} = await import('node:child_process');
  const git = args => {
    const r = spawnSync('git', args, {cwd: f.root, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
  };
  git(['init', '-q']);
  await f.put('.gitignore', '*.config\ndist/\n');
  await f.put('runtime.config', 'first');
  git(['add', '-f', 'runtime.config']);
  const first = await snapshotInputs(f.root);
  await f.put('runtime.config', 'second');
  assert.notEqual((await snapshotInputs(f.root)).fingerprint, first.fingerprint);
  assert.ok((await readFile(path.join(f.root, 'runtime.config'), 'utf8')).includes('second'));
});

test('symlinks disable reuse without hiding later source changes from the receipt', async t => {
  const f = await fixture(t);
  try {
    await symlink(f.root, path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM') return t.skip('Symlink creation requires privileges on this host.');
    throw error;
  }
  const first = await snapshotInputs(f.root);
  assert.equal(first.cacheable, false);
  await f.put('source.js', 'changed after symlink');
  assert.notEqual((await snapshotInputs(f.root)).fingerprint, first.fingerprint);
});
