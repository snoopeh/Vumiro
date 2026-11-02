import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, deletionRetryDelayMs, handleAccountRequest, recentAuth, validateSnapshot } from './accounts.js';

const encode = value => Buffer.from(value instanceof Uint8Array ? value : JSON.stringify(value)).toString('base64url');

async function contact() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const id = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', spki)));
  return { id, key: encode(spki), name: 'Friend', username: 'friend.name', avatar: '', nickname: '' };
}

async function snapshot() {
  return {
    version: 1,
    profile: { name: 'Owner', username: 'owner.name', avatar: '' },
    friends: [await contact()],
    blocked: [],
    settings: { fps: 60, mbps: 20, resolution: 'native', contentHint: 'detail', audio: true, excludeDiscord: true },
    privacyNoticeVersion: '2026-11-01',
    privacyNoticeAcceptedAt: '2026-11-01T12:00:00.000Z'
  };
}

test('strict snapshot validation accepts the canonical client schema', async () => {
  assert.equal(await validateSnapshot(await snapshot(), Date.parse('2026-11-01T12:01:00.000Z')), true);
});

test('snapshot validation rejects unknown settings, duplicate identities, and friend avatars', async () => {
  const unknown = await snapshot();
  unknown.settings.unexpected = true;
  assert.equal(await validateSnapshot(unknown), false);

  const duplicate = await snapshot();
  duplicate.friends.push({ ...duplicate.friends[0] });
  assert.equal(await validateSnapshot(duplicate), false);

  const avatar = await snapshot();
  avatar.friends[0].avatar = 'data:image/png;base64,AA==';
  assert.equal(await validateSnapshot(avatar), false);
});

test('encrypted identity recovery has a closed, bounded schema', async () => {
  const value = await snapshot();
  const identity = await contact();
  value.identityRecovery = {
    version: 1,
    identityId: identity.id,
    publicKey: identity.key,
    passwordWrap: { kdf: 'PBKDF2-SHA-256', iterations: 600000, salt: encode(new Uint8Array(16)), iv: encode(new Uint8Array(12)), ciphertext: encode(new Uint8Array(17).fill(1)) },
    recoveryWrap: { kdf: 'HKDF-SHA-256', salt: encode(new Uint8Array(16)), iv: encode(new Uint8Array(12)), ciphertext: encode(new Uint8Array(17).fill(2)) },
    transition: null
  };
  assert.equal(await validateSnapshot(value), true);
  value.identityRecovery.passwordWrap.rawPrivateKey = 'forbidden';
  assert.equal(await validateSnapshot(value), false);
  delete value.identityRecovery.passwordWrap.rawPrivateKey;
  const oldKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const oldSpki = new Uint8Array(await crypto.subtle.exportKey('spki', oldKeys.publicKey));
  const transition = {
    version: 1,
    fromId: encode(new Uint8Array(await crypto.subtle.digest('SHA-256', oldSpki))),
    fromKey: encode(oldSpki),
    toId: value.identityRecovery.identityId,
    toKey: value.identityRecovery.publicKey,
    createdAt: new Date().toISOString(),
    signature: ''
  };
  const text = ['vumiro-identity-transition-v1',transition.fromId,transition.fromKey,transition.toId,transition.toKey,transition.createdAt].join('\n');
  transition.signature = encode(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, oldKeys.privateKey, new TextEncoder().encode(text))));
  value.identityRecovery.transition = transition;
  assert.equal(await validateSnapshot(value), true);
  const tamperedSignature = Buffer.from(value.identityRecovery.transition.signature, 'base64url');
  tamperedSignature[0] ^= 1;
  value.identityRecovery.transition.signature = encode(tamperedSignature);
  assert.equal(await validateSnapshot(value), false);
});

