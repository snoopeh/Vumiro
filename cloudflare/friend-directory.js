// Ephemeral coordination only. Profiles, names and friend lists stay on devices;
// attachments contain identity proofs and presence subscriptions, never media.
import { DurableObject } from 'cloudflare:workers';

export const FRIEND_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ROOM_PATTERN = /^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
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

function onlyFields(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function read(ws) {
  try { return ws.deserializeAttachment(); } catch { return null; }
}

export class FriendDirectory extends DurableObject {
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
      time: now, watch: [], window: now, count: 0, departed: false, authStarted: false});
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
      if (session.watch.includes(id)) this.send(watcher, {type: 'presence', id, online: !!owner && read(owner).watch.includes(session.id)});
    }
  }

  async webSocketMessage(ws, text) {
    if (typeof text !== 'string') { this.reject(ws, 'Only identity and call signaling text is allowed.', 1003); return; }
    if (text.length > MAX_BYTES || encoder.encode(text).byteLength > MAX_BYTES) { this.reject(ws, 'Presence message is too large.', 1009); return; }
    let session = read(ws);
    if (!session || session.departed) return;
    const now = Date.now();
    if (now - session.window >= 10000) { session.window = now; session.count = 0; }
    if (++session.count > 120) { this.reject(ws, 'Too many presence messages.'); return; }
    ws.serializeAttachment(session);
    let message;
    try { message = JSON.parse(text); } catch { this.reject(ws, 'Invalid presence JSON.'); return; }
    if (!session.auth) {
      await this.authenticate(ws, session, message);
      return;
    }
    if (onlyFields(message, ['type', 'ids']) && message.type === 'watch') {
      if (!Array.isArray(message.ids) || message.ids.length > 128 || !message.ids.every(id => typeof id === 'string' && FRIEND_ID_PATTERN.test(id))) {
        this.reject(ws, 'Invalid presence subscriptions.'); return;
      }
      session.watch = [...new Set(message.ids)].filter(id => id !== session.id);
      ws.serializeAttachment(session);
      for (const id of session.watch) {
        const owner = this.owner(id);
        if (!this.send(ws, {type: 'presence', id, online: !!owner && read(owner).watch.includes(session.id)})) break;
      }
      // Adding or removing a local friend changes whether that friend can see
      // this identity online. No online state is disclosed for one-sided adds.
      this.presence(session.id);
      return;
    }
    if (message?.type !== 'invite' && message?.type !== 'answer') { this.reject(ws, 'Invalid presence message type.'); return; }
    const answer = message.type === 'answer';
    const fields = ['type', 'to', 'room', 'nonce', 'expires', 'signature'];
    if (answer) fields.push('accepted');
    if (!onlyFields(message, fields) || typeof message.to !== 'string' || !FRIEND_ID_PATTERN.test(message.to) || message.to === session.id ||
      typeof message.room !== 'string' || !ROOM_PATTERN.test(message.room) || !answer && message.room.slice(0,43) !== session.id ||
      typeof message.nonce !== 'string' || !NONCE_PATTERN.test(message.nonce) ||
      !Number.isSafeInteger(message.expires) || message.expires <= now || message.expires > now + 120000 ||
      answer && typeof message.accepted !== 'boolean') {
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
    // Crypto awaits can interleave replacement, close, reset, and watch events.
    // Never write the old attachment back or act for a superseded owner.
    session = read(ws);
    if (!session?.auth || session.departed || this.owner(session.id) !== ws) return;
    if (!verified) { this.reject(ws, 'Invalid call invitation proof.'); return; }
    if (message.expires <= Date.now()) { this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce}); return; }
    const target = this.owner(message.to);
    if (!target || !session.watch.includes(message.to) || !read(target).watch.includes(session.id)) {
      this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce}); return;
    }
    const forwarded = {type: message.type, from: session.id, to: message.to, room: message.room,
      nonce: message.nonce, expires: message.expires, signature: message.signature};
    if (answer) forwarded.accepted = message.accepted;
    if (!target || !this.send(target, forwarded)) this.send(ws, {type: 'unavailable', to: message.to, nonce: message.nonce});
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
    if (this.send(ws, {type: 'ready', id: current.id})) this.presence(current.id);
  }

  depart(ws) {
    const session = read(ws);
    if (!session || session.departed) return;
    const authenticated = session.auth;
    session.departed = true; session.auth = false; session.watch = [];
    ws.serializeAttachment(session);
    if (authenticated) this.presence(session.id);
  }

  webSocketClose(ws, code) {
    this.depart(ws);
    try { ws.close(code === 1006 || code === 1005 ? 1001 : code, 'Presence connection closed.'); } catch { /* already closed */ }
  }

  webSocketError(ws) { this.reject(ws, 'Presence connection failed.', 1011); }
}
