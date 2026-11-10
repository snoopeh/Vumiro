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
  function cleanBio(value = '') {
    if (typeof value !== 'string') throw Error('Your bio must be text.');
    const result = value.normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
    if (result.length > 240) throw Error('Keep your bio to 240 characters.');
    return result;
  }
  function cleanBanner(value = '') {
    if (typeof value !== 'string' || value.length > 16384 || (value && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))) throw Error('Choose a PNG, JPEG or WebP banner under 16 KiB after resizing.');
    return value;
  }
  const connectionPaths = {
    steam: ['steamcommunity.com', /^\/(?:id\/[A-Za-z0-9_-]{1,64}|profiles\/[0-9]{17})\/?$/],
    spotify: ['open.spotify.com', /^\/user\/[A-Za-z0-9._-]{1,100}\/?$/],
    twitch: ['www.twitch.tv', /^\/[A-Za-z0-9_]{1,25}\/?$/],
    youtube: ['www.youtube.com', /^\/(?:@[\p{L}\p{N}_.%-]{1,100}|(?:channel|c|user)\/[A-Za-z0-9_%-]{1,100})\/?$/u],
    github: ['github.com', /^\/[A-Za-z0-9-]{1,39}\/?$/],
    xbox: ['www.xbox.com', /^\/(?:[a-z]{2}-[a-z]{2}\/)?play\/user\/[A-Za-z0-9%_-]{1,100}\/?$/i]
  };
  function cleanConnections(value = []) {
    if (!Array.isArray(value) || value.length > 5) throw Error('Choose up to five profile links.');
    const seen = new Set();
    return value.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'provider,url' || typeof item.provider !== 'string' || !Object.hasOwn(connectionPaths, item.provider) || typeof item.url !== 'string' || item.url.length > 240) throw Error('This profile link is invalid.');
      const rule = connectionPaths[item.provider]; let url;
      try { url = new URL(item.url); } catch { throw Error('Enter a complete HTTPS profile link.'); }
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || host !== rule[0].replace(/^www\./, '') || !rule[1].test(url.pathname) || /%2f|%5c|%00/i.test(url.pathname) || seen.has(item.provider)) throw Error('Use one HTTPS profile link for each supported provider.');
      seen.add(item.provider); url.hostname = rule[0];
      return {provider: item.provider, url: url.href};
    });
  }
  const cardFields = value => ({bio: cleanBio(value?.bio), banner: cleanBanner(value?.banner), connections: cleanConnections(value?.connections)});
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
  const publicProfile = () => identity ? {id: identity.id, name: identity.name, key: identity.key, username: identity.username || '', avatar: identity.avatar || '', ...cardFields(identity)} : null;
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
    if ('bio' in update) patch.bio = cleanBio(update.bio);
    if ('banner' in update) patch.banner = cleanBanner(update.banner);
    if ('connections' in update) patch.connections = cleanConnections(update.connections);
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
    return {id: contact.id, name, key: contact.key, username: cleanUsername(contact.username), avatar: cleanAvatar(contact.avatar), ...cardFields(contact)};
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
    if ('bio' in update) fields.bio = cleanBio(update.bio);
    if ('banner' in update) fields.banner = cleanBanner(update.banner);
    if ('connections' in update) fields.connections = cleanConnections(update.connections);
    await transaction('friends', 'readwrite', store => {
      const request = store.get(id); request.onsuccess = () => {
        if (!request.result) return;
        const old = decorate(request.result), next = {...old, ...fields};
        if (!next.nicknameOverride) next.nickname = next.name;
        if (Object.keys(fields).some(key => JSON.stringify(old[key] ?? (key === 'connections' ? [] : '')) !== JSON.stringify(fields[key]))) { store.put(next); didChange = true; }
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
  async function accountSnapshot() {
    if (!identity) throw Error('Create a local profile before syncing account data.');
    const friends = (await listFriends()).map(friend => ({id:friend.id,key:friend.key,name:friend.name,username:friend.username||'',avatar:'',nickname:friend.nicknameOverride?friend.nickname:''}));
    return {version:1,profile:{name:identity.name,username:identity.username||'',avatar:identity.avatar||'',...cardFields(identity)},friends,blocked:await listBlocked(),settings:{}};
  }
  async function applyAccountSnapshot(snapshot) {
    if (!identity) throw Error('Create a local profile before restoring account data.');
    if (!snapshot || snapshot.version !== 1 || !snapshot.profile || !Array.isArray(snapshot.friends) || snapshot.friends.length > 128 || !Array.isArray(snapshot.blocked) || snapshot.blocked.length > 64) throw Error('The saved account data is invalid.');
    if(Object.keys(snapshot.profile).some(key=>!['name','username','avatar','bio','banner','connections'].includes(key)))throw Error('The saved profile is invalid.');
    const profilePatch={name:cleanName(snapshot.profile.name),username:cleanUsername(snapshot.profile.username||''),avatar:cleanAvatar(snapshot.profile.avatar||''),...cardFields(snapshot.profile)};
    if(snapshot.blocked.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id))||new Set(snapshot.blocked).size!==snapshot.blocked.length)throw Error('The saved block list is invalid.');
    // A snapshot can contain this installation's current identity when it was
    // produced by a different device. It is not a valid friend/block locally,
    // but it must not make the rest of a cross-device restore fail.
    const blocked=snapshot.blocked.filter(id=>id!==identity.id);
    // Validate every imported public key and field before opening the write
    // transaction. Any malformed item leaves the existing profile untouched.
    const wanted = new Map();
    for (const raw of snapshot.friends) {
      if(raw?.id===identity.id)continue;
      const contact=await validateContact(raw);
      if(raw.nickname!=null&&typeof raw.nickname!=='string')throw Error('The saved nickname is invalid.');
      const nickname=typeof raw.nickname==='string'&&raw.nickname.trim()?cleanName(raw.nickname):'';
      if (wanted.has(contact.id)) throw Error('The saved contact list contains duplicates.');
      if (!blocked.includes(contact.id)) wanted.set(contact.id,{...contact,avatar:'',bio:'',banner:'',connections:[],nickname:nickname||contact.name,nicknameOverride:!!nickname,added:Date.now()});
    }
    const db=await open();
    let candidate;
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['state','friends'],'readwrite');
      const state=tx.objectStore('state'),friends=tx.objectStore('friends');
      let failure=null;
      tx.oncomplete=()=>resolve();tx.onerror=()=>{};tx.onabort=()=>reject(failure||tx.error||Error('Could not restore account data.'));
      const req=state.get('profile');
      req.onerror=()=>{failure=Error('Could not read the local profile.');tx.abort();};
      req.onsuccess=()=>{
        try {
          if(!req.result||req.result.id!==identity.id)throw Error('The local identity changed during restore.');
          candidate={...req.result,...profilePatch};state.put(candidate,'profile');
          friends.clear();for(const friend of wanted.values())friends.put(friend);
          state.put(blocked,'blocked-ids');
        } catch(error) {failure=error;tx.abort();}
      };
    });
    identity=candidate;
    profileChanged();changed();
    return true;
  }
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
  function transitionText(value) {
    return ['vumiro-identity-transition-v1',value.fromId,value.fromKey,value.toId,value.toKey,value.createdAt].join('\n');
  }
  async function validateRecoveredIdentity(value) {
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.identityId || '') || typeof value.publicKey !== 'string' || !value.privateKey) throw Error('The recovered identity is invalid.');
    const spki=decode(value.publicKey,256),id=base64url(await crypto.subtle.digest('SHA-256',spki));
    if(id!==value.identityId)throw Error('The recovered identity fingerprint is invalid.');
    const publicKey=await crypto.subtle.importKey('spki',spki,algorithm,false,['verify']);
    if(value.privateKey.extractable)throw Error('The recovered private identity must be nonextractable.');
    const challenge=crypto.getRandomValues(new Uint8Array(32));
    const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},value.privateKey,challenge);
    if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,challenge))throw Error('The recovered private identity does not match its public key.');
    return true;
  }
  async function prepareIdentityMigration(value) {
    if(!identity)throw Error('Create a local profile before enabling identity recovery.');
    await validateRecoveredIdentity(value);
    const createdAt=new Date().toISOString();
    const transition={version:1,fromId:identity.id,fromKey:identity.key,toId:value.identityId,toKey:value.publicKey,createdAt,signature:''};
    transition.signature=await sign(transitionText(transition));
    return {expectedId:identity.id,identity:{...identity,id:value.identityId,key:value.publicKey,privateKey:value.privateKey,transition},transition};
  }
  async function commitIdentityMigration(prepared) {
    if(!prepared?.identity||prepared.expectedId!==identity?.id)throw Error('The local identity changed before recovery could be enabled.');
    await validateRecoveredIdentity({identityId:prepared.identity.id,publicKey:prepared.identity.key,privateKey:prepared.identity.privateKey});
    const next=prepared.identity;
    await transaction('state','readwrite',store=>{
      const request=store.get('profile');
      request.onsuccess=()=>{if(!request.result||request.result.id!==prepared.expectedId)store.transaction.abort();else store.put(next,'profile');};
    });
    identity=next;profileChanged();changed();return publicProfile();
  }
  async function installRecoveredIdentity(value,profile,transition=null) {
    await validateRecoveredIdentity(value);
    if(identity&&identity.id!==value.identityId){
      if(!transition||transition.fromId!==identity.id||transition.fromKey!==identity.key||transition.toId!==value.identityId||transition.toKey!==value.publicKey||
        !await verify(identity,transitionText(transition),transition.signature))throw Error('This device already has a different local identity and the account has no valid transition from it.');
    }
    const candidate={id:value.identityId,key:value.publicKey,privateKey:value.privateKey,name:cleanName(profile?.name||identity?.name||'Vumiro user'),username:cleanUsername(profile?.username||identity?.username||''),avatar:cleanAvatar(profile?.avatar||identity?.avatar||''),...cardFields(profile || identity),...(transition?{transition}:{})};
    await transaction('state','readwrite',store=>{
      const request=store.get('profile');
      request.onsuccess=()=>{if(request.result&&request.result.id!==candidate.id&&request.result.id!==transition?.fromId)store.transaction.abort();else store.put(candidate,'profile');};
    });
    identity=candidate;profileChanged();return publicProfile();
  }
  async function applyIdentityTransition(value,nextProfile) {
    if(!value||Object.keys(value).sort().join(',')!==['createdAt','fromId','fromKey','signature','toId','toKey','version'].sort().join(',')||value.version!==1||
      !/^[A-Za-z0-9_-]{43}$/.test(value.fromId||'')||!/^[A-Za-z0-9_-]{43}$/.test(value.toId||'')||value.fromId===value.toId||
      typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||Date.parse(value.createdAt)>Date.now()+300000)throw Error('The identity transition is invalid.');
    const contact=await validateContact({id:value.toId,key:value.toKey,name:nextProfile?.name,username:nextProfile?.username||'',avatar:nextProfile?.avatar||'',...cardFields(nextProfile)});
    if(contact.id===identity?.id)throw Error('A friend identity cannot replace your own identity.');
    const current=await transaction('friends','readonly',store=>store.get(value.fromId));
    if(!current){const existing=await transaction('friends','readonly',store=>store.get(value.toId));return existing?existing:null;}
    if(current.key!==value.fromKey||!await verify(current,transitionText(value),value.signature))throw Error('The identity transition signature is invalid.');
    const next={...contact,nickname:current.nickname||contact.name,nicknameOverride:!!current.nicknameOverride,added:current.added||Date.now()};
    const db=await open();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(['friends','state'],'readwrite'),friends=tx.objectStore('friends'),state=tx.objectStore('state');let failure=null;
      tx.oncomplete=resolve;tx.onerror=()=>{};tx.onabort=()=>reject(failure||tx.error||Error('Could not update the friend identity.'));
      const old=friends.get(value.fromId),collision=friends.get(value.toId),blocks=state.get('blocked-ids');
      let loaded=0;const commit=()=>{if(++loaded<3)return;try{if(!old.result||old.result.key!==value.fromKey)throw Error('The trusted friend identity changed.');if(collision.result&&value.toId!==value.fromId)throw Error('The replacement identity is already saved as another friend.');friends.delete(value.fromId);friends.put(next);const ids=Array.isArray(blocks.result)?blocks.result:[];state.put([...new Set(ids.map(id=>id===value.fromId?value.toId:id))],'blocked-ids');}catch(error){failure=error;tx.abort();}};
      old.onsuccess=commit;collision.onsuccess=commit;blocks.onsuccess=commit;old.onerror=collision.onerror=blocks.onerror=()=>{failure=Error('Could not read the trusted friend identity.');tx.abort();};
    });
    changed();return next;
  }
  const identityTransition=()=>identity?.transition||null;
  window.VumiroLocalProfile = {initialize, createProfile, updateName, updateProfile, ownCode, parseContactCode, validateContact, listFriends, addFriend, addContact, applyFriendResolution, importContact: addContact, updateContactProfile, renameFriend, removeFriend, listBlocked, blockContact, unblockContact, accountSnapshot, applyAccountSnapshot, listRequests, saveRequest, removeRequest, sign, verify, prepareIdentityMigration, commitIdentityMigration, installRecoveredIdentity, applyIdentityTransition, identityTransition, transitionText, profile: publicProfile, validateAvatar: cleanAvatar, validateBio: cleanBio, validateBanner: cleanBanner, validateConnections: cleanConnections};
})();

