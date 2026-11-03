import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAccountRequest, runAccountMaintenance } from './accounts.js';

const encode = value => Buffer.from(value instanceof Uint8Array ? value : JSON.stringify(value)).toString('base64url');

// Run the production SQL against SQLite instead of matching SQL strings in a mock.
function memoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('./migrations/', import.meta.url);
  const files = readdirSync(migrations).filter(name => /^000[1-6]_.*\.sql$/.test(name)).sort();
  assert.equal(files.length, 6);
  for (const name of files) sqlite.exec(readFileSync(new URL(name, migrations), 'utf8'));
  function statement(sql, values = []) {
    return {
      bind(...bound) { return statement(sql, bound); },
      run() {
        const result = sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      first(column) {
        const row = sqlite.prepare(sql).get(...values);
        return row ? column ? row[column] : { ...row } : null;
      },
      all() { return { success: true, results: sqlite.prepare(sql).all(...values).map(row => ({ ...row })) }; }
    };
  }
  return {
    sqlite,
    prepare: statement,
    batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(query => query.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    close() { sqlite.close(); }
  };
}

async function fixture(t) {
  const db = memoryD1();
  t.after(() => db.close());
  const accountId = crypto.randomUUID(), deviceId = crypto.randomUUID();
  const base = `https://account-routes-${crypto.randomUUID()}.supabase.co`;
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  Object.assign(jwk, { kid: crypto.randomUUID(), use: 'sig', alg: 'ES256' });
  const env = {
    ACCOUNT_DB: db,
    ACCOUNT_SERVICE_ENABLED: 'true',
    ACCOUNT_REGISTRATION_ENABLED: 'true',
    SUPABASE_URL: base,
    SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(24)}`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-only'
  };
  const provider = { deleteStatus: 204, deletionCalls: [] };
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    if (url === `${base}/auth/v1/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (url === `${base}/auth/v1/admin/users/${accountId}`) {
      assert.equal(options.method, 'DELETE');
      assert.equal(options.headers.apikey, env.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(options.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
      provider.deletionCalls.push({ url, options });
      return new Response(null, { status: provider.deleteStatus });
    }
    throw new Error(`Unexpected external request in account test: ${url}`);
  });
  async function signedToken({ subject = accountId, authAge = 0 } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'ES256', typ: 'JWT', kid: jwk.kid });
    const claims = encode({ iss: `${base}/auth/v1`, aud: 'authenticated', sub: subject, role: 'authenticated', email: 'owner@example.com', iat: now - 10, exp: now + 600, amr: [{ method: 'password', timestamp: now - authAge }] });
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(`${header}.${claims}`));
    return `${header}.${claims}.${encode(new Uint8Array(signature))}`;
  }
  const token = await signedToken();
  async function request(path = '/data', method = 'GET', body, credentials = {}) {
    const headers = { Authorization: `Bearer ${credentials.token || token}`, 'X-Vumiro-Device': credentials.deviceId || deviceId };
    if (credentials.deviceToken) headers['X-Vumiro-Device-Token'] = credentials.deviceToken;
    if (credentials.profileCards !== undefined) headers['X-Vumiro-Profile-Cards'] = credentials.profileCards;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await handleAccountRequest(new Request(`https://accounts.example/api/v1/account${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), env);
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  async function enroll(id = deviceId, jwt = token) {
    const result = await request('/devices/register', 'POST', undefined, { deviceId: id, token: jwt });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.match(result.body.deviceToken, /^[0-9a-f]{64}$/);
    return { deviceId: id, deviceToken: result.body.deviceToken };
  }
  return { db, env, accountId, deviceId, provider, signedToken, request, enroll };
}

function snapshot(name = 'Owner') {
  return {
    version: 1,
    profile: { name, username: 'owner.name', avatar: '' },
    friends: [], blocked: [], settings: { fps: 60, audio: true },
    privacyNoticeVersion: '2026-11-03', privacyNoticeAcceptedAt: new Date().toISOString()
  };
}

test('account routes require enrollment and device credentials, enforce revisions, and export notice evidence', async t => {
  const app = await fixture(t);
  assert.equal((await app.request()).status, 401);
  const credentials = await app.enroll();
  const stored = app.db.prepare('SELECT credential_hash FROM account_devices WHERE account_id = ? AND device_id = ?').bind(app.accountId, app.deviceId).first();
  const expectedHash = Buffer.from(await crypto.subtle.digest('SHA-256', Buffer.from(credentials.deviceToken, 'hex'))).toString('hex');
  assert.equal(stored.credential_hash, expectedHash);
  assert.notEqual(stored.credential_hash, credentials.deviceToken);
  assert.equal((await app.request()).status, 403, 'a JWT alone cannot use an enrolled device');
  assert.equal((await app.request('/data', 'GET', undefined, { ...credentials, deviceToken: '0'.repeat(64) })).status, 403);
  const initial = await app.request('/data', 'GET', undefined, credentials);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data, null);
  assert.equal(initial.body.revision, 0);

  const original = snapshot();
  const inserted = await app.request('/data', 'PUT', { snapshot: original, expectedRevision: 0 }, credentials);
  assert.equal(inserted.status, 200, JSON.stringify(inserted.body));
  assert.equal(inserted.body.revision, 1);
  assert.equal((await app.request('/data', 'PUT', { snapshot: original, expectedRevision: 0 }, credentials)).status, 409);
  const read = await app.request('/data', 'GET', undefined, credentials);
  assert.deepEqual(read.body.data, original);
  assert.equal(read.body.revision, 1);

  const candidates = [snapshot('First writer'), snapshot('Second writer')];
  const writes = await Promise.all(candidates.map(value => app.request('/data', 'PUT', { snapshot: value, expectedRevision: 1 }, credentials)));
  assert.deepEqual(writes.map(result => result.status).sort(), [200, 409]);
  const winningSnapshot = candidates[writes.findIndex(result => result.status === 200)];
  const exported = await app.request('/export', 'GET', undefined, credentials);
  assert.equal(exported.status, 200);
  assert.deepEqual(exported.body.account, { id: app.accountId, email: 'owner@example.com' });
  assert.deepEqual(exported.body.data, winningSnapshot);
  assert.equal(exported.body.sync.revision, 2);
  assert.equal(exported.body.noticeRecords.length, 1);
  assert.equal(exported.body.noticeRecords[0].version, original.privacyNoticeVersion);
  assert.equal(exported.body.noticeRecords[0].acceptedAt, original.privacyNoticeAcceptedAt);
  assert.equal(exported.body.noticeRecords[0].deviceId, app.deviceId);
  assert.ok(Number.isFinite(Date.parse(exported.body.noticeRecords[0].recordedAt)));
  assert.equal(exported.body.devices[0].status, 'active');
  assert.equal(exported.body.devices[0].id, app.deviceId);
  assert.equal(Object.hasOwn(exported.body.devices[0], 'credential_hash'), false);
  assert.equal(JSON.stringify(exported.body).includes(credentials.deviceToken), false);
});

test('profile-card capability keeps legacy reads compatible and legacy writes preserve saved details', async t => {
  const app = await fixture(t), legacy = await app.enroll(), modern = {...legacy, profileCards:'1'};
  const original = snapshot();
  const card = {bio:'Here together.',banner:'data:image/png;base64,AA==',connections:[{provider:'github',url:'https://github.com/snoopeh'}]};
  Object.assign(original.profile,card);
  assert.equal((await app.request('/data','PUT',{snapshot:original,expectedRevision:0},legacy)).status,400,'metadata writes require capability');
  assert.equal((await app.request('/data','PUT',{snapshot:original,expectedRevision:0},modern)).status,200);
  const oldRead = await app.request('/data','GET',undefined,legacy);
  assert.equal(oldRead.status,200);
  assert.deepEqual(oldRead.body.data.profile,{name:'Owner',username:'owner.name',avatar:''});
  const newRead = await app.request('/data','GET',undefined,modern);
  assert.deepEqual(newRead.body.data.profile,original.profile);
  const outdated = structuredClone(oldRead.body.data); outdated.privacyNoticeVersion='2026-11-01';
  const upgradeRequired = await app.request('/data','PUT',{snapshot:outdated,expectedRevision:1},legacy);
  assert.equal(upgradeRequired.status,426);
  assert.match(upgradeRequired.body.error,/Update Vumiro.*current privacy notice/);
  assert.equal((await app.request('/data','GET',undefined,legacy)).body.revision,1,'old notice rejection does not change saved data');
  assert.equal((await app.request('/export','GET',undefined,legacy)).status,200,'old clients retain export access');
  const oldWrite = structuredClone(oldRead.body.data); oldWrite.profile.name='Changed on an older device';
  assert.equal((await app.request('/data','PUT',{snapshot:oldWrite,expectedRevision:1},legacy)).status,200);
  const preserved = await app.request('/data','GET',undefined,modern);
  assert.deepEqual(preserved.body.data.profile,{...oldWrite.profile,...card});
  assert.equal(preserved.body.revision,2);
  const stale = structuredClone(oldWrite); stale.profile.name='Stale writer';
  assert.equal((await app.request('/data','PUT',{snapshot:stale,expectedRevision:1},legacy)).status,409);
  assert.deepEqual((await app.request('/export','GET',undefined,legacy)).body.data.profile,preserved.body.data.profile,'exports include every field even on older clients');
  assert.equal((await app.request('/data','GET',undefined,{...legacy,profileCards:'2'})).status,400);
  assert.equal((await app.request('/data','GET',undefined,{...legacy,profileCards:'1,1'})).status,400);
  assert.match(newRead.headers.get('Access-Control-Allow-Headers'),/X-Vumiro-Profile-Cards/);
  const cleared = snapshot('Cleared intentionally'); Object.assign(cleared.profile,{bio:'',banner:'',connections:[]});
  assert.equal((await app.request('/data','PUT',{snapshot:cleared,expectedRevision:2},modern)).status,200);
  assert.deepEqual((await app.request('/data','GET',undefined,modern)).body.data.profile,cleared.profile);
});

test('device enrollment and revocation require recent auth and revoked or other-account credentials are rejected', async t => {
  const app = await fixture(t);
  const staleToken = await app.signedToken({ authAge: 301 });
  assert.equal((await app.request('/devices/register', 'POST', undefined, { token: staleToken })).status, 401);
  const first = await app.enroll(), second = await app.enroll(crypto.randomUUID());
  assert.equal((await app.request('/data', 'GET', undefined, second)).status, 200);
  const strangerToken = await app.signedToken({ subject: crypto.randomUUID() });
  assert.equal((await app.request('/data', 'GET', undefined, { ...first, token: strangerToken })).status, 401);
  assert.equal((await app.request('/devices/revoke', 'POST', { deviceId: second.deviceId }, { ...first, token: staleToken })).status, 401);
  assert.equal((await app.request('/devices/revoke', 'POST', { deviceId: first.deviceId }, first)).status, 400);
  assert.equal((await app.request('/devices/revoke', 'POST', { deviceId: second.deviceId }, first)).status, 200);
  const revoked = app.db.prepare('SELECT revoked_at, credential_hash FROM account_devices WHERE account_id = ? AND device_id = ?').bind(app.accountId, second.deviceId).first();
  assert.ok(revoked.revoked_at);
  assert.equal(revoked.credential_hash, null);
  assert.equal((await app.request('/data', 'GET', undefined, second)).status, 401);
  assert.equal((await app.request('/devices/register', 'POST', undefined, second)).status, 403, 'fresh login cannot resurrect a revoked device ID');
  const devices = await app.request('/devices', 'GET', undefined, first);
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices.find(device => device.id === second.deviceId).status, 'revoked');
  assert.equal((await app.request('/data', 'GET', undefined, first)).status, 200);
});

test('failed provider deletion removes local account rows, remains pending, and completes through maintenance retry', async t => {
  const app = await fixture(t), credentials = await app.enroll();
  assert.equal((await app.request('/data', 'PUT', { snapshot: snapshot(), expectedRevision: 0 }, credentials)).status, 200);
  app.provider.deleteStatus = 503;
  const deleted = await app.request('/data', 'DELETE', undefined, credentials);
  assert.equal(deleted.status, 202);
  assert.equal(deleted.body.deletionPending, true);
  for (const table of ['account_data', 'account_devices', 'account_notice_acceptances', 'account_rate_limits']) {
    assert.equal(app.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id = ?`).bind(app.accountId).first().count, 0, `${table} cleared`);
  }
  const pending = app.db.prepare('SELECT * FROM deleted_accounts WHERE account_id = ?').bind(app.accountId).first();
  assert.equal(pending.state, 'pending');
  assert.equal(pending.attempts, 1);
  assert.equal(pending.last_error, 'http_503');
  assert.ok(Date.parse(pending.next_attempt_at) > Date.now());
  assert.equal(pending.completed_at, null);
  assert.equal((await app.request('/data', 'GET', undefined, credentials)).status, 410);

  // Retrying DELETE remains possible after its original device row was removed.
  const retried = await app.request('/data', 'DELETE', undefined, credentials);
  assert.equal(retried.status, 202);
  assert.equal(retried.body.deletionPending, true);
  assert.equal(app.provider.deletionCalls.length, 2);
  await runAccountMaintenance(app.env);
  assert.equal(app.provider.deletionCalls.length, 2, 'maintenance respects the next-attempt deadline');
  app.db.prepare('UPDATE deleted_accounts SET next_attempt_at = ? WHERE account_id = ?').bind('2000-01-01T00:00:00.000Z', app.accountId).run();
  app.provider.deleteStatus = 404; // Already removed at the provider is idempotent success.
  await runAccountMaintenance(app.env);
  assert.equal(app.provider.deletionCalls.length, 3);
  const completed = app.db.prepare('SELECT * FROM deleted_accounts WHERE account_id = ?').bind(app.accountId).first();
  assert.equal(completed.state, 'complete');
  assert.equal(completed.attempts, 3);
  assert.equal(completed.last_error, null);
  assert.equal(completed.next_attempt_at, null);
  assert.ok(Number.isFinite(Date.parse(completed.completed_at)));
  assert.ok(Date.parse(completed.expires_at) > Date.now());
  assert.equal((await app.request('/data', 'GET', undefined, credentials)).status, 410, 'completed tombstone rejects previously issued JWTs');
  assert.equal((await app.request('/devices/register', 'POST', undefined, credentials)).status, 410);
  await runAccountMaintenance(app.env);
  assert.equal(app.provider.deletionCalls.length, 3, 'completed work is not retried');
});

test('successful provider deletion returns completion and leaves no account snapshot or devices', async t => {
  const app = await fixture(t), credentials = await app.enroll();
  assert.equal((await app.request('/data', 'PUT', { snapshot: snapshot(), expectedRevision: 0 }, credentials)).status, 200);
  const deleted = await app.request('/data', 'DELETE', undefined, credentials);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);
  assert.equal(deleted.body.deletedRows, 1);
  assert.equal(deleted.body.deletionPending, undefined);
  assert.equal(app.provider.deletionCalls.length, 1);
  assert.equal(app.db.prepare('SELECT state FROM deleted_accounts WHERE account_id = ?').bind(app.accountId).first().state, 'complete');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM account_data').first().count, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM account_devices').first().count, 0);
});
