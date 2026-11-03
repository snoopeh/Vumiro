// Interactive production OAuth acceptance check. Open the printed authorization
// URL manually in the browser. Credentials, codes and tokens stay in memory.
// No provider administration, device enrollment, profile/store access or deletion.
// Usage: node scripts/Test-OAuthProvider.mjs --provider google [--check]
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE = 'https://vumiro-rooms.vumiro-signaling.workers.dev';
const AUTH = 'https://rrrflwevxojheaejbcnp.supabase.co';
const nodeRequire = createRequire(import.meta.url);
let stage = 'arguments';
let native;
let pending;
let accessToken = '';
let clientKey = '';
let logoutComplete = false;
let interrupted = false;

function pass(name) { console.log(`PASS: ${name}`); }
function requireCondition(value) { if (!value) throw new Error('Acceptance condition failed.'); }
function parseArguments() {
  const args = process.argv.slice(2);
  requireCondition(args.length >= 2 && args[0] === '--provider' && ['google', 'azure'].includes(args[1]));
  requireCondition(args.length === 2 || (args.length === 3 && args[2] === '--check'));
  return { provider: args[1], check: args[2] === '--check' };
}

function createBridge() {
  let notify;
  const browserOpened = new Promise(resolve => { notify = resolve; });
  const app = {
    getAppPath: () => ROOT, getPath: () => ROOT, setName() {}, setPath() {},
    getVersion: () => 'oauth-acceptance', requestSingleInstanceLock: () => false, quit() {}
  };
  const electron = {
    app, protocol: { registerSchemesAsPrivileged() {} },
    shell: { async openExternal(value) { notify(new URL(value)); } }
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : nodeRequire(name),
    __dirname: path.join(ROOT, 'Vumiro.Linux'), process, URL, URLSearchParams, Response, AbortSignal,
    setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} }
  });
  // Match the existing desktop OAuth test seam. No Electron windows or storage
  // are initialized because the simulated app does not obtain the instance lock.
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'Vumiro.Linux/main.cjs'), 'utf8') +
    '\nglobalThis.acceptanceOAuth = { startOAuth, cancel: () => cancelOAuth && cancelOAuth() };', context,
  { filename: 'Vumiro.Linux/main.cjs', timeout: 5000 });
  return { ...context.acceptanceOAuth, browserOpened };
}

function validateAuthorize(url, provider, challenge) {
  requireCondition(url.origin === AUTH && url.pathname === '/auth/v1/authorize' && !url.hash && !url.username && !url.password);
  const names = [...url.searchParams.keys()].sort().join(',');
  requireCondition(names === 'code_challenge,code_challenge_method,provider,redirect_to,scopes');
  requireCondition(url.searchParams.get('provider') === provider && url.searchParams.get('code_challenge') === challenge &&
    url.searchParams.get('code_challenge_method') === 's256' &&
    url.searchParams.get('scopes') === (provider === 'azure' ? 'email' : 'openid email profile'));
  const callback = new URL(url.searchParams.get('redirect_to'));
  requireCondition(callback.origin === 'http://127.0.0.1:43821' && /^\/vumiro-auth\/[A-Za-z0-9_-]{32}\/$/.test(callback.pathname) && !callback.search && !callback.hash);
  return callback;
}

