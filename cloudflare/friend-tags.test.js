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
    assert.deepEqual(Object.keys(result.profile).sort(),['friendTag','id','key','name','socialVersion','username']);
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
