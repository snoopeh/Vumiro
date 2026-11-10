import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Exercise production Durable Object logic and SQL, replacing only the Workers
// host class and socket transport. All identity proofs use real ECDSA keys.
const source=readFileSync(new URL('./friend-directory.js',import.meta.url),'utf8')
  .replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject { constructor(ctx,env) { this.ctx=ctx;this.env=env; } }');
const {FriendDirectory,allocationBucket}=await import(`data:text/javascript;base64,${Buffer.from(source+'\nexport {allocationBucket};').toString('base64')}`);
const encode=value=>Buffer.from(value).toString('base64url');
const text=new TextEncoder();

function fixture(t) {
  const sqlite=new DatabaseSync(':memory:'),sockets=[];
  t.after(()=>sqlite.close());
  let alarm=null;
  const ctx={getWebSockets:()=>sockets,storage:{
    sql:{exec(query,...bindings) { const statement=sqlite.prepare(query);return statement.columns().length ? statement.all(...bindings) : (statement.run(...bindings),[]); }},
    transactionSync(fn) {sqlite.exec('BEGIN');try{const result=fn();sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
    async getAlarm(){return alarm;},async setAlarm(value){alarm=value;},async deleteAlarm(){alarm=null;}
  }};
  return {directory:new FriendDirectory(ctx,{}),ctx,sqlite,sockets};
}
async function identity() {
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const bytes=await crypto.subtle.exportKey('spki',pair.publicKey),key=encode(bytes),id=encode(await crypto.subtle.digest('SHA-256',bytes));
  return {id,key,async sign(value){return encode(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,text.encode(value)));}};
}
function socket(app,owner,tagAllocation=null) {
  let attachment={id:owner.id,nonce:encode(crypto.getRandomValues(new Uint8Array(32))),auth:false,time:Date.now(),watch:[],blocked:[],window:Date.now(),count:0,tagAllocation};
  const ws={readyState:1,messages:[],serializeAttachment(value){attachment=structuredClone(value);},deserializeAttachment(){return structuredClone(attachment);},send(value){this.messages.push(JSON.parse(value));},close(code,reason){this.readyState=3;this.closed={code,reason};}};
  app.sockets.push(ws);return ws;
}
async function authenticate(app,owner,ws=socket(app,owner)) {
  const signature=await owner.sign(`screentask-directory-v1\n${owner.id}\n${ws.deserializeAttachment().nonce}`);
  await app.directory.webSocketMessage(ws,JSON.stringify({type:'authenticate',key:owner.key,signature}));
  return ws;
}
async function announce(app,ws,name='Person',extra={}) {
  await app.directory.webSocketMessage(ws,JSON.stringify({type:'profile-announce',name,socialVersion:2,...extra}));
}
async function lookup(app,ws,query) {
  await app.directory.webSocketMessage(ws,JSON.stringify({type:'lookup',query,nonce:'lookup_nonce_123456'}));
  return ws.messages.at(-1);
}
async function transition(from,to) {
  const value={version:1,fromId:from.id,fromKey:from.key,toId:to.id,toKey:to.key,createdAt:new Date().toISOString()};
  value.signature=await from.sign(['vumiro-identity-transition-v1',value.fromId,value.fromKey,value.toId,value.toKey,value.createdAt].join('\n'));
  return value;
}

test('verified identities receive stable persistent friend numbers across reconnect and hibernation',async t=>{
  const app=fixture(t),owner=await identity(),ws=await authenticate(app,owner);
  const ready=ws.messages.find(message=>message.type==='ready');
  assert.match(ready.friendTag,/^#\d{5}-\d{5}$/);
  await announce(app,ws);
  assert.equal(ws.messages.findLast(message=>message.type==='profile-ready').profile.friendTag,ready.friendTag);
  app.directory=new FriendDirectory(app.ctx,{});
  const replacement=await authenticate(app,owner);
  assert.equal(replacement.messages.find(message=>message.type==='ready').friendTag,ready.friendTag);
  assert.equal(ws.closed.code,4001);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tags').get().n,1);
});

test('friend numbers retry random collisions under a database uniqueness constraint',t=>{
  const app=fixture(t),values=[12345,67890,12345,67890,22222,33333];
  t.mock.method(crypto,'getRandomValues',array=>{array[0]=values.shift();return array;});
  assert.equal(app.directory.assignFriendTag('a'.repeat(43)),'#12345-67890');
  assert.equal(app.directory.assignFriendTag('b'.repeat(43)),'#22222-33333');
  assert.equal(app.sqlite.prepare('SELECT COUNT(DISTINCT tag) AS n FROM friend_tags').get().n,2);
  assert.equal(app.directory.assignFriendTag('a'.repeat(43)),'#12345-67890');
});

test('exhausted collision retries fail closed without changing an existing allocation',t=>{
  const app=fixture(t);
  t.mock.method(crypto,'getRandomValues',array=>{array[0]=0;return array;});
  assert.equal(app.directory.assignFriendTag('a'.repeat(43)),'#00000-00000');
  assert.throws(()=>app.directory.assignFriendTag('b'.repeat(43)),/temporarily unavailable/);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tags').get().n,1);
  assert.equal(app.directory.assignFriendTag('a'.repeat(43)),'#00000-00000');
});

test('invalid identity proof cannot reserve a number or look up another identity',async t=>{
  const app=fixture(t),owner=await identity(),ws=socket(app,owner);
  await app.directory.webSocketMessage(ws,JSON.stringify({type:'authenticate',key:owner.key,signature:encode(new Uint8Array(64))}));
  assert.equal(ws.closed.code,1008);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tags').get().n,0);
  const pending=socket(app,owner);
  await lookup(app,pending,'#12345-67890');
  assert.equal(pending.closed.code,1008);
  assert.equal(pending.messages.some(message=>message.type==='lookup-result'),false);
});

test('allocation buckets use only the Cloudflare header and rotate without retaining raw IP addresses',async()=>{
  const request=new Request('https://example.test/friends-signaling',{headers:{'CF-Connecting-IP':'192.0.2.1','X-Forwarded-For':'198.51.100.2','X-Real-IP':'203.0.113.3'}});
  const bucket=await allocationBucket(request,3600000);
  assert.match(bucket.key,/^[A-Za-z0-9_-]{43}$/);assert.equal(bucket.hour,1);
  assert.equal(JSON.stringify(bucket).includes('192.0.2.1'),false);
  assert.deepEqual(await allocationBucket(new Request(request.url,{headers:{'CF-Connecting-IP':'192.0.2.1'}}),3600000),bucket);
  assert.notEqual((await allocationBucket(request,7200000)).key,bucket.key);
  assert.equal(await allocationBucket(new Request(request.url,{headers:{'X-Forwarded-For':'192.0.2.1','X-Real-IP':'192.0.2.1'}})),null);
});

test('ten new identities per IP per hour survive hibernation while existing profiles reconnect without spending quota',async t=>{
  const app=fixture(t),now=Math.floor(Date.now()/3600000)*3600000+1000;
  t.mock.method(Date,'now',()=>now);
  const bucket=await allocationBucket(new Request('https://example.test',{headers:{'CF-Connecting-IP':'192.0.2.1'}}));
  let firstOwner,firstTag;
  for(let i=0;i<10;i++) {
    const owner=await identity(),ws=await authenticate(app,owner,socket(app,owner,bucket));
    assert.equal(ws.readyState,1);
    if(i===0){firstOwner=owner;firstTag=ws.deserializeAttachment().friendTag;}
  }
  app.directory=new FriendDirectory(app.ctx,{});
  const overLimit=await identity(),blocked=await authenticate(app,overLimit,socket(app,overLimit,bucket));
  assert.equal(blocked.closed.code,1013);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tags').get().n,10);
  const reconnected=await authenticate(app,firstOwner,socket(app,firstOwner,bucket));
  assert.equal(reconnected.deserializeAttachment().friendTag,firstTag);
  assert.equal(app.sqlite.prepare('SELECT count FROM friend_tag_allocations WHERE bucket=?').get(bucket.key).count,10);
  const otherBucket=await allocationBucket(new Request('https://example.test',{headers:{'CF-Connecting-IP':'198.51.100.2'}}));
  const other=await identity(),differentIp=await authenticate(app,other,socket(app,other,otherBucket));
  assert.equal(differentIp.readyState,1);
  app.directory.pruneFriendRows(now+3600000);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tag_allocations').get().n,0);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tags').get().n,11);
});