async function jsonRequest(url, options = {}) {
  // All callers construct fixed HTTPS endpoints. Never follow an unexpected
  // redirect with a bearer token or print an untrusted provider response.
  requireCondition(new URL(url).origin === AUTH || new URL(url).origin === SERVICE);
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  requireCondition(response.ok);
  const text = await response.text();
  requireCondition(text.length < 2 * 1024 * 1024);
  return text ? JSON.parse(text) : null;
}
async function authRequest(endpoint, body, token = '') {
  return jsonRequest(`${AUTH}/auth/v1${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { apikey: clientKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}
function hasProvider(user, provider) {
  return Array.isArray(user?.identities) && user.identities.some(identity => identity?.provider === provider) &&
    Array.isArray(user?.app_metadata?.providers) && user.app_metadata.providers.includes(provider);
}
function validateSession(value, provider, previousId = '') {
  requireCondition(typeof value?.access_token === 'string' && value.access_token.length > 32 &&
    // Refresh tokens are opaque; OAuth does not define a minimum size. The
    // subsequent real refresh request establishes validity, not token length.
    typeof value.refresh_token === 'string' && value.refresh_token.length > 0 &&
    typeof value.user?.id === 'string' && /^[0-9a-f-]{36}$/i.test(value.user.id) && hasProvider(value.user, provider) &&
    (!previousId || value.user.id === previousId));
}
async function checkPortReleased() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(43821, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()));
  });
}
function cancel() { interrupted = true; native?.cancel(); }

try {
  const { provider, check } = parseArguments();
  if (check) {
    stage = 'opaque refresh token validation';
    const fixture = { access_token: 'synthetic-access-credential-for-schema-check', refresh_token: 'short',
      user: { id: '11111111-1111-4111-8111-111111111111', identities: [{ provider }], app_metadata: { providers: [provider] } } };
    validateSession(fixture, provider);
    let rejectedEmpty = false;
    try { validateSession({ ...fixture, refresh_token: '' }, provider); } catch { rejectedEmpty = true; }
    requireCondition(rejectedEmpty);
    pass(stage);
  }
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  stage = 'production desktop OAuth fixture';
  native = createBridge();
  pass(stage);
  if (!check) {
    stage = 'public production configuration';
    const cfg = await jsonRequest(`${SERVICE}/api/v1/account/config`);
    requireCondition(cfg?.serviceEnabled === true && cfg.authUrl === AUTH &&
      typeof cfg.publishableKey === 'string' && /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(cfg.publishableKey));
    clientKey = cfg.publishableKey;
    // Provider flags may remain off during this prelaunch acceptance check.
    pass(stage);
  }
  requireCondition(!interrupted);
  let verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  stage = 'loopback listener and PKCE authorization URL';
  pending = native.startOAuth({ authUrl: AUTH, provider, codeChallenge: challenge });
  pending.catch(() => {});
  const authorize = await Promise.race([native.browserOpened, pending.then(() => { throw new Error('Unexpected early callback.'); })]);
  const callback = validateAuthorize(authorize, provider, challenge);
  pass(stage);
  if (check) {
    stage = 'wrong callback transaction rejected';
    const wrong = new URL(callback);
    wrong.pathname = '/vumiro-auth/not-the-current-transaction/';
    wrong.search = '?code=synthetic-invalid-transaction';
    const rejected = await fetch(wrong, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    requireCondition(rejected.status === 400);
    pass(stage);
    stage = 'controlled cancellation and callback port released';
    native.cancel();
    let cancelled = false;
    try { await pending; } catch { cancelled = true; }
    requireCondition(cancelled);
    await checkPortReleased();
    verifier = '';
    pass(stage);
    console.log('PASS: offline harness check; no provider sign-in was attempted');
  } else {
    console.log(`AUTHORIZE_URL: ${authorize.href}`);
    console.log('WAIT: open the authorization URL in the browser and complete provider sign-in within five minutes');
    stage = 'real provider callback and PKCE exchange';
    let result = await pending;
    requireCondition(typeof result?.code === 'string' && result.code.length > 0 && result.code.length <= 2048);
    let session = await authRequest('/token?grant_type=pkce', { auth_code: result.code, code_verifier: verifier });
    result = null;
    verifier = '';
    // Retain the access credential for local-scope cleanup even if subsequent
    // identity checks fail. No provider tokens are persisted or displayed.
    accessToken = typeof session?.access_token === 'string' ? session.access_token : '';
    validateSession(session, provider);
    pass(stage);
    stage = 'provider identity and authenticated user';
    const id = session.user.id;
    const user = await authRequest('/user', undefined, accessToken);
    requireCondition(user?.id === id && hasProvider(user, provider));
    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8'));
    const now = Date.now() / 1000;
    requireCondition(Array.isArray(claims.amr) && claims.amr.some(item => item?.method === 'oauth' &&
      Number(item.timestamp) >= now - 300 && Number(item.timestamp) <= now + 60));
    pass(stage);
    stage = 'session refresh preserves account identity';
    const refreshed = await authRequest('/token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    if (typeof refreshed?.access_token === 'string') accessToken = refreshed.access_token;
    validateSession(refreshed, provider, id);
    session = null;
    pass(stage);
    stage = 'test session local logout';
    await authRequest('/logout?scope=local', {}, accessToken);
    logoutComplete = true;
    accessToken = '';
    pass(stage);
    console.log(`PASS: real ${provider} OAuth callback, PKCE, identity, refresh and local logout`);
  }
} catch {
  // Never expose exception strings, HTTP bodies, callback URLs or credentials.
  console.error(`FAIL: ${stage}`);
  if (stage === 'arguments') console.error('Usage: node scripts/Test-OAuthProvider.mjs --provider google|azure [--check]');
  process.exitCode = 1;
} finally {
  native?.cancel();
  if (pending) await pending.catch(() => {});
  if (accessToken && clientKey && !logoutComplete) {
    try { await authRequest('/logout?scope=local', {}, accessToken); console.log('PASS: test session local cleanup'); }
    catch { console.error('FAIL: test session local cleanup; provider session was not deleted'); process.exitCode = 1; }
  }
  accessToken = '';
  clientKey = '';
  process.off('SIGINT', cancel);
  process.off('SIGTERM', cancel);
}
