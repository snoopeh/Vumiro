/* Local identity and contact book. The P-256 signing key never leaves IndexedDB. */
(() => {
  'use strict';
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
  const algorithm = {name: 'ECDSA', namedCurve: 'P-256'};
  const MAX_SERVER_TIME = 8640000000000000;
  const validServerTime = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_SERVER_TIME;
  let database, identity;
  const serverClock = (() => {
    let serverBase = null, performanceBase = 0;
    return Object.freeze({
      sync(serverTime) {
        if (!validServerTime(serverTime) || typeof performance === 'undefined')
          throw Error('The server clock returned an invalid timestamp.');
        const baseline = performance.now();
        if (!Number.isFinite(baseline) || baseline < 0) throw Error('A monotonic clock is unavailable.');
        serverBase = serverTime;
        performanceBase = baseline;
      },
      now() {
        if (serverBase === null) return null;
        const current = performance.now();
        if (!Number.isFinite(current) || current < 0) return null;
        const value = Math.floor(serverBase + Math.max(0, current - performanceBase));
        return validServerTime(value) ? value : null;
      },
      isSynced() { return serverBase !== null; }
    });
  })();
  window.VumiroServerClock = serverClock;
  const changes = typeof BroadcastChannel === 'function' ? new BroadcastChannel('vumiro-contact-changes') : null;
  function changed() { dispatchEvent(new Event('vumiro-friends-changed')); changes?.postMessage('changed'); }
  function profileChanged() { dispatchEvent(new Event('vumiro-profile-changed')); changes?.postMessage({type: 'profile'}); }
  if (changes) changes.onmessage = event => {
    if (event.data?.type === 'profile') initialize().then(() => dispatchEvent(new Event('vumiro-profile-changed'))).catch(() => {});
    else dispatchEvent(new Event('vumiro-friends-changed'));
  };
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
    // Merge only edited fields into the newest stored record inside one IDB
    // transaction. Disjoint photo/name/username writes must not restore a stale
    // in-memory snapshot from this page or an open room iframe.
    const patch = {};
    if ('name' in update) patch.name = cleanName(update.name);
    if ('username' in update) patch.username = cleanUsername(update.username);
    if ('avatar' in update) patch.avatar = cleanAvatar(update.avatar);
    let candidate;
    await transaction('state', 'readwrite', (store, tx) => {
      const request = store.get('profile');
      request.onsuccess = () => {
        if (!request.result || request.result.id !== identity.id) { tx.abort(); return; }
        candidate = {...request.result, ...patch}; store.put(candidate, 'profile');
      };
    });
    identity = candidate; profileChanged(); return publicProfile();
  }
  async function updateName(value) { return updateProfile({name: value}); }
  // SEC 1 sections 2.3.3/2.3.4: compressed P-256 public points. Only public
  // coordinates are processed here; the nonextractable private key is untouched.
  // https://www.secg.org/sec1-v2.pdf
  const p256 = (1n << 256n) - (1n << 224n) + (1n << 192n) + (1n << 96n) - 1n;
  const p256b = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
  const spkiPrefix = Uint8Array.from([0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00]);
  function modularPower(value, exponent) {
    let result = 1n; value %= p256;
    while (exponent > 0n) { if (exponent & 1n) result = result * value % p256; value = value * value % p256; exponent >>= 1n; }
    return result;
  }
  function compressedSpki(value) {
    if (!/^[A-Za-z0-9_-]{44}$/.test(value)) throw Error('Paste a complete vm1. contact code.');
    const point = decode(value, 44);
    if (point.length !== 33 || base64url(point) !== value || ![2,3].includes(point[0])) throw Error('This contact code contains an invalid public key.');
    const x = BigInt('0x' + Array.from(point.slice(1), byte => byte.toString(16).padStart(2, '0')).join(''));
    if (x >= p256) throw Error('This contact code contains an invalid public key.');
    const square = ((x * x % p256 * x - 3n * x + p256b) % p256 + p256) % p256;
    let y = modularPower(square, (p256 + 1n) / 4n);
    if (y * y % p256 !== square) throw Error('This contact code contains an invalid public key.');
    if (Number(y & 1n) !== (point[0] & 1)) y = p256 - y;
    if (y >= p256 || Number(y & 1n) !== (point[0] & 1)) throw Error('This contact code contains an invalid public key.');
    const spki = new Uint8Array(91); spki.set(spkiPrefix); spki[26] = 4; spki.set(point.slice(1),27);
    const hex = y.toString(16).padStart(64, '0');
    for (let index = 0; index < 32; index++) spki[59 + index] = Number.parseInt(hex.slice(index*2,index*2+2),16);
    return spki;
  }
  function ownCode() {
    if (!identity) throw Error('Create your local profile first.');
    const spki = decode(identity.key,256);
    if (spki.length === 91 && spki[26] === 4 && spkiPrefix.every((value,index) => spki[index] === value)) {
      const compressed = new Uint8Array(33); compressed[0] = 2 | (spki[90] & 1); compressed.set(spki.slice(27,59),1);
      return 'vm1.' + base64url(compressed);
    }
    // Preserve support for an older, valid noncanonical SPKI encoding without
    // changing the identity hash that existing friends already trust.
    return 'stfriend1.' + base64url(encoder.encode(JSON.stringify({v:1,id:identity.id,name:identity.name,key:identity.key})));
  }
  async function validateContact(contact) {
    if (!contact || !/^[A-Za-z0-9_-]{43}$/.test(contact.id || '')) throw Error('This contact uses an unsupported identity format.');
    const spki = decode(contact.key, 256), name = cleanName(contact.name);
    const publicKey = await crypto.subtle.importKey('spki', spki, algorithm, false, ['verify']);
    if (publicKey.algorithm.namedCurve !== 'P-256' || base64url(await crypto.subtle.digest('SHA-256', spki)) !== contact.id) throw Error('The public key does not match this contact’s identity.');
    if (contact.id === identity?.id) throw Error('This is your own identity. Ask your friend for theirs.');
    return {id: contact.id, name, key: contact.key, username: cleanUsername(contact.username), avatar: cleanAvatar(contact.avatar)};
  }
  async function parseContactCode(code, fallbackName) {
    if (typeof code !== 'string' || code.length > 2048) throw Error('Paste a complete vm1. or stfriend1. contact code.');
    const text = code.trim();
    if (text.startsWith('vm1.')) {
      const spki = compressedSpki(text.slice(4)), id = base64url(await crypto.subtle.digest('SHA-256',spki));
      return validateContact({id,key:base64url(spki),name:fallbackName?.trim() || 'Friend ' + id.slice(0,6)});
    }
    if (!text.startsWith('stfriend1.')) throw Error('Paste a complete vm1. or stfriend1. contact code.');
    let contact;
    try { contact = JSON.parse(decoder.decode(decode(text.slice(10), 2000))); }
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
  async function applyFriendResolution(value, canSave) {
    if (!value || typeof value !== 'object' || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value.nonce) || typeof value.accepted !== 'boolean' ||
        !validServerTime(value.expires)) throw Error('This friend request resolution is invalid.');
    if (!serverClock.isSynced()) throw Error('Waiting for a trusted server time before saving this resolution.');
    const now = serverClock.now();
    if (!Number.isSafeInteger(now) || value.expires <= now) throw Error('This friend request resolution has expired.');
    const contact = await validateContact(value.contact);
    if (value.nickname != null && typeof value.nickname !== 'string') throw Error('The saved nickname is invalid.');
    const alias = value.nickname?.trim() ? cleanName(value.nickname) : '';

    const db = await open();
    const result = {added: false, alreadyProcessed: false};
    let didChangeFriends = false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['friends', 'state'], 'readwrite');
      const friends = tx.objectStore('friends'), state = tx.objectStore('state');
      let failure = null;
      const abort = error => {
        failure = error;
        try { tx.abort(); } catch { reject(error); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => {};
      tx.onabort = () => reject(failure || tx.error || Error('Could not save this friend request resolution.'));

      const completedRequest = state.get('friend-resolution-completions');
      completedRequest.onerror = () => abort(Error('Could not read saved friend request resolutions.'));
      completedRequest.onsuccess = () => {
        try {
          const currentNow = serverClock.now();
          if (!Number.isSafeInteger(currentNow) || value.expires <= currentNow) throw Error('This friend request resolution has expired.');
          const completed = (Array.isArray(completedRequest.result) ? completedRequest.result : [])
            .filter(item => item && typeof item.nonce === 'string' && Number.isSafeInteger(item.expires) && item.expires > currentNow);
          if (completed.some(item => item.nonce === value.nonce)) {
            result.alreadyProcessed = true;
            return;
          }
          if (canSave && !canSave()) throw Error('This request is no longer available.');

          const recordCompletion = () => {
            completed.push({nonce: value.nonce, expires: value.expires});
            state.put(completed.slice(-256), 'friend-resolution-completions');
          };
          if (!value.accepted) { recordCompletion(); return; }

          const countRequest = friends.count(), existingRequest = friends.get(contact.id);
          let countReady = false, existingReady = false;
          const commitContact = () => {
            if (!countReady || !existingReady) return;
            try {
              const commitNow = serverClock.now();
              if (!Number.isSafeInteger(commitNow) || value.expires <= commitNow) throw Error('This friend request resolution has expired.');
              if (canSave && !canSave()) throw Error('This request is no longer available.');
              const old = existingRequest.result ? decorate(existingRequest.result) : null;
              if (!old && countRequest.result >= 128) throw Error('Your local contact book is full (128 friends).');
              friends.put({...contact, avatar: contact.avatar || old?.avatar || '', nickname: old?.nicknameOverride ? old.nickname : alias || contact.name,
                nicknameOverride: old?.nicknameOverride || !!alias, added: old?.added || commitNow});
              recordCompletion();
              result.added = !old;
              didChangeFriends = true;
            } catch (error) { abort(error); }
          };
          countRequest.onsuccess = () => { countReady = true; commitContact(); };
          existingRequest.onsuccess = () => { existingReady = true; commitContact(); };
          countRequest.onerror = existingRequest.onerror = () => abort(Error('Could not read the local contact book.'));
        } catch (error) { abort(error); }
      };
    });
    if (didChangeFriends) changed();
    return result;
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
  window.VumiroLocalProfile = {initialize, createProfile, updateName, updateProfile, ownCode, parseContactCode, validateContact, listFriends, addFriend, addContact, applyFriendResolution, importContact: addContact, updateContactProfile, renameFriend, removeFriend, listBlocked, blockContact, unblockContact, listRequests, saveRequest, removeRequest, sign, verify, profile: publicProfile, validateAvatar: cleanAvatar};
})();
