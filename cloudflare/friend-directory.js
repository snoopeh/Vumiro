// Ephemeral coordination only. Attachments contain bounded public profile,
// identity proofs, subscriptions and requests, never private keys or media.
import { DurableObject } from 'cloudflare:workers';

export const FRIEND_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ROOM_PATTERN = /^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,24}$/;
const MAX_BYTES = 16 * 1024;
const encoder = new TextEncoder();

function encoded(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decoded(value, maxBytes) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(maxBytes * 4 / 3)) return null;
  try {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return bytes.length <= maxBytes && encoded(bytes) === value ? bytes : null;
  } catch { return null; }
}

function onlyFields(value, fields, optional = []) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    fields.every(field => Object.hasOwn(value, field)) && Object.keys(value).every(field => fields.includes(field) || optional.includes(field));
}

function read(ws) {
  try { return ws.deserializeAttachment(); } catch { return null; }
}

function publicProfile(session) { return {id: session.id, name: session.name, username: session.username || '', key: session.key}; }
function ids(value, self) { return Array.isArray(value) && value.length <= 128 && value.every(id => typeof id === 'string' && FRIEND_ID_PATTERN.test(id) && id !== self) && new Set(value).size === value.length; }
function blocked(a, b) { return (a.blocked || []).includes(b.id) || (b.blocked || []).includes(a.id); }
function mutual(a, b) { return a.watch.includes(b.id) && b.watch.includes(a.id) && !blocked(a, b); }
function budget(session, key, limit, duration, now) {
  const window = session[key] || {at: now, count: 0};
  if (now - window.at >= duration) { window.at = now; window.count = 0; }
  session[key] = window; return ++window.count <= limit;
}
async function verify(keyText, signatureText, canonical) {
  try {
    const bytes = decoded(keyText, 256), signature = decoded(signatureText, 64);
    if (!bytes || signature?.byteLength !== 64) return false;
    const key = await crypto.subtle.importKey('spki', bytes, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
    return await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, signature, encoder.encode(canonical));
  } catch { return false; }
}
function grantShape(grant, now) {
  return onlyFields(grant, ['nonce', 'expires', 'signature']) && typeof grant.nonce === 'string' && NONCE_PATTERN.test(grant.nonce) && Number.isSafeInteger(grant.expires) &&
    grant.expires > now && grant.expires <= now + 86400000 && decoded(grant.signature, 64)?.length === 64;
}
function profileSignal(value) {
  if(onlyFields(value,['refresh'])) return value.refresh===true;
  if(onlyFields(value,['description'])) return onlyFields(value.description,['type','sdp']) && ['offer','answer'].includes(value.description.type) &&
    typeof value.description.sdp==='string' && value.description.sdp.length<=12000 && !/\btyp\s+relay\b/i.test(value.description.sdp);
  if(!onlyFields(value,['candidate'])) return false;
  const candidate=value.candidate;
  return candidate===null || onlyFields(candidate,['candidate'],['sdpMid','sdpMLineIndex','usernameFragment']) &&
    typeof candidate.candidate==='string' && candidate.candidate.length<=4096 && !/\btyp\s+relay\b/i.test(candidate.candidate) &&
    (candidate.sdpMid==null || typeof candidate.sdpMid==='string'&&candidate.sdpMid.length<=256) &&
    (candidate.sdpMLineIndex==null || Number.isInteger(candidate.sdpMLineIndex)&&candidate.sdpMLineIndex>=0&&candidate.sdpMLineIndex<=64) &&
    (candidate.usernameFragment==null || typeof candidate.usernameFragment==='string'&&candidate.usernameFragment.length<=256);
}

