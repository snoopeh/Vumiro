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
function fields(value, required, optional=[]) {
  return value && typeof value==='object' && !Array.isArray(value) && required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
}
function policyValue(value) {
  if(!value || !['public','friends','private'].includes(value.mode)) return null;
  if(value.mode!=='private') return fields(value,['mode']) ? {mode:value.mode} : null;
  return fields(value,['mode','salt','verifier']) && decoded(value.salt,16)?.length===16 && decoded(value.verifier,32)?.length===32 ?
    {mode:'private',salt:value.salt,verifier:value.verifier} : null;
}
function publicPolicy(owner) {
  const policy=owner?.policy;
  return !policy ? {mode:'legacy'} : {mode:policy.mode,...(policy.mode==='private'?{salt:policy.salt}:{})};
}
function isBlocked(a,b) {return (a.blockedIds||[]).includes(b.id)||(b.blockedIds||[]).includes(a.id);}
async function passwordProof(verifier,proof,canonical) {
  try {
    const keyBytes=decoded(verifier,32),signature=decoded(proof,32);
    if(keyBytes?.length!==32 || signature?.length!==32) return false;
    const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('HMAC',key,signature,encoder.encode(canonical));
  } catch {return false;}
}
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
  sessions() {return this.ctx.getWebSockets().filter(ws=>ws.readyState===1 && attachment(ws) && !attachment(ws).departed);}
  authenticated() {return this.sessions().filter(ws=>attachment(ws).auth);}
  owner(room) {return this.authenticated().find(ws=>attachment(ws).id===room.slice(0,43));}
  save(ws,session) {
    if(encoder.encode(JSON.stringify(session)).byteLength>=16128) {this.reject(ws,'Room metadata is full. Reduce friends or blocks.');return false;}
    ws.serializeAttachment(session);return true;
  }
  reject(ws,reason,code=1008) {this.depart(ws);try {ws.close(code,reason);} catch { /* already closed */ }}
  send(ws,message) {try {if(ws.readyState!==1 || attachment(ws)?.departed) return false;ws.send(JSON.stringify(message));return true;} catch {this.depart(ws);return false;}}
  async fetch(request) {
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket') return new Response('WebSocket upgrade required.',{status:426});
    const url=new URL(request.url),room=url.searchParams.get('room'),id=url.searchParams.get('id');
    if(!ROOM_PATTERN.test(room||'') || !FRIEND_ID_PATTERN.test(id||'')) return new Response('A protected room and local profile are required. Create a new room in Vumiro.',{status:400});
    for(const pending of this.sessions()) if(!attachment(pending).auth && Date.now()-attachment(pending).time>30000) this.reject(pending,'Room identity challenge expired.');
    if(this.sessions().length>=24 || this.authenticated().length>=8 && !this.authenticated().some(ws=>attachment(ws).id===id)) {
      const [client,server]=Object.values(new WebSocketPair());server.accept();server.close(1008,'This room already has 8 participants.');return new Response(null,{status:101,webSocket:client});
    }
    const name=(url.searchParams.get('name')||'Guest').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,48)||'Guest';
    const [client,server]=Object.values(new WebSocketPair()),now=Date.now(),nonce=encoded(crypto.getRandomValues(new Uint8Array(32)));
    const ownerSocket=this.owner(room),owner=ownerSocket&&attachment(ownerSocket),isOwner=id===room.slice(0,43);
    const policy=isOwner?{mode:'friends'}:owner?publicPolicy(owner):{mode:'offline'},policyRevision=isOwner?1:owner?.policyRevision||0;
    this.ctx.acceptWebSocket(server);
    this.save(server,{id,name,room,nonce,auth:false,authStarted:false,friends:[],blockedIds:[],friendsRevision:0,policyRevision:0,
      challengeRevision:policyRevision,challengeOwnerNonce:owner?.nonce||'',visible:[],time:now,window:now,count:0,departed:false});
    this.send(server,{type:'room-challenge',nonce,room,id,policy,policyRevision});
    return new Response(null,{status:101,webSocket:client});
  }
  allowed(session,owner) {
    if(!owner || isBlocked(session,owner)) return false;
    const mode=owner.policy?.mode||'legacy';
    if(mode==='legacy') return owner.friends.includes(session.id) && session.friends.includes(owner.id) && session.grantExpires>Date.now();
    if(session.version!==2) return false;
    if(mode==='public') return true;
    if(mode==='friends') return owner.friends.includes(session.id) && session.friends.includes(owner.id);
    return session.privateTag===owner.privateTag && !!owner.privateTag;
  }
  enforceAccess(room) {
    const ownerSocket=this.owner(room),owner=ownerSocket&&attachment(ownerSocket),ownerId=room.slice(0,43);
    for(const ws of this.authenticated()) {
      const session=attachment(ws);
      if(session.id!==ownerId && !this.allowed(session,owner)) this.reject(ws,'Room access changed. Check its privacy mode, password, friendship or block settings.');
    }
    this.announcePeers();
  }
  announcePeers() {
    // The authenticated room holds at most eight peers. Blocks apply to every
    // pair, including public/password guests who are not local contacts.
    const sessions=this.authenticated().map(ws=>({ws,session:attachment(ws)}));
    for(const item of sessions) {
      const peers=sessions.filter(other=>other!==item&&!isBlocked(item.session,other.session));
      const previous=item.session.visible||[],next=peers.map(other=>other.session.id);
      item.session.visible=next;if(!this.save(item.ws,item.session)) return;
      for(const id of previous) if(!next.includes(id)&&!this.send(item.ws,{type:'peer-left',id})) return;
      for(const other of peers) if(!previous.includes(other.session.id)&&!this.send(item.ws,{type:'peer-joined',id:other.session.id,name:other.session.name})) return;
    }
  }
  async webSocketMessage(ws,text) {
    if(typeof text!=='string'||encoder.encode(text).byteLength>LIMIT) {this.reject(ws,'Signaling message too large.',1009);return;}
    let session=attachment(ws);if(!session||session.departed) return;
    const now=Date.now();if(now-session.window>10000) {session.window=now;session.count=0;}
    if(++session.count>(session.auth?240:4)) {this.reject(ws,'Too many signaling messages.');return;}
    if(!this.save(ws,session)) return;
    let message;try {message=JSON.parse(text);} catch {this.reject(ws,'Invalid signaling JSON.');return;}
    if(!session.auth) {await this.authenticate(ws,session,message);return;}
    const owner=this.owner(session.room),ownerSession=owner&&attachment(owner);
    if(session.id!==session.room.slice(0,43)&&!this.allowed(session,ownerSession)) {this.reject(ws,'Room access expired or changed. Reconnect with the current room settings.');return;}
    if(message?.type==='room-policy') {await this.updatePolicy(ws,session,message);return;}
    if(message?.type==='room-friends') {await this.updateFriends(ws,session,message);return;}
    const forwarded=cleanSignal(message,session.id);
    if(!forwarded) {this.reject(ws,'Invalid direct signaling message.');return;}
    const target=this.authenticated().find(other=>other!==ws&&attachment(other).id===message.to);
    if(target&&!isBlocked(session,attachment(target))) this.send(target,forwarded);
  }
  async updateFriends(ws,session,message) {
    const modern=session.version===2,list=friends(message.friends,session.id),blocks=modern?friends(message.blockedIds,session.id):[];
    if(!fields(message,['type','friends','revision','signature'],modern?['version','blockedIds']:[])||modern&&message.version!==2||!list||!blocks||list.length+blocks.length>192||!Number.isSafeInteger(message.revision)||message.revision<1) {this.reject(ws,'Invalid room friend or block list revision.');return;}
    const canonical=modern?`vumiro-room-friends-v2\n${session.room}\n${session.id}\n${session.nonce}\n${message.revision}\n${list.join(',')}\n${blocks.join(',')}`:
      `screentask-room-friends-v1\n${session.room}\n${session.id}\n${session.nonce}\n${message.revision}\n${list.join(',')}`;
    const valid=await verify(session.key,message.signature,canonical);
    session=attachment(ws);if(!session?.auth||session.departed||!this.authenticated().includes(ws)) return;
    if(!valid) {this.reject(ws,'Invalid room friend update.');return;}
    if(message.revision<=(session.friendsRevision||0)) return;
    session.friends=list;
    // Owner blocks have one monotonic authority: room-policy. Applying them
    // again through an independent friend revision could restore stale access
    // when the two signature verifications finish in a different order.
    if(session.id!==session.room.slice(0,43)) session.blockedIds=blocks;
    session.friendsRevision=message.revision;
    if(this.save(ws,session)) this.enforceAccess(session.room);
  }
  async updatePolicy(ws,session,message) {
    const policy=policyValue(message.policy),blocks=friends(message.blockedIds,session.id);
    if(session.id!==session.room.slice(0,43)||session.version!==2||!fields(message,['type','revision','policy','blockedIds','signature'])||!policy||!blocks||blocks.length+session.friends.length>192||!Number.isSafeInteger(message.revision)||message.revision<2) {this.reject(ws,'Only the authenticated owner can update a valid room policy.');return;}
    const canonical=`vumiro-room-policy-v1\n${session.room}\n${session.id}\n${session.nonce}\n${message.revision}\n${JSON.stringify(message.policy)}\n${blocks.join(',')}`;
    const valid=await verify(session.key,message.signature,canonical);
    session=attachment(ws);if(!session?.auth||session.departed||this.owner(session.room)!==ws) return;
    if(!valid) {this.reject(ws,'Invalid owner policy signature.');return;}
    if(message.revision<=session.policyRevision) return;
    // A changed password or transition into private mode invalidates all old
    // password admissions. Block-only changes preserve existing valid proofs.
    if(policy.mode==='private'&&(session.policy?.mode!=='private'||policy.salt!==session.policy.salt||policy.verifier!==session.policy.verifier)) session.privateTag=encoded(crypto.getRandomValues(new Uint8Array(32)));
    if(policy.mode!=='private') delete session.privateTag;
    session.policy=policy;session.policyRevision=message.revision;session.blockedIds=blocks;
    if(!this.save(ws,session)) return;
    this.enforceAccess(session.room);
    for(const other of this.authenticated()) this.send(other,{type:'room-policy',policy:publicPolicy(session),policyRevision:session.policyRevision});
  }
  async authenticate(ws,session,message) {
    const modern=message?.version===2,list=friends(message?.friends,session.id),blocks=modern?friends(message.blockedIds,session.id):[];
    const isOwner=session.id===session.room.slice(0,43),policy=modern&&isOwner?policyValue(message.policy):null;
    const required=['type','key','signature','friends'],optional=modern?['version','blockedIds','policy','policyRevision','passwordProof','grant']:['grant'];
    if(!fields(message,required,optional)||message.type!=='room-authenticate'||!list||!blocks||list.length+blocks.length>192||session.authStarted||Date.now()-session.time>30000||
      modern&&(!Object.hasOwn(message,'policy')||!Object.hasOwn(message,'blockedIds')||!Number.isSafeInteger(message.policyRevision)||message.policyRevision<0||isOwner&&(!policy||message.policyRevision!==1)||!isOwner&&message.policy!==null)||
      message.passwordProof!==undefined&&decoded(message.passwordProof,32)?.length!==32) {this.reject(ws,'Room identity challenge or privacy policy is invalid.');return;}
    session.authStarted=true;if(!this.save(ws,session)) return;
    const canonical=modern?`vumiro-room-v2\n${session.room}\n${session.id}\n${session.nonce}\n${list.join(',')}\n${blocks.join(',')}\n${message.policyRevision}\n${JSON.stringify(message.policy)}\n${message.passwordProof||''}`:
      `screentask-room-v1\n${session.room}\n${session.id}\n${session.nonce}\n${list.join(',')}`;
    const valid=await verify(message.key,message.signature,canonical,session.id);
    let current=attachment(ws);if(!current||current.departed||ws.readyState!==1) return;
    if(!valid||Date.now()-current.time>30000) {this.reject(ws,'Room identity authentication failed.');return;}
    if(!isOwner) {
      const ownerSocket=this.owner(current.room),owner=ownerSocket&&attachment(ownerSocket);
      if(!owner) {this.reject(ws,'Waiting for the room owner to connect.',4004);return;}
      if(isBlocked({...current,blockedIds:blocks},owner)) {this.reject(ws,'Room access is blocked.');return;}
      const mode=owner.policy?.mode||'legacy',revision=owner.policyRevision||0;
      if(mode!=='legacy'&&!modern) {this.reject(ws,'Update Vumiro to join rooms with privacy settings.');return;}
      if(modern&&(message.policyRevision!==revision||current.challengeRevision!==revision||current.challengeOwnerNonce!==owner.nonce)) {this.reject(ws,'Room privacy changed. Reconnect to get its current settings.');return;}
      let proofValid=true;
      if(mode==='private') proofValid=await passwordProof(owner.policy.verifier,message.passwordProof,
        `vumiro-room-password-v1\n${current.room}\n${current.id}\n${current.nonce}\n${revision}`);
      if(mode==='legacy') proofValid=roomGrant(message.grant,Date.now())&&await verify(owner.key,message.grant.signature,
        `vumiro-room-grant-v1\n${owner.id}\n${current.id}\n${current.room}\n${message.grant.nonce}\n${message.grant.expires}`);
      current=attachment(ws);const freshOwnerSocket=this.owner(session.room),freshOwner=freshOwnerSocket&&attachment(freshOwnerSocket);
      if(!current||current.departed||ws.readyState!==1) return;
      if(!proofValid||Date.now()-current.time>30000||freshOwnerSocket!==ownerSocket||freshOwner?.nonce!==owner.nonce||(freshOwner?.policyRevision||0)!==revision) {this.reject(ws,mode==='private'?'Room password is incorrect or changed. Reconnect and try again.':'Room approval or privacy changed. Reconnect and try again.');return;}
      current.version=modern?2:1;current.friends=list;current.blockedIds=blocks;
      if(mode==='private') current.privateTag=owner.privateTag;
      if(mode==='legacy') current.grantExpires=message.grant.expires;
      if(!this.allowed(current,freshOwner)) {this.reject(ws,mode==='friends'?'Only mutual friends of the online owner can join this room.':'Room access denied by its current privacy or block settings.');return;}
    } else {
      current.version=modern?2:1;current.friends=list;current.blockedIds=blocks;current.policy=policy;current.policyRevision=modern?1:0;
      if(policy?.mode==='private') current.privateTag=encoded(crypto.getRandomValues(new Uint8Array(32)));
    }
    const existing=this.authenticated().filter(other=>attachment(other).id!==current.id);
    if(existing.length>=8) {this.reject(ws,'This room already has 8 participants.');return;}
    for(const previous of this.authenticated()) if(previous!==ws&&attachment(previous).id===current.id) {
      const old=attachment(previous);old.departed=true;old.auth=false;delete old.policy;delete old.privateTag;previous.serializeAttachment(old);try {previous.close(4001,'Identity connected from another session.');} catch { /* already closed */ }
      for(const other of existing) {const value=attachment(other);value.visible=(value.visible||[]).filter(id=>id!==current.id);other.serializeAttachment(value);this.send(other,{type:'peer-left',id:current.id});}
    }
    current.auth=true;current.key=message.key;
    // New peers receive their initial list in welcome. Existing peers learn the
    // newcomer through announcePeers, with the same pairwise block filtering.
    const peers=existing.filter(other=>!isBlocked(current,attachment(other)));
    current.visible=peers.map(other=>attachment(other).id);
    if(!this.save(ws,current)) return;
    this.enforceAccess(current.room);
    if(!attachment(ws)?.auth||attachment(ws).departed) return;
    this.send(ws,{type:'welcome',id:current.id,peers:peers.filter(other=>attachment(other)?.auth&&!attachment(other)?.departed).map(other=>{const s=attachment(other);return {id:s.id,name:s.name};}),policy:publicPolicy(isOwner?current:attachment(this.owner(current.room))),policyRevision:isOwner?current.policyRevision:attachment(this.owner(current.room))?.policyRevision||0});
  }
  depart(ws) {
    const session=attachment(ws);if(!session||session.departed) return;
    const wasAuthenticated=session.auth;session.departed=true;session.auth=false;delete session.policy;delete session.privateTag;ws.serializeAttachment(session);
    if(wasAuthenticated) {
      for(const other of this.authenticated()) {const value=attachment(other);if((value.visible||[]).includes(session.id)) {value.visible=value.visible.filter(id=>id!==session.id);other.serializeAttachment(value);this.send(other,{type:'peer-left',id:session.id});}}
      if(session.id===session.room.slice(0,43)) this.enforceAccess(session.room);
    }
  }
  webSocketClose(ws,code) {this.depart(ws);try {ws.close(code===1006||code===1005?1001:code,'Room connection closed.');} catch { /* already closed */ }}
  webSocketError(ws) {this.reject(ws,'Signaling connection failed.',1011);}
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==='/call-signaling' || url.pathname==='/friends-signaling') {
      const friends=url.pathname==='/friends-signaling';
      if(!FRIEND_ID_PATTERN.test(url.searchParams.get('id') || '') || !friends && !ROOM_PATTERN.test(url.searchParams.get('room') || '')) return new Response('A local profile and protected room code are required. Create a new room in Vumiro.',{status:400});
      const origin=request.headers.get('Origin');
      if(origin && origin!==url.origin && origin!=='https://screentask.local' && origin!=='https://vumiro.local') {
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
    if(!['/call.html','/call-client.js','/friends.html','/friends-client.js','/local-profile.js','/peer-profile.js'].includes(url.pathname)) return new Response('Not found.',{status:404});
    const response=await env.ASSETS.fetch(new Request(url,request));
    const headers=new Headers(response.headers);headers.set('Cache-Control','no-cache');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
    // Embedded hosts use the same source files through a trusted WebView2 virtual host.
    headers.set('Permissions-Policy','camera=(), display-capture=(self), microphone=(self)');
    return new Response(response.body,{status:response.status,headers});
  }
};