/* Local diagnostics: bounded technical events only; never account or media content. */
(() => {
  'use strict';
  const key='vumiro-diagnostics', day=86400000;
  const events=new Set(['page-ready','page-error','promise-rejection','page-unload','capture-requested','capture-started','capture-ended','capture-stopped','capture-error','native-audio-state','native-audio-started','native-audio-warning','native-audio-error','audio-context-state','peer-state','signaling-state','stream-health','playback-boost-error']);
  const numeric=new Set(['code','width','height','frameRate','sampleRate','channels','audioTracks','videoTracks','peers','frames','bytes','sequence','processId']);
  const flags=new Set(['supported','audio','excludeDiscord']);
  const names=new Set(['Error','TypeError','RangeError','SyntaxError','ReferenceError','NotAllowedError','NotFoundError','NotReadableError','NotSupportedError','AbortError','InvalidStateError','OverconstrainedError','SecurityError','OperationError','NetworkError','UnknownError']);
  const states=new Set(['new','checking','connecting','connected','disconnected','failed','closed','completed','stable','have-local-offer','have-remote-offer','have-local-pranswer','have-remote-pranswer','running','suspended','interrupted','live','ended','open','closing']);
  let rows=[],minute=-1,count=0;
  function details(value={}) {
    const clean={};if(!value||typeof value!=='object')return clean;
    for(const [field,item] of Object.entries(value)) {
      if(numeric.has(field)&&typeof item==='number'&&Number.isFinite(item)&&Math.abs(item)<=Number.MAX_SAFE_INTEGER)clean[field]=item;
      else if(flags.has(field)&&typeof item==='boolean')clean[field]=item;
      else if(field==='name'&&names.has(item))clean[field]=item;
      else if(['state','connectionState','iceConnectionState','signalingState'].includes(field)&&states.has(item))clean[field]=item;
      else if(field==='source'&&['friends','call','native'].includes(item))clean[field]=item;
      else if(field==='kind'&&['audio','video'].includes(item))clean[field]=item;
    }
    return clean;
  }
  function prune(){const now=Date.now();rows=rows.filter(row=>Number.isFinite(row.time)&&row.time>=now-day&&row.time<=now&&events.has(row.event)).slice(-256).map(row=>({time:row.time,event:row.event,details:details(row.details)}));}
  try{const saved=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(saved))rows=saved.filter(row=>row&&typeof row==='object');prune();}catch{}
  function record(event,value={}) {
    if(!events.has(event))return false;
    const now=Date.now(),bucket=Math.floor(now/60000);if(bucket!==minute){minute=bucket;count=0;}if(++count>32)return false;
    const clean=details(value),message={type:'diagnostics',action:'record',event,details:clean};
    try {
      if(window.parent&&window.parent!==window){window.parent.postMessage({...message,type:'vumiro-diagnostics'},location.origin);return true;}
      if(window.chrome?.webview){window.chrome.webview.postMessage(message);return true;}
    }catch{/* A closing host must not interfere with capture. */}
    rows.push({time:now,event,details:clean});prune();try{localStorage.setItem(key,JSON.stringify(rows));}catch{}return true;
  }
  function exportLogs() {
    if(window.chrome?.webview){window.chrome.webview.postMessage({type:'diagnostics',action:'export'});return;}
    prune();const file=new Blob([JSON.stringify({format:1,retention:'Up to 24 hours / 256 technical events. No media, chat, credentials or peer addresses.',events:rows},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download='Vumiro-diagnostics-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.VumiroDiagnostics=Object.freeze({record,exportLogs,snapshot(){prune();return rows.map(row=>({...row,details:{...row.details}}));}});
  if(typeof addEventListener==='function') {
    const errorName=error=>names.has(error?.name)?error.name:'Error';
    addEventListener('error',event=>record('page-error',{name:errorName(event.error)}));
    addEventListener('unhandledrejection',event=>record('promise-rejection',{name:errorName(event.reason)}));
    addEventListener('pagehide',()=>record('page-unload'));
    record('page-ready',{source:window.location?.pathname==='/call.html'?'call':'friends'});
  }
})();

/* Local voice preferences and audio diagnostics. Deliberately separate from account snapshots. */
(() => {
  'use strict';
  const key = 'vumiro-audio-settings';
  const defaults = { inputId: '', outputId: '', masterVolume: 100, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  function clean(value = {}) {
    const device = id => typeof id === 'string' && id.length <= 512 && !/[\u0000-\u001f]/.test(id) ? id : '';
    return { inputId: device(value.inputId), outputId: device(value.outputId), masterVolume: Number.isFinite(value.masterVolume) ? Math.round(Math.max(0, Math.min(100, value.masterVolume))) : 100,
      echoCancellation: value.echoCancellation !== false, noiseSuppression: value.noiseSuppression !== false, autoGainControl: value.autoGainControl !== false };
  }
  let settings = { ...defaults }, adapter = null, deafened = false, isolation = 0, queue = Promise.resolve(), dialog = null, preview = null, serial = 0, opener = null, deviceChangeHandler = null;
  const players = new Map(), routing = new Map(), attachments = new WeakMap(), listeners = new Set();
  let playbackContext = null;
  const boostGraphs = new Set();
  try { settings = clean(JSON.parse(localStorage.getItem(key)) || {}); } catch { /* Session defaults remain usable. */ }
  const media = () => window.navigator?.mediaDevices || (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
  const supported = () => media()?.getSupportedConstraints?.() || {};
  function constraints(value = settings) {
    const result = {}, support = supported();
    if (value.inputId) result.deviceId = { exact: value.inputId };
    for (const name of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) if (support[name]) result[name] = value[name];
    return { audio: Object.keys(result).length ? result : true, video: false };
  }
  const snapshot = () => ({ ...settings });
  function emit() { for (const listener of listeners) { try { listener({ ...settings, deafened, isolated: isolation > 0 }); } catch { /* Views are independent. */ } } }
  function applyVolumes() {
    for (const [audio, player] of players) {
      const requested = Number(player.level()), volume = Number.isFinite(requested) ? Math.max(0, Math.min(4, requested * settings.masterVolume / 100)) : 0;
      audio.volume = Math.min(1, volume);
      if (player.graph) player.graph.gain.gain.value = Math.max(1, volume);
      else if (volume > 1 && !player.boostFailed && player.stream?.getAudioTracks().length) startBoost(audio, player);
      audio.muted = routing.has(audio) || deafened || isolation > 0 || volume === 0;
    }
  }
  function releaseBoost(player) {
    const graph = player.graph; if (!graph) return; player.graph = null;
    for (const node of [graph.source, graph.gain]) { try { node?.disconnect(); } catch { /* Already disconnected. */ } }
    graph.destination?.stream.getTracks().forEach(track => track.stop()); boostGraphs.delete(graph);
    if (!boostGraphs.size && playbackContext) { const context = playbackContext; playbackContext = null; context.close().catch(() => {}); }
  }
  async function startBoost(audio, player) {
    // Keep <=100% playback on the original device path. Boost uses the device's
    // default sample rate and still plays through the selected HTML audio sink.
    const graph = {}; player.graph = graph; boostGraphs.add(graph);
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw Error('This audio engine does not support amplification.');
      const context = playbackContext || (playbackContext = new Context({ latencyHint: 'playback' }));
      graph.source = context.createMediaStreamSource(player.stream); graph.gain = context.createGain(); graph.destination = context.createMediaStreamDestination();
      graph.source.connect(graph.gain); graph.gain.connect(graph.destination);
      graph.gain.gain.value = Math.max(1, Math.min(4, Number(player.level()) * settings.masterVolume / 100));
      await context.resume();
      if (players.get(audio) !== player || player.graph !== graph) return;
      audio.srcObject = graph.destination.stream; applyVolumes();
      if (!routing.has(audio)) { const playing = audio.play(); if (playing?.catch) playing.catch(() => report('Click Enable audio to resume playback.')); }
    } catch (error) {
      if (player.graph !== graph) return;
      window.VumiroDiagnostics?.record('playback-boost-error', { name: error.name });
      player.boostFailed = true; releaseBoost(player);
      if (players.get(audio) === player) { applyVolumes(); report('Audio boost unavailable; playing at up to 100%: ' + error.message); }
    }
  }
  function gate() { applyVolumes(); adapter?.gate?.(deafened || isolation > 0); emit(); }
  function report(message) { adapter?.report?.(message); }
  function setDeafened(value) { deafened = value === true; gate(); return deafened; }
  function isolate() {
    ++isolation; gate(); let active = true;
    return () => { if (!active) return; active = false; isolation = Math.max(0, isolation - 1); gate(); };
  }
  async function sink(audio, id) {
    if (!audio.setSinkId) { if (id) throw Error('Speaker selection is unavailable here. Use your system sound settings.'); return; }
    await audio.setSinkId(id);
  }
  async function routeAll(id) {
    const token = {}, audios = [...players.keys()];
    for (const audio of audios) routing.set(audio, token);
    applyVolumes();
    // The probe validates selection even when no remote player exists yet.
    const probe = document.createElement('audio');
    await sink(probe, id);
    await Promise.all(audios.map(audio => sink(audio, id)));
    for (const audio of audios) if (routing.get(audio) === token) routing.delete(audio);
    applyVolumes();
  }
  async function apply(next) {
    const previous = settings;
    try {
      if (next.outputId !== previous.outputId) await routeAll(next.outputId);
      await adapter?.apply?.(next, previous);
    } catch (error) {
      if (next.outputId !== previous.outputId) await routeAll(previous.outputId).catch(() => report('Could not restore the previous speaker. Check Voice & audio.'));
      throw error;
    }
    settings = next; applyVolumes(); emit();
    if(next.outputId!==previous.outputId)for(const audio of players.keys())if(!routing.has(audio))adapter?.playbackReady?.(audio);
    return snapshot();
  }
  function update(patch) {
    const task = queue.then(async () => {
      const next = await apply(clean({ ...settings, ...patch }));
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { report('Audio changes apply for this session; local preferences could not be saved.'); }
      return next;
    });
    queue = task.catch(() => {}); return task;
  }
  function registerPlayback(audio, level = () => 1) {
    const old = players.get(audio); if (old) releaseBoost(old);
    const token = {}; players.set(audio, { level, stream: audio.srcObject, graph: null, boostFailed: false }); attachments.set(audio, token); routing.set(audio, token); applyVolumes();
    // Serializing attachment also handles a track arriving during a speaker change.
    const ready = queue.then(async () => {
      if (!players.has(audio) || attachments.get(audio) !== token) throw Error('Playback attachment cancelled.');
      routing.set(audio, token); applyVolumes();
      await sink(audio, settings.outputId);
      if (!players.has(audio) || attachments.get(audio) !== token) throw Error('Playback attachment cancelled.');
      routing.delete(audio); applyVolumes();
    }).catch(error => {
      if (players.has(audio)) report('Speaker selection failed; playback remains muted: ' + error.message);
      throw error;
    });
    // Callers can await routing; attaching a remote track must not create an unhandled rejection.
    queue = ready.catch(() => {}); return ready;
  }
  function forgetPlayback(audio) { const player = players.get(audio); players.delete(audio); if (player) releaseBoost(player); routing.delete(audio); attachments.delete(audio); audio.muted = true; audio.pause?.(); audio.srcObject = null; }
  function controller() {
    if (adapter) return api;
    for (const frame of document.querySelectorAll?.('iframe') || []) {
      try {
        const target = frame.contentWindow, url = new URL(target.location.href);
        if (url.origin === location.origin && url.pathname === '/call.html' && target.VumiroAudioSettings?.hasRoom()) return target.VumiroAudioSettings;
      } catch { /* Never control a cross-origin frame. */ }
    }
    return api;
  }
  const status = message => { if (dialog) dialog.querySelector('[data-audio-status]').textContent = message; };
  function stopPreview(message) {
    ++serial; const active = preview; preview = null;
    if (active) {
      clearInterval(active.meterTimer); clearTimeout(active.recordTimer); clearTimeout(active.timeout);
      if (active.recorder?.state !== 'inactive') { try { active.recorder?.stop(); } catch { /* Already stopped. */ } }
      if (active.audio) { active.audio.onended = active.audio.onerror = null; active.audio.pause(); active.audio.removeAttribute('src'); active.audio.srcObject = null; active.audio.remove(); }
      if (active.url) URL.revokeObjectURL(active.url);
      active.unsubscribe?.(); active.stream?.getTracks().forEach(track => { if(active.ended)track.removeEventListener?.('ended',active.ended);track.stop(); });
      active.context?.close().catch(() => {}); active.release?.();
    }
    if (dialog) { dialog.querySelector('[data-audio-meter]').value = 0; dialog.querySelector('[data-audio-level]').textContent = 'Microphone off'; dialog.querySelector('[data-audio-stop]').disabled = true; }
    if (message) status(message);
  }
  async function startPreview(test = false) {
    stopPreview(); const target = controller(), session = { token: serial, release: test ? target.isolate() : null }; preview = session;
    if(test && target.hasRoom())session.unsubscribe=target.subscribe(()=>{if(preview===session&&!target.hasRoom())stopPreview('Microphone test stopped because the room ended.');});
    if (dialog) dialog.querySelector('[data-audio-stop]').disabled = false;
    const value = controller().snapshot();
    try {
      if (!media()?.getUserMedia) throw Error('Microphone access is unavailable in this environment.');
      if (test && typeof MediaRecorder !== 'function') throw Error('Microphone recording tests are unavailable here. You can still check the input meter.');
      status(test ? 'Recording for 3 seconds. Your room microphone and received audio are paused.' : 'Requesting microphone permission…');
      const stream = await media().getUserMedia(constraints(value));
      if (preview !== session || !dialog?.open) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream; dialog.querySelector('[data-audio-stop]').disabled = false;
      session.ended = () => { if (preview === session) stopPreview('Microphone disconnected. Choose an available device.'); };
      for (const track of stream.getTracks()) track.addEventListener?.('ended', session.ended);
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context) {
        session.context = new Context(); await session.context.resume();
        if (preview !== session) return;
        const source = session.context.createMediaStreamSource(stream), analyser = session.context.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        session.meterTimer = setInterval(() => {
          if (preview !== session) return; analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length), level = Math.min(100, Math.round(rms * 300));
          dialog.querySelector('[data-audio-meter]').value = level; dialog.querySelector('[data-audio-level]').textContent = level > 95 ? 'Input is very loud' : 'Microphone active';
        }, 80);
      }
      await refreshDevices(); renderProcessing(stream.getAudioTracks()[0]);
      if (preview !== session) return;
      if (!test) { status('Microphone meter is local only. Close this panel or choose Stop to release it.'); return; }
      const recorder = session.recorder = new MediaRecorder(stream), chunks = [];
      recorder.ondataavailable = event => { if (event.data?.size && preview === session) chunks.push(event.data); };
      recorder.onerror = () => { if (preview === session) stopPreview('The microphone test failed. Try another input.'); };
      recorder.onstop = async () => {
        if (preview !== session) return;
        stream.getTracks().forEach(track => { track.removeEventListener?.('ended',session.ended);track.stop(); });
        try {
          if (!chunks.length) throw Error('No audio was recorded. Check your microphone.');
          const audio = session.audio = document.createElement('audio'); audio.hidden = true; dialog.append(audio);
          session.url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || chunks[0].type })); audio.src = session.url;
          await sink(audio, value.outputId); audio.volume = value.masterVolume / 100;
          audio.onended = () => { if (preview === session) stopPreview('Microphone test finished. Your previous room audio state is restored.'); };
          audio.onerror = () => { if (preview === session) stopPreview('Recorded audio could not play. Check the selected speaker.'); };
          if (preview !== session) return;
          status('Playing your recording through the selected speaker. Room audio remains paused.'); await audio.play();
        } catch (error) { if (preview === session) stopPreview(error.message); }
      };
      recorder.start(); session.recordTimer = setTimeout(() => { if (preview === session && recorder.state === 'recording') recorder.stop(); }, 3000);
      session.timeout = setTimeout(() => { if (preview === session) stopPreview('Microphone test stopped. Your previous room audio state is restored.'); }, 15000);
    } catch (error) { if (preview === session) stopPreview('Microphone: ' + error.message); }
  }
  function option(select, value, label) { const item = document.createElement('option'); item.value = value; item.textContent = label; select.append(item); }
  async function refreshDevices() {
    if (!dialog) return;
    const value = controller().snapshot(), input = dialog.querySelector('[data-audio-input]'), output = dialog.querySelector('[data-audio-output]');
    let devices = []; try { devices = await media()?.enumerateDevices?.() || []; } catch (error) { status('Could not list devices: ' + error.message); }
    if (!dialog?.open) return;
    for (const [select, kind, selected] of [[input, 'audioinput', value.inputId], [output, 'audiooutput', value.outputId]]) {
      select.replaceChildren(); option(select, '', 'System default'); let count = 0;
      for (const item of devices.filter(item => item.kind === kind && item.deviceId && item.deviceId !== 'default')) option(select, item.deviceId, item.label || (kind === 'audioinput' ? 'Microphone ' : 'Speaker ') + (++count));
      if (selected && !devices.some(item => item.kind === kind && item.deviceId === selected)) option(select, selected, 'Saved device (not currently available)');
      select.value = selected;
    }
    output.disabled = typeof document.createElement('audio').setSinkId !== 'function';
    dialog.querySelector('[data-audio-speaker-help]').textContent = output.disabled ? 'Speaker selection is unavailable here. Use your system sound settings.' : 'Changes affect Vumiro playback, not system-wide volume or screen-audio capture.';
  }
  function renderProcessing(track) {
    if (!dialog) return;
    const support = supported(), capabilities = track?.getCapabilities?.() || {}, actual = track?.getSettings?.() || {};
    for (const name of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) {
      const input = dialog.querySelector('[data-audio-' + name + ']');
      input.disabled = !support[name] || (Array.isArray(capabilities[name]) && !(capabilities[name].includes(true) && capabilities[name].includes(false)));
      input.parentElement.title = input.disabled ? 'This audio engine does not expose an adjustable setting.' : '';
    }
    const details = [['echoCancellation', 'Echo cancellation'], ['noiseSuppression', 'Noise suppression'], ['autoGainControl', 'Automatic gain']].filter(([name]) => typeof actual[name] === 'boolean').map(([name, label]) => label + ': ' + (actual[name] ? 'on' : 'off'));
    dialog.querySelector('[data-audio-processing]').textContent = details.length ? 'Current input: ' + details.join(' · ') : 'Supported preferences apply when a microphone starts. Availability depends on the audio engine.';
  }
  function render() {
    if (!dialog) return; const value = controller().snapshot();
    dialog.querySelector('[data-audio-volume]').value = value.masterVolume; dialog.querySelector('[data-audio-volume-value]').textContent = value.masterVolume + '%';
    for (const name of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) dialog.querySelector('[data-audio-' + name + ']').checked = value[name];
    renderProcessing(controller().getMicrophone()?.getAudioTracks()[0]);
  }
  async function change(patch) {
    stopPreview(); status('Applying audio settings…');
    try { await controller().update(patch); render(); await refreshDevices(); status('Audio settings applied on this device.'); }
    catch (error) { render(); await refreshDevices(); status('Audio settings were not changed: ' + error.message); }
  }
  async function testSpeaker() {
    stopPreview(); const session = { token: serial }; preview = session;
    try {
      // A short generated WAV uses the same HTML audio route as received room sound.
      const rate = 24000, frames = 6000, buffer = new ArrayBuffer(44 + frames * 2), view = new DataView(buffer);
      const text = (at, value) => [...value].forEach((letter, i) => view.setUint8(at + i, letter.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true);
      for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 660 / rate) * 5000 * Math.min(1, i / 200, (frames - i) / 200), true);
      const audio = session.audio = document.createElement('audio'), value = controller().snapshot(); audio.hidden = true; dialog.append(audio);
      session.url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' })); audio.src = session.url; audio.volume = value.masterVolume / 100;
      await sink(audio, value.outputId); if (preview !== session) return;
      audio.onended = () => { if (preview === session) stopPreview('Speaker test finished.'); }; audio.onerror = () => { if (preview === session) stopPreview('Speaker test could not play.'); };
      dialog.querySelector('[data-audio-stop]').disabled = false; session.timeout = setTimeout(() => { if (preview === session) stopPreview(); }, 5000);
      status(value.masterVolume ? 'Playing a short tone through the selected speaker.' : 'Playback volume is 0%. Raise it to hear the test tone.'); await audio.play();
    } catch (error) { if (preview === session) stopPreview('Speaker: ' + error.message); }
  }
  function ensureDialog() {
    if (dialog) return;
    const style = document.createElement('style');
    // Audio controls must not style the shared settings navigation or its layout.
    style.textContent = `dialog.vumiro-audio-dialog:not(.settingsScreen){color-scheme:dark;color:#f7f2ef;background:#211c1c;border:1px solid #63413f;border-radius:18px;width:min(620px,calc(100vw - 30px));max-height:calc(100svh - 40px);padding:25px;overflow:auto;box-shadow:0 30px 100px #0009;font:13px/1.5 Sora,'Segoe UI',sans-serif}dialog.vumiro-audio-dialog:not(.settingsScreen)::backdrop{background:#090707b8;backdrop-filter:blur(5px)}.va-content{min-width:0;width:100%;max-width:760px;margin-inline:auto}.va-content .va-header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:0 0 10px}.va-content h2{font:600 30px/1.2 Outfit,Sora,'Segoe UI',sans-serif;letter-spacing:-.8px;margin:0}.va-content h3{font:550 19px/1.4 Outfit,Sora,'Segoe UI',sans-serif;margin:0 0 18px}.va-content p{font-size:12px;line-height:1.7;color:var(--muted,#c1b3ae);margin:10px 0 0}.va-content .va-intro{font-size:13px;margin:0 0 30px}.va-content .va-close{position:static;float:none;margin:0;display:grid;place-items:center;flex:none;width:34px;height:34px;background:transparent;border:1px solid var(--line,#483a39);border-radius:50%;font-size:23px;line-height:1;color:#e3d5cf;padding:0}.va-content .va-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.va-content label{display:flex;flex-direction:column;gap:8px;min-width:0;font-size:12px;color:#e2d2cb}.va-content select,.va-content button{box-sizing:border-box;font:inherit;color:#f7eee8;background:var(--surface,#292423);border:1px solid var(--line,#48403e);border-radius:10px;padding:9px 12px;min-width:0}.va-content select{width:100%;max-width:100%;text-overflow:ellipsis}.va-content button{cursor:pointer}.va-content button:hover{background:#38302e;border-color:#6a5651}.va-content button:disabled,.va-content input:disabled,.va-content select:disabled{opacity:.5;cursor:default}.va-content :focus-visible{outline:2px solid #ff7471;outline-offset:3px}.va-content .va-actions{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.va-content .va-check{flex-direction:row;align-items:center;gap:10px;margin:14px 0}.va-content input[type=checkbox]{accent-color:#ee3a40;width:15px;height:15px;margin:0}.va-content input[type=range]{width:100%;max-width:none;accent-color:#ed454b;padding:0}.va-content meter{display:block;width:100%;height:14px}.va-content .va-level{font-size:11px;color:var(--muted,#c4b2aa);margin:5px 0 0}.va-content .va-section{margin-top:28px;padding-top:26px;border-top:1px solid var(--line,#483a39)}.va-content [data-audio-status]{font-size:12px;background:#ffffff03;border:1px solid var(--line,#483a39);border-radius:10px;padding:13px 16px;margin:28px 0 0;min-height:38px;color:var(--muted,#e4c9bd)}.va-content .va-volume{display:flex;justify-content:space-between;gap:12px}.va-content [hidden]{display:none!important}@media(max-width:620px){.va-content .va-grid{grid-template-columns:1fr}}`;
    document.head.append(style); dialog = document.createElement('dialog'); dialog.className = 'vumiro-audio-dialog'; dialog.setAttribute('aria-labelledby', 'vumiro-audio-title');
    dialog.innerHTML = `<div class="va-content"><div class="dialogHead va-header"><h2 id="vumiro-audio-title">Voice &amp; audio</h2><button type="button" class="va-close" data-audio-close aria-label="Close voice and audio">×</button></div><p class="va-intro">Choose what you speak through and where you listen. Saved only on this device.</p><section aria-label="Microphone and speaker devices"><div class="va-grid"><label>Microphone<select data-audio-input aria-label="Microphone device"></select></label><label>Speaker / headphones<select data-audio-output aria-label="Speaker device"></select></label></div><div class="va-actions"><button type="button" data-audio-refresh>Refresh devices</button><button type="button" data-audio-permission>Enable mic meter</button></div><meter data-audio-meter min="0" max="100" value="0" aria-label="Microphone input level"></meter><div class="va-level" data-audio-level>Microphone off</div><div class="va-actions"><button type="button" data-audio-test>Record &amp; play test</button><button type="button" data-audio-stop disabled>Stop test / meter</button></div><p>Tests stay on this device. A microphone test pauses room voice and playback until it ends. The meter alone does not change your call mute.</p></section><section class="va-section" aria-labelledby="va-playback-title"><h3 id="va-playback-title">Playback</h3><label><span class="va-volume">Playback volume <output data-audio-volume-value>100%</output></span><input data-audio-volume type="range" min="0" max="100" step="1" aria-label="Master playback volume"></label><div class="va-actions"><button type="button" data-audio-speaker-test>Test speaker</button></div><p data-audio-speaker-help></p><p>In a room, open a participant’s Audio controls to adjust Screen and Voice separately, with boost up to 400% for quiet sources.</p></section><section class="va-section" aria-labelledby="va-processing-title"><h3 id="va-processing-title">Voice processing</h3><label class="va-check"><input data-audio-echoCancellation type="checkbox">Echo cancellation</label><label class="va-check"><input data-audio-noiseSuppression type="checkbox">Noise suppression</label><label class="va-check"><input data-audio-autoGainControl type="checkbox">Automatic microphone level</label><p data-audio-processing></p></section><div data-audio-status role="status" aria-live="polite">Microphone stays off until you enable the meter or start a test.</div></div>`;
    document.body.append(dialog);
    const get = selector => dialog.querySelector('[data-audio-' + selector + ']');
    get('close').onclick = () => dialog.close(); dialog.addEventListener('close', () => { stopPreview(); opener?.focus?.(); });
    dialog.addEventListener('cancel', () => stopPreview()); dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });
    get('refresh').onclick = refreshDevices; get('permission').onclick = () => startPreview(); get('test').onclick = () => startPreview(true); get('stop').onclick = () => stopPreview('Stopped. Your previous room audio state is restored.'); get('speaker-test').onclick = testSpeaker;
    get('input').onchange = () => change({ inputId: get('input').value }); get('output').onchange = () => change({ outputId: get('output').value });
    get('volume').oninput = () => change({ masterVolume: Number(get('volume').value) });
    for (const name of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) get(name).onchange = () => change({ [name]: get(name).checked });
    deviceChangeHandler = () => { if (dialog.open) refreshDevices(); };
    media()?.addEventListener?.('devicechange', deviceChangeHandler);
  }
  function open() { ensureDialog(); opener = document.activeElement; render(); if (!dialog.open) dialog.showModal(); refreshDevices();status(controller().getMicrophone()?'Your call microphone keeps its current mute state. Tests are local only.':'Opening settings does not enable your microphone. Enable the meter or start a local test when ready.');dialog.querySelector('[data-audio-close]').focus(); }
  function dispose() { stopPreview(); dialog?.close();media()?.removeEventListener?.('devicechange',deviceChangeHandler);adapter?.gate?.(true);adapter=null;for(const audio of [...players.keys()])forgetPlayback(audio);deafened=false;isolation=0;emit(); }
  const api = Object.freeze({ open, snapshot, constraints, update, isolate, setDeafened, isDeafened: () => deafened, isSuppressed: () => deafened || isolation > 0,
    hasRoom: () => !!adapter && adapter.active?.() !== false, getMicrophone: () => adapter?.microphone?.() || null,
    registerRoom(value) { adapter = value; gate(); }, registerPlayback, forgetPlayback, refreshPlayback: applyVolumes,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, stopTest: stopPreview, dispose });
  window.VumiroAudioSettings = api;
  if (typeof addEventListener === 'function') {
    addEventListener('storage', event => {
      if (event.key !== key || !event.newValue) return;
      let next; try { next = clean(JSON.parse(event.newValue)); } catch { return; }
      const task = queue.then(() => apply(next)).catch(error => { report('Audio preference change could not apply: ' + error.message); try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Optional persistence. */ } }); queue = task;
    });
    addEventListener('beforeunload', dispose); addEventListener('pagehide', () => stopPreview());
  }
})();
