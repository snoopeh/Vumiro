import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const library = new URL('../scripts/lib/check-plan.mjs', import.meta.url);
async function planner() {
  assert.ok(existsSync(library), 'feature-scoped check planner exists');
  return import(library);
}
async function plan(options = {}) { return (await planner()).createCheckPlan({ root, ...options }); }

test('default plans discover every top-level test and all native/backend checks', async () => {
  const result = await plan();
  const files = (await readdir(path.join(root, 'tests'))).filter(file => file.endsWith('.test.mjs')).map(file => `tests/${file}`).sort();
  assert.deepEqual(result.tests, files);
  assert.equal(result.full, true);
  assert.equal(result.backend, true);
  assert.equal(result.native.length, 14);
  assert.ok(result.native.some(check=>check.project.endsWith('MarketplaceLinkChecks.csproj')));
  assert.ok(result.native.some(check => check.project.endsWith('NativeAudioSmoke.csproj') && check.args.includes('--self-test')));
});

test('chat group selects explicit chat tests without backend or unrelated release checks', async () => {
  const result = await plan({ groups: ['chat'] });
  assert.equal(result.full, false);
  assert.deepEqual(result.groups, ['chat']);
  assert.ok(result.tests.includes('tests/chat-pane.test.mjs'));
  assert.ok(result.tests.includes('tests/room-chat-media.test.mjs'));
  assert.ok(!result.tests.includes('tests/ship-command.test.mjs'));
  assert.equal(result.backend, false);
  assert.deepEqual(result.native, []);
});

test('marketplace group includes licensing commerce and desktop link acceptance checks',async()=>{
  const result=await plan({groups:['marketplace']});
  assert.equal(result.full,false);assert.equal(result.backend,true);
  assert.ok(result.tests.includes('tests/marketplace-model.test.mjs'));
  assert.ok(result.native.some(check=>check.name==='marketplace-links'));
});

test('leaf source changes infer groups and include packaging consumers', async () => {
  const result = await plan({ changedFiles: ['Vumiro.Client/WebServer/chat-pane.js'] });
  assert.ok(result.groups.includes('chat'));
  assert.ok(result.tests.includes('tests/chat-pane.test.mjs'));
  assert.ok(result.tests.includes('tests/package-web-bundle.test.mjs'));
  assert.equal(result.full, false);
});

test('HTML changes include localization consumers', async () => {
  const result = await plan({ changedFiles: ['Vumiro.Client/WebServer/auth.html'] });
  assert.ok(result.tests.includes('tests/i18n.test.mjs'));
});

test('backend and profile changes select backend tests only when relevant', async () => {
  const accounts = await plan({ changedFiles: ['cloudflare/accounts.js'] });
  assert.equal(accounts.backend, true);
  assert.ok(accounts.tests.includes('tests/profile-card-data.test.mjs'));
  const chat = await plan({ groups: ['chat'], skipBackend: true });
  assert.equal(chat.backend, false);
  assert.equal((await plan({ groups: ['accounts'], skipBackend: true })).backend, false);
});

test('docs-only and empty changes execute no tests', async () => {
  for (const changedFiles of [[], ['docs/LOCAL-DEVELOPMENT.md', 'README.md']]) {
    const result = await plan({ changedFiles });
    assert.equal(result.full, false);
    assert.deepEqual(result.tests, []);
    assert.deepEqual(result.native, []);
    assert.equal(result.backend, false);
  }
});

test('explicit groups combine with changed files and deduplicate tests', async () => {
  const result = await plan({ groups: ['chat', 'chat'], changedFiles: ['Vumiro.Client/WebServer/profile-crop.js'] });
  assert.ok(result.groups.includes('chat'));
  assert.ok(result.groups.includes('profile'));
  assert.ok(result.tests.includes('tests/profile-crop.test.mjs'));
  assert.equal(result.tests.length, new Set(result.tests).size);
});

