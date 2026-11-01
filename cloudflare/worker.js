// Signaling only: no video, audio, TURN credentials, or file relay.
import { DurableObject } from 'cloudflare:workers';
import { FriendDirectory, FRIEND_ID_PATTERN } from './friend-directory.js';
export { FriendDirectory };

export const ROOM_PATTERN = /^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/;
const LIMIT = 65536;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const encoder = new TextEncoder();
function encoded(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
function decoded(value, limit) {
  if(typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(limit*4/3)) return null;
  try { const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)), c=>c.charCodeAt(0));return bytes.length<=limit && encoded(bytes)===value ? bytes : null; } catch { return null; }
}
function friends(value, id) {
  if(!Array.isArray(value) || value.length>128 || !value.every(item=>typeof item==='string' && FRIEND_ID_PATTERN.test(item) && item!==id)) return null;
  const sorted=[...new Set(value)].sort();
  return sorted.length===value.length && sorted.every((item,index)=>item===value[index]) ? sorted : null;
}
function attachment(ws) {try {return ws.deserializeAttachment();} catch {return null;}}
function roomGrant(value, now) {
  return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===3 &&
    typeof value.nonce==='string' && NONCE_PATTERN.test(value.nonce) && Number.isSafeInteger(value.expires) &&
    value.expires>now && value.expires<=now+86400000 && decoded(value.signature,64)?.length===64;
}
async function verify(keyText, signatureText, canonical, identity) {
  try {
    const bytes=decoded(keyText,256),signature=decoded(signatureText,64);
    if(!bytes || signature?.length!==64 || identity && encoded(await crypto.subtle.digest('SHA-256',bytes))!==identity) return false;
    const key=await crypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,encoder.encode(canonical));
  } catch {return false;}
}
export function cleanSignal(message, from) {
  if(!message || message.type !== 'signal' || typeof message.to !== 'string' || message.to.length > 64) return null;
  const result = {type:'signal',from};
  if(message.description !== undefined && !('candidate' in message)) {
    const value = message.description;
    if(!value || !['offer','answer'].includes(value.type) || typeof value.sdp !== 'string' || value.sdp.length > 60000 || /\btyp\s+relay\b/i.test(value.sdp)) return null;
    result.description = {type:value.type,sdp:value.sdp};
  } else if('candidate' in message && message.description === undefined) {
    const value=message.candidate;
    if(value === null) result.candidate=null;
    else {
      if(!value || typeof value.candidate !== 'string' || value.candidate.length > 4096 || /\btyp\s+relay\b/i.test(value.candidate)) return null;
      if(value.sdpMid != null && (typeof value.sdpMid !== 'string' || value.sdpMid.length > 256)) return null;
      if(value.sdpMLineIndex != null && (!Number.isInteger(value.sdpMLineIndex) || value.sdpMLineIndex < 0 || value.sdpMLineIndex > 64)) return null;
      if(value.usernameFragment != null && (typeof value.usernameFragment !== 'string' || value.usernameFragment.length > 256)) return null;
      result.candidate={candidate:value.candidate,sdpMid:value.sdpMid ?? null,sdpMLineIndex:value.sdpMLineIndex ?? null};
      if(value.usernameFragment != null) result.candidate.usernameFragment=value.usernameFragment;
    }
  } else return null;
  return result;
}

