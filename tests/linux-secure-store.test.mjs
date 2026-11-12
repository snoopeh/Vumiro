import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
let module;
try { module = require('../Vumiro.Linux/secure-store.cjs'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const success = value => ({ ok: true, value });
const failure = (code, backend = 'gnome_libsecret') => ({ ok: false, error: { code, backend } });
const plain = value => JSON.parse(JSON.stringify(value));
function keyring(overrides = {}) {
  return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: value => Buffer.from('cipher:' + Buffer.from(value).toString('base64')),
    decryptString: value => { assert.ok(value.toString().startsWith('cipher:')); return Buffer.from(value.toString().slice(7), 'base64').toString(); }, ...overrides };
}
async function fixture(t, overrides = {}) {
  assert.equal(typeof module?.createSecureStore, 'function', 'secure-store module exports a testable storage factory');
  const root = await mkdtemp(path.join(os.tmpdir(), 'vumiro-secure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'profile', 'account-session.bin'), safeStorage = keyring(overrides);
  const create = () => module.createSecureStore({ safeStorage, file });
  return { root, file, safeStorage, create, store: create() };
}

test('encrypted sessions persist across instances and can be deleted without a keyring', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.store({ action: 'set', value: 'synthetic-session' }), success(true));
  const ciphertext = await readFile(f.file);
  assert.equal(ciphertext.includes('synthetic-session'), false);
  assert.deepEqual(await f.create()({ action: 'get' }), success('synthetic-session'));
  assert.deepEqual(await readdir(path.dirname(f.file)), ['account-session.bin']);
  f.safeStorage.isEncryptionAvailable = () => false;
  f.safeStorage.decryptString = () => { throw Error('must not decrypt'); };
  assert.deepEqual(await f.create()({ action: 'delete' }), success(true));
  assert.deepEqual(await f.create()({ action: 'get' }), success(''));
  assert.deepEqual(await f.create()({ action: 'delete' }), success(true));
});

test('missing sessions read as empty even when backend inspection throws', async t => {
  const f = await fixture(t, { isEncryptionAvailable() { throw Error('private OS detail'); }, getSelectedStorageBackend() { throw Error('private backend detail'); } });
  assert.deepEqual(await f.store({ action: 'get' }), success(''));
  assert.deepEqual(await f.store({ action: 'status' }), success({ available: false, code: 'SECURE_STORAGE_UNAVAILABLE', backend: 'unknown' }));
});

test('backend status is allowlisted and never describes unprotected or unknown storage as available', async t => {
  const f = await fixture(t);
  for (const backend of ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']) {
    f.safeStorage.getSelectedStorageBackend = () => backend;
    assert.deepEqual(await f.store({ action: 'status' }), success({ available: true, code: null, backend }));
  }
  for (const [backend, code, reported] of [['basic_text', 'SECURE_STORAGE_UNPROTECTED', 'basic_text'], ['private path / secret', 'SECURE_STORAGE_UNAVAILABLE', 'unknown']]) {
    f.safeStorage.getSelectedStorageBackend = () => backend;
    assert.deepEqual(await f.store({ action: 'status' }), success({ available: false, code, backend: reported }));
    assert.deepEqual(await f.store({ action: 'set', value: 'session' }), failure(code, reported));
  }
});

test('locked, unprotected, decrypt and encrypt failures preserve existing ciphertext across restart', async t => {
  const f = await fixture(t);
  await f.store({ action: 'set', value: 'preserve-me' });
  const original = await readFile(f.file);
  f.safeStorage.isEncryptionAvailable = () => false;
  for (const request of [{ action: 'get' }, { action: 'set', value: 'replacement' }]) assert.deepEqual(await f.create()(request), failure('SECURE_STORAGE_UNAVAILABLE'));
  f.safeStorage.isEncryptionAvailable = () => true;
  f.safeStorage.getSelectedStorageBackend = () => 'basic_text';
  assert.deepEqual(await f.create()({ action: 'get' }), failure('SECURE_STORAGE_UNPROTECTED', 'basic_text'));
  f.safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
  f.safeStorage.decryptString = () => { throw Error('private decryption key'); };
  assert.deepEqual(await f.create()({ action: 'get' }), failure('SECURE_STORAGE_READ_FAILED'));
  f.safeStorage.encryptString = () => { throw Error('private encryption key'); };
  assert.deepEqual(await f.create()({ action: 'set', value: 'replacement' }), failure('SECURE_STORAGE_WRITE_FAILED'));
  assert.deepEqual(await readFile(f.file), original);
  assert.deepEqual(await readdir(path.dirname(f.file)), ['account-session.bin']);
});

test('read, write and delete filesystem failures become sanitized envelopes', async t => {
  const f = await fixture(t);
  await mkdir(f.file, { recursive: true });
  assert.deepEqual(await f.store({ action: 'get' }), failure('SECURE_STORAGE_READ_FAILED'));
  assert.deepEqual(await f.store({ action: 'delete' }), failure('SECURE_STORAGE_DELETE_FAILED', 'unknown'));
  assert.deepEqual(await f.store({ action: 'set', value: 'session' }), failure('SECURE_STORAGE_WRITE_FAILED'));
  assert.deepEqual(await readdir(path.dirname(f.file)), ['account-session.bin']);
});

test('invalid and malicious requests cannot read, delete or replace ciphertext', async t => {
  const f = await fixture(t);
  await f.store({ action: 'set', value: 'retained' });
  const original = await readFile(f.file);
  for (const request of [null, [], {}, { action: 'constructor' }, { action: '__proto__' }, { action: 'set', value: 1 }, { action: 'set', value: 'x'.repeat(8193) }, { action: 'delete', file: f.file }, { action: 'status', extra: true }]) {
    assert.deepEqual(await f.store(request), failure('SECURE_STORAGE_INVALID_REQUEST', 'unknown'));
    assert.deepEqual(await readFile(f.file), original);
  }
});

test('IPC handler validates sender before inspecting request or touching storage', async () => {
  assert.equal(typeof module?.createSecureStoreHandler, 'function', 'IPC factory is available');
  let calls = 0;
  const handler = module.createSecureStoreHandler({ store: async request => { calls++; return success(request.action); }, isTrusted: event => event.trusted === true });
  assert.deepEqual(await handler({ trusted: false }, { get action() { throw Error('request inspected'); } }), failure('SECURE_STORAGE_FORBIDDEN', 'unknown'));
  assert.equal(calls, 0);
  assert.deepEqual(await handler({ trusted: true }, { action: 'status' }), success('status'));
  assert.equal(calls, 1);
});

function bridge(invoke) {
  let exposed;
  vm.runInNewContext(readFileSync(new URL('../Vumiro.Linux/preload.js', import.meta.url), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { exposed = value; } }, ipcRenderer: { on() {}, send() {}, invoke } }),
    process: { argv: [] },
  });
  return exposed.secureStore;
}

