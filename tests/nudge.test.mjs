import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/peer-profile.js',import.meta.url),'utf8');
const text=new TextEncoder();
const until=async check=>{const end=performance.now()+2000;while(!check()){assert.ok(performance.now()<end,'operation did not settle');await new Promise(setImmediate);}};
async function fixture({allow=true}={}){
  let now=Date.now(),next=0,own,friend,pendingCrypto=0;const timers=new Map(),connections=[],received=[],contacts=new Map();
  const key=async(id)=>{const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);return {id,key:Buffer.from(await webcrypto.subtle.exportKey('spki',pair.publicKey)).toString('base64url'),name:id[0],username:'',avatar:'',pair};};
  own=await key('A'.repeat(43));friend=await key('B'.repeat(43));contacts.set(friend.id,friend);
  const sign=async(person,value)=>{pendingCrypto++;try{return Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},person.pair.privateKey,text.encode(value))).toString('base64url');}finally{pendingCrypto--;}};
  const local={profile:()=>own,sign:value=>sign(own,value),verify:async(person,value,signature)=>{pendingCrypto++;try{const imported=await webcrypto.subtle.importKey('spki',Buffer.from(person.key,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return await webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},imported,Buffer.from(signature,'base64url'),text.encode(value));}catch{return false;}finally{pendingCrypto--;}}};
  class PC{constructor(){connections.push(this);}createDataChannel(label){return this.channel={label,readyState:'connecting',bufferedAmount:0,sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.readyState='closed';}};}async createOffer(){return {type:'offer',sdp:'v=0'};}async setLocalDescription(value){this.localDescription=value;}close(){this.closed=true;}}
  const sandbox={window:{VumiroServerClock:{now:()=>now}},TextEncoder,crypto:{randomUUID},RTCPeerConnection:PC,queueMicrotask,Date,setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,sandbox);const api=sandbox.window.VumiroPeerProfiles,profiles=api.create({local,send(){},getFriend:id=>contacts.get(id),onProfile(){},onNudge:id=>{received.push(id);return allow;}});
  assert.equal(typeof profiles.nudge,'function','friend transport exposes signed nudges');
  profiles.presence(friend.id,true);await until(()=>connections[0]?.channel?.onopen);const channel=connections[0].channel;
  const open=async()=>{channel.readyState='open';channel.onopen();await until(()=>channel.sent.some(value=>value.type==='profile'));};
  const packet=async(patch={},person=friend)=>{const value={type:'nudge',version:1,from:person.id,to:own.id,key:person.key,nonce:randomUUID(),expires:now+10000,...patch};value.signature=await sign(person,api.nudgeText(value));return value;};
  const drain=async()=>{await new Promise(setImmediate);await until(()=>pendingCrypto===0);await new Promise(setImmediate);await until(()=>pendingCrypto===0);};
  const inject=async value=>{channel.onmessage({data:JSON.stringify(value)});await drain();};
  return {api,profiles,local,friend,contacts,connections,channel,received,timers,open,packet,inject,drain,sign,key,get own(){return own;},replaceIdentity:value=>{own=value;},now:()=>now,async advance(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await new Promise(setImmediate);},close:()=>profiles.reset()};
}
test('nudge waits for channel open and delivery requires a signed matching acknowledgment',async()=>{
  const f=await fixture();try{let done=false;const sent=f.profiles.nudge(f.friend.id).then(result=>{done=true;return result;});assert.equal(done,false);await f.open();await until(()=>f.channel.sent.some(v=>v.type==='nudge'));const request=f.channel.sent.find(v=>v.type==='nudge');assert.equal(request.expires-f.now(),10000);
    assert.equal(await f.local.verify(f.own,f.api.nudgeText(request),request.signature),true);
    f.channel.onmessage({data:JSON.stringify({type:'nudge-ack',request:request.nonce,accepted:true})});await new Promise(setImmediate);assert.equal(done,false);
    const ack=await f.packet({type:'nudge-ack',request:request.nonce,accepted:true});f.channel.onmessage({data:JSON.stringify(ack)});assert.equal((await sent).delivered,true);
  }finally{f.close();}
});
test('verified nudge is acknowledged once; replay, tamper, expiry and wrong recipient stay inert',async()=>{
  const f=await fixture();try{await f.open();const valid=await f.packet();await f.inject(valid);assert.equal(f.received.length,1);await until(()=>f.channel.sent.some(v=>v.type==='nudge-ack'));const ack=f.channel.sent.find(v=>v.type==='nudge-ack');assert.equal(ack.request,valid.nonce);assert.equal(await f.local.verify(f.own,f.api.nudgeText(ack),ack.signature),true);
    for(const value of [valid,{...valid,nonce:randomUUID()},await f.packet({expires:f.now()-1}),await f.packet({to:'C'.repeat(43)})]){f.channel.onmessage({data:JSON.stringify(value)});}
    await f.drain();assert.equal(f.received.length,1);assert.equal(f.channel.sent.filter(v=>v.type==='nudge-ack').length,1);
  }finally{f.close();}
});
test('send cooldown, offline and blocked contacts fail without creating a delivered result',async()=>{
  const f=await fixture();try{const pending=f.profiles.nudge(f.friend.id).catch(e=>e);await assert.rejects(f.profiles.nudge(f.friend.id),/30 seconds/);f.profiles.presence(f.friend.id,false);await pending;await assert.rejects(f.profiles.nudge(f.friend.id),/online friend/);f.contacts.delete(f.friend.id);f.profiles.presence(f.friend.id,true);await assert.rejects(f.profiles.nudge(f.friend.id),/online friend/);
  }finally{f.close();}
});
test('old peer times out politely and disconnect or reset cancels queued nudges',async()=>{
  for(const action of ['timeout','offline','reset']){const f=await fixture();try{const pending=f.profiles.nudge(f.friend.id).catch(e=>e);if(action==='timeout')await f.advance(10001);else if(action==='offline')f.profiles.presence(f.friend.id,false);else f.profiles.reset();const error=await pending;assert.ok(error instanceof Error||error?.name==='Error');assert.match(error.message,action==='timeout'?/acknowledge|acknowledgment/i:/closed|cancelled|offline/i);assert.equal(f.timers.size,action==='timeout'?1:0);
  }finally{f.close();}}
});
test('receiver preference can decline with a signed ack without applying an effect',async()=>{
  const f=await fixture({allow:false});try{await f.open();const value=await f.packet();await f.inject(value);await until(()=>f.channel.sent.some(v=>v.type==='nudge-ack'));assert.equal(f.channel.sent.find(v=>v.type==='nudge-ack').accepted,false);
  }finally{f.close();}
});
test('friend removal during verification cancels receipt before callback or ack',async()=>{
  const f=await fixture();try{await f.open();const value=await f.packet(),verify=f.local.verify;let release;f.local.verify=async(...args)=>{await new Promise(resolve=>{release=resolve;});return verify(...args);};f.channel.onmessage({data:JSON.stringify(value)});await until(()=>release);f.contacts.delete(f.friend.id);release();await new Promise(setImmediate);assert.equal(f.received.length,0);assert.equal(f.channel.sent.some(v=>v.type==='nudge-ack'),false);
  }finally{f.close();}
});
test('identity replacement during signing cannot send a nudge for the previous identity',async()=>{
  const f=await fixture();try{await f.open();const sign=f.local.sign;let release;f.local.sign=async value=>{if(value.startsWith('vumiro-peer-nudge-v1'))await new Promise(resolve=>{release=resolve;});return sign(value);};const pending=f.profiles.nudge(f.friend.id).catch(e=>e);await until(()=>release);f.replaceIdentity({...f.own,id:'Z'.repeat(43)});release();assert.match((await pending).message,/cancelled|identity|acknowledge/i);assert.equal(f.channel.sent.some(v=>v.type==='nudge'),false);
  }finally{f.close();}
});
test('receive cooldown ignores another signed nudge for 30 seconds',async()=>{
  const f=await fixture();try{await f.open();await f.inject(await f.packet());const count=f.channel.sent.filter(v=>v.type==='nudge-ack').length;await f.inject(await f.packet());assert.equal(f.received.length,1);assert.equal(f.channel.sent.filter(v=>v.type==='nudge-ack').length,count);
  }finally{f.close();}
});
test('global send burst is bounded across distinct friends and reset releases every queued promise',async()=>{
  const f=await fixture();try{const pending=[f.profiles.nudge(f.friend.id).catch(e=>e)];for(const name of ['C','D','E']){const person={...f.friend,id:name.repeat(43)};f.contacts.set(person.id,person);f.profiles.presence(person.id,true);if(name!=='E')pending.push(f.profiles.nudge(person.id).catch(e=>e));else await assert.rejects(f.profiles.nudge(person.id),/Too many nudges/);}f.profiles.reset();for(const value of await Promise.all(pending))assert.match(value.message,/cancelled/);assert.equal(f.timers.size,0);
  }finally{f.close();}
});
test('global receive burst caps effects across different authenticated friends',async()=>{
  const f=await fixture();try{await f.open();await f.inject(await f.packet());for(const name of ['C','D','E']){const person=await f.key(name.repeat(43));f.contacts.set(person.id,person);const count=f.connections.length;f.profiles.presence(person.id,true);await until(()=>f.connections.length>count);const channel=f.connections.at(-1).channel;channel.readyState='open';channel.onopen();await f.drain();channel.onmessage({data:JSON.stringify(await f.packet({},person))});await f.drain();}assert.equal(f.received.length,3);
  }finally{f.close();}
});
test('expiry during signature verification prevents the receive effect and ack',async()=>{
  const f=await fixture();try{await f.open();const value=await f.packet(),verify=f.local.verify;let release;f.local.verify=async(...args)=>{await new Promise(resolve=>{release=resolve;});return verify(...args);};f.channel.onmessage({data:JSON.stringify(value)});await until(()=>release);await f.advance(10001);release();await f.drain();assert.equal(f.received.length,0);assert.equal(f.channel.sent.some(v=>v.type==='nudge-ack'),false);
  }finally{f.close();}
});
test('pending nudge prevents the completed profile exchange from closing its channel',async()=>{
  const f=await fixture();try{await f.open();Object.assign(f.local,{validateAvatar(){},validateBio:value=>value||'',validateBanner:value=>value||'',validateConnections:value=>value||[]});const profile={type:'profile',id:f.friend.id,key:f.friend.key,nonce:randomUUID(),expires:f.now()+60000,profile:{name:'Friend',username:'',avatar:''}};profile.signature=await f.sign(f.friend,`vumiro-peer-profile-v1\n${f.friend.id}\n${f.own.id}\n${profile.nonce}\n${profile.expires}\n${JSON.stringify(profile.profile)}`);await f.inject(profile);await f.inject({type:'received',nonce:f.channel.sent.find(v=>v.type==='profile').nonce});assert.ok([...f.timers.values()].some(v=>v.at===f.now()+250));const pending=f.profiles.nudge(f.friend.id).catch(e=>e);await f.advance(300);assert.equal(f.channel.readyState,'open');f.profiles.reset();await pending;
  }finally{f.close();}
});