export class CallRoom extends DurableObject {
  sessions() { return this.ctx.getWebSockets().filter(ws => ws.readyState===1 && attachment(ws) && !attachment(ws).departed); }
  authenticated() {return this.sessions().filter(ws=>attachment(ws).auth);}
  owner(room) {return this.authenticated().find(ws=>attachment(ws).id===room.slice(0,43));}
  reject(ws,reason,code=1008) {this.depart(ws);try {ws.close(code,reason);} catch { /* already closed */ }}
  async fetch(request) {
    if(request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required.',{status:426});
    const url=new URL(request.url),room=url.searchParams.get('room'),id=url.searchParams.get('id');
    if(!ROOM_PATTERN.test(room || '') || !FRIEND_ID_PATTERN.test(id || '')) return new Response('A protected room and local profile are required. Create a new room in Vumiro.',{status:400});
    for(const pending of this.sessions()) if(!attachment(pending).auth && Date.now()-attachment(pending).time>30000) this.reject(pending,'Room identity challenge expired.');
    if(this.sessions().length>=24 || this.authenticated().length>=8 && !this.authenticated().some(ws=>attachment(ws).id===id)) {
      const [client,server]=Object.values(new WebSocketPair());server.accept();server.close(1008,'This room already has 8 participants.');
      return new Response(null,{status:101,webSocket:client});
    }
    const name=(url.searchParams.get('name') || 'Guest').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,48) || 'Guest';
    const [client,server]=Object.values(new WebSocketPair()),now=Date.now();
    this.ctx.acceptWebSocket(server);
    const nonce=encoded(crypto.getRandomValues(new Uint8Array(32)));
    server.serializeAttachment({id,name,room,nonce,auth:false,authStarted:false,friends:[],friendsRevision:0,time:now,window:now,count:0,departed:false});
    this.send(server,{type:'room-challenge',nonce,room,id});
    return new Response(null,{status:101,webSocket:client});
  }
  send(ws,message) { try { ws.send(JSON.stringify(message)); } catch { this.depart(ws); } }
  async webSocketMessage(ws,message) {
    if(typeof message!=='string' || encoder.encode(message).byteLength>LIMIT) {this.reject(ws,'Signaling message too large.',1009);return;}
    let session=attachment(ws);if(!session || session.departed) return;
    if(session.auth && session.id!==session.room.slice(0,43) && (!session.grantExpires || session.grantExpires<=Date.now())) {
      this.reject(ws,'Room approval expired. Request approval from the owner again.');return;
    }
    const now=Date.now();if(now-session.window>10000) {session.window=now;session.count=0;}
    if(++session.count>(session.auth?240:4)) {this.reject(ws,'Too many signaling messages.');return;}
    ws.serializeAttachment(session);
    let messageObject;try {messageObject=JSON.parse(message);} catch {this.reject(ws,'Invalid signaling JSON.');return;}
    if(!session.auth) {await this.authenticate(ws,session,messageObject);return;}
    if(messageObject?.type==='room-friends') {
      const list=friends(messageObject.friends,session.id);
      if(!list || !Number.isSafeInteger(messageObject.revision) || messageObject.revision<1) {this.reject(ws,'Invalid room friend list revision.');return;}
      const valid=await verify(session.key,messageObject.signature,`screentask-room-friends-v1\n${session.room}\n${session.id}\n${session.nonce}\n${messageObject.revision}\n${list.join(',')}`);
      session=attachment(ws);
      if(!session?.auth || session.departed || !this.authenticated().includes(ws)) return;
      if(!valid) {this.reject(ws,'Invalid room friend update.');return;}
      // Verifications may complete out of order. A replay or delayed older
      // update must never restore permissions removed by a newer revision.
      if(messageObject.revision<=(session.friendsRevision || 0)) return;
      session.friends=list;session.friendsRevision=messageObject.revision;ws.serializeAttachment(session);
      this.enforceFriends(session.room);
      return;
    }
    const forwarded=cleanSignal(messageObject,session.id);
    if(!forwarded) {this.reject(ws,'Invalid direct signaling message.');return;}
    const target=this.authenticated().find(other=>other!==ws && attachment(other).id===messageObject.to);
    if(target) this.send(target,forwarded);
  }
  async authenticate(ws,session,message) {
    const list=friends(message?.friends,session.id);
    if(message?.type!=='room-authenticate' || !list || session.authStarted || Date.now()-session.time>30000) {this.reject(ws,'Room identity challenge expired or is invalid.');return;}
    session.authStarted=true;ws.serializeAttachment(session);
    const valid=await verify(message.key,message.signature,`screentask-room-v1\n${session.room}\n${session.id}\n${session.nonce}\n${list.join(',')}`,session.id);
    let current=attachment(ws);
    if(!current || current.departed || ws.readyState!==1) return;
    if(!valid || Date.now()-current.time>30000) {this.reject(ws,'Room identity authentication failed.');return;}
    const ownerId=current.room.slice(0,43);
    let owner=this.owner(current.room);
    if(current.id!==ownerId && !owner) {this.reject(ws,'Waiting for the room owner to connect.',4004);return;}
    if(current.id!==ownerId && (!attachment(owner).friends.includes(current.id) || !list.includes(ownerId))) {this.reject(ws,'Only mutual friends of the online room owner can join.');return;}
    if(current.id!==ownerId) {
      if(!roomGrant(message.grant,Date.now())) {this.reject(ws,'Owner approval is required. Update Vumiro and request to join this room.');return;}
      const approvingOwner=owner,ownerKey=attachment(owner).key,grant=message.grant;
      const approved=await verify(ownerKey,grant.signature,`vumiro-room-grant-v1\n${ownerId}\n${current.id}\n${current.room}\n${grant.nonce}\n${grant.expires}`);
      // Verification yields. Recheck the current owner, current friend revision,
      // socket lifetime and expiry instead of restoring a stale attachment.
      current=attachment(ws);owner=this.owner(session.room);
      if(!current || current.departed || ws.readyState!==1) return;
      if(!approved || Date.now()-current.time>30000 || grant.expires<=Date.now() || owner!==approvingOwner || attachment(owner)?.key!==ownerKey ||
        !attachment(owner)?.friends.includes(current.id) || !list.includes(ownerId)) {
        this.reject(ws,'Room approval is invalid or access changed. Request approval again.');return;
      }
      current.grantExpires=grant.expires;
    }
    const existing=this.authenticated().filter(other=>attachment(other).id!==current.id);
    if(existing.length>=8) {this.reject(ws,'This room already has 8 participants.');return;}
    // Replace a duplicate only after its cryptographic proof is verified. Keep
    // the same peer ID, but tell peers to discard the previous WebRTC session.
    for(const previous of this.authenticated()) if(previous!==ws && attachment(previous).id===current.id) {
      const old=attachment(previous);old.departed=true;old.auth=false;previous.serializeAttachment(old);
      try {previous.close(4001,'Identity connected from another session.');} catch { /* already closed */ }
      for(const other of existing) this.send(other,{type:'peer-left',id:current.id});
    }
    current.auth=true;current.key=message.key;current.friends=list;ws.serializeAttachment(current);
    this.enforceFriends(current.room);
    const peers=this.authenticated().filter(other=>other!==ws);
    this.send(ws,{type:'welcome',id:current.id,peers:peers.map(other=>{const s=attachment(other);return {id:s.id,name:s.name};})});
    for(const other of peers) this.send(other,{type:'peer-joined',id:current.id,name:current.name});
  }
  enforceFriends(room) {
    const owner=this.owner(room),ownerId=room.slice(0,43),list=owner?attachment(owner).friends:[];
    for(const other of this.authenticated()) {
      const session=attachment(other);
      if(session.id!==ownerId && (!owner || !list.includes(session.id) || !session.friends.includes(ownerId) || !session.grantExpires || session.grantExpires<=Date.now())) this.reject(other,'Room access removed. Current owner approval and mutual friendship are required.');
    }
  }
  depart(ws) {
    const session=attachment(ws);if(!session || session.departed) return;
    const wasAuthenticated=session.auth;
    session.departed=true;session.auth=false;ws.serializeAttachment(session);
    if(wasAuthenticated) {
      for(const other of this.authenticated()) if(other!==ws) this.send(other,{type:'peer-left',id:session.id});
      if(session.id===session.room.slice(0,43)) this.enforceFriends(session.room);
    }
  }
  webSocketClose(ws,code) {this.depart(ws);try {ws.close(code===1006?1001:code,'Room connection closed.');} catch { /* already closed */ }}
  webSocketError(ws) {this.depart(ws);try {ws.close(1011,'Signaling connection failed.');} catch { /* already closed */ }}
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/call-signaling' || url.pathname==='/friends-signaling') {
      const friends=url.pathname==='/friends-signaling';
      if(!FRIEND_ID_PATTERN.test(url.searchParams.get('id') || '') || !friends && !ROOM_PATTERN.test(url.searchParams.get('room') || '')) return new Response('A local profile and protected room code are required. Create a new room in Vumiro.',{status:400});
      const origin=request.headers.get('Origin');
      if(origin && origin!==url.origin && origin!=='https://screentask.local') {
        // Local browser development is allowed only on the local Worker itself.
        let local=false;try { const u=new URL(origin);local=['localhost','127.0.0.1','[::1]'].includes(url.hostname) && ['localhost','127.0.0.1','[::1]'].includes(u.hostname); } catch { /* invalid origin */ }
        if(!local) return new Response('Origin not allowed.',{status:403});
      }
      if(friends) return env.FRIEND_DIRECTORY.get(env.FRIEND_DIRECTORY.idFromName('directory-v1')).fetch(request);
      const id=env.CALL_ROOMS.idFromName(url.searchParams.get('room'));
      return env.CALL_ROOMS.get(id).fetch(request);
    }
    if(url.pathname==='/' || url.pathname==='/friends' || url.pathname==='/friends/') url.pathname='/friends.html';
    if(url.pathname==='/call' || url.pathname==='/call/') url.pathname='/call.html';
    if(!['/call.html','/call-client.js','/friends.html','/friends-client.js','/local-profile.js'].includes(url.pathname)) return new Response('Not found.',{status:404});
    const response=await env.ASSETS.fetch(new Request(url,request));
    const headers=new Headers(response.headers);headers.set('Cache-Control','no-cache');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
    // Embedded hosts use the same source files through a trusted WebView2 virtual host.
    headers.set('Permissions-Policy','camera=(), display-capture=(self), microphone=(self)');
    return new Response(response.body,{status:response.status,headers});
  }
};
