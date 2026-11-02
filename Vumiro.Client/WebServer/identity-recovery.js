/* Encrypted cross-device recovery for the Vumiro P-256 identity key. */
(() => {
  'use strict';
  const root = typeof globalThis === 'object' ? globalThis : window;
  const webCrypto = root.crypto;
  const subtle = webCrypto?.subtle;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const DOMAIN = 'vumiro-identity-recovery-v1';
  const PASSWORD_ITERATIONS = 600000;
  const p256 = {name: 'ECDSA', namedCurve: 'P-256'};
  const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');

  function encode(bytes) {
    let binary = '';
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let offset = 0; offset < view.length; offset += 0x8000)
      binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  function decode(value, min, max) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(max * 4 / 3) + 2) throw Error('The identity recovery data is invalid.');
    let result;
    try { result = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0)); }
    catch { throw Error('The identity recovery data is invalid.'); }
    if (result.length < min || result.length > max || encode(result) !== value) throw Error('The identity recovery data is invalid.');
    return result;
  }
  const random = length => webCrypto.getRandomValues(new Uint8Array(length));
  async function digest(bytes) { return new Uint8Array(await subtle.digest('SHA-256', bytes)); }
  function requireCrypto() {
    if (!webCrypto?.getRandomValues || !subtle) throw Error('Secure identity recovery is unavailable on this device.');
  }
  function requirePassword(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw Error('Use a password between 12 and 128 characters for identity recovery.');
  }
  async function identityForSpki(spki) { return encode(await digest(spki)); }
  function wrapAad(envelope, kind, wrap) {
    return encoder.encode([
      DOMAIN, String(envelope.version), envelope.identityId, envelope.publicKey, kind,
      wrap.kdf, String(wrap.iterations || ''), wrap.salt, wrap.iv
    ].join('\n'));
  }
  const transitionText = value => encoder.encode(['vumiro-identity-transition-v1',value.fromId,value.fromKey,value.toId,value.toKey,value.createdAt].join('\n'));
  async function passwordKey(password, wrap) {
    requirePassword(password);
    const source = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: decode(wrap.salt, 16, 16), iterations: wrap.iterations}, source, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  }
  async function recoveryKey(secret, wrap) {
    const source = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: decode(wrap.salt, 16, 16), info: encoder.encode(DOMAIN)}, source, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
  }
  async function recoveryCode(secret) {
    const checksum = (await digest(new Uint8Array([...encoder.encode(DOMAIN), ...secret]))).slice(0, 4);
    return `vmr1.${encode(new Uint8Array([...secret, ...checksum]))}`;
  }
  async function recoverySecret(code) {
    if (typeof code !== 'string' || !code.startsWith('vmr1.')) throw Error('Enter the complete Vumiro identity recovery code.');
    const value = decode(code.slice(5).trim(), 36, 36), secret = value.slice(0, 32), expected = await recoveryCode(secret);
    if (expected !== code.trim()) throw Error('The Vumiro identity recovery code is invalid.');
    return secret;
  }
  function validateWrap(value, kind) {
    const password = kind === 'password';
    const keys = password ? ['kdf', 'iterations', 'salt', 'iv', 'ciphertext'] : ['kdf', 'salt', 'iv', 'ciphertext'];
    if (!exactKeys(value, keys) || value.kdf !== (password ? 'PBKDF2-SHA-256' : 'HKDF-SHA-256') ||
      password && (!Number.isInteger(value.iterations) || value.iterations < PASSWORD_ITERATIONS || value.iterations > 2000000)) throw Error('The identity recovery data is invalid.');
    decode(value.salt, 16, 16); decode(value.iv, 12, 12); decode(value.ciphertext, 17, 2048);
  }
  async function validateEnvelope(value) {
    requireCrypto();
    if (!exactKeys(value, ['version', 'identityId', 'publicKey', 'passwordWrap', 'recoveryWrap', 'transition']) || value.version !== 1 ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.identityId || '')) throw Error('The identity recovery data is invalid.');
    const spki = decode(value.publicKey, 80, 512);
    if (await identityForSpki(spki) !== value.identityId) throw Error('The recovered public identity does not match its fingerprint.');
    try { await subtle.importKey('spki', spki, p256, false, ['verify']); } catch { throw Error('The recovered public identity is invalid.'); }
    validateWrap(value.passwordWrap, 'password'); validateWrap(value.recoveryWrap, 'recovery');
    if (value.transition !== null) {
      const transition = value.transition;
      if (!exactKeys(transition, ['version', 'fromId', 'fromKey', 'toId', 'toKey', 'createdAt', 'signature']) || transition.version !== 1 ||
        !/^[A-Za-z0-9_-]{43}$/.test(transition.fromId || '') || transition.toId !== value.identityId || transition.toKey !== value.publicKey ||
        transition.fromId === transition.toId || typeof transition.createdAt !== 'string' || !Number.isFinite(Date.parse(transition.createdAt)) || Date.parse(transition.createdAt) > Date.now() + 300000)
        throw Error('The identity transition data is invalid.');
      const fromSpki = decode(transition.fromKey, 80, 512);
      if (await identityForSpki(fromSpki) !== transition.fromId) throw Error('The identity transition data is invalid.');
      try {
        const fromKey=await subtle.importKey('spki', fromSpki, p256, false, ['verify']);
        if(!await subtle.verify({name:'ECDSA',hash:'SHA-256'},fromKey,decode(transition.signature,64,64),transitionText(transition)))throw Error();
      } catch { throw Error('The identity transition data is invalid.'); }
    }
    return spki;
  }
  async function verifyPrivate(envelope, pkcs8, spki) {
    let privateKey, publicKey;
    try {
      privateKey = await subtle.importKey('pkcs8', pkcs8, p256, false, ['sign']);
      publicKey = await subtle.importKey('spki', spki, p256, false, ['verify']);
      const challenge = random(32), signature = await subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, privateKey, challenge);
      if (!await subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, publicKey, signature, challenge)) throw Error();
    } catch { throw Error('The recovered private identity does not match this account.'); }
    return privateKey;
  }
  async function encryptWrap(envelope, kind, key, pkcs8, parameters) {
    const wrap = {...parameters, iv: encode(random(12)), ciphertext: ''};
    const ciphertext = await subtle.encrypt({name: 'AES-GCM', iv: decode(wrap.iv, 12, 12), additionalData: wrapAad(envelope, kind, wrap), tagLength: 128}, key, pkcs8);
    wrap.ciphertext = encode(ciphertext);
    return wrap;
  }
  async function create(password) {
    requireCrypto(); requirePassword(password);
    const pair = await subtle.generateKey(p256, true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
    const spki = new Uint8Array(await subtle.exportKey('spki', pair.publicKey));
    const secret = random(32);
    const envelope = {version: 1, identityId: await identityForSpki(spki), publicKey: encode(spki), passwordWrap: null, recoveryWrap: null, transition: null};
    const passwordBase = {kdf: 'PBKDF2-SHA-256', iterations: PASSWORD_ITERATIONS, salt: encode(random(16))};
    envelope.passwordWrap = await encryptWrap(envelope, 'password', await passwordKey(password, passwordBase), pkcs8, passwordBase);
    const recoveryBase = {kdf: 'HKDF-SHA-256', salt: encode(random(16))};
    envelope.recoveryWrap = await encryptWrap(envelope, 'recovery', await recoveryKey(secret, recoveryBase), pkcs8, recoveryBase);
    const privateKey = await verifyPrivate(envelope, pkcs8, spki);
    pkcs8.fill(0);
    return {identityRecovery: envelope, recoveryCode: await recoveryCode(secret), privateKey, identityId: envelope.identityId, publicKey: envelope.publicKey};
  }
  async function decrypt(envelope, kind, secret) {
    const spki = await validateEnvelope(envelope), wrap = kind === 'password' ? envelope.passwordWrap : envelope.recoveryWrap;
    let key;
    if (kind === 'password') key = await passwordKey(secret, wrap);
    else if (kind === 'recovery') key = await recoveryKey(await recoverySecret(secret), wrap);
    else throw Error('Choose a supported identity recovery method.');
    let pkcs8;
    try { pkcs8 = new Uint8Array(await subtle.decrypt({name: 'AES-GCM', iv: decode(wrap.iv, 12, 12), additionalData: wrapAad(envelope, kind, wrap), tagLength: 128}, key, decode(wrap.ciphertext, 17, 2048))); }
    catch { throw Error(kind === 'password' ? 'The password could not unlock this Vumiro identity.' : 'The recovery code could not unlock this Vumiro identity.'); }
    const privateKey = await verifyPrivate(envelope, pkcs8, spki);
    pkcs8.fill(0);
    return {privateKey, identityId: envelope.identityId, publicKey: envelope.publicKey};
  }
  async function rewrapPassword(envelope, recovery, newPassword) {
    requirePassword(newPassword);
    const spki = await validateEnvelope(envelope), old = envelope.recoveryWrap;
    const key = await recoveryKey(await recoverySecret(recovery), old);
    let pkcs8;
    try { pkcs8 = new Uint8Array(await subtle.decrypt({name: 'AES-GCM', iv: decode(old.iv, 12, 12), additionalData: wrapAad(envelope, 'recovery', old), tagLength: 128}, key, decode(old.ciphertext, 17, 2048))); }
    catch { throw Error('The recovery code could not unlock this Vumiro identity.'); }
    await verifyPrivate(envelope, pkcs8, spki);
    const next = structuredClone(envelope), base = {kdf: 'PBKDF2-SHA-256', iterations: PASSWORD_ITERATIONS, salt: encode(random(16))};
    next.passwordWrap = await encryptWrap(next, 'password', await passwordKey(newPassword, base), pkcs8, base);
    pkcs8.fill(0);
    return next;
  }

  const api = Object.freeze({create, recoverWithPassword: (value, password) => decrypt(value, 'password', password), recoverWithCode: (value, code) => decrypt(value, 'recovery', code), rewrapPassword, validateEnvelope, recoverySecret});
  root.VumiroIdentityRecovery = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
