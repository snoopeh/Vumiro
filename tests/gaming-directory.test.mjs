import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../Vumiro.Client/WebServer/gaming-directory.js',import.meta.url),'utf8');
const own='a'.repeat(43),peer='b'.repeat(43);
const wire=()=>({type:'gaming-signal',from:peer,to:own,session:'c'.repeat(32),nonce:'signal_nonce_123456789012',expires:Date.now()+60000,payload:{kind:'invite',mode:'lan'},signature:Buffer.alloc(64).toString('base64url')});
async function harness(){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const events=[],sent=[],received=[],friend={id:peer,key:'friend-key',name:'Friend'};
  let connected=true,saved=friend;
  const local={profile:()=>({id:own}),validateContact:async contact=>contact,verify:async(contact,text,signature)=>crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pair.publicKey,Buffer.from(signature,'base64url'),new TextEncoder().encode(text))};
  const context={window:null,Date,Map,Set,TextEncoder,JSON,Error,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};context.window=context;
  vm.runInNewContext(source,context);const api=context.VumiroGamingDirectory;
  const options={local,send:message=>sent.push(message),getFriend:id=>saved?.id===id?saved:null,listFriends:()=>saved?[saved]:[],isOnline:()=>connected};
  api.subscribe(value=>received.push(value));
  const sign=async value=>{value.signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(['vumiro-gaming-signal-v1',value.from,value.to,value.session,value.nonce,value.expires,JSON.stringify(value.payload)].join('\n')))).toString('base64url');return value;};
  return {api,options,events,sent,received,sign,setSaved:value=>saved=value,setConnected:value=>connected=value};
}
test('registers one existing directory transport and invalidates captured context on reset',async()=>{
  const app=await harness();assert.equal(app.api.getContext(),null);
  app.api.register(app.options);const context=app.api.getContext();assert.equal(context.local,app.options.local);
  const message=await app.sign({...wire(),from:own,to:peer});context.send(message);assert.equal(app.sent[0],message);
  assert.equal(app.events.at(-1).detail.online,true);app.api.reset();assert.equal(app.api.getContext(),null);assert.equal(app.events.at(-1).detail.online,false);
  assert.throws(()=>context.send(message),/offline|disconnected/i);assert.equal(app.sent.length,1);
});
test('only dispatches signed messages addressed to this identity from a currently saved friend',async()=>{
  const app=await harness();app.api.register(app.options);
  const valid=await app.sign(wire());assert.equal(await app.api.receive({...valid,signature:Buffer.alloc(64).toString('base64url')}),false);
  assert.equal(await app.api.receive({...valid,to:peer}),false);assert.equal(await app.api.receive({...valid,from:'d'.repeat(43)}),false);
  assert.equal(await app.api.receive(valid),true);assert.equal(app.received.length,1);
  assert.equal(await app.api.receive(valid),false);assert.equal(app.received.length,1);
  const fresh=await app.sign({...wire(),nonce:'another_nonce_1234567890'});app.setSaved(null);assert.equal(await app.api.receive(fresh),false);
});
test('rejects verification completing after disconnect or removal and preserves subscribers across reconnection',async()=>{
  const app=await harness();app.api.register(app.options);const valid=await app.sign(wire());
  let release;app.options.local.validateContact=()=>new Promise(resolve=>release=resolve);
  const pending=app.api.receive(valid);app.api.reset();release({id:peer,key:'friend-key'});assert.equal(await pending,false);assert.equal(app.received.length,0);
  app.options.local.validateContact=async value=>value;app.api.register(app.options);assert.equal(await app.api.receive(valid),true);assert.equal(app.received.length,1);
  app.setConnected(false);assert.throws(()=>app.api.getContext().send({...valid,from:own,to:peer}),/offline/i);
});
test('unsubscribes listeners and rejects malformed envelopes before signature work',async()=>{
  const app=await harness();app.api.register(app.options);let count=0;const off=app.api.subscribe(()=>count++);off();
  const valid=await app.sign(wire());assert.equal(await app.api.receive({...valid,payload:{kind:'offer',description:{type:'offer',sdp:'garbage'}}}),false);
  assert.equal(await app.api.receive(valid),true);assert.equal(count,0);
});
test('drops a valid proof if the saved key changes while verification is pending',async()=>{
  const app=await harness();app.api.register(app.options);const valid=await app.sign(wire());
  const friend=app.options.getFriend(peer);let release;
  const verify=app.options.local.verify;app.options.local.verify=(...args)=>new Promise(resolve=>release=async()=>resolve(await verify(...args)));
  const pending=app.api.receive(valid);await new Promise(resolve=>setImmediate(resolve));friend.key='replacement-key';await release();
  assert.equal(await pending,false);assert.equal(app.received.length,0);
});