test('missing edge IP uses a shared bounded fallback and allocation alarms prune expired counters',async t=>{
  const app=fixture(t),now=Math.floor(Date.now()/3600000)*3600000+1000;
  let clockNow=now;t.mock.method(Date,'now',()=>clockNow);
  app.sqlite.prepare('INSERT INTO friend_tag_allocations(bucket,expires,count) VALUES(?,?,?)').run('unknown',now+1000,256);
  assert.throws(()=>app.directory.assignFriendTag('x'.repeat(43)),/Too many/);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tags').get().n,0);
  await app.directory.syncFriendAlarm();assert.equal(await app.ctx.storage.getAlarm(),now+1000);
  clockNow=now+1001;
  await app.directory.alarm();
  assert.equal(await app.ctx.storage.getAlarm(),null);
  assert.match(app.directory.assignFriendTag('x'.repeat(43)),/^#\d{5}-\d{5}$/);
});

test('tag lookup accepts familiar formatting and keeps offline and blocked identities private',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  await announce(app,aw,'Alice');await announce(app,bw,'Bob',{username:'bob.person'});
  const tag=bw.deserializeAttachment().friendTag;
  for(const query of [tag,tag.slice(1),tag.replace(/[#-]/g,''),` ${tag.replace('-',' ')} `]) {
    const result=await lookup(app,aw,query);
    assert.equal(result.profile.id,b.id);assert.equal(result.profile.friendTag,tag);
    assert.deepEqual(Object.keys(result.profile).sort(),['friendHandle','friendTag','id','key','name','socialVersion','username']);
  }
  assert.equal((await lookup(app,aw,'@bob.person')).profile.id,b.id);
  assert.equal((await lookup(app,aw,b.id)).profile.id,b.id);
  const code='stfriend1.'+encode(text.encode(JSON.stringify({v:1,id:b.id})));
  assert.equal((await lookup(app,aw,code)).profile.id,b.id);
  await announce(app,bw,'Bob',{blockedIds:[a.id]});
  assert.equal((await lookup(app,aw,tag)).profile,null);
  await announce(app,bw,'Bob');
  await announce(app,aw,'Alice',{blockedIds:[b.id]});
  assert.equal((await lookup(app,aw,tag)).profile,null);
  await announce(app,aw,'Alice');
  app.directory.depart(bw);
  assert.equal((await lookup(app,aw,tag)).profile,null);
  assert.equal(app.sqlite.prepare('SELECT tag FROM friend_tags WHERE identity_id=?').get(b.id).tag,tag.replace(/[#-]/g,''));
});

test('online username and display-name prefix discovery is bounded and deduplicated',async t=>{
  const app=fixture(t),requester=await authenticate(app,await identity());await announce(app,requester,'Requester');
  const people=[];
  for(let n=0;n<23;n++){const ws=await authenticate(app,await identity());await announce(app,ws,n<2?'Mira '+n:'Search Person '+n,{username:'search'+String(n).padStart(2,'0')});people.push(ws);}
  const byName=await lookup(app,requester,'mIrA');assert.deepEqual(byName.profiles.map(item=>item.name),['Mira 0','Mira 1']);assert.equal(byName.truncated,false);
  const byUsername=await lookup(app,requester,'@search');assert.equal(byUsername.profiles.length,20);assert.equal(byUsername.truncated,true);assert.equal(new Set(byUsername.profiles.map(item=>item.id)).size,20);
  assert.ok(byUsername.profiles.every(item=>Object.keys(item).sort().join(',')==='friendHandle,friendTag,id,key,name,socialVersion,username'));
});

test('friend number lookups retain the existing authenticated control-message budget',async t=>{
  const app=fixture(t),ws=await authenticate(app,await identity());
  for(let n=0;n<24;n++)assert.equal((await lookup(app,ws,'#12345-67890')).type,'lookup-result');
  const limited=await lookup(app,ws,'#12345-67890');
  assert.equal(limited.type,'social-error');assert.equal(limited.code,'rate-limit');
});

test('signed offline identity migration transfers a number once and ignores replay after the old key returns',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  const oldTag=aw.deserializeAttachment().friendTag,proof=await transition(a,b);
  app.directory.depart(aw);
  await announce(app,bw,'New identity',{transition:proof});
  assert.equal(bw.deserializeAttachment().friendTag,oldTag);
  assert.equal(app.sqlite.prepare('SELECT identity_id FROM friend_tags WHERE tag=?').get(oldTag.replace(/[#-]/g,'')).identity_id,b.id);
  const returned=await authenticate(app,a),replacementTag=returned.deserializeAttachment().friendTag;
  assert.notEqual(replacementTag,oldTag);app.directory.depart(returned);
  await announce(app,bw,'New identity',{transition:proof});
  assert.equal(bw.deserializeAttachment().friendTag,oldTag);
  assert.equal(app.sqlite.prepare('SELECT tag FROM friend_tags WHERE identity_id=?').get(a.id).tag,replacementTag.replace(/[#-]/g,''));
});

test('online source and forged identity transitions cannot move a number',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  const targetTag=bw.deserializeAttachment().friendTag,proof=await transition(a,b);
  await announce(app,bw,'New identity',{transition:proof});
  assert.equal(bw.deserializeAttachment().friendTag,targetTag);
  app.directory.depart(aw);proof.signature=encode(new Uint8Array(64));
  await announce(app,bw,'New identity',{transition:proof});
  assert.equal(bw.messages.at(-1).code,'invalid-transition');
  assert.equal(bw.deserializeAttachment().friendTag,targetTag);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_tag_moves').get().n,0);
});

test('request pruning leaves number assignments intact and profile announcements cannot choose a number',async t=>{
  const app=fixture(t),owner=await identity(),ws=await authenticate(app,owner),tag=ws.deserializeAttachment().friendTag;
  await announce(app,ws,'Person',{friendTag:'#11111-11111'});
  assert.equal(ws.messages.at(-1).code,'invalid-profile');
  await app.directory.alarm();
  assert.equal(app.directory.assignFriendTag(owner.id),tag);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_requests').get().n,0);
});

test('shared usernames receive distinct persistent named handles and exact lookups disambiguate them',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  assert.equal(aw.messages.find(message=>message.type==='ready').namedFriendTagsVersion,1);
  await announce(app,aw,'Mira',{username:'mira'});await announce(app,bw,'Another Mira',{username:'mira'});
  const ar=aw.messages.findLast(message=>message.type==='profile-ready'),br=bw.messages.findLast(message=>message.type==='profile-ready');
  assert.equal(ar.namedFriendTagsVersion,1);assert.match(ar.profile.friendHandle,/^mira#\d{5}$/);assert.match(br.profile.friendHandle,/^mira#\d{5}$/);
  assert.notEqual(ar.profile.friendHandle,br.profile.friendHandle);
  const found=await lookup(app,aw,'@mira');assert.deepEqual(found.profiles.map(profile=>profile.id),[a.id,b.id]);assert.equal(found.profile,null);
  for(const query of [br.profile.friendHandle,`@${br.profile.friendHandle.toUpperCase()}`])assert.equal((await lookup(app,aw,query)).profile.id,b.id);
  await announce(app,bw,'Renamed display',{username:'mira'});assert.equal(bw.deserializeAttachment().friendHandle,br.profile.friendHandle);
  app.directory=new FriendDirectory(app.ctx,{});
  const reconnected=await authenticate(app,b);await announce(app,reconnected,'Another Mira',{username:'mira'});
  assert.equal(reconnected.deserializeAttachment().friendHandle,br.profile.friendHandle);
  assert.equal(reconnected.deserializeAttachment().friendTag,br.profile.friendTag);
});

test('named handles use safe display-name fallbacks and rename without stealing occupied handles',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  await announce(app,aw,'Mira Person');await announce(app,bw,'Other',{username:'target'});
  assert.match(aw.deserializeAttachment().friendHandle,/^mira-person#\d{5}$/);
  const target=bw.deserializeAttachment().friendHandle;
  await announce(app,aw,'Mira Person',{username:'target'});
  assert.match(aw.deserializeAttachment().friendHandle,/^target#\d{5}$/);assert.notEqual(aw.deserializeAttachment().friendHandle,target);
  assert.equal((await lookup(app,bw,'mira-person#000')).profile,null);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM friend_handles').get().n,2);
  await announce(app,aw,'😀');assert.match(aw.deserializeAttachment().friendHandle,/^person#\d{5}$/);
  await announce(app,aw,'X');assert.match(aw.deserializeAttachment().friendHandle,/^x__#\d{5}$/);
  await announce(app,aw,'X',{friendHandle:'target#000'});assert.equal(aw.messages.at(-1).code,'invalid-profile');
});

test('named handle namespaces allocate random five-digit codes even with legacy three-digit allocations',t=>{
  const app=fixture(t),insert=app.sqlite.prepare('INSERT INTO friend_handles(identity_id,handle_base,discriminator) VALUES(?,?,?)');
  for(let n=0;n<1000;n++)insert.run(`identity-${n}`,'popular',String(n).padStart(3,'0'));
  t.mock.method(crypto,'getRandomValues',array=>{array[0]=73429;return array;});
  assert.equal(app.directory.assignFriendHandle('a'.repeat(43),'popular'),'popular#73429');
  assert.equal(app.directory.assignFriendHandle('a'.repeat(43),'popular'),'popular#73429');
});

test('named handles retry collisions, migrate legacy allocations once and retain the stable five-digit code',t=>{
  const app=fixture(t),insert=app.sqlite.prepare('INSERT INTO friend_handles(identity_id,handle_base,discriminator) VALUES(?,?,?)');
  insert.run('existing','mira','73429');insert.run('legacy','mira','003');
  const values=[73429,29041,73429,90125];
  t.mock.method(crypto,'getRandomValues',array=>{array[0]=values.shift();return array;});
  assert.equal(app.directory.assignFriendHandle('legacy','mira'),'mira#29041');
  app.directory=new FriendDirectory(app.ctx,{});
  assert.equal(app.directory.assignFriendHandle('legacy','mira'),'mira#29041');
  assert.equal(app.directory.assignFriendHandle('new','mira'),'mira#90125');
  assert.equal(app.directory.assignFriendHandle('legacy','renamed'),'renamed#29041');
  assert.equal(values.length,0);
});

test('failed five-digit migration rolls back without deleting the original handle',t=>{
  const app=fixture(t);
  app.sqlite.prepare('INSERT INTO friend_handles VALUES(?,?,?)').run('existing','mira','73429');
  app.sqlite.prepare('INSERT INTO friend_handles VALUES(?,?,?)').run('legacy','mira','003');
  t.mock.method(crypto,'getRandomValues',array=>{array[0]=73429;return array;});
  assert.throws(()=>app.directory.assignFriendHandle('legacy','mira'),/temporarily unavailable/);
  assert.equal(app.sqlite.prepare('SELECT discriminator FROM friend_handles WHERE identity_id=?').get('legacy').discriminator,'003');
});

const nonce='room_alias_nonce_123456';
async function command(app,ws,value){await app.directory.webSocketMessage(ws,JSON.stringify(value));return ws.messages.at(-1);}
async function publish(app,ws,mode='public'){
  const room=ws.deserializeAttachment().id+'_'+'a'.repeat(48);
  await command(app,ws,{type:'room-state',room,live:false,mode});return room;
}

test('room aliases are opaque, owner-bounded, persist across hibernation and omit admission secrets',async t=>{
  const app=fixture(t),owner=await identity(),ws=await authenticate(app,owner);await announce(app,ws);
  assert.equal(ws.messages.find(message=>message.type==='ready').capabilities.roomAliases,1);
  const room=await publish(app,ws,'private'),first=await command(app,ws,{type:'room-alias',nonce});
  assert.equal(first.type,'room-alias-result');assert.equal(first.room,room);assert.equal(first.nonce,nonce);
  assert.match(first.token,/^[A-Za-z0-9_-]{12}$/);assert.match(first.code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(Math.abs(first.expires-Date.now()-86400000)<100);
  assert.deepEqual(Object.keys(first).sort(),['code','expires','nonce','room','token','type']);
  app.directory=new FriendDirectory(app.ctx,{});
  assert.deepEqual(await command(app,ws,{type:'room-alias',nonce}),first);
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,1);
});

test('room alias resolution enforces online owner, friendship and blocks while private rooms still require admission',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  await announce(app,aw,'Alice');await announce(app,bw,'Bob');const room=await publish(app,aw);
  const alias=await command(app,aw,{type:'room-alias',nonce});
  for(const value of [alias.token,alias.code,alias.code.toLowerCase(),alias.code.replace('-','')]){
    const resolved=await command(app,bw,{type:'room-resolve',value,nonce});assert.equal(resolved.room,room);assert.equal(resolved.owner,a.id);assert.equal(resolved.mode,'public');
    assert.deepEqual(Object.keys(resolved).sort(),['mode','name','nonce','owner','room','type']);
  }
  await publish(app,aw,'friends');assert.equal((await command(app,bw,{type:'room-resolve',value:alias.token,nonce})).room,null);
  await command(app,aw,{type:'watch',ids:[b.id]});await command(app,bw,{type:'watch',ids:[a.id]});
  assert.equal((await command(app,bw,{type:'room-resolve',value:alias.token,nonce})).room,room);
  await publish(app,aw,'private');assert.equal((await command(app,bw,{type:'room-resolve',value:alias.token,nonce})).mode,'private');
  await announce(app,aw,'Alice',{blockedIds:[b.id]});assert.equal((await command(app,bw,{type:'room-resolve',value:alias.token,nonce})).room,null);
  await announce(app,aw,'Alice');await announce(app,bw,'Bob',{blockedIds:[a.id]});assert.equal((await command(app,bw,{type:'room-resolve',value:alias.token,nonce})).room,null);
  app.directory.depart(aw);assert.equal((await command(app,bw,{type:'room-resolve',value:alias.code,nonce})).room,null);
});

test('aliases expire, room changes revoke old codes and non-owners cannot create mappings',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);await announce(app,aw);await announce(app,bw);
  assert.equal((await command(app,bw,{type:'room-alias',nonce})).code,'room-unavailable');
  const room=await publish(app,aw),first=await command(app,aw,{type:'room-alias',nonce});
  await command(app,aw,{type:'room-state',room:null,live:false});
  assert.equal((await command(app,bw,{type:'room-resolve',value:first.token,nonce})).room,null);
  await publish(app,aw);const second=await command(app,aw,{type:'room-alias',nonce});assert.notEqual(second.token,first.token);
  let now=second.expires+1;t.mock.method(Date,'now',()=>now);
  assert.equal((await command(app,bw,{type:'room-resolve',value:second.code,nonce})).room,null);
  await app.directory.alarm();assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,0);
  const third=await command(app,aw,{type:'room-alias',nonce});assert.notEqual(third.code,second.code);assert.equal(third.room,room);
});

test('room alias mutations reject secret fields and preserve the directory control-message limit',async t=>{
  const app=fixture(t),ws=await authenticate(app,await identity());await announce(app,ws);await publish(app,ws);
  assert.equal((await command(app,ws,{type:'room-alias',nonce,password:'secret'})).code,'invalid-room-alias');
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,0);
  assert.equal((await command(app,ws,{type:'room-resolve',value:'bad',nonce})).code,'invalid-room-alias');
  for(let n=0;n<20;n++)await command(app,ws,{type:'room-alias',nonce});
  assert.equal((await command(app,ws,{type:'room-alias',nonce})).code,'rate-limit');
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,1);
});

test('only hosts allocate aliases while guests may fetch an existing alias under the current discovery policy',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);await announce(app,aw);await announce(app,bw);
  const room=await publish(app,aw);
  assert.equal((await command(app,bw,{type:'room-alias',room,nonce})).code,'room-unavailable');
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,0);
  const alias=await command(app,aw,{type:'room-alias',nonce});
  assert.equal((await command(app,bw,{type:'room-alias',room,nonce})).token,alias.token);
  await publish(app,aw,'friends');
  assert.equal((await command(app,bw,{type:'room-alias',room,nonce})).code,'room-unavailable');
  await command(app,aw,{type:'watch',ids:[b.id]});await command(app,bw,{type:'watch',ids:[a.id]});
  assert.equal((await command(app,bw,{type:'room-alias',room,nonce})).code,alias.code);
  const attempt=b.id+'_'+'b'.repeat(48);
  assert.equal((await command(app,bw,{type:'room-alias',room:attempt,nonce})).code,'room-unavailable');
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,1);
});

test('alias uniqueness retries collisions and expiry is scheduled even without pending friend requests',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);await announce(app,aw);await announce(app,bw);
  await publish(app,aw);await publish(app,bw);
  let fills=[1,1,1,1,2,2];t.mock.method(crypto,'getRandomValues',array=>array.fill(fills.shift()));
  const first=await command(app,aw,{type:'room-alias',nonce});
  const second=await command(app,bw,{type:'room-alias',nonce});
  assert.notEqual(first.token,second.token);assert.notEqual(first.code,second.code);assert.equal(fills.length,0);
  app.sqlite.prepare('DELETE FROM friend_tag_allocations').run();await app.directory.syncFriendAlarm();
  assert.equal(await app.ctx.storage.getAlarm(),Math.min(first.expires,second.expires));
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,2);
});

test('alias protocol rejects array coercion for room identifiers and request nonces',async t=>{
  const app=fixture(t),ws=await authenticate(app,await identity());await announce(app,ws);const room=await publish(app,ws);
  for(const message of [{type:'room-alias',room:[room],nonce},{type:'room-alias',nonce:[nonce]},{type:'room-resolve',value:'ABCD-EFGH',nonce:[nonce]}]){
    assert.equal((await command(app,ws,message)).code,'invalid-room-alias');
  }
  assert.equal(app.sqlite.prepare('SELECT COUNT(*) AS n FROM room_aliases').get().n,0);
});

test('short links redirect with only the opaque token, remove extra URL data and disable caching/referrers',async()=>{
  const workerSource=readFileSync(new URL('./worker.js',import.meta.url),'utf8')
    .replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject {}')
    .replace("import { FriendDirectory, FRIEND_ID_PATTERN } from './friend-directory.js';",'class FriendDirectory {}; const FRIEND_ID_PATTERN=/^[A-Za-z0-9_-]{43}$/;')
    .replace("import { handleAccountRequest, runAccountMaintenance } from './accounts.js';",'');
  const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);
  const request=new Request('https://vumiro.example/r/Abc_456-xy12?password=secret&grant=stuff');
  const response=await worker.fetch(request,{});
  assert.equal(response.status,302);
  assert.equal(response.headers.get('Location'),'https://vumiro.example/friends.html?roomInvite=Abc_456-xy12');
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal((await worker.fetch(new Request('https://vumiro.example/r/short'),{})).status,404);
  assert.equal((await worker.fetch(new Request('https://vumiro.example/r/Abc_456-xy12',{method:'POST'}),{})).status,405);
});

