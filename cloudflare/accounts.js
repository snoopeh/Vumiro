const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_SNAPSHOT_BYTES = 262144;
const ACTIVE_DEVICE_LIMIT = 16;
const REVOKED_DEVICE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const COMPLETED_TOMBSTONE_RETENTION_MS = 2 * 60 * 60 * 1000;
const PRIVACY_NOTICE_VERSION = '2026-11-01';
const cache = new Map();

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
function validOrigin(origin, requestUrl) {
  if (!origin) return true;
  if (origin === 'https://screentask.local' || origin === 'https://vumiro.local' || origin === 'vumiro://app' || origin === requestUrl.origin) return true;
  try { const host = new URL(origin).hostname; return ['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname) && ['localhost', '127.0.0.1', '[::1]'].includes(host); } catch { return false; }
}
function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Vumiro-Device, X-Vumiro-Device-Token', 'Vary': 'Origin' };
}
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FRIEND_ID = /^[A-Za-z0-9_-]{43}$/;
const USERNAME = /^(?:|[a-z0-9_.-]{3,24})$/;
const AVATAR = /^(?:|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})$/;

function encodeB64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function b64url(text, maxBytes = 8192) {
  if (typeof text !== 'string' || !text || !/^[A-Za-z0-9_-]+$/.test(text) || text.length > Math.ceil(maxBytes * 4 / 3) + 2) throw new Error('invalid base64url');
  const raw = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - text.length % 4) % 4));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (bytes.length > maxBytes || encodeB64url(bytes) !== text) throw new Error('invalid base64url');
  return bytes;
}
function decodeJson(text) { return JSON.parse(decoder.decode(b64url(text))); }
function onlyKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(), expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function onlyKeysWithOptional(value, required, optional) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !required.every(key => Object.hasOwn(value, key))) return false;
  return Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function cleanText(value, min, max) {
  return typeof value === 'string' && value.length >= min && value.length <= max && value === value.normalize('NFC') && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

async function verificationKey(env, kid) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) || typeof kid !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(kid)) throw new Error('Account authentication is not configured.');
  const now = Date.now(), current = cache.get(base);
  let keys = current && current.expires > now ? current.keys : null;
  if (!keys) {
    const response = await fetch(`${base}/auth/v1/.well-known/jwks.json`, { headers: { 'Accept': 'application/json' }, cf: { cacheTtl: 300, cacheEverything: true } });
    if (!response.ok) throw new Error('Unable to validate account session.');
    const jwks = await response.json();
    if (!onlyKeys(jwks, ['keys']) || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 32) throw new Error('Invalid account signing keys.');
    keys = jwks.keys; cache.set(base, { keys, expires: now + 300000 });
  }
  const matches = keys.filter(item => item && item.kid === kid && item.use === 'sig');
  if (matches.length !== 1) throw new Error('Invalid account signing key.');
  const jwk = matches[0];
  if (!['ES256', 'RS256'].includes(jwk.alg) || (jwk.alg === 'ES256' && (jwk.kty !== 'EC' || jwk.crv !== 'P-256')) || (jwk.alg === 'RS256' && jwk.kty !== 'RSA') || (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify'))) throw new Error('Invalid account signing key.');
  const algorithm = jwk.alg === 'ES256' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const verifyAlgorithm = jwk.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
  return { key: await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']), algorithm: jwk.alg, verifyAlgorithm, issuer: `${base}/auth/v1` };
}
function amrTimestamp(value) {
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string') {
    if (/^\d{10}$/.test(value)) return Number(value);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return 0;
}
export function recentAuth(claims, methods, now = Math.floor(Date.now() / 1000)) {
  return Array.isArray(claims.amr) && claims.amr.some(item => onlyKeys(item, ['method', 'timestamp']) && methods.includes(item.method) &&
    amrTimestamp(item.timestamp) >= now - 300 && amrTimestamp(item.timestamp) <= now + 60);
}
export async function authenticate(request, env) {
  const match = /^Bearer ([A-Za-z0-9_.-]{32,8192})$/.exec(request.headers.get('Authorization') || '');
  if (!match) return null;
  try {
    const segments = match[1].split('.');
    if (segments.length !== 3 || segments.some(segment => !segment)) return null;
    const [headText, payloadText, signatureText] = segments;
    const head = decodeJson(headText), claims = decodeJson(payloadText);
    if (!head || typeof head !== 'object' || Array.isArray(head) || typeof head.kid !== 'string' || !['ES256', 'RS256'].includes(head.alg) || (head.typ !== undefined && head.typ !== 'JWT') || head.crit !== undefined) return null;
    const signing = await verificationKey(env, head.kid);
    if (head.alg !== signing.algorithm) return null;
    const data = encoder.encode(`${headText}.${payloadText}`), signature = b64url(signatureText, 1024);
    if (!await crypto.subtle.verify(signing.verifyAlgorithm, signing.key, signature, data)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== signing.issuer || claims.aud !== 'authenticated' || typeof claims.sub !== 'string' || !ACCOUNT_ID.test(claims.sub) ||
      !Number.isInteger(claims.iat) || claims.iat > now + 60 || !Number.isInteger(claims.exp) || claims.exp <= now || claims.exp <= claims.iat || claims.exp > now + 7200 ||
      (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now + 60)) || claims.role !== 'authenticated') return null;
    const email = typeof claims.email === 'string' && claims.email.length <= 254 ? claims.email : '';
    return { id: claims.sub, email, recentPasswordAuth: recentAuth(claims, ['password'], now), recentEnrollmentAuth: recentAuth(claims, ['password', 'otp', 'recovery', 'email', 'signup', 'email/signup'], now) };
  } catch { return null; }
}

function validSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  const allowed = ['fps', 'mbps', 'resolution', 'contentHint', 'audio', 'excludeDiscord'];
  if (Object.keys(settings).some(key => !allowed.includes(key))) return false;
  return (!Object.hasOwn(settings, 'fps') || Number.isInteger(settings.fps) && settings.fps >= 1 && settings.fps <= 120) &&
    (!Object.hasOwn(settings, 'mbps') || Number.isFinite(settings.mbps) && settings.mbps >= 1 && settings.mbps <= 100) &&
    (!Object.hasOwn(settings, 'resolution') || ['native', '720p', '1080p', '1440p', '2160p'].includes(settings.resolution)) &&
    (!Object.hasOwn(settings, 'contentHint') || ['detail', 'motion'].includes(settings.contentHint)) &&
    (!Object.hasOwn(settings, 'audio') || typeof settings.audio === 'boolean') &&
    (!Object.hasOwn(settings, 'excludeDiscord') || typeof settings.excludeDiscord === 'boolean');
}
async function validFriend(friend) {
  if (!onlyKeys(friend, ['id', 'key', 'name', 'username', 'avatar', 'nickname']) || !FRIEND_ID.test(friend.id || '') || !cleanText(friend.name, 1, 48) ||
    !cleanText(friend.nickname, 0, 48) || typeof friend.username !== 'string' || friend.username !== friend.username.trim().toLowerCase() || !USERNAME.test(friend.username) || friend.avatar !== '') return false;
  try {
    const spki = b64url(friend.key, 256);
    const publicKey = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return publicKey.algorithm.namedCurve === 'P-256' && encodeB64url(await crypto.subtle.digest('SHA-256', spki)) === friend.id;
  } catch { return false; }
}
async function recoveryPublicKeyMatches(identityId, publicKey) {
  try {
    const spki = b64url(publicKey, 384);
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return key.algorithm.namedCurve === 'P-256' && encodeB64url(await crypto.subtle.digest('SHA-256', spki)) === identityId;
  } catch { return false; }
}
function exactEncoded(value, characters, bytes) {
  if (typeof value !== 'string' || value.length !== characters) return false;
  try { return b64url(value, bytes).length === bytes; } catch { return false; }
}
function boundedEncoded(value, maximumCharacters) {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximumCharacters) return false;
  try { b64url(value, Math.ceil(maximumCharacters * 3 / 4)); return true; } catch { return false; }
}
function encodedBytesBetween(value, minimumBytes, maximumBytes, maximumCharacters) {
  if (typeof value !== 'string' || value.length > maximumCharacters) return false;
  try { const bytes = b64url(value, maximumBytes); return bytes.length >= minimumBytes; } catch { return false; }
}
async function validIdentityRecovery(value, now) {
  if (value === undefined) return true;
  if (!onlyKeys(value, ['version', 'identityId', 'publicKey', 'passwordWrap', 'recoveryWrap', 'transition']) || value.version !== 1 ||
    !FRIEND_ID.test(value.identityId || '') || !boundedEncoded(value.publicKey, 512) || !await recoveryPublicKeyMatches(value.identityId, value.publicKey)) return false;
  const password = value.passwordWrap, recovery = value.recoveryWrap;
  if (!onlyKeys(password, ['kdf', 'iterations', 'salt', 'iv', 'ciphertext']) || password.kdf !== 'PBKDF2-SHA-256' ||
    !Number.isInteger(password.iterations) || password.iterations < 600000 || password.iterations > 2000000 ||
    !exactEncoded(password.salt, 22, 16) || !exactEncoded(password.iv, 16, 12) || !encodedBytesBetween(password.ciphertext, 17, 1536, 2048)) return false;
  if (!onlyKeys(recovery, ['kdf', 'salt', 'iv', 'ciphertext']) || recovery.kdf !== 'HKDF-SHA-256' ||
    !exactEncoded(recovery.salt, 22, 16) || !exactEncoded(recovery.iv, 16, 12) || !encodedBytesBetween(recovery.ciphertext, 17, 1536, 2048)) return false;
  if (value.transition === null) return true;
  const transition = value.transition;
  if (!onlyKeys(transition, ['version', 'fromId', 'fromKey', 'toId', 'toKey', 'createdAt', 'signature']) || transition.version !== 1 ||
    !FRIEND_ID.test(transition.fromId || '') || !boundedEncoded(transition.fromKey, 512) || transition.toId !== value.identityId || transition.toKey !== value.publicKey ||
    transition.fromId === transition.toId ||
    typeof transition.createdAt !== 'string' || !Number.isFinite(Date.parse(transition.createdAt)) || Date.parse(transition.createdAt) > now + 300000 ||
    !exactEncoded(transition.signature, 86, 64) || !await recoveryPublicKeyMatches(transition.fromId, transition.fromKey)) return false;
  try {
    const key = await crypto.subtle.importKey('spki', b64url(transition.fromKey, 384), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const text = encoder.encode(['vumiro-identity-transition-v1',transition.fromId,transition.fromKey,transition.toId,transition.toKey,transition.createdAt].join('\n'));
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64url(transition.signature, 64), text);
  } catch { return false; }
}
export async function validateSnapshot(value, now = Date.now()) {
  const required = ['version', 'profile', 'friends', 'blocked', 'settings', 'privacyNoticeVersion', 'privacyNoticeAcceptedAt'];
  if (!onlyKeysWithOptional(value, required, ['identityRecovery']) || !await validIdentityRecovery(value.identityRecovery, now) || value.version !== 1 ||
    !onlyKeys(value.profile, ['name', 'username', 'avatar']) || !Array.isArray(value.friends) || !Array.isArray(value.blocked) || !validSettings(value.settings)) return false;
  if (value.friends.length > 128 || value.blocked.length > 64 || !cleanText(value.profile.name, 1, 48) || typeof value.profile.username !== 'string' ||
    value.profile.username !== value.profile.username.trim().toLowerCase() || !USERNAME.test(value.profile.username) || typeof value.profile.avatar !== 'string' || value.profile.avatar.length > 44000 || !AVATAR.test(value.profile.avatar)) return false;
  const acceptedAt = Date.parse(value.privacyNoticeAcceptedAt);
  if (value.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION || typeof value.privacyNoticeAcceptedAt !== 'string' || !Number.isFinite(acceptedAt) || acceptedAt > now + 300000) return false;
  const blocked = new Set();
  for (const id of value.blocked) {
    if (typeof id !== 'string' || !FRIEND_ID.test(id) || blocked.has(id)) return false;
    blocked.add(id);
  }
  const friends = new Set();
  for (const friend of value.friends) {
    if (!await validFriend(friend) || friends.has(friend.id) || blocked.has(friend.id)) return false;
    friends.add(friend.id);
  }
  return true;
}
async function readBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!Number.isFinite(length) || length < 0 || length > MAX_SNAPSHOT_BYTES) throw new Error('Account data is too large.');
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Account data is too large.');
  return JSON.parse(text);
}