export class FriendDirectory extends DurableObject {
  save(ws, session) {
    if (encoder.encode(JSON.stringify(session)).byteLength >= MAX_BYTES - 256) { this.reject(ws, 'Presence metadata is full. Reduce friends or blocks.'); return false; }
    ws.serializeAttachment(session); return true;
  }
  error(ws, code, message, nonce) { this.send(ws, {type: 'social-error', code, message, ...(typeof nonce === 'string' && NONCE_PATTERN.test(nonce) ? {nonce} : {})}); }
  rooms() {
    // Deserialize each bounded attachment once per push, rather than once per
    // pair of friends. A failed send publishes a fresh departure snapshot;
    // stop this older snapshot so it cannot overwrite that newer one.
    const sessions = this.authenticated().map(ws => ({ws, session: read(ws)}));
    for (const watcher of sessions) {
      const rooms = sessions.filter(other => other !== watcher && other.session.room && mutual(watcher.session, other.session))
        .map(other => { const s = other.session; return {owner: s.id, room: s.room, live: !!s.live, mode:s.roomMode||'legacy'}; });
      if (!this.send(watcher.ws, {type: 'rooms', rooms})) return;
    }
  }
  sessions() {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === 1 && !read(ws)?.departed);
  }

  authenticated() {
    return this.sessions().filter(ws => read(ws)?.auth === true);
  }

  owner(id) {
    return this.authenticated().find(ws => read(ws).id === id);
  }

  async fetch(request) {
    const id = new URL(request.url).searchParams.get('id');
    if (request.method !== 'GET' || !FRIEND_ID_PATTERN.test(id || '')) return new Response('Invalid identity.', {status: 400});
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required.', {status: 426});
    // Idle unauthenticated sockets cannot reserve directory capacity forever.
    // Sweep from attachment timestamps without timers or a persistent database.
    for (const pending of this.sessions()) {
      const session = read(pending);
      if (!session.auth && Date.now() - session.time > 30000) this.reject(pending, 'Identity challenge expired.');
    }
    if (this.sessions().length >= 256) return new Response('Presence directory is full.', {status: 429});
    const [client, server] = Object.values(new WebSocketPair());
    const now = Date.now();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({id, auth: false, nonce: encoded(crypto.getRandomValues(new Uint8Array(32))),
      time: now, watch: [], blocked: [], pending: [], seen: [], window: now, count: 0, departed: false, authStarted: false});
    this.send(server, {type: 'challenge', nonce: read(server).nonce});
    return new Response(null, {status: 101, webSocket: client});
  }

  send(ws, value) {
    try {
      if (ws.readyState !== 1 || read(ws)?.departed) return false;
      ws.send(JSON.stringify(value));
      return true;
    } catch {
      this.depart(ws);
      try { ws.close(1011, 'Presence connection failed.'); } catch { /* already closed */ }
      return false;
    }
  }

  reject(ws, reason, code = 1008) {
    this.depart(ws);
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  presence(id) {
    const owner = this.owner(id);
    for (const watcher of this.authenticated()) {
      const session = read(watcher);
      if (session.watch.includes(id)) this.send(watcher, this.presenceEvent(session, id, owner));
    }
  }
  presenceEvent(session, id, owner) {
    const value = owner && read(owner), online = !!value && mutual(session, value);
    return {type: 'presence', id, online, ...(online && value.name ? {profile: publicProfile(value)} : {}), ...(online&&value.room?{mode:value.roomMode||'legacy'}:{})};
  }

  async webSocketMessage(ws, text) {
    if (typeof text !== 'string') { this.reject(ws, 'Only identity and call signaling text is allowed.', 1003); return; }
    if (text.length > MAX_BYTES || encoder.encode(text).byteLength > MAX_BYTES) { this.reject(ws, 'Presence message is too large.', 1009); return; }
    let session = read(ws);
    if (!session || session.departed) return;
    const now = Date.now();
    if (now - session.window >= 10000) { session.window = now; session.count = 0; }
    if (++session.count > (session.auth ? 384 : 4)) { this.reject(ws, 'Too many presence messages.'); return; }
    if (!this.save(ws, session)) return;
    let message;
    try { message = JSON.parse(text); } catch { this.reject(ws, 'Invalid presence JSON.'); return; }
    if (!session.auth) {
      await this.authenticate(ws, session, message);
      return;
    }
    if (this.owner(session.id) !== ws) return;
    if (['watch', 'profile-announce', 'lookup', 'room-state'].includes(message?.type)) {
      if (!budget(session, 'controlRate', 24, 10000, now)) { this.error(ws, 'rate-limit', 'Wait before sending more directory updates.', message.nonce); this.save(ws, session); return; }
      if (!this.save(ws, session)) return;
    }
    if (message?.type === 'profile-announce') { this.profile(ws, session, message); return; }
    if (message?.type === 'lookup') { this.lookup(ws, session, message); return; }
    if (message?.type === 'social') { await this.social(ws, session, message); return; }
    if (message?.type === 'profile-signal') { await this.relayProfile(ws, session, message); return; }
    if (message?.type === 'room-state') {
      if (!onlyFields(message, ['type', 'room', 'live'], ['mode']) || typeof message.live !== 'boolean' ||
        message.mode!==undefined && !['public','friends','private','legacy'].includes(message.mode) ||
        message.room !== null && (typeof message.room !== 'string' || !ROOM_PATTERN.test(message.room) || message.room.slice(0, 43) !== session.id) || message.room === null && message.live) {
        this.error(ws, 'invalid-room', 'Only your own protected room can be published.'); return;
      }
      session.room = message.room; session.live = message.live; session.roomMode=message.mode||'legacy';
      if (this.save(ws, session)) this.rooms(); return;
    }
    if (onlyFields(message, ['type', 'ids']) && message.type === 'watch') {
      if (!ids(message.ids, session.id) || message.ids.length + (session.blocked || []).length > 192) {
        this.reject(ws, 'Invalid presence subscriptions.'); return;
      }
      session.watch = [...new Set(message.ids)].filter(id => id !== session.id);
      if (!this.save(ws, session)) return;
      for (const id of session.watch) {
        const owner = this.owner(id);
        if (!this.send(ws, this.presenceEvent(session, id, owner))) break;
      }
      // Adding or removing a local friend changes whether that friend can see
      // this identity online. No online state is disclosed for one-sided adds.
      this.presence(session.id);
      this.rooms();
      return;
    }
    if (message?.type !== 'invite' && message?.type !== 'answer') { this.reject(ws, 'Invalid presence message type.'); return; }
    const answer = message.type === 'answer';
    const fields = ['type', 'to', 'room', 'nonce', 'expires', 'signature'];
    if (answer) fields.push('accepted');
    if (!onlyFields(message, fields, answer ? [] : ['grant']) || typeof message.to !== 'string' || !FRIEND_ID_PATTERN.test(message.to) || message.to === session.id ||
      typeof message.room !== 'string' || !ROOM_PATTERN.test(message.room) || !answer && message.room.slice(0,43) !== session.id ||
      typeof message.nonce !== 'string' || !NONCE_PATTERN.test(message.nonce) ||
      !Number.isSafeInteger(message.expires) || message.expires <= now || message.expires > now + 120000 ||
      answer && typeof message.accepted !== 'boolean' || message.grant !== undefined && !grantShape(message.grant, now)) {
      this.reject(ws, 'Invalid signed call invitation.'); return;
    }
    const signature = decoded(message.signature, 64);
    if (!signature || signature.byteLength !== 64) { this.reject(ws, 'Invalid call invitation signature.'); return; }
    const canonical = answer ?
      `screentask-answer-v1\n${session.id}\n${message.to}\n${message.room}\n${message.nonce}\n${message.accepted}\n${message.expires}` :
      `screentask-invite-v1\n${session.id}\n${message.to}\n${message.room}\n${message.nonce}\n${message.expires}`;
    let verified = false;
    try {
      const key = await crypto.subtle.importKey('spki', decoded(session.key, 256), {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
      verified = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, signature, encoder.encode(canonical));
    } catch { /* malformed or incompatible proof */ }
    if (message.grant) verified = verified && await verify(session.key, message.grant.signature,
      `vumiro-room-grant-v1\n${session.id}\n${message.to}\n${message.room}\n${message.grant.nonce}\n${message.grant.expires}`);
    // Crypto awaits can interleave replacement, close, reset, and watch events.
    // Never write the old attachment back or act for a superseded owner.
    session = read(ws);
    if (!session?.auth || session.departed || this.owner(session.id) !== ws) return;
    if (!verified) { this.reject(ws, 'Invalid call invitation proof.'); return; }
    if (message.expires <= Date.now() || message.grant && message.grant.expires <= Date.now()) { this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce}); return; }
    const target = this.owner(message.to);
    if (!target || !mutual(session, read(target))) {
      this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce}); return;
    }
    const forwarded = {type: message.type, from: session.id, to: message.to, room: message.room,
      nonce: message.nonce, expires: message.expires, signature: message.signature};
    if (answer) forwarded.accepted = message.accepted;
    if (message.grant) forwarded.grant = message.grant;
    if (!target || !this.send(target, forwarded)) this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce});
  }

  profile(ws, session, message) {
    const username = message.username ?? '', blocks = message.blockedIds ?? [];
    if (!onlyFields(message, ['type', 'name'], ['username', 'blockedIds']) || typeof message.name !== 'string' ||
      !message.name.trim() || message.name !== message.name.trim() || message.name.length > 48 || /[\u0000-\u001f\u007f]/.test(message.name) ||
      typeof username !== 'string' || username !== '' && !USERNAME_PATTERN.test(username) || !ids(blocks, session.id) || blocks.length + session.watch.length > 192) {
      this.error(ws, 'invalid-profile', 'Use a name up to 48 characters, an optional lowercase username and valid block list.'); return;
    }
    if (username && this.authenticated().some(other => other !== ws && read(other).username === username)) {
      this.error(ws, 'username-taken', 'That username is in use online. Choose another or use contact codes.'); return;
    }
    session.name = message.name; session.username = username; session.blocked = blocks;
    if (!this.save(ws, session)) return;
    this.send(ws, {type: 'profile-ready', profile: publicProfile(session)});
    this.presence(session.id);
    for (const id of session.watch) this.send(ws, this.presenceEvent(session, id, this.owner(id)));
    this.rooms();
  }
  lookup(ws, session, message) {
    if (!onlyFields(message, ['type', 'query', 'nonce']) || typeof message.query !== 'string' || message.query.length > 2048 || typeof message.nonce !== 'string' || !NONCE_PATTERN.test(message.nonce)) {
      this.error(ws, 'invalid-lookup', 'Enter a username or contact code.', message.nonce); return;
    }
    let query = message.query.trim(), id = '';
    if (query.startsWith('stfriend1.')) {
      try {
        const bytes = decoded(query.slice(10), 1500), contact = bytes && JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        if (contact?.v === 1 && FRIEND_ID_PATTERN.test(contact.id || '')) id = contact.id;
      } catch { /* no result for malformed code */ }
    } else if (FRIEND_ID_PATTERN.test(query)) id = query;
    else query = query.replace(/^@/, '').toLowerCase();
    const target = this.authenticated().find(other => {
      const value = read(other);
      return value.name && !blocked(session, value) && (id ? value.id === id : USERNAME_PATTERN.test(query) && value.username === query);
    });
    this.send(ws, {type: 'lookup-result', nonce: message.nonce, profile: target ? publicProfile(read(target)) : null});
  }
  async social(ws, session, message) {
    const now = Date.now(), kinds = ['friend-request', 'friend-answer', 'join-request', 'join-answer'];
    if (!onlyFields(message, ['type', 'to', 'kind', 'nonce', 'expires', 'payload', 'signature']) ||
      typeof message.to !== 'string' || !FRIEND_ID_PATTERN.test(message.to) || message.to === session.id || !kinds.includes(message.kind) ||
      typeof message.nonce !== 'string' || !NONCE_PATTERN.test(message.nonce) || !Number.isSafeInteger(message.expires) || message.expires <= now || message.expires > now + 120000 || !session.name) {
      this.error(ws, 'invalid-social', 'Announce your profile and send a valid, unexpired signed request.', message.nonce); return;
    }
    const kind = message.kind, payload = message.payload, answer = kind.endsWith('answer'), join = kind.startsWith('join');
    const fields = kind === 'friend-request' ? [] : kind === 'friend-answer' ? ['requestNonce', 'accepted'] : kind === 'join-request' ? ['room'] : ['requestNonce', 'room', 'accepted'];
    if (!onlyFields(payload, fields, kind === 'join-answer' && payload?.accepted === true ? ['grant'] : []) ||
      answer && (typeof payload.requestNonce !== 'string' || !NONCE_PATTERN.test(payload.requestNonce) || typeof payload.accepted !== 'boolean') ||
      join && (typeof payload.room !== 'string' || !ROOM_PATTERN.test(payload.room) || payload.room.slice(0, 43) !== (answer ? session.id : message.to)) ||
      kind === 'join-answer' && payload.accepted && !grantShape(payload.grant, now)) {
      this.error(ws, 'invalid-social', 'Invalid request details.', message.nonce); return;
    }
    if (!budget(session, 'socialRate', 16, 10000, now)) { this.save(ws, session); this.error(ws, 'rate-limit', 'Wait before sending more requests.', message.nonce); return; }
    if (!this.save(ws, session)) return;
    const canonical = `vumiro-social-v1\n${session.id}\n${message.to}\n${kind}\n${message.nonce}\n${message.expires}\n${JSON.stringify(payload)}`;
    const verified = await verify(session.key, message.signature, canonical);
    let validGrant = true;
    if (kind === 'join-answer' && payload.accepted) validGrant = await verify(session.key, payload.grant.signature,
      `vumiro-room-grant-v1\n${session.id}\n${message.to}\n${payload.room}\n${payload.grant.nonce}\n${payload.grant.expires}`);
    session = read(ws);
    if (!session?.auth || session.departed || this.owner(session.id) !== ws) return;
    if (!verified || !validGrant) { this.reject(ws, 'Invalid signed social proof.'); return; }
    const target = this.owner(message.to), targetSession = target && read(target), currentTime = Date.now();
    if (message.expires <= currentTime || kind === 'join-answer' && payload.accepted && payload.grant.expires <= currentTime ||
      !targetSession?.name || !session.name || blocked(session, targetSession) || join && (!mutual(session, targetSession) || (answer ? session.room : targetSession.room) !== payload.room)) {
      this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce}); return;
    }
    session.seen = (session.seen || []).filter(entry => entry[1] > currentTime);
    session.pending = (session.pending || []).filter(entry => entry.e > currentTime);
    if (session.seen.some(entry => entry[0] === message.nonce)) { this.error(ws, 'replay', 'This signed request was already used.', message.nonce); return; }
    if (session.seen.length >= 16 || !answer && session.pending.length >= 8) { this.error(ws, 'request-limit', 'Wait for pending requests to finish or expire.', message.nonce); return; }
    if (answer) {
      targetSession.pending = (targetSession.pending || []).filter(entry => entry.e > currentTime);
      const pending = targetSession.pending.find(entry => entry.n === payload.requestNonce && entry.t === session.id && entry.k === (join ? 'join-request' : 'friend-request') && (!join || entry.r === payload.room));
      if (!pending) { this.error(ws, 'unknown-request', 'The original request is no longer pending.', message.nonce); return; }
      targetSession.pending = targetSession.pending.filter(entry => entry !== pending);
    } else {
      if (kind === 'friend-request') {
        // Sum the bounded online windows: no durable counter or mailbox. This
        // also limits aggregate unsolicited notifications across the directory.
        const globalCount = this.authenticated().reduce((count, socket) => {
          const rate = read(socket).requestRate;
          return count + (rate && currentTime - rate.at < 60000 ? rate.count : 0);
        }, 0);
        if (globalCount >= 128 || !budget(session, 'requestRate', 4, 60000, currentTime) || !budget(targetSession, 'inboundRate', 12, 60000, currentTime)) {
          this.save(ws, session); this.save(target, targetSession); this.error(ws, 'rate-limit', 'Wait before sending another friend request.', message.nonce); return;
        }
        session.requestTargets = (session.requestTargets || []).filter(entry => entry[2] > currentTime);
        const pair = session.requestTargets.find(entry => entry[0] === message.to);
        if (pair && pair[1] >= 2) { this.save(ws, session); this.save(target, targetSession); this.error(ws, 'rate-limit', 'This friend already received your request. Wait a minute.', message.nonce); return; }
        if (pair) pair[1]++; else session.requestTargets.push([message.to, 1, currentTime + 60000]);
      }
      session.pending.push({n: message.nonce, t: message.to, k: kind, e: message.expires, ...(join ? {r: payload.room} : {})});
    }
    session.seen.push([message.nonce, message.expires]);
    if (!this.save(ws, session) || !this.save(target, targetSession)) return;
    if (this.send(target, {...message, from: session.id, profile: publicProfile(session)})) this.send(ws, {type: 'social-sent', to: message.to, nonce: message.nonce});
    else this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce});
  }

  async relayProfile(ws, session, message) {
    const now=Date.now();
    if(!onlyFields(message,['type','to','nonce','expires','payload','signature']) || typeof message.to!=='string' || !FRIEND_ID_PATTERN.test(message.to) || message.to===session.id ||
      typeof message.nonce!=='string' || !NONCE_PATTERN.test(message.nonce) || !Number.isSafeInteger(message.expires) || message.expires<=now || message.expires>now+15000 || !profileSignal(message.payload)) {
      this.error(ws,'invalid-profile-signal','Invalid direct profile signaling message.',message.nonce);return;
    }
    if(!budget(session,'profileRate',256,10000,now)) {this.save(ws,session);this.error(ws,'rate-limit','Wait before starting more direct profile connections.',message.nonce);return;}
    if(!this.save(ws,session)) return;
    const valid=await verify(session.key,message.signature,`vumiro-profile-signal-v1\n${session.id}\n${message.to}\n${message.nonce}\n${message.expires}\n${JSON.stringify(message.payload)}`);
    session=read(ws);if(!session?.auth || session.departed || this.owner(session.id)!==ws) return;
    if(!valid) {this.reject(ws,'Invalid direct profile signaling signature.');return;}
    const target=this.owner(message.to);
    if(message.expires<=Date.now() || !target || !mutual(session,read(target))) {this.send(ws,{type:'unavailable',to:message.to,nonce:message.nonce});return;}
    if(!this.send(target,{...message,from:session.id})) this.send(ws,{type:'unavailable',to:message.to,nonce:message.nonce});
  }

  async authenticate(ws, session, message) {
    if (!onlyFields(message, ['type', 'key', 'signature']) || message.type !== 'authenticate' ||
      session.authStarted || Date.now() - session.time > 30000) {
      this.reject(ws, 'Identity challenge expired or is invalid.'); return;
    }
    session.authStarted = true;
    ws.serializeAttachment(session);
    const keyBytes = decoded(message.key, 256), signature = decoded(message.signature, 64);
    let verified = false;
    try {
      if (keyBytes && signature?.byteLength === 64 && encoded(await crypto.subtle.digest('SHA-256', keyBytes)) === session.id) {
        const key = await crypto.subtle.importKey('spki', keyBytes, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['verify']);
        verified = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, key, signature,
          encoder.encode(`screentask-directory-v1\n${session.id}\n${session.nonce}`));
      }
    } catch { /* malformed or incompatible identity */ }
    const current = read(ws);
    if (!current || current.departed || ws.readyState !== 1) return;
    if (!verified || Date.now() - current.time > 30000) { this.reject(ws, 'Identity authentication failed.'); return; }
    // Publish the replacement before retiring the old socket. Its close event
    // cannot cause a transient offline notification for this identity.
    current.auth = true;
    current.key = message.key;
    delete current.nonce;
    ws.serializeAttachment(current);
    for (const previous of this.authenticated()) {
      if (previous !== ws && read(previous).id === current.id) {
        const old = read(previous);
        old.departed = true; old.auth = false; old.watch = [];
        previous.serializeAttachment(old);
        try { previous.close(4001, 'Identity connected from another session.'); } catch { /* already closed */ }
      }
    }
    if (this.send(ws, {type: 'ready', id: current.id})) { this.presence(current.id); this.rooms(); }
  }

  depart(ws) {
    const session = read(ws);
    if (!session || session.departed) return;
    const authenticated = session.auth;
    session.departed = true; session.auth = false; session.watch = []; session.room = null; session.pending = []; session.seen = [];
    ws.serializeAttachment(session);
    if (authenticated) { this.presence(session.id); this.rooms(); }
  }

  webSocketClose(ws, code) {
    this.depart(ws);
    try { ws.close(code === 1006 || code === 1005 ? 1001 : code, 'Presence connection closed.'); } catch { /* already closed */ }
  }

  webSocketError(ws) { this.reject(ws, 'Presence connection failed.', 1011); }
}