test('Worker serves every script referenced by current client HTML while rejecting unknown assets',async()=>{
  const workerSource=readFileSync(new URL('./worker.js',import.meta.url),'utf8')
    .replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject {}')
    .replace("import { FriendDirectory, FRIEND_ID_PATTERN } from './friend-directory.js';",'class FriendDirectory {}; const FRIEND_ID_PATTERN=/^[A-Za-z0-9_-]{43}$/;')
    .replace("import { handleAccountRequest, runAccountMaintenance } from './accounts.js';",'');
  const {default:worker}=await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`);
  const scripts=new Set();
  for(const page of ['auth','friends','call']) {
    const html=readFileSync(new URL(`../Vumiro.Client/WebServer/${page}.html`,import.meta.url),'utf8');
    for(const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) scripts.add(match[1]);
  }
  assert.ok(scripts.size>0,'current HTML supplies script requests');
  const forwarded=[];
  const env={ASSETS:{fetch:async request=>{forwarded.push(request.url);return new Response('asset:'+request.url);}}};
  for(const script of scripts) {
    const request=new Request(`https://vumiro.example${script}?version=qa`);
    const response=await worker.fetch(request,env);
    assert.equal(response.status,200,script+' reaches the asset binding');
    assert.equal(await response.text(),'asset:'+request.url,script+' returns the forwarded asset');
    assert.equal(forwarded.at(-1),request.url);
  }
  const count=forwarded.length;
  assert.equal((await worker.fetch(new Request('https://vumiro.example/unknown-script.js'),env)).status,404);
  assert.equal(forwarded.length,count,'unknown paths never reach the asset binding');
});

