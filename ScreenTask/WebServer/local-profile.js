/* Local identity and contact book. The P-256 signing key never leaves IndexedDB. */
(() => {
  'use strict';
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
  const algorithm = {name: 'ECDSA', namedCurve: 'P-256'};
  let database, identity;
  const changes = typeof BroadcastChannel === 'function' ? new BroadcastChannel('screentask-contact-changes') : null;
  function changed() { dispatchEvent(new Event('screentask-friends-changed')); changes?.postMessage('changed'); }
  if (changes) changes.onmessage = () => dispatchEvent(new Event('screentask-friends-changed'));
  function base64url(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function decode(value, limit = 4096) {
    if (typeof value !== 'string' || !value.length || value.length > limit || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('This contact code contains invalid data.');
    return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
  }
  function cleanName(value) {
    if (typeof value !== 'string') throw Error('Enter a display name.');
    const result = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!result || result.length > 48) throw Error('Choose a name between 1 and 48 characters.');
    return result;
  }
  function cleanUsername(value) {
    const result = String(value || '').trim().replace(/^@/, '').toLowerCase();
    if (result && !/^[a-z0-9_.-]{3,24}$/.test(result)) throw Error('Use 3–24 letters, numbers, dots, underscores or hyphens for your username.');
    return result;
  }
  function cleanAvatar(value) {
    if (!value) return '';
    if (typeof value !== 'string' || value.length > 32768 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('Choose a PNG, JPEG or WebP profile picture under 32 KiB after resizing.');
    return value;
  }
  function open() {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('screentask-local-profile', 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('state'); request.result.createObjectStore('friends', {keyPath: 'id'}); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error('Local profile storage could not open. Check this app’s storage permissions.'));
      request.onblocked = () => reject(Error('Close other Vumiro windows to open your local profile.'));
    }); return database;
  }
  async function transaction(store, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), result = work(tx.objectStore(store), tx);
      tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result?.result);
      tx.onerror = tx.onabort = () => reject(tx.error || Error('Could not save the local profile.'));
    });
  }
  const publicProfile = () => identity ? {id: identity.id, name: identity.name, key: identity.key, username: identity.username || '', avatar: identity.avatar || ''} : null;
  async function initialize() {
    if (!window.isSecureContext || !crypto.subtle || !window.indexedDB) throw Error('Open Vumiro in its desktop app or over HTTPS to use local profiles.');
    identity = await transaction('state', 'readonly', store => store.get('profile')) || null;
    if (identity && (identity.privateKey?.extractable !== false || identity.privateKey.algorithm?.namedCurve !== 'P-256')) throw Error('This stored identity could not be opened. Your contact book has been preserved.');
    return publicProfile();
  }
  async function createProfile(displayName) {
    if (identity) throw Error('A local profile already exists on this device.');
    const name = cleanName(displayName), keys = await crypto.subtle.generateKey(algorithm, false, ['sign', 'verify']);
    const spki = await crypto.subtle.exportKey('spki', keys.publicKey);
    const candidate = {id: base64url(await crypto.subtle.digest('SHA-256', spki)), name, key: base64url(spki), privateKey: keys.privateKey, username: '', avatar: ''};
    await transaction('state', 'readwrite', (store, tx) => {
      const existing = store.get('profile'); existing.onsuccess = () => { if (existing.result) tx.abort(); else store.put(candidate, 'profile'); };
    }); identity = candidate; return publicProfile();
  }
  async function updateProfile(update) {
    if (!identity) throw Error('Create your local profile first.');
    const candidate = {...identity};
    if ('name' in update) candidate.name = cleanName(update.name);
    if ('username' in update) candidate.username = cleanUsername(update.username);
    if ('avatar' in update) candidate.avatar = cleanAvatar(update.avatar);
    await transaction('state', 'readwrite', store => store.put(candidate, 'profile')); identity = candidate;
    return publicProfile();
  }
  async function updateName(value) { return updateProfile({name: value}); }
  function ownCode() {
    if (!identity) throw Error('Create your local profile first.');
    return 'stfriend1.' + base64url(encoder.encode(JSON.stringify({v: 1, id: identity.id, name: identity.name, key: identity.key, ...(identity.username ? {username: identity.username} : {})})));
  }
  async function validateContact(contact) {
    if (!contact || !/^[A-Za-z0-9_-]{43}$/.test(contact.id || '')) throw Error('This contact uses an unsupported identity format.');
    const spki = decode(contact.key, 256), name = cleanName(contact.name);
    const publicKey = await crypto.subtle.importKey('spki', spki, algorithm, false, ['verify']);
    if (publicKey.algorithm.namedCurve !== 'P-256' || base64url(await crypto.subtle.digest('SHA-256', spki)) !== contact.id) throw Error('The public key does not match this contact’s identity.');
    if (contact.id === identity?.id) throw Error('This is your own identity. Ask your friend for theirs.');
    return {id: contact.id, name, key: contact.key, username: cleanUsername(contact.username), avatar: cleanAvatar(contact.avatar)};
  }
  async function parseContactCode(code) {
    if (typeof code !== 'string' || code.length > 2048 || !code.trim().startsWith('stfriend1.')) throw Error('Paste a complete contact code starting with stfriend1.');
    let contact;
    try { contact = JSON.parse(decoder.decode(decode(code.trim().slice(10), 2000))); }
    catch { throw Error('This contact code is incomplete or invalid. Ask your friend to copy it again.'); }
    if (contact?.v !== 1) throw Error('This contact code uses an unsupported identity format.');
    return validateContact(contact);
  }
  const decorate = value => ({...value, nicknameOverride: value.nicknameOverride ?? (!!value.nickname && value.nickname !== value.name), nickname: (value.nicknameOverride ?? (!!value.nickname && value.nickname !== value.name)) ? value.nickname : value.name});
  async function listFriends() { return (await transaction('friends', 'readonly', store => store.getAll()) || []).map(decorate).sort((a, b) => a.nickname.localeCompare(b.nickname)); }
  async function addContact(value, nickname, canSave) {
    const contact = await validateContact(value), alias = nickname?.trim() ? cleanName(nickname) : '';
    if (canSave && !canSave()) throw Error('This request is no longer available.');
    await transaction('friends', 'readwrite', (store, tx) => {
      const count = store.count(), existing = store.get(contact.id);
      existing.onsuccess = () => {
        if ((canSave && !canSave()) || (!existing.result && count.result >= 128)) { tx.abort(); return; }
        const old = existing.result ? decorate(existing.result) : null;
        store.put({...contact, avatar: contact.avatar || old?.avatar || '', nickname: old?.nicknameOverride ? old.nickname : alias || contact.name, nicknameOverride: old?.nicknameOverride || !!alias, added: old?.added || Date.now()});
      };
    }).catch(error => { throw Error(error.name === 'AbortError' ? 'Your local contact book is full (128 friends).' : error.message); });
    changed(); return contact.id;
  }
  async function addFriend(code, nickname) { return addContact(await parseContactCode(code), nickname); }
  async function updateContactProfile(id, update) {
    let didChange = false;
    const fields = {};
    if ('name' in update) fields.name = cleanName(update.name);
    if ('username' in update) fields.username = cleanUsername(update.username);
    if ('avatar' in update) fields.avatar = cleanAvatar(update.avatar);
    await transaction('friends', 'readwrite', store => {
      const request = store.get(id); request.onsuccess = () => {
        if (!request.result) return;
        const old = decorate(request.result), next = {...old, ...fields};
        if (!next.nicknameOverride) next.nickname = next.name;
        if (Object.keys(fields).some(key => (old[key] || '') !== fields[key])) { store.put(next); didChange = true; }
      };
    }); if (didChange) changed();
  }
  async function renameFriend(id, nickname) {
    const alias = nickname?.trim() ? cleanName(nickname) : '';
    await transaction('friends', 'readwrite', store => { const request = store.get(id); request.onsuccess = () => { if (request.result) store.put({...request.result, nickname: alias || request.result.name, nicknameOverride: !!alias}); }; }); changed();
  }
  async function removeFriend(id) { await transaction('friends', 'readwrite', store => store.delete(id)); changed(); }
  async function listBlocked() { return await transaction('state', 'readonly', store => store.get('blocked-ids')) || []; }
  async function blockContact(id) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id || '') || id === identity?.id) throw Error('Invalid contact identity.');
    const ids = await listBlocked(); if (!ids.includes(id)) { if (ids.length >= 64) throw Error('Your local block list is full (64 contacts).'); ids.push(id); }
    await transaction('state', 'readwrite', store => store.put(ids, 'blocked-ids')); await removeFriend(id);
  }
  async function unblockContact(id) { const ids = (await listBlocked()).filter(value => value !== id); await transaction('state', 'readwrite', store => store.put(ids, 'blocked-ids')); changed(); }
  async function listRequests() { return await transaction('state', 'readonly', store => store.get('social-requests')) || []; }
  async function saveRequest(value) {
    const clean = {...value}; if (clean.contact) clean.contact = await validateContact(clean.contact);
    await transaction('state', 'readwrite', store => { const request = store.get('social-requests'); request.onsuccess = () => { const items = request.result || []; const rest = items.filter(item => item.id !== clean.id); rest.push(clean); store.put(rest.slice(-128), 'social-requests'); }; });
  }
  async function removeRequest(id) { await transaction('state', 'readwrite', store => { const request = store.get('social-requests'); request.onsuccess = () => store.put((request.result || []).filter(item => item.id !== id), 'social-requests'); }); }
  async function sign(text) { if (!identity) throw Error('Create your local profile first.'); return base64url(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, identity.privateKey, encoder.encode(text))); }
  async function verify(contact, text, signature) {
    try { const key = await crypto.subtle.importKey('spki', decode(contact.key, 256), algorithm, false, ['verify']); return await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, decode(signature, 128), encoder.encode(text)); } catch { return false; }
  }
  window.ScreenTaskLocalProfile = {initialize, createProfile, updateName, updateProfile, ownCode, parseContactCode, validateContact, listFriends, addFriend, addContact, importContact: addContact, updateContactProfile, renameFriend, removeFriend, listBlocked, blockContact, unblockContact, listRequests, saveRequest, removeRequest, sign, verify, profile: publicProfile, validateAvatar: cleanAvatar};
})();