test('preload unwraps success and exposes capability status', async () => {
  const calls = [], value = { available: false, code: 'SECURE_STORAGE_UNAVAILABLE', backend: 'kwallet6' };
  const secure = bridge(async (channel, request) => { calls.push([channel, plain(request)]); return success(request.action === 'status' ? value : request.action === 'get' ? 'session' : true); });
  assert.equal(await secure.get(), 'session');
  assert.equal(await secure.set('new'), true);
  assert.equal(await secure.delete(), true);
  assert.deepEqual(plain(await secure.status()), value);
  assert.deepEqual(calls.map(call => call[1]), [{ action: 'get' }, { action: 'set', value: 'new' }, { action: 'delete' }, { action: 'status' }]);
});

test('secure-store methods work when detached across the context bridge without exposing internal helpers', async () => {
  const secure = bridge(async () => success('session'));
  const get = secure.get;
  assert.equal(await get(), 'session');
  assert.deepEqual(Object.keys(secure).sort(), ['delete', 'get', 'set', 'status']);
});

test('preload converts sanitized failures and malformed replies into fixed-message errors', async () => {
  for (const code of ['SECURE_STORAGE_UNAVAILABLE', 'SECURE_STORAGE_UNPROTECTED', 'SECURE_STORAGE_READ_FAILED', 'SECURE_STORAGE_WRITE_FAILED', 'SECURE_STORAGE_DELETE_FAILED', 'SECURE_STORAGE_INVALID_REQUEST', 'SECURE_STORAGE_FORBIDDEN']) {
    await assert.rejects(bridge(async () => ({ ...failure(code, 'kwallet5'), message: 'secret path' })).get(), error => error.code === code && error.backend === 'kwallet5' && error.message === 'Secure account storage could not complete the request.');
  }
  for (const reply of [null, 'secret reply', { ok: false, error: { code: 'secret code', backend: 'secret backend' } }]) {
    await assert.rejects(bridge(async () => reply).get(), error => error.code === 'SECURE_STORAGE_READ_FAILED' && error.backend === 'unknown' && !error.message.includes('secret'));
  }
  await assert.rejects(bridge(async () => { throw Error('private DBus address'); }).get(), error => error.code === 'SECURE_STORAGE_READ_FAILED' && error.backend === 'unknown' && !error.message.includes('DBus'));
});