test('named handles preserve offline and blocked lookup privacy',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  await announce(app,aw,'Alice');await announce(app,bw,'Bob',{username:'bob'});
  const handle=bw.deserializeAttachment().friendHandle;
  await announce(app,bw,'Bob',{username:'bob',blockedIds:[a.id]});assert.equal((await lookup(app,aw,handle)).profile,null);
  await announce(app,bw,'Bob',{username:'bob'});await announce(app,aw,'Alice',{blockedIds:[b.id]});assert.equal((await lookup(app,aw,handle)).profile,null);
  await announce(app,aw,'Alice');app.directory.depart(bw);assert.equal((await lookup(app,aw,handle)).profile,null);
});

test('signed migration moves a named handle once and replay cannot steal a returned identity handle',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b);
  await announce(app,aw,'Mira',{username:'mira'});await announce(app,bw,'Mira',{username:'mira'});
  const handle=aw.deserializeAttachment().friendHandle,targetHandle=bw.deserializeAttachment().friendHandle,proof=await transition(a,b);
  await announce(app,bw,'Mira',{username:'mira',transition:proof});assert.equal(bw.deserializeAttachment().friendHandle,targetHandle);
  app.directory.depart(aw);await announce(app,bw,'Mira',{username:'mira',transition:proof});assert.equal(bw.deserializeAttachment().friendHandle,handle);
  const returned=await authenticate(app,a);await announce(app,returned,'Mira',{username:'mira'});
  const replacement=returned.deserializeAttachment().friendHandle;assert.notEqual(replacement,handle);app.directory.depart(returned);
  await announce(app,bw,'Mira',{username:'mira',transition:proof});assert.equal(bw.deserializeAttachment().friendHandle,handle);
  assert.equal(app.sqlite.prepare('SELECT discriminator FROM friend_handles WHERE identity_id=?').get(a.id).discriminator,replacement.split('#')[1]);
  proof.signature=encode(new Uint8Array(64));await announce(app,bw,'Mira',{username:'mira',transition:proof});assert.equal(bw.messages.at(-1).code,'invalid-transition');
});

test('migration before a source has a named handle still consumes its one-time handle transfer',async t=>{
  const app=fixture(t),a=await identity(),b=await identity(),aw=await authenticate(app,a),bw=await authenticate(app,b),proof=await transition(a,b);
  app.directory.depart(aw);await announce(app,bw,'Mira',{username:'mira',transition:proof});
  const returned=await authenticate(app,a);await announce(app,returned,'Mira',{username:'mira'});
  const replacement=returned.deserializeAttachment().friendHandle;app.directory.depart(returned);
  await announce(app,bw,'Mira',{username:'mira',transition:proof});
  assert.notEqual(bw.deserializeAttachment().friendHandle,replacement);
  assert.equal(app.sqlite.prepare('SELECT discriminator FROM friend_handles WHERE identity_id=?').get(a.id).discriminator,replacement.split('#')[1]);
});