test('email/signup AMR permits initial device enrollment', () => {
  const now = 1_800_000_000;
  assert.equal(recentAuth({ amr: [{ method: 'email/signup', timestamp: now }] }, ['email/signup'], now), true);
  assert.equal(recentAuth({ amr: [{ method: 'email/signup', timestamp: now, extra: true }] }, ['email/signup'], now), false);
  assert.equal(recentAuth({ amr: [{ method: 'email/signup', timestamp: now - 301 }] }, ['email/signup'], now), false);
});

test('service and signup availability are independent config flags', async () => {
  const disabled = await handleAccountRequest(new Request('https://accounts.example/api/v1/account/config'), {});
  assert.equal(disabled.status, 503);
  assert.deepEqual(await disabled.json(), { error: 'Vumiro account service is not enabled yet.', serviceEnabled: false, registrationEnabled: false });

  const enabled = await handleAccountRequest(new Request('https://accounts.example/api/v1/account/config'), {
    ACCOUNT_SERVICE_ENABLED: 'true',
    ACCOUNT_REGISTRATION_ENABLED: 'false',
    SUPABASE_URL: 'https://account-test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(24)}`
  });
  assert.equal(enabled.status, 200);
  const config = await enabled.json();
  assert.equal(config.serviceEnabled, true);
  assert.equal(config.registrationEnabled, false);
  assert.deepEqual(config.oauthProviders, []);
  assert.equal(config.privacyNoticeVersion, '2026-11-01');
});

test('social providers are explicitly enabled independently of registration', async () => {
  const response = await handleAccountRequest(new Request('https://accounts.example/api/v1/account/config'), {
    ACCOUNT_SERVICE_ENABLED: 'true', ACCOUNT_REGISTRATION_ENABLED: 'false',
    ACCOUNT_OAUTH_GOOGLE_ENABLED: 'true', ACCOUNT_OAUTH_MICROSOFT_ENABLED: 'true',
    SUPABASE_URL: 'https://account-test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(24)}`
  });
  const config = await response.json();
  assert.deepEqual(config.oauthProviders, ['google', 'azure']);
  assert.equal(config.registrationEnabled, false);
});

test('fresh OAuth allows security reauthentication but stale and arbitrary AMR do not', () => {
  const now = 1_800_000_000;
  assert.equal(recentAuth({ amr: [{ method: 'oauth', timestamp: now - 10 }] }, ['password', 'oauth'], now), true);
  assert.equal(recentAuth({ amr: [{ method: 'oauth', timestamp: now - 301 }] }, ['password', 'oauth'], now), false);
  assert.equal(recentAuth({ amr: [{ method: 'otp', timestamp: now }] }, ['password', 'oauth'], now), false);
});

test('JWT verification accepts a signed Supabase token and rejects extra segments', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  Object.assign(jwk, { kid: 'test-key', use: 'sig', alg: 'RS256', key_ops: ['verify'] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' });
    const payload = encode({ iss: 'https://account-jwt-test.supabase.co/auth/v1', aud: 'authenticated', sub: '123e4567-e89b-42d3-a456-426614174000', role: 'authenticated', email: 'owner@example.com', iat: now - 10, exp: now + 600, amr: [{ method: 'email/signup', timestamp: now - 10 }] });
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${payload}`)));
    const token = `${header}.${payload}.${encode(signature)}`;
    const env = { SUPABASE_URL: 'https://account-jwt-test.supabase.co' };
    const user = await authenticate(new Request('https://accounts.example', { headers: { Authorization: `Bearer ${token}` } }), env);
    assert.equal(user?.id, '123e4567-e89b-42d3-a456-426614174000');
    assert.equal(user?.recentEnrollmentAuth, true);
    assert.equal(await authenticate(new Request('https://accounts.example', { headers: { Authorization: `Bearer ${token}.extra` } }), env), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('identity deletion retry backoff is bounded', () => {
  assert.equal(deletionRetryDelayMs(1), 5 * 60 * 1000);
  assert.equal(deletionRetryDelayMs(2), 10 * 60 * 1000);
  assert.equal(deletionRetryDelayMs(99), 24 * 60 * 60 * 1000);
});