test('main registers the sender-gated secure storage handler and packages the implementation', () => {
  const source = readFileSync(new URL('../Vumiro.Linux/main.cjs', import.meta.url), 'utf8');
  assert.match(source, /createSecureStoreHandler/);
  assert.match(source, /isTrusted:\s*(?:\(?event\)?\s*=>\s*)validAccountFrame\(event.sender,\s*event.senderFrame\)/);
  assert.ok(JSON.parse(readFileSync(new URL('../Vumiro.Linux/package.json', import.meta.url), 'utf8')).build.files.includes('secure-store.cjs'));
});

test('real main sender gate rejects foreign contents, subframes and untrusted documents before all storage actions', async t => {
  const f = await fixture(t);
  const source = readFileSync(new URL('../Vumiro.Linux/main.cjs', import.meta.url), 'utf8');
  let handler;
  const contents = { mainFrame: { url: 'vumiro://app/auth.html' } };
  const functions = ['parseAppUrl', 'isTrustedPage', 'validMainFrame', 'validAccountFrame'].map(name => {
    const start = source.indexOf('function ' + name + '('), end = source.indexOf('\n}', start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end + 2);
  }).join('\n');
  const start = source.indexOf("  const { createSecureStore, createSecureStoreHandler } = require('./secure-store.cjs');");
  const end = source.indexOf("  ipcMain.on('vumiro:post-message'", start);
  vm.runInNewContext(functions + '\n' + source.slice(start, end), {
    APP_SCHEME: 'vumiro', APP_HOST: 'app', URL, path,
    mainWindow: { webContents: contents }, safeStorage: f.safeStorage,
    app: { getPath: () => path.dirname(f.file) }, require: name => { assert.equal(name, './secure-store.cjs'); return module; },
    ipcMain: { handle(channel, callback) { assert.equal(channel, 'vumiro:secure-store'); handler = callback; } }
  });
  const trusted = { sender: contents, senderFrame: contents.mainFrame };
  assert.deepEqual(plain(await handler(trusted, { action: 'set', value: 'retained' })), success(true));
  const original = await readFile(f.file);
  for (const event of [{ sender: {}, senderFrame: contents.mainFrame }, { sender: contents, senderFrame: { url: contents.mainFrame.url } }]) {
    for (const action of ['get', 'set', 'delete', 'status']) assert.deepEqual(plain(await handler(event, { action, value: 'overwrite' })), failure('SECURE_STORAGE_FORBIDDEN', 'unknown'));
  }
  for (const url of ['https://example.test/auth.html', 'vumiro://app/call.html', 'vumiro://other/auth.html', 'vumiro://user@app/auth.html']) {
    contents.mainFrame.url = url;
    assert.deepEqual(plain(await handler(trusted, { action: 'delete' })), failure('SECURE_STORAGE_FORBIDDEN', 'unknown'));
  }
  assert.deepEqual(await readFile(f.file), original);
  contents.mainFrame.url = 'vumiro://app/friends.html';
  assert.deepEqual(plain(await handler(trusted, { action: 'get' })), success('retained'));
});