const deviceView = row => ({ ...row, status: row.revokedAt ? 'revoked' : 'active' });
async function devicesForAccount(env, accountId) {
  const result = await env.ACCOUNT_DB.prepare('SELECT device_id AS id, label, first_seen AS firstSeen, last_seen AS lastSeen, revoked_at AS revokedAt FROM account_devices WHERE account_id = ? ORDER BY revoked_at IS NULL DESC, last_seen DESC LIMIT 64').bind(accountId).all();
  return (result.results || []).map(deviceView);
}
async function noticesForAccount(env, accountId) {
  const result = await env.ACCOUNT_DB.prepare('SELECT notice_version AS version, accepted_at AS acceptedAt, recorded_at AS recordedAt, device_id AS deviceId FROM account_notice_acceptances WHERE account_id = ? ORDER BY recorded_at ASC').bind(accountId).all();
  return result.results || [];
}

const RATE_LIMITS = Object.freeze({ register: [8, 3600], read: [600, 600], write: [120, 600], revoke: [30, 3600], export: [30, 3600], delete: [5, 3600] });
async function consumeRateLimit(env, accountId, action) {
  const [limit, seconds] = RATE_LIMITS[action];
  const now = Math.floor(Date.now() / 1000), windowStart = Math.floor(now / seconds) * seconds;
  await env.ACCOUNT_DB.prepare(`INSERT INTO account_rate_limits (account_id, action, window_start, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(account_id, action) DO UPDATE SET count = CASE WHEN account_rate_limits.window_start = excluded.window_start THEN account_rate_limits.count + 1 ELSE 1 END,
    window_start = excluded.window_start`).bind(accountId, action, windowStart).run();
  const row = await env.ACCOUNT_DB.prepare('SELECT count FROM account_rate_limits WHERE account_id = ? AND action = ?').bind(accountId, action).first();
  return Number(row?.count || 0) <= limit ? 0 : Math.max(1, windowStart + seconds - now);
}
function rateAction(url, method) {
  if (url.pathname.endsWith('/devices/register')) return 'register';
  if (url.pathname.endsWith('/devices/revoke') || url.pathname.endsWith('/devices/revoke-all')) return 'revoke';
  if (url.pathname.endsWith('/export')) return 'export';
  if (url.pathname.endsWith('/data') && method === 'DELETE') return 'delete';
  return method === 'GET' ? 'read' : 'write';
}

