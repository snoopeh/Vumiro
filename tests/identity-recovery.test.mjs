import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { before, test } from 'node:test';

before(() => {
  Object.defineProperty(globalThis, 'crypto', {value: webcrypto, configurable: true});
  globalThis.btoa ??= value => Buffer.from(value, 'binary').toString('base64');
  globalThis.atob ??= value => Buffer.from(value, 'base64').toString('binary');
});

const modulePath = new URL('../Vumiro.Client/WebServer/identity-recovery.js', import.meta.url);
const api = await import(modulePath.href).then(() => globalThis.VumiroIdentityRecovery);
const password = 'correct horse battery staple';

async function signsWith(result) {
  const publicKey = await crypto.subtle.importKey('spki', decode(result.publicKey), {name:'ECDSA', namedCurve:'P-256'}, false, ['verify']);
  const value = crypto.getRandomValues(new Uint8Array(32));
  const signature = await crypto.subtle.sign({name:'ECDSA', hash:'SHA-256'}, result.privateKey, value);
  assert.equal(await crypto.subtle.verify({name:'ECDSA', hash:'SHA-256'}, publicKey, signature, value), true);
  assert.equal(result.privateKey.extractable, false);
}

function decode(value) {
  return Uint8Array.from(Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64'));
}
function encode(value) {
  return Buffer.from(value).toString('base64url');
}

test('password and recovery code restore the same nonextractable identity', async () => {
  const created = await api.create(password);
  const byPassword = await api.recoverWithPassword(created.identityRecovery, password);
  const byCode = await api.recoverWithCode(created.identityRecovery, created.recoveryCode);
  assert.equal(byPassword.identityId, created.identityId);
  assert.equal(byCode.identityId, created.identityId);
  await signsWith(byPassword);
  await signsWith(byCode);
});

test('wrong password and wrong recovery code fail closed', async () => {
  const created = await api.create(password);
  await assert.rejects(api.recoverWithPassword(created.identityRecovery, 'this is the wrong password'), /could not unlock/);
  const changed = created.recoveryCode.slice(0, -1) + (created.recoveryCode.endsWith('A') ? 'B' : 'A');
  await assert.rejects(api.recoverWithCode(created.identityRecovery, changed), /invalid|could not unlock/);
});

test('authenticated metadata and ciphertext tampering are rejected', async () => {
  const created = await api.create(password);
  const metadata = structuredClone(created.identityRecovery);
  metadata.passwordWrap.iterations += 1;
  await assert.rejects(api.recoverWithPassword(metadata, password), /could not unlock/);
  const ciphertext = structuredClone(created.identityRecovery);
  ciphertext.passwordWrap.ciphertext = ciphertext.passwordWrap.ciphertext.slice(0, -1) + (ciphertext.passwordWrap.ciphertext.endsWith('A') ? 'B' : 'A');
  await assert.rejects(api.recoverWithPassword(ciphertext, password), /could not unlock|invalid/);
});

test('recovery code can rewrap the same identity under a new password', async () => {
  const created = await api.create(password);
  const nextPassword = 'a different long password for vumiro';
  const envelope = await api.rewrapPassword(created.identityRecovery, created.recoveryCode, nextPassword);
  await assert.rejects(api.recoverWithPassword(envelope, password), /could not unlock/);
  const recovered = await api.recoverWithPassword(envelope, nextPassword);
  assert.equal(recovered.identityId, created.identityId);
  await signsWith(recovered);
});

test('transition object uses the closed schema and matching fingerprints', async () => {
  const oldIdentity = await api.create(password);
  const created = await api.create(password);
  const transition={version:1,fromId:oldIdentity.identityId,fromKey:oldIdentity.publicKey,toId:created.identityId,toKey:created.publicKey,createdAt:new Date().toISOString(),signature:''};
  const text=['vumiro-identity-transition-v1',transition.fromId,transition.fromKey,transition.toId,transition.toKey,transition.createdAt].join('\n');
  transition.signature=encode(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},oldIdentity.privateKey,new TextEncoder().encode(text)));
  const valid=structuredClone(created.identityRecovery);valid.transition=transition;
  await api.validateEnvelope(valid);
  const tampered=structuredClone(valid);tampered.transition.signature=tampered.transition.signature.slice(0,-1)+(tampered.transition.signature.endsWith('A')?'B':'A');
  await assert.rejects(api.validateEnvelope(tampered), /transition/);
  const malformed = structuredClone(created.identityRecovery);
  malformed.transition = {unexpected: true};
  await assert.rejects(api.validateEnvelope(malformed), /transition/);
  const mismatch = structuredClone(created.identityRecovery);
  mismatch.transition = {version:1,fromId:created.identityId,fromKey:created.publicKey,toId:created.identityId,toKey:created.publicKey,createdAt:new Date().toISOString(),signature:'AQ'};
  mismatch.transition.fromId = 'A'.repeat(43);
  await assert.rejects(api.validateEnvelope(mismatch), /transition/);
});