test('unknown, shared, automation, native host and new test paths fall back to full checks', async () => {
  for (const file of ['unknown.js', '.github/workflows/build.yml', 'scripts/new-check.mjs', 'Vumiro.Client/Program.cs', 'Vumiro.Client/WebServer/call-client.js', 'tests/new-test.test.mjs']) {
    const result = await plan({ changedFiles: [file] });
    assert.equal(result.full, true, file);
    assert.equal(result.backend, true, file);
    assert.match(result.reason, /full|shared|unknown|unclassified/i);
  }
});

test('known test changes expand to their feature group', async () => {
  const result = await plan({ changedFiles: ['tests/chat-pane.test.mjs'] });
  assert.ok(result.groups.includes('chat'));
  assert.equal(result.full, false);
});

test('all native group checks have existing projects, and manifest maps current tests', async () => {
  const result = await plan({ groups: ['native'] });
  assert.equal(result.native.length, 14);
  for (const check of result.native) assert.ok(existsSync(path.join(root, check.project)), check.project);
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/feature-checks.json'), 'utf8'));
  const mapped = new Set(Object.values(manifest.groups).flatMap(group => group.tests));
  for (const file of (await plan()).tests) assert.ok(mapped.has(file), file);
});

test('full plan discovers tests from the requested repository root', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vumiro-plan-root-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'tests/nested'), { recursive: true });
  await mkdir(path.join(directory, 'scripts'));
  await writeFile(path.join(directory, 'scripts/feature-checks.json'), await readFile(path.join(root, 'scripts/feature-checks.json')));
  await writeFile(path.join(directory, 'tests/fixture.test.mjs'), '');
  await writeFile(path.join(directory, 'tests/nested/ignored.test.mjs'), '');
  assert.deepEqual((await plan({ root: directory })).tests, ['tests/fixture.test.mjs']);
});

test('unknown group and invalid changed-file inputs fail visibly', async () => {
  await assert.rejects(plan({ groups: ['typo'] }), /unknown.*group/i);
  await assert.rejects(plan({ changedFiles: ['../outside.js'] }), /path/i);
});

async function gitFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'vumiro-check-plan-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'core.autocrlf', 'false'); git('config', 'user.email', 'checks@example.invalid'); git('config', 'user.name', 'Check fixture');
  await writeFile(path.join(directory, 'original name.js'), 'one\n');
  await writeFile(path.join(directory, 'deleted.js'), 'deleted\n');
  git('add', '.'); git('commit', '-qm', 'initial');
  return { directory, git };
}

test('git changes include committed, staged, unstaged, untracked and both rename sides', async t => {
  const { changedFilesSince } = await planner();
  const { directory, git } = await gitFixture(t);
  const ref = git('rev-parse', 'HEAD');
  git('mv', 'original name.js', 'renamed name.js'); git('commit', '-qm', 'rename');
  await writeFile(path.join(directory, 'staged.js'), 'stage\n'); git('add', 'staged.js');
  await writeFile(path.join(directory, 'renamed name.js'), 'changed\n');
  await rm(path.join(directory, 'deleted.js'));
  await mkdir(path.join(directory, 'new directory'));
  await writeFile(path.join(directory, 'new directory/untracked.js'), 'new\n');
  const files = await changedFilesSince(directory, ref);
  assert.deepEqual(files, ['deleted.js', 'new directory/untracked.js', 'original name.js', 'renamed name.js', 'staged.js']);
});

test('git errors never become an empty change list', async t => {
  const { changedFilesSince } = await planner();
  const { directory } = await gitFixture(t);
  await assert.rejects(changedFilesSince(directory, 'missing-ref'), /git|revision|ref/i);
  const nonRepo = await mkdtemp(path.join(os.tmpdir(), 'vumiro-not-git-'));
  t.after(() => rm(nonRepo, { recursive: true, force: true }));
  await assert.rejects(changedFilesSince(nonRepo, 'HEAD'), /git|repository/i);
});
