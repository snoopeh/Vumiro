import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);

function bridge() {
  let opened;
  const windowActions = [];
  let notify;
  const browserOpened = new Promise(resolve => { notify = resolve; });
  const app = { getAppPath: () => root, getPath: () => root, setName() {}, setPath() {}, getVersion: () => '1.21.4', requestSingleInstanceLock: () => false, quit() {} };
  const electron = { app, protocol: { registerSchemesAsPrivileged() {} }, shell: { async openExternal(value) { opened = new URL(value); notify(opened); } } };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : nodeRequire(name),
    __dirname: path.join(root, 'Vumiro.Linux'), process, URL, URLSearchParams, Response, AbortSignal,
    setTimeout, clearTimeout, console
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'Vumiro.Linux/main.cjs'), 'utf8') + '\nglobalThis.checkOAuth = { startOAuth, cancel: () => cancelOAuth && cancelOAuth(), setWindow: window => { mainWindow = window; } };', context);
  context.checkOAuth.setWindow({ isDestroyed: () => false, isMinimized: () => true, isVisible: () => false,
    restore: () => windowActions.push('restore'), show: () => windowActions.push('show'), focus: () => windowActions.push('focus') });
  return { ...context.checkOAuth, windowActions, browserOpened, get opened() { return opened; } };
}

const request = { authUrl: 'https://project-example.supabase.co', provider: 'google', codeChallenge: 'a'.repeat(43) };

test('desktop OAuth opens a PKCE URL and accepts only its loopback transaction', async () => {
  const native = bridge();
  const flow = native.startOAuth(request);
  try {
    const authorize = await native.browserOpened;
    assert.equal(authorize.origin, request.authUrl);
    assert.equal(authorize.pathname, '/auth/v1/authorize');
    assert.equal(authorize.searchParams.get('provider'), 'google');
    assert.equal(authorize.searchParams.get('code_challenge'), request.codeChallenge);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 's256');
    assert.equal(authorize.searchParams.get('scopes'), 'openid email profile');
    const callback = new URL(authorize.searchParams.get('redirect_to'));
    assert.equal(callback.origin, 'http://127.0.0.1:43821');
    assert.match(callback.pathname, /^\/vumiro-auth\/[A-Za-z0-9_-]{32}\/$/);
    await assert.rejects(native.startOAuth(request), /already open/);
    const wrong = new URL(callback); wrong.pathname = '/vumiro-auth/wrong/'; wrong.search = '?code=stolen';
    assert.equal((await fetch(wrong)).status, 400);
    const duplicate = new URL(callback); duplicate.search = '?code=one&code=two';
    assert.equal((await fetch(duplicate)).status, 400);
    const ambiguous = new URL(callback); ambiguous.search = '?code=one&error=denied';
    assert.equal((await fetch(ambiguous)).status, 400);
    assert.deepEqual(native.windowActions, [], 'Unrelated or invalid callbacks cannot activate the app.');
    callback.search = '?code=one-use-code';
    const response = await fetch(callback);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.text();
    assert.ok(!body.includes('one-use-code'));
    const script = body.match(/<script>(.*?)<\/script>/)[1];
    assert.match(script, /history\.replaceState/);
    assert.match(script, /window\.close\(\)/);
    assert.match(body, /If this tab stays open/);
    const scriptHash = createHash('sha256').update(script).digest('base64');
    assert.ok(response.headers.get('content-security-policy').includes(`'sha256-${scriptHash}'`));
    assert.equal((await flow).code, 'one-use-code');
    assert.deepEqual(native.windowActions, ['restore', 'show', 'focus']);
  } finally { native.cancel(); await flow.catch(() => {}); }
});

test('desktop OAuth restricts provider origins and Microsoft requests email scope', async () => {
  const native = bridge();
  for (const authUrl of ['http://project-example.supabase.co', 'https://attacker.example', 'https://project-example.supabase.co.evil.test', 'https://project-example.supabase.co/path', 'https://user@project-example.supabase.co'])
    await assert.rejects(native.startOAuth({ ...request, authUrl }), /Invalid/);
  await assert.rejects(native.startOAuth({ ...request, provider: 'other' }), /Invalid/);
  await assert.rejects(native.startOAuth({ ...request, codeChallenge: 'short' }), /Invalid/);
  const flow = native.startOAuth({ ...request, provider: 'azure' });
  const rejection = assert.rejects(flow, /cancelled or declined/);
  try {
    const authorize = await native.browserOpened;
    assert.equal(authorize.searchParams.get('provider'), 'azure');
    assert.equal(authorize.searchParams.get('scopes'), 'email');
    const callback = new URL(authorize.searchParams.get('redirect_to'));
    callback.search = '?error=access_denied&error_description=private-details';
    const result = await fetch(callback);
    const body = await result.text();
    assert.ok(!body.includes('private-details'));
    assert.ok(!body.includes('window.close'));
    await rejection;
    assert.deepEqual(native.windowActions, [], 'Provider denial cannot steal focus.');
  } finally { native.cancel(); await flow.catch(() => {}); }
});

test('cancelling desktop OAuth rejects pending sign-in and releases the callback port', async () => {
  const first = bridge();
  const pending = first.startOAuth(request);
  const rejection = assert.rejects(pending, /expired or was cancelled/);
  await first.browserOpened;
  first.cancel();
  await rejection;
  assert.deepEqual(first.windowActions, [], 'Cancelling sign-in cannot steal focus.');
  const second = bridge();
  const resumed = second.startOAuth(request);
  try {
    const callback = new URL((await second.browserOpened).searchParams.get('redirect_to'));
    callback.search = '?code=resumed';
    await fetch(callback);
    assert.equal((await resumed).code, 'resumed');
  } finally { second.cancel(); await resumed.catch(() => {}); }
});
