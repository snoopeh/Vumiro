// Bounded public coordination; persist requests, pseudonymous friend-tag
// assignments and expiring hashed allocation budgets. No private keys or media.
import { DurableObject } from 'cloudflare:workers';

export const FRIEND_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ROOM_PATTERN = /^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const USERNAME_PATTERN = /^[a-z0-9_.-]{3,24}$/;
const MAX_BYTES = 16 * 1024;
const TAG_ALLOCATION_HOUR = 3600000;
const ROOM_ALIAS_TTL = 86400000;
const ROOM_ALIAS_TOKEN = /^[A-Za-z0-9_-]{12}$/;
const ROOM_ALIAS_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
const CAPABILITIES = {roomAliases:1};
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

function formattedTag(tag) { return `#${tag.slice(0,5)}-${tag.slice(5)}`; }
function parsedTag(query) {
  if (!/^#?[\d -]+$/.test(query)) return '';
  const digits=query.replace(/^#/, '').replace(/[ -]/g, '');
  return /^\d{10}$/.test(digits) ? digits : '';
}
function handleBase(name,username) {
  if(username)return username;
  const slug=name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_.-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24);
  return (slug||'person').padEnd(3,'_');
}
function parsedHandle(query) {
  const match=/^@?([a-z0-9_.-]{3,24})#(\d{3,10})$/i.exec(query);
  return match ? {base:match[1].toLowerCase(),code:match[2]} : null;
}
function randomTag() {
  // Rejection sampling avoids biased decimal digits; UNIQUE enforces allocation.
  const parts=[];
  while(parts.length<2) { const value=crypto.getRandomValues(new Uint32Array(1))[0];if(value<4294900000)parts.push(String(value%100000).padStart(5,'0')); }
  return parts.join('');
}
function randomDiscriminator() {
  for (;;) {
    const value=crypto.getRandomValues(new Uint32Array(1))[0];
    if(value<4294900000)return String(value%100000).padStart(5,'0');
  }
}
function randomRoomCode() {
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)),byte=>alphabet[byte&31]).join('');
}
async function allocationBucket(request,now=Date.now()) {
  // worker.js passes the original edge request directly to this DO. Trust only
  // Cloudflare's client-IP header, never client-supplied forwarding headers.
  const ip=request.headers.get('CF-Connecting-IP');
  if(!ip || !/^[0-9a-f:.]{3,64}$/i.test(ip))return null;
  const hour=Math.floor(now/TAG_ALLOCATION_HOUR);
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(`vumiro-friend-tag-budget-v1\n${hour}\n${ip.toLowerCase()}`));
  return {key:encoded(digest),hour};
}
function publicProfile(session) { return {id: session.id, name: session.name, username: session.username || '', key: session.key, socialVersion: session.socialVersion === 2 ? 2 : 1, ...(session.friendTag ? {friendTag:session.friendTag} : {}), ...(session.friendHandle ? {friendHandle:session.friendHandle} : {})}; }
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
async function validIdentityTransition(value, session, now=Date.now()) {
  if(value==null)return true;
  if(!onlyFields(value,['version','fromId','fromKey','toId','toKey','createdAt','signature'])||value.version!==1||
    !FRIEND_ID_PATTERN.test(value.fromId||'')||value.fromId===session.id||value.toId!==session.id||value.toKey!==session.key||
    typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||Date.parse(value.createdAt)>now+300000||decoded(value.signature,64)?.length!==64)return false;
  const oldKey=decoded(value.fromKey,256);
  if(!oldKey||encoded(await crypto.subtle.digest('SHA-256',oldKey))!==value.fromId)return false;
  return verify(value.fromKey,value.signature,['vumiro-identity-transition-v1',value.fromId,value.fromKey,value.toId,value.toKey,value.createdAt].join('\n'));
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
  constructor(ctx, env) {
    super(ctx, env);
    const sql=ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS friend_tags (identity_id TEXT PRIMARY KEY, tag TEXT NOT NULL UNIQUE)');
    // A signed transition can move a tag once. Remembering that move prevents a
    // replay from replacing the stable destination tag after the old key returns.
    sql.exec('CREATE TABLE IF NOT EXISTS friend_tag_moves (from_id TEXT PRIMARY KEY, to_id TEXT NOT NULL)');
    // Named handles are an additive directory feature. Legacy numbers keep
    // resolving for existing clients and saved contact codes.
    sql.exec('CREATE TABLE IF NOT EXISTS friend_handles (identity_id TEXT PRIMARY KEY, handle_base TEXT NOT NULL, discriminator TEXT NOT NULL, UNIQUE(handle_base,discriminator))');
    sql.exec('CREATE TABLE IF NOT EXISTS friend_handle_moves (from_id TEXT PRIMARY KEY, to_id TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS friend_tag_allocations (bucket TEXT PRIMARY KEY, expires INTEGER NOT NULL, count INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS friend_tag_allocations_expiry ON friend_tag_allocations(expires)');
    // Discovery only. Never persist passwords, admissions, profiles or grants.
    // One expiring mapping per identity bounds allocation even across reconnects.
    sql.exec('CREATE TABLE IF NOT EXISTS room_aliases (owner_id TEXT PRIMARY KEY, room TEXT NOT NULL, token TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS room_aliases_expiry ON room_aliases(expires)');
    sql.exec(`CREATE TABLE IF NOT EXISTS friend_requests (
      nonce TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
      expires INTEGER NOT NULL, retain_until INTEGER NOT NULL, state TEXT NOT NULL,
      request_json TEXT NOT NULL, response_json TEXT, from_profile_json TEXT NOT NULL, to_profile_json TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0, from_resolved INTEGER NOT NULL DEFAULT 0,
      to_resolved INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS friend_requests_from_state ON friend_requests(from_id,state,expires)');
    sql.exec('CREATE INDEX IF NOT EXISTS friend_requests_to_state ON friend_requests(to_id,state,expires)');
    sql.exec('CREATE INDEX IF NOT EXISTS friend_requests_retain ON friend_requests(retain_until)');
  }
  rows(query,...bindings) { return [...this.ctx.storage.sql.exec(query,...bindings)]; }
  assignFriendTag(id,allocation=null) {
    let tag='';
    this.ctx.storage.transactionSync(()=>{
      tag=this.rows('SELECT tag FROM friend_tags WHERE identity_id=?',id)[0]?.tag || '';
      if(tag)return;
      const now=Date.now(),hour=Math.floor(now/TAG_ALLOCATION_HOUR),expires=(hour+1)*TAG_ALLOCATION_HOUR;
      if(allocation && (allocation.hour!==hour || !FRIEND_ID_PATTERN.test(allocation.key||'')))throw new Error('Friend number allocation connection expired. Reconnect to retry.');
      const bucket=allocation?.key || 'unknown',limit=allocation?10:256;
      this.ctx.storage.sql.exec('DELETE FROM friend_tag_allocations WHERE expires<=?',now);
      const count=Number(this.rows('SELECT count FROM friend_tag_allocations WHERE bucket=?',bucket)[0]?.count||0);
      if(count>=limit)throw new Error('Too many new friend numbers from this connection. Try again in an hour.');
      for(let attempt=0;attempt<32;attempt++) {
        const candidate=randomTag();
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO friend_tags(identity_id,tag) VALUES(?,?)',id,candidate);
        tag=this.rows('SELECT tag FROM friend_tags WHERE identity_id=?',id)[0]?.tag || '';
        if(tag) {
          this.ctx.storage.sql.exec('INSERT INTO friend_tag_allocations(bucket,expires,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1',bucket,expires);
          return;
        }
      }
      throw new Error('Friend tag allocation is temporarily unavailable.');
    });
    return formattedTag(tag);
  }
  transitionFriendTag(session,transition) {
    if(!transition || this.owner(transition.fromId))return session.friendTag;
    let tag='';
    this.ctx.storage.transactionSync(()=>{
      if(this.rows('SELECT to_id FROM friend_tag_moves WHERE from_id=?',transition.fromId).length)return;
      const source=this.rows('SELECT tag FROM friend_tags WHERE identity_id=?',transition.fromId)[0];
      if(!source)return;
      this.ctx.storage.sql.exec('DELETE FROM friend_tags WHERE identity_id=?',session.id);
      this.ctx.storage.sql.exec('UPDATE friend_tags SET identity_id=? WHERE identity_id=?',session.id,transition.fromId);
      this.ctx.storage.sql.exec('INSERT INTO friend_tag_moves(from_id,to_id) VALUES(?,?)',transition.fromId,session.id);
      tag=source.tag;
    });
    return tag ? formattedTag(tag) : session.friendTag;
  }
  assignFriendHandle(id,base) {
    let handle='';
    this.ctx.storage.transactionSync(()=>{
      const current=this.rows('SELECT handle_base,discriminator FROM friend_handles WHERE identity_id=?',id)[0];
      // Upgrade the original three-digit QA handles exactly once. Reconnects
      // and renames preserve every already-assigned five-digit discriminator.
      let code=current?.discriminator?.length===3 ? null : current?.discriminator;
      if(current?.handle_base===base&&code){handle=`${base}#${code}`;return;}
      if(!code || this.rows('SELECT identity_id FROM friend_handles WHERE handle_base=? AND discriminator=?',base,code).length) {
        code=null;
        for(let attempt=0;attempt<64;attempt++) {
          const candidate=randomDiscriminator();
          if(!this.rows('SELECT identity_id FROM friend_handles WHERE handle_base=? AND discriminator=?',base,candidate).length){code=candidate;break;}
        }
        if(!code)throw new Error('Friend handle allocation is temporarily unavailable.');
      }
      // One row per verified identity bounds storage even when names change.
      this.ctx.storage.sql.exec('INSERT INTO friend_handles(identity_id,handle_base,discriminator) VALUES(?,?,?) ON CONFLICT(identity_id) DO UPDATE SET handle_base=excluded.handle_base,discriminator=excluded.discriminator',id,base,code);
      handle=`${base}#${code}`;
    });
    return handle;
  }
  transitionFriendHandle(session,transition) {
    if(!transition || this.owner(transition.fromId))return;
    this.ctx.storage.transactionSync(()=>{
      if(this.rows('SELECT to_id FROM friend_handle_moves WHERE from_id=?',transition.fromId).length)return;
      const source=this.rows('SELECT identity_id FROM friend_handles WHERE identity_id=?',transition.fromId)[0];
      if(source) {
        this.ctx.storage.sql.exec('DELETE FROM friend_handles WHERE identity_id=?',session.id);
        this.ctx.storage.sql.exec('UPDATE friend_handles SET identity_id=? WHERE identity_id=?',session.id,transition.fromId);
      }
      // Consume the proof even if an older client had not announced a named
      // handle. Replaying it must never steal a later allocation by the old key.
      this.ctx.storage.sql.exec('INSERT INTO friend_handle_moves(from_id,to_id) VALUES(?,?)',transition.fromId,session.id);
    });
  }
  pruneFriendRows(now=Date.now()) {
    this.ctx.storage.sql.exec('DELETE FROM friend_requests WHERE retain_until<=?',now);
    this.ctx.storage.sql.exec('DELETE FROM friend_tag_allocations WHERE expires<=?',now);
    this.ctx.storage.sql.exec('DELETE FROM room_aliases WHERE expires<=?',now);
  }
  async syncFriendAlarm() {
    const current=await this.ctx.storage.getAlarm();
    const rows=this.rows('SELECT MIN(at) AS at FROM (SELECT MIN(retain_until) AS at FROM friend_requests UNION ALL SELECT MIN(expires) AS at FROM friend_tag_allocations UNION ALL SELECT MIN(expires) AS at FROM room_aliases)');
    const next=rows[0]?.at == null ? null : Number(rows[0].at);
    if(next===null) { if(current!==null) await this.ctx.storage.deleteAlarm(); }
    else if(current!==next) await this.ctx.storage.setAlarm(next);
  }
  friendRow(nonce) { return this.rows('SELECT * FROM friend_requests WHERE nonce=?',nonce)[0] || null; }
  friendRowValue(row) {
    if(!row) return null;
    try { return {nonce:row.nonce,fromId:row.from_id,toId:row.to_id,expires:Number(row.expires),retainUntil:Number(row.retain_until),state:row.state,
      request:JSON.parse(row.request_json),response:row.response_json?JSON.parse(row.response_json):null,fromProfile:JSON.parse(row.from_profile_json),toProfile:JSON.parse(row.to_profile_json),delivered:!!row.delivered,
      fromResolved:!!row.from_resolved,toResolved:!!row.to_resolved}; } catch { return null; }
  }
  friendState(row,id) {
    const value=this.friendRowValue(row);if(!value) return null;
    return {type:'friend-state',request:value.request,response:value.response,contact:id===value.fromId?value.toProfile:value.fromProfile,state:value.state,expires:value.retainUntil,delivered:value.delivered};
  }
  sendFriendState(row,id) {
    const socket=this.owner(id);if(!socket) return false;
    const session=read(socket),value=this.friendRowValue(row);
    if(!value || session.blocked?.includes(id===value.fromId?value.toId:value.fromId)) return false;
    return this.send(socket,this.friendState(row,id));
  }
  pushFriendRow(row) {
    if(!row) return;
    this.sendFriendState(row,row.from_id);this.sendFriendState(row,row.to_id);
  }
  async replayFriendRows(ws,session) {
    this.pruneFriendRows();
    for(const row of this.rows('SELECT * FROM friend_requests WHERE from_id=? OR to_id=? ORDER BY created ASC',session.id,session.id)) {
      const value=this.friendRowValue(row);if(!value) continue;
      const other=value.fromId===session.id?value.toId:value.fromId;
      if(value.state!=='pending' && (session.id===value.fromId?value.fromResolved:value.toResolved)) continue;
      if((session.blocked||[]).includes(other)) {
        if(value.state!=='pending') this.ackFriendResolution(session.id,value.nonce);
        continue;
      }
      if(!this.send(ws,this.friendState(row,session.id))) break;
    }
    await this.syncFriendAlarm();
  }
  async saveFriendRequest(ws,session,target,targetSession,message) {
    const now=Date.now(),nonce=message.nonce,request={type:'social',version:2,from:session.id,to:message.to,kind:'friend-request',nonce,expires:message.expires,payload:{},signature:message.signature,profile:publicProfile(session)};
    const previous=this.friendRow(nonce);
    if(previous) { const old=this.friendRowValue(previous);if(old?.fromId===session.id && old?.toId===message.to && old.request.signature===message.signature && old.request.expires===message.expires) { this.send(ws,{type:'social-sent',to:message.to,nonce});this.pushFriendRow(previous);return; }this.error(ws,'replay','This signed friend request nonce was already used.',nonce);return; }
    const globalRate=this.authenticated().reduce((count,socket)=>{ const rate=read(socket).requestRate;return count+(rate&&now-rate.at<60000?rate.count:0); },0);
    session.requestTargets=(session.requestTargets||[]).filter(entry=>entry[2]>now);
    const pair=session.requestTargets.find(entry=>entry[0]===message.to);
    if(globalRate>=128 || !budget(session,'requestRate',4,60000,now) || !budget(targetSession,'inboundRate',12,60000,now) || pair&&pair[1]>=2) {
      this.save(ws,session);this.save(target,targetSession);this.error(ws,'rate-limit','Wait before sending another friend request.',nonce);return;
    }
    if(pair) pair[1]++;else session.requestTargets.push([message.to,1,now+60000]);
    if(!this.save(ws,session) || !this.save(target,targetSession)) return;
    let outcome='ok',row=null;
    this.ctx.storage.transactionSync(()=>{
      this.pruneFriendRows(now);
      const prior=this.friendRow(nonce);
      if(prior) { const old=this.friendRowValue(prior);if(old?.fromId===session.id && old?.toId===message.to && old.request.signature===message.signature && old.request.expires===message.expires) row=prior;else outcome='replay';return; }
      const outstanding=Number(this.rows("SELECT COUNT(*) AS n FROM friend_requests WHERE (from_id=? OR to_id=?)",session.id,session.id)[0]?.n||0);
      const targetOutstanding=Number(this.rows('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id=? OR to_id=?',message.to,message.to)[0]?.n||0);
      const global=Number(this.rows("SELECT COUNT(*) AS n FROM friend_requests WHERE state='pending'")[0]?.n||0);
      const total=Number(this.rows('SELECT COUNT(*) AS n FROM friend_requests')[0]?.n||0);
      if(outstanding>=32 || targetOutstanding>=32 || global>=1024 || total>=1024) { outcome='limit';return; }
      this.ctx.storage.sql.exec(`INSERT INTO friend_requests(nonce,from_id,to_id,expires,retain_until,state,request_json,response_json,from_profile_json,to_profile_json,delivered,from_resolved,to_resolved,created)
        VALUES(?,?,?,?,?,'pending',?,NULL,?,?,0,0,0,?)`,nonce,session.id,message.to,message.expires,message.expires,JSON.stringify(request),JSON.stringify(publicProfile(session)),JSON.stringify(publicProfile(targetSession)),now);
      row=this.friendRow(nonce);
    });
    if(outcome==='replay') { this.error(ws,'replay','This signed friend request nonce was already used.',nonce);return; }
    if(outcome==='limit') { this.error(ws,'request-limit','There are too many outstanding friend requests. Resolve or wait for existing requests.',nonce);return; }
    if(row) { this.send(ws,{type:'social-sent',to:message.to,nonce});this.pushFriendRow(row); }
    await this.syncFriendAlarm();
  }
  async saveFriendAnswer(ws,session,message) {
    const now=Date.now(),nonce=message.nonce,requestNonce=message.payload.requestNonce,accepted=message.payload.accepted;
    const response={type:'social',version:2,from:session.id,to:message.to,kind:'friend-answer',nonce,expires:message.expires,payload:{requestNonce,accepted},signature:message.signature,profile:publicProfile(session)};
    let outcome='ok',row=null;
    this.ctx.storage.transactionSync(()=>{
      this.pruneFriendRows(now);
      const prior=this.friendRow(requestNonce);if(!prior) { outcome='unknown';return; }
      const value=this.friendRowValue(prior);if(!value || value.toId!==session.id || value.fromId!==message.to) { outcome='unknown';return; }
      if(value.state!=='pending') {
        if(value.response?.payload?.accepted===accepted) row=prior;else outcome='conflict';return;
      }
      if(value.expires<=now) { outcome='unknown';return; }
      this.ctx.storage.sql.exec("UPDATE friend_requests SET state=?,response_json=?,to_profile_json=?,retain_until=? WHERE nonce=? AND state='pending'",accepted?'accepted':'declined',JSON.stringify(response),JSON.stringify(publicProfile(session)),now+7*86400000,requestNonce);
      row=this.friendRow(requestNonce);
    });
    if(outcome==='unknown') { this.error(ws,'unknown-request','The original friend request is no longer pending.',nonce);return; }
    if(outcome==='conflict') { this.error(ws,'conflicting-answer','This request already has a different answer.',nonce);return; }
    this.send(ws,{type:'social-sent',to:message.to,nonce});this.pushFriendRow(row);await this.syncFriendAlarm();
  }
  ackFriendResolution(id,nonce) {
    this.ctx.storage.transactionSync(()=>{
      const row=this.friendRow(nonce);if(!row) return;
      const value=this.friendRowValue(row);if(!value || value.state==='pending' || id!==value.fromId&&id!==value.toId) return;
      const col=id===value.fromId?'from_resolved':'to_resolved';this.ctx.storage.sql.exec(`UPDATE friend_requests SET ${col}=1 WHERE nonce=?`,nonce);
      const updated=this.friendRow(nonce);if(updated && updated.from_resolved && updated.to_resolved) this.ctx.storage.sql.exec('DELETE FROM friend_requests WHERE nonce=?',nonce);
    });
  }
  async receiveFriendReceipt(ws,session,message) {
    if(!onlyFields(message,['type','requestNonce','phase']) || typeof message.requestNonce!=='string' || !NONCE_PATTERN.test(message.requestNonce) || !['pending','resolved'].includes(message.phase)) { this.error(ws,'invalid-receipt','Invalid friend delivery receipt.',message.requestNonce);return; }
    let row=null,invalid=false;
    this.ctx.storage.transactionSync(()=>{
      const current=this.friendRow(message.requestNonce);if(!current) return;
      const value=this.friendRowValue(current);if(!value || value.state==='pending'&&message.phase!=='pending' || value.state!=='pending'&&message.phase!=='resolved' || message.phase==='pending'&&session.id!==value.toId || message.phase==='resolved'&&session.id!==value.fromId&&session.id!==value.toId) { invalid=true;return; }
      if(message.phase==='pending') { if(!current.delivered) { this.ctx.storage.sql.exec('UPDATE friend_requests SET delivered=1 WHERE nonce=?',message.requestNonce);row=true; } }
      else { const col=session.id===value.fromId?'from_resolved':'to_resolved';this.ctx.storage.sql.exec(`UPDATE friend_requests SET ${col}=1 WHERE nonce=?`,message.requestNonce); }
      const updated=this.friendRow(message.requestNonce);if(updated && updated.from_resolved && updated.to_resolved) { this.ctx.storage.sql.exec('DELETE FROM friend_requests WHERE nonce=?',message.requestNonce);row=null; } else if(message.phase==='resolved') row=updated; else if(row===true) row=updated; else row=null;
    });
    if(invalid) { this.error(ws,'invalid-receipt','This receipt does not match the friend request.',message.requestNonce);return; }
    if(row && message.phase==='pending') this.sendFriendState(row,row.from_id);
    await this.syncFriendAlarm();
  }
  async cancelFriendRequest(ws,session,message) {
    if(!onlyFields(message,['type','requestNonce']) || typeof message.requestNonce!=='string' || !NONCE_PATTERN.test(message.requestNonce)) { this.error(ws,'invalid-cancel','Invalid friend request cancellation.',message.requestNonce);return; }
    let row=null,owner=false;
    this.ctx.storage.transactionSync(()=>{
      const current=this.friendRow(message.requestNonce);if(!current) return;
      const value=this.friendRowValue(current);if(!value || value.fromId!==session.id) return;owner=true;
      if(value.state==='pending') this.ctx.storage.sql.exec("UPDATE friend_requests SET state='cancelled',retain_until=? WHERE nonce=?",Date.now()+7*86400000,message.requestNonce);
      row=this.friendRow(message.requestNonce);
    });
    if(!owner) { this.error(ws,'unknown-request','Only the sender can cancel an outstanding request.',message.requestNonce);return; }
    this.pushFriendRow(row);await this.syncFriendAlarm();
  }
  async alarm() {
    const now=Date.now();this.ctx.storage.transactionSync(()=>this.pruneFriendRows(now));await this.syncFriendAlarm();
  }
  save(ws, session) {
    if (encoder.encode(JSON.stringify(session)).byteLength >= MAX_BYTES - 256) { this.reject(ws, 'Presence metadata is full. Reduce friends or blocks.'); return false; }
    ws.serializeAttachment(session); return true;
  }
  error(ws, code, message, nonce) { this.send(ws, {type: 'social-error', code, message, ...(typeof nonce === 'string' && NONCE_PATTERN.test(nonce) ? {nonce} : {})}); }
  aliasOwner(session,row) {
    const socket=row&&this.owner(row.owner_id),owner=socket&&read(socket);
    if(!owner||owner.room!==row.room||row.expires<=Date.now()||blocked(session,owner))return null;
    if(owner.id!==session.id&&!['public','private'].includes(owner.roomMode)&&!mutual(session,owner))return null;
    return owner;
  }
  async roomAlias(ws,session,message) {
    if(!onlyFields(message,['type','nonce'],['room'])||typeof message.nonce!=='string'||!NONCE_PATTERN.test(message.nonce)||message.room!==undefined&&(typeof message.room!=='string'||!ROOM_PATTERN.test(message.room))) {
      this.error(ws,'invalid-room-alias','Request a room invitation without passwords or admission data.',message.nonce);return;
    }
    const room=message.room||session.room;
    if(!room||!ROOM_PATTERN.test(room)) {this.error(ws,'room-unavailable','Create a room before inviting people.',message.nonce);return;}
    let row=this.rows('SELECT * FROM room_aliases WHERE owner_id=?',room.slice(0,43))[0];
    if(room.slice(0,43)!==session.id) {
      if(!row||row.room!==room||!this.aliasOwner(session,row)){this.error(ws,'room-unavailable','This room invitation is not available.',message.nonce);return;}
    } else {
      if(session.room!==room) {this.error(ws,'room-unavailable','Only your current room can create an invitation.',message.nonce);return;}
      try {
        this.ctx.storage.transactionSync(()=>{
          this.ctx.storage.sql.exec('DELETE FROM room_aliases WHERE expires<=?',Date.now());
          row=this.rows('SELECT * FROM room_aliases WHERE owner_id=?',session.id)[0];
          if(row?.room===room)return;
          this.ctx.storage.sql.exec('DELETE FROM room_aliases WHERE owner_id=?',session.id);
          for(let attempt=0;attempt<32;attempt++) {
            const token=encoded(crypto.getRandomValues(new Uint8Array(9))),code=randomRoomCode();
            this.ctx.storage.sql.exec('INSERT OR IGNORE INTO room_aliases(owner_id,room,token,code,expires) VALUES(?,?,?,?,?)',session.id,room,token,code,Date.now()+ROOM_ALIAS_TTL);
            row=this.rows('SELECT * FROM room_aliases WHERE owner_id=?',session.id)[0];
            if(row)return;
          }
          throw new Error('Room invitation allocation is temporarily unavailable.');
        });
      } catch(error) {this.error(ws,'room-unavailable',error.message,message.nonce);return;}
    }
    this.send(ws,{type:'room-alias-result',nonce:message.nonce,room:row.room,token:row.token,code:row.code.slice(0,4)+'-'+row.code.slice(4),expires:Number(row.expires)});
    await this.syncFriendAlarm();
  }
  resolveRoomAlias(ws,session,message) {
    const value=typeof message.value==='string'?message.value.trim():'';
    const code=value.toUpperCase().replace(/[ -]/g,'');
    if(!onlyFields(message,['type','value','nonce'])||typeof message.nonce!=='string'||!NONCE_PATTERN.test(message.nonce)||value.length>32||!ROOM_ALIAS_TOKEN.test(value)&&!ROOM_ALIAS_CODE.test(code)) {
      this.error(ws,'invalid-room-alias','Enter a valid room invitation or room code.',message.nonce);return;
    }
    const row=ROOM_ALIAS_TOKEN.test(value)?this.rows('SELECT * FROM room_aliases WHERE token=?',value)[0]:this.rows('SELECT * FROM room_aliases WHERE code=?',code)[0];
    const owner=this.aliasOwner(session,row);
    // Discovery grants no admission. CallRoom still checks signed identity,
    // friendship, owner blocks and the current private-room password proof.
    this.send(ws,{type:'room-resolve-result',nonce:message.nonce,room:owner?row.room:null,...(owner?{owner:owner.id,mode:owner.roomMode||'legacy',name:owner.name||'Vumiro'}:{})});
  }
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
    const now = Date.now();
    const tagAllocation=await allocationBucket(request,now);
    // Hashing yields: recheck capacity before accepting an interleaved socket.
    if (this.sessions().length >= 256) return new Response('Presence directory is full.', {status: 429});
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({id, auth: false, nonce: encoded(crypto.getRandomValues(new Uint8Array(32))),
      time: now, watch: [], blocked: [], pending: [], seen: [], window: now, count: 0, departed: false, authStarted: false,tagAllocation});
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
  sendIdentityTransitions(session) {
    for(const socket of this.authenticated()) {
      const other=read(socket);if(other.id===session.id||blocked(session,other))continue;
      if(other.transition&&session.watch.includes(other.transition.fromId)&&other.watch.includes(session.id))
        this.send(this.owner(session.id),{type:'identity-transition',transition:other.transition,profile:publicProfile(other)});
      if(session.transition&&other.watch.includes(session.transition.fromId)&&session.watch.includes(other.id))
        this.send(socket,{type:'identity-transition',transition:session.transition,profile:publicProfile(session)});
    }
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
    if (['watch', 'profile-announce', 'lookup', 'room-state', 'room-alias', 'room-resolve'].includes(message?.type)) {
      if (!budget(session, 'controlRate', 24, 10000, now)) { this.error(ws, 'rate-limit', 'Wait before sending more directory updates.', message.nonce); this.save(ws, session); return; }
      if (!this.save(ws, session)) return;
    }
    if (message?.type === 'profile-announce') { await this.profile(ws, session, message); return; }
    if (message?.type === 'friend-received') { await this.receiveFriendReceipt(ws,session,message); return; }
    if (message?.type === 'friend-cancel') { await this.cancelFriendRequest(ws,session,message); return; }
    if (message?.type === 'lookup') { this.lookup(ws, session, message); return; }
    if (message?.type === 'room-alias') { await this.roomAlias(ws,session,message);return; }
    if (message?.type === 'room-resolve') { this.resolveRoomAlias(ws,session,message);return; }
    if (message?.type === 'social') { await this.social(ws, session, message); return; }
    if (message?.type === 'profile-signal') { await this.relayProfile(ws, session, message); return; }
    if (message?.type === 'room-state') {
      if (!onlyFields(message, ['type', 'room', 'live'], ['mode']) || typeof message.live !== 'boolean' ||
        message.mode!==undefined && !['public','friends','private','legacy'].includes(message.mode) ||
        message.room !== null && (typeof message.room !== 'string' || !ROOM_PATTERN.test(message.room) || message.room.slice(0, 43) !== session.id) || message.room === null && message.live) {
        this.error(ws, 'invalid-room', 'Only your own protected room can be published.'); return;
      }
      session.room = message.room; session.live = message.live; session.roomMode=message.mode||'legacy';
      if (this.save(ws, session)) {
        this.ctx.storage.sql.exec('DELETE FROM room_aliases WHERE owner_id=? AND room<>?',session.id,message.room||'');
        this.rooms();
      }
      return;
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
      this.sendIdentityTransitions(session);
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

  async profile(ws, session, message) {
    const username = message.username ?? '', blocks = message.blockedIds ?? [], transition=message.transition??null;
    if (!onlyFields(message, ['type', 'name'], ['username', 'blockedIds','socialVersion','transition']) || typeof message.name !== 'string' ||
      !message.name.trim() || message.name !== message.name.trim() || message.name.length > 48 || /[\u0000-\u001f\u007f]/.test(message.name) ||
      typeof username !== 'string' || username !== '' && !USERNAME_PATTERN.test(username) || message.socialVersion!==undefined && message.socialVersion!==2 || !ids(blocks, session.id) || blocks.length + session.watch.length > 192) {
      this.error(ws, 'invalid-profile', 'Use a name up to 48 characters, an optional lowercase username and valid block list.'); return;
    }
    if(!await validIdentityTransition(transition,session)){this.error(ws,'invalid-transition','The signed identity transition is invalid.');return;}
    session=read(ws);if(!session?.auth||session.departed||this.owner(session.id)!==ws)return;
    session.friendTag=this.transitionFriendTag(session,transition);
    this.transitionFriendHandle(session,transition);
    session.friendHandle=this.assignFriendHandle(session.id,handleBase(message.name,username));
    session.name = message.name; session.username = username; session.socialVersion=message.socialVersion===2?2:1; session.blocked = blocks;session.transition=transition;
    if (!this.save(ws, session)) return;
    this.send(ws, {type: 'profile-ready', profile: publicProfile(session), namedFriendTagsVersion:1, capabilities:CAPABILITIES, socialVersion:2, serverTime:Date.now()});
    this.presence(session.id);
    this.sendIdentityTransitions(session);
    for (const id of session.watch) this.send(ws, this.presenceEvent(session, id, this.owner(id)));
    this.rooms();await this.replayFriendRows(ws,session);
  }
  lookup(ws, session, message) {
    if (!onlyFields(message, ['type', 'query', 'nonce']) || typeof message.query !== 'string' || message.query.length > 2048 || typeof message.nonce !== 'string' || !NONCE_PATTERN.test(message.nonce)) {
      this.error(ws, 'invalid-lookup', 'Enter a friend number, username or contact code.', message.nonce); return;
    }
    let query = message.query.trim(), id = '';
    const friendTag=parsedTag(query),friendHandle=parsedHandle(query);
    if(friendTag) id=this.rows('SELECT identity_id FROM friend_tags WHERE tag=?',friendTag)[0]?.identity_id || '';
    else if(friendHandle) id=this.rows('SELECT identity_id FROM friend_handles WHERE handle_base=? AND discriminator=?',friendHandle.base,friendHandle.code)[0]?.identity_id || '';
    else if (query.startsWith('stfriend1.')) {
      try {
        const bytes = decoded(query.slice(10), 1500), contact = bytes && JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        if (contact?.v === 1 && FRIEND_ID_PATTERN.test(contact.id || '')) id = contact.id;
      } catch { /* no result for malformed code */ }
    } else if (FRIEND_ID_PATTERN.test(query)) id = query;
    else query = query.replace(/^@/, '').toLowerCase();
    const online = this.authenticated();
    const target = online.find(other => {
      const value = read(other);
      return value.name && !blocked(session, value) && (id ? value.id === id : !friendTag && !friendHandle && USERNAME_PATTERN.test(query) && value.username === query);
    });
    // Exact handles/tags/codes retain their single-profile response. Other
    // text is a bounded online prefix search over username and display name.
    if (!id && !friendTag && !friendHandle && query.length >= 1) {
      const prefix=query.replace(/^@/,'').normalize('NFKC').toLocaleLowerCase();
      const matches=[],seen=new Set();
      for(const other of online){
        const value=read(other),username=String(value.username||'').normalize('NFKC').toLocaleLowerCase(),name=String(value.name||'').normalize('NFKC').toLocaleLowerCase();
        if(!value.name||blocked(session,value)||seen.has(value.id)||!(username.startsWith(prefix)||name.startsWith(prefix)||String(value.friendHandle||'').startsWith(prefix)))continue;
        seen.add(value.id);matches.push(publicProfile(value));if(matches.length===21)break;
      }
      this.send(ws,{type:'lookup-result',nonce:message.nonce,profile:matches.length===1?matches[0]:null,profiles:matches.slice(0,20),truncated:matches.length>20});return;
    }
    this.send(ws, {type: 'lookup-result', nonce: message.nonce, profile: target ? publicProfile(read(target)) : null});
  }
  async social(ws, session, message) {
    const now = Date.now(), kinds = ['friend-request', 'friend-answer', 'join-request', 'join-answer'];
    const kind=message?.kind,answer=typeof kind==='string'&&kind.endsWith('answer'),join=typeof kind==='string'&&kind.startsWith('join'),v2Friend=message?.version===2&&!join,maxExpiry=v2Friend?(answer?120000:86400000):120000;
    if (!onlyFields(message, ['type', 'to', 'kind', 'nonce', 'expires', 'payload', 'signature'], ['version']) || message.version!==undefined && message.version!==2 ||
      typeof message.to !== 'string' || !FRIEND_ID_PATTERN.test(message.to) || message.to === session.id || !kinds.includes(message.kind) ||
      typeof message.nonce !== 'string' || !NONCE_PATTERN.test(message.nonce) || !Number.isSafeInteger(message.expires) || message.expires <= now || message.expires > now + maxExpiry || !session.name) {
      this.error(ws, 'invalid-social', 'Announce your profile and send a valid, unexpired signed request.', message.nonce); return;
    }
    const payload = message.payload;
    const fields = kind === 'friend-request' ? [] : kind === 'friend-answer' ? ['requestNonce', 'accepted'] : kind === 'join-request' ? ['room'] : ['requestNonce', 'room', 'accepted'];
    if (!onlyFields(payload, fields, kind === 'join-answer' && payload?.accepted === true ? ['grant'] : []) ||
      answer && (typeof payload.requestNonce !== 'string' || !NONCE_PATTERN.test(payload.requestNonce) || typeof payload.accepted !== 'boolean') ||
      join && (typeof payload.room !== 'string' || !ROOM_PATTERN.test(payload.room) || payload.room.slice(0, 43) !== (answer ? session.id : message.to)) ||
      kind === 'join-answer' && payload.accepted && !grantShape(payload.grant, now)) {
      this.error(ws, 'invalid-social', 'Invalid request details.', message.nonce); return;
    }
    if (!budget(session, 'socialRate', 16, 10000, now)) { this.save(ws, session); this.error(ws, 'rate-limit', 'Wait before sending more requests.', message.nonce); return; }
    if (!this.save(ws, session)) return;
    const canonical = `${v2Friend?'vumiro-social-v2':'vumiro-social-v1'}\n${session.id}\n${message.to}\n${kind}\n${message.nonce}\n${message.expires}\n${JSON.stringify(payload)}`;
    const verified = await verify(session.key, message.signature, canonical);
    let validGrant = true;
    if (kind === 'join-answer' && payload.accepted) validGrant = await verify(session.key, payload.grant.signature,
      `vumiro-room-grant-v1\n${session.id}\n${message.to}\n${payload.room}\n${payload.grant.nonce}\n${payload.grant.expires}`);
    session = read(ws);
    if (!session?.auth || session.departed || this.owner(session.id) !== ws) return;
    if (!verified || !validGrant) { this.reject(ws, 'Invalid signed social proof.'); return; }
    const target = this.owner(message.to), targetSession = target && read(target), currentTime = Date.now();
    if(v2Friend) {
      if(message.expires<=currentTime || !session.name) { this.error(ws,'expired','This signed friend request has expired.',message.nonce);return; }
      if(kind==='friend-request') {
        if(!targetSession?.name || targetSession.socialVersion!==2) { this.error(ws,'friend-unavailable','This person is offline or needs to update Vumiro before receiving friend requests.',message.nonce);return; }
        if(blocked(session,targetSession)) { this.error(ws,'friend-unavailable','This person is unavailable for friend requests.',message.nonce);return; }
        await this.saveFriendRequest(ws,session,target,targetSession,message);return;
      }
      if(session.blocked?.includes(message.to) || targetSession && blocked(session,targetSession)) { this.error(ws,'friend-unavailable','This person is unavailable for friend requests.',message.nonce);return; }
      await this.saveFriendAnswer(ws,session,message);return;
    }
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
    try { current.friendTag=this.assignFriendTag(current.id,current.tagAllocation); }
    catch { this.reject(ws, 'New friend number limit reached. Retry after an hour; existing profiles can still reconnect.',1013);return; }
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
    if (this.send(ws, {type: 'ready', id: current.id, friendTag:current.friendTag, namedFriendTagsVersion:1, capabilities:CAPABILITIES, socialVersion:2, serverTime:Date.now()})) { this.presence(current.id); this.rooms(); }
    await this.syncFriendAlarm();
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