export async function handleAccountRequest(request, env) {
  const url = new URL(request.url), origin = request.headers.get('Origin') || url.origin;
  if (!validOrigin(request.headers.get('Origin'), url)) return new Response('Origin not allowed.', { status: 403 });
  const cors = corsHeaders(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Max-Age': '600' } });
  if (env.ACCOUNT_SERVICE_ENABLED !== 'true') return json({ error: 'Vumiro account service is not enabled yet.', serviceEnabled: false, registrationEnabled: false }, 503, cors);
  if (url.pathname === '/api/v1/account/config' && request.method === 'GET') {
    const base = String(env.SUPABASE_URL || '').replace(/\/$/, ''), publishable = String(env.SUPABASE_PUBLISHABLE_KEY || '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) || !/^(?:sb_publishable_[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(publishable)) return json({ error: 'Account service is not configured yet.', serviceEnabled: false, registrationEnabled: false }, 503, cors);
    return json({ authUrl: base, publishableKey: publishable, serviceEnabled: true, registrationEnabled: env.ACCOUNT_REGISTRATION_ENABLED === 'true', privacyNoticeVersion: PRIVACY_NOTICE_VERSION }, 200, cors);
  }
  if (!env.ACCOUNT_DB) return json({ error: 'Account storage is not configured yet.' }, 503, cors);
  const user = await authenticate(request, env);
  if (!user) return json({ error: 'Please sign in again to use account sync.' }, 401, cors);
  const deviceId = request.headers.get('X-Vumiro-Device') || '';
  if (!DEVICE_ID.test(deviceId)) return json({ error: 'This device needs a fresh local registration.' }, 400, cors);
  try {
    const retryAfter = await consumeRateLimit(env, user.id, rateAction(url, request.method));
    if (retryAfter) return json({ error: 'Too many account requests. Wait before trying again.' }, 429, { ...cors, 'Retry-After': String(retryAfter) });
    const now = new Date().toISOString();
    const tombstone = await env.ACCOUNT_DB.prepare('SELECT expires_at, state, attempts, next_attempt_at AS nextAttemptAt FROM deleted_accounts WHERE account_id = ?').bind(user.id).first();
    const deletePath = url.pathname === '/api/v1/account/data' && request.method === 'DELETE';
    if (tombstone?.state === 'pending') {
      if (deletePath) {
        if (!user.recentPasswordAuth) return json({ error: 'Sign in again before retrying account deletion.' }, 401, cors);
        return finishDeletion(user.id, env, cors);
      }
      return json({ error: 'This account deletion is pending. Vumiro will keep retrying identity deletion.' }, 410, cors);
    }
    if (tombstone && Date.parse(tombstone.expires_at) > Date.now()) return json({ error: 'This account was deleted. Sign out and create a new account if you want to use Vumiro again.' }, 410, cors);
    if (tombstone) await env.ACCOUNT_DB.prepare("DELETE FROM deleted_accounts WHERE account_id = ? AND state = 'complete'").bind(user.id).run();
    if (url.pathname === '/api/v1/account/devices/register' && request.method === 'POST') {
      if (!user.recentEnrollmentAuth) return json({ error: 'Sign in again before registering this device.' }, 401, cors);
      const revokedBefore = new Date(Date.now() - REVOKED_DEVICE_RETENTION_MS).toISOString();
      await env.ACCOUNT_DB.prepare('DELETE FROM account_devices WHERE account_id = ? AND revoked_at IS NOT NULL AND revoked_at <= ?').bind(user.id, revokedBefore).run();
      const existing = await env.ACCOUNT_DB.prepare('SELECT revoked_at, credential_hash FROM account_devices WHERE account_id = ? AND device_id = ?').bind(user.id, deviceId).first();
      if (existing?.revoked_at) return json({ error: 'This device was revoked and cannot be registered again during the security retention period.' }, 403, cors);
      const secretBytes = crypto.getRandomValues(new Uint8Array(32));
      const deviceToken = Array.from(secretBytes, byte => byte.toString(16).padStart(2, '0')).join('');
      const credentialHash = await digestHex(secretBytes);
      const result = existing
        ? await env.ACCOUNT_DB.prepare('UPDATE account_devices SET credential_hash = ?, last_seen = ? WHERE account_id = ? AND device_id = ? AND revoked_at IS NULL').bind(credentialHash, now, user.id, deviceId).run()
        : await env.ACCOUNT_DB.prepare(`INSERT INTO account_devices (account_id, device_id, label, first_seen, last_seen, credential_hash)
            SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM account_devices WHERE account_id = ? AND revoked_at IS NULL) < ? ON CONFLICT(account_id, device_id) DO NOTHING`).bind(user.id, deviceId, 'Vumiro desktop', now, now, credentialHash, user.id, ACTIVE_DEVICE_LIMIT).run();
      if (!result.meta?.changes) return json({ error: `This account has reached its ${ACTIVE_DEVICE_LIMIT} active-device limit.` }, 409, cors);
      return json({ deviceToken }, 201, cors);
    }
    const device = await env.ACCOUNT_DB.prepare('SELECT revoked_at, credential_hash FROM account_devices WHERE account_id = ? AND device_id = ?').bind(user.id, deviceId).first();
    if (!device || !device.credential_hash) return json({ error: 'Register this device with a fresh sign-in before using account sync.' }, 401, cors);
    if (device.revoked_at) return json({ error: 'This device was revoked and cannot be registered again.' }, 403, cors);
    if (!await verifyDeviceToken(request.headers.get('X-Vumiro-Device-Token') || '', device.credential_hash)) return json({ error: 'This device credential is invalid.' }, 403, cors);
    await env.ACCOUNT_DB.prepare('UPDATE account_devices SET last_seen = ? WHERE account_id = ? AND device_id = ?').bind(now, user.id, deviceId).run();
    if (url.pathname === '/api/v1/account/devices' && request.method === 'GET') return json({ devices: await devicesForAccount(env, user.id), currentDevice: deviceId }, 200, cors);
    if (url.pathname === '/api/v1/account/devices/revoke' && request.method === 'POST') {
      if (!user.recentPasswordAuth) return json({ error: 'Sign in again before revoking a device.' }, 401, cors);
      const body = await readBody(request), target = body?.deviceId;
      if (!onlyKeys(body, ['deviceId']) || !DEVICE_ID.test(target || '') || target === deviceId) return json({ error: 'Choose another linked device to revoke.' }, 400, cors);
      const result = await env.ACCOUNT_DB.prepare('UPDATE account_devices SET revoked_at = ?, credential_hash = NULL WHERE account_id = ? AND device_id = ? AND revoked_at IS NULL').bind(now, user.id, target).run();
      if (!result.meta?.changes) return json({ error: 'That linked device was not found or was already revoked.' }, 404, cors);
      return json({ ok: true, revokedAt: now }, 200, cors);
    }
    if (url.pathname === '/api/v1/account/devices/revoke-all' && request.method === 'POST') {
      if (!user.recentPasswordAuth) return json({ error: 'Sign in again before revoking every device.' }, 401, cors);
      const result = await env.ACCOUNT_DB.prepare('UPDATE account_devices SET revoked_at = ?, credential_hash = NULL WHERE account_id = ? AND revoked_at IS NULL').bind(now, user.id).run();
      return json({ ok: true, revokedAt: now, revokedDevices: result.meta?.changes || 0 }, 200, cors);
    }
    if (url.pathname === '/api/v1/account/data' && request.method === 'GET') {
      const row = await env.ACCOUNT_DB.prepare('SELECT payload, updated_at, revision FROM account_data WHERE account_id = ?').bind(user.id).first();
      return json({ version: 1, account: { email: user.email }, data: row ? JSON.parse(row.payload) : null, revision: row?.revision || 0, devices: await devicesForAccount(env, user.id), currentDevice: deviceId, updatedAt: row?.updated_at || null, noticeRecords: await noticesForAccount(env, user.id) }, 200, cors);
    }
    if (url.pathname === '/api/v1/account/export' && request.method === 'GET') {
      const row = await env.ACCOUNT_DB.prepare('SELECT payload, updated_at, revision FROM account_data WHERE account_id = ?').bind(user.id).first();
      return json({ version: 1, exportedAt: now, account: { id: user.id, email: user.email }, data: row ? JSON.parse(row.payload) : null, sync: { revision: row?.revision || 0, updatedAt: row?.updated_at || null }, devices: await devicesForAccount(env, user.id), currentDevice: deviceId, noticeRecords: await noticesForAccount(env, user.id) }, 200, cors);
    }
    if (url.pathname === '/api/v1/account/data' && request.method === 'PUT') {
      const body = await readBody(request), snapshot = body?.snapshot, expectedRevision = body?.expectedRevision;
      if (!onlyKeys(body, ['snapshot', 'expectedRevision']) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return json({ error: 'Account sync version is invalid. Reload account data and try again.' }, 400, cors);
      if (!await validateSnapshot(snapshot)) return json({ error: 'The account data format is invalid.' }, 400, cors);
      const payload = JSON.stringify(snapshot), timestamp = new Date().toISOString();
      let result;
      if (expectedRevision === 0) result = await env.ACCOUNT_DB.prepare('INSERT INTO account_data (account_id, payload, updated_at, revision) VALUES (?, ?, ?, 1) ON CONFLICT(account_id) DO NOTHING').bind(user.id, payload, timestamp).run();
      else result = await env.ACCOUNT_DB.prepare('UPDATE account_data SET payload = ?, updated_at = ?, revision = revision + 1 WHERE account_id = ? AND revision = ?').bind(payload, timestamp, user.id, expectedRevision).run();
      if (!result.meta?.changes) return json({ error: 'Account data changed on another device. Restore the latest copy or choose to replace it with this device.' }, 409, cors);
      await env.ACCOUNT_DB.prepare(`INSERT INTO account_notice_acceptances (account_id, notice_version, accepted_at, recorded_at, device_id)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, notice_version) DO NOTHING`).bind(user.id, snapshot.privacyNoticeVersion, snapshot.privacyNoticeAcceptedAt, timestamp, deviceId).run();
      return json({ ok: true, revision: expectedRevision + 1, updatedAt: timestamp }, 200, cors);
    }
    if (deletePath) {
      if (!user.recentPasswordAuth) return json({ error: 'Sign in again before deleting your account.' }, 401, cors);
      if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Account deletion is not configured. Contact Vumiro support.' }, 503, cors);
      const pendingExpiry = '9999-12-31T23:59:59.999Z';
      const results = await env.ACCOUNT_DB.batch([
        env.ACCOUNT_DB.prepare(`INSERT INTO deleted_accounts (account_id, expires_at, state, requested_at, attempts, next_attempt_at)
          VALUES (?, ?, 'pending', ?, 0, ?) ON CONFLICT(account_id) DO UPDATE SET expires_at = excluded.expires_at, state = 'pending',
          requested_at = COALESCE(deleted_accounts.requested_at, excluded.requested_at), next_attempt_at = excluded.next_attempt_at`).bind(user.id, pendingExpiry, now, now),
        env.ACCOUNT_DB.prepare('DELETE FROM account_data WHERE account_id = ?').bind(user.id),
        env.ACCOUNT_DB.prepare('DELETE FROM account_devices WHERE account_id = ?').bind(user.id),
        env.ACCOUNT_DB.prepare('DELETE FROM account_notice_acceptances WHERE account_id = ?').bind(user.id),
        env.ACCOUNT_DB.prepare('DELETE FROM account_rate_limits WHERE account_id = ?').bind(user.id)
      ]);
      const completed = await attemptIdentityDeletion(user.id, env);
      if (!completed) return json({ error: 'Account data was removed. Identity deletion is pending and Vumiro will retry automatically.' }, 202, cors);
      return json({ ok: true, deletedRows: results[1]?.meta?.changes || 0 }, 200, cors);
    }
    return json({ error: 'Not found.' }, 404, cors);
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'The request body is invalid.' }, 400, cors);
    return json({ error: 'Account request failed. Check the service configuration and try again.' }, 500, cors);
  }
}

async function digestHex(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function verifyDeviceToken(token, expectedHash) {
  if (!/^[0-9a-f]{64}$/.test(token) || !/^[0-9a-f]{64}$/.test(expectedHash || '')) return false;
  const actualHash = await digestHex(Uint8Array.from(token.match(/../g), pair => parseInt(pair, 16)));
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return difference === 0;
}
async function requestIdentityDeletion(userId, env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: 'service_not_configured' };
  try {
    const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    if (response.ok || response.status === 404) return { ok: true };
    return { ok: false, error: `http_${response.status}` };
  } catch { return { ok: false, error: 'network_error' }; }
}
export function deletionRetryDelayMs(attempts) {
  return Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, Math.min(16, attempts - 1)));
}
async function attemptIdentityDeletion(userId, env) {
  const row = await env.ACCOUNT_DB.prepare("SELECT attempts FROM deleted_accounts WHERE account_id = ? AND state = 'pending'").bind(userId).first();
  if (!row) return true;
  const attempts = Number(row.attempts || 0) + 1, attemptedAt = new Date().toISOString();
  const result = await requestIdentityDeletion(userId, env);
  if (result.ok) {
    const expiresAt = new Date(Date.now() + COMPLETED_TOMBSTONE_RETENTION_MS).toISOString();
    await env.ACCOUNT_DB.prepare(`UPDATE deleted_accounts SET state = 'complete', attempts = ?, last_attempt_at = ?, last_error = NULL,
      next_attempt_at = NULL, completed_at = ?, expires_at = ? WHERE account_id = ? AND state = 'pending'`).bind(attempts, attemptedAt, attemptedAt, expiresAt, userId).run();
    return true;
  }
  const nextAttempt = new Date(Date.now() + deletionRetryDelayMs(attempts)).toISOString();
  await env.ACCOUNT_DB.prepare(`UPDATE deleted_accounts SET attempts = ?, last_attempt_at = ?, last_error = ?, next_attempt_at = ?
    WHERE account_id = ? AND state = 'pending'`).bind(attempts, attemptedAt, result.error, nextAttempt, userId).run();
  return false;
}
async function finishDeletion(userId, env, cors) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Account deletion is not configured. Contact Vumiro support.' }, 503, cors);
  const completed = await attemptIdentityDeletion(userId, env);
  return completed ? json({ ok: true, deletedRows: 0 }, 200, cors) : json({ error: 'Account data was removed. Identity deletion is pending and Vumiro will retry automatically.' }, 202, cors);
}
export async function runAccountMaintenance(env) {
  if (!env.ACCOUNT_DB) return;
  const now = new Date().toISOString();
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const pending = await env.ACCOUNT_DB.prepare("SELECT account_id AS accountId FROM deleted_accounts WHERE state = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY requested_at ASC LIMIT 25").bind(now).all();
    for (const item of pending.results || []) await attemptIdentityDeletion(item.accountId, env);
  }
  const revokedBefore = new Date(Date.now() - REVOKED_DEVICE_RETENTION_MS).toISOString();
  const rateBefore = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60;
  await env.ACCOUNT_DB.batch([
    env.ACCOUNT_DB.prepare("DELETE FROM deleted_accounts WHERE state = 'complete' AND expires_at <= ?").bind(now),
    env.ACCOUNT_DB.prepare('DELETE FROM account_devices WHERE revoked_at IS NOT NULL AND revoked_at <= ?').bind(revokedBefore),
    env.ACCOUNT_DB.prepare('DELETE FROM account_rate_limits WHERE window_start <= ?').bind(rateBefore)
  ]);
}
