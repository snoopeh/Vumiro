/* This machine owns the identity and address book. Only public contact codes are
   exportable; the signing key stays nonextractable in the browser's local store. */
(() => {
  'use strict';
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
  const algorithm = {name: 'ECDSA', namedCurve: 'P-256'};
  let database, identity;
  const contactChanges = typeof BroadcastChannel === 'function' ? new BroadcastChannel('screentask-contact-changes') : null;
  function changed() {
    dispatchEvent(new Event('screentask-friends-changed'));
    contactChanges?.postMessage('changed');
  }
  if (contactChanges) contactChanges.onmessage = () => dispatchEvent(new Event('screentask-friends-changed'));
  function base64url(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(value, limit = 4096) {
    if (typeof value !== 'string' || !value.length || value.length > limit || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('This contact code contains invalid data.');
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
  }
  function name(value) {
    if (typeof value !== 'string') throw Error('Enter a display name.');
    const result = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!result || result.length > 48) throw Error('Choose a name between 1 and 48 characters.');
    return result;
  }
  function open() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('screentask-local-profile', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('state');
        request.result.createObjectStore('friends', {keyPath: 'id'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error('Local profile storage could not open. Check this app’s storage permissions.'));
      request.onblocked = () => reject(Error('Close other ScreenTask windows to finish opening your local profile.'));
    });
    return database;
  }
  async function transaction(store, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), result = work(tx.objectStore(store), tx);
      tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error('Could not save the local profile.'));
    });
  }
  const publicProfile = () => identity ? {id: identity.id, name: identity.name, key: identity.key} : null;
  async function initialize() {
    if (!window.isSecureContext || !crypto.subtle || !window.indexedDB) throw Error('Open ScreenTask in its desktop app or over HTTPS to use local profiles.');
    identity = await transaction('state', 'readonly', store => store.get('profile')) || null;
    if (identity && (identity.privateKey?.extractable !== false || identity.privateKey.algorithm?.namedCurve !== 'P-256')) throw Error('This stored identity could not be opened. Your contact book has been preserved.');
    return publicProfile();
  }
  async function createProfile(displayName) {
    if (identity) throw Error('A local profile already exists on this device.');
    const clean = name(displayName), keys = await crypto.subtle.generateKey(algorithm, false, ['sign', 'verify']);
    const spki = await crypto.subtle.exportKey('spki', keys.publicKey);
    const candidate = {id: base64url(await crypto.subtle.digest('SHA-256', spki)), name: clean, key: base64url(spki), privateKey: keys.privateKey};
    await transaction('state', 'readwrite', (store, tx) => {
      const existing = store.get('profile');
      existing.onsuccess = () => { if (existing.result) tx.abort(); else store.put(candidate, 'profile'); };
    });
    identity = candidate; return publicProfile();
  }
  async function updateName(displayName) {
    if (!identity) throw Error('Create your local profile first.');
    const candidate = {...identity, name: name(displayName)};
    await transaction('state', 'readwrite', store => store.put(candidate, 'profile'));
    identity = candidate; return publicProfile();
  }
  function ownCode() {
    if (!identity) throw Error('Create your local profile first.');
    return 'stfriend1.' + base64url(encoder.encode(JSON.stringify({v: 1, ...publicProfile()})));
  }
  async function parseContactCode(code) {
    if (typeof code !== 'string' || code.length > 2048 || !code.trim().startsWith('stfriend1.')) throw Error('Paste a complete ScreenTask contact code starting with stfriend1.');
    let contact;
    try { contact = JSON.parse(decoder.decode(decode(code.trim().slice(10), 2000))); }
    catch { throw Error('This contact code is incomplete or invalid. Ask your friend to copy it again.'); }
    if (contact?.v !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(contact.id || '')) throw Error('This contact code uses an unsupported identity format.');
    const spki = decode(contact.key, 256), displayName = name(contact.name);
    const publicKey = await crypto.subtle.importKey('spki', spki, algorithm, false, ['verify']);
    if (publicKey.algorithm.namedCurve !== 'P-256' || base64url(await crypto.subtle.digest('SHA-256', spki)) !== contact.id) throw Error('The public key does not match this contact’s identity.');
    if (contact.id === identity?.id) throw Error('This is your own contact code. Ask your friend for theirs.');
    return {id: contact.id, name: displayName, key: contact.key};
  }
  async function listFriends() { return (await transaction('friends', 'readonly', store => store.getAll()) || []).sort((a, b) => a.nickname.localeCompare(b.nickname)); }
  async function addFriend(code, nickname) {
    const contact = await parseContactCode(code);
    const alias = nickname?.trim() ? name(nickname) : contact.name;
    await transaction('friends', 'readwrite', (store, tx) => {
      const count = store.count(), existing = store.get(contact.id);
      existing.onsuccess = () => {
        if (!existing.result && count.result >= 128) { tx.abort(); return; }
        store.put({...contact, nickname: existing.result?.nickname || alias, added: existing.result?.added || Date.now()});
      };
    }).catch(error => { throw Error(error.name === 'AbortError' ? 'Your local contact book is full (128 friends).' : error.message); });
    changed(); return contact.id;
  }
  async function renameFriend(id, nickname) {
    const clean = name(nickname);
    await transaction('friends', 'readwrite', store => {
      const request = store.get(id); request.onsuccess = () => { if (request.result) store.put({...request.result, nickname: clean}); };
    });
  }
  async function removeFriend(id) { await transaction('friends', 'readwrite', store => store.delete(id)); changed(); }
  async function sign(text) {
    if (!identity) throw Error('Create your local profile first.');
    return base64url(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, identity.privateKey, encoder.encode(text)));
  }
  async function verify(contact, text, signature) {
    try {
      const key = await crypto.subtle.importKey('spki', decode(contact.key, 256), algorithm, false, ['verify']);
      return await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, decode(signature, 128), encoder.encode(text));
    } catch { return false; }
  }
  window.ScreenTaskLocalProfile = {initialize, createProfile, updateName, ownCode, parseContactCode, listFriends, addFriend, renameFriend, removeFriend, sign, verify, profile: publicProfile};
})();
