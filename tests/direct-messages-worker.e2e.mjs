// Explicit local-only integration check: start wrangler.storage.jsonc on 8787.
// Uses disposable generated identities, production browser transport, real HTTP
// WebSockets and SQLite Durable Objects. Never reads installed client profiles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const endpoint=new URL(process.env.VUMIRO_DM_E2E_URL||'http://127.0.0.1:8787');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname),'integration fixture only contacts a local Worker');
const transportSource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/direct-messages.js',import.meta.url),'utf8'),window={};
vm.runInNewContext(transportSource,{window,crypto:webcrypto,TextEncoder,TextDecoder,Date,Map,Set,JSON,Number,Object,String,Promise,Error,setTimeout,clearTimeout,btoa,atob});
async function identity(name){const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),bytes=await webcrypto.subtle.exportKey('spki',pair.publicKey);return {name,id:Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('base64url'),key:Buffer.from(bytes).toString('base64url'),sign:async value=>Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(value))).toString('base64url')};}
async function verify(author,text,signature){const key=await webcrypto.subtle.importKey('spki',Buffer.from(author.key,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(signature,'base64url'),new TextEncoder().encode(text));}
const sessions=[];
async function connect(user,contacts){
  const url=new URL('/friends-signaling',endpoint);url.protocol='ws:';url.searchParams.set('id',user.id);const socket=new WebSocket(url),queue=[],waiting=[],received=[],errors=[];let api;
  function next(type,predicate=()=>true){const index=queue.findIndex(m=>m.type===type&&predicate(m));if(index>=0)return Promise.resolve(queue.splice(index,1)[0]);return new Promise((resolve,reject)=>{const pending={type,predicate,resolve:value=>{clearTimeout(pending.timer);resolve(value);},timer:setTimeout(()=>{waiting.splice(waiting.indexOf(pending),1);reject(Error('Timed out waiting for '+type));},10000),reject};waiting.push(pending);});}
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),index=waiting.findIndex(item=>item.type===message.type&&item.predicate(message));if(index>=0)waiting.splice(index,1)[0].resolve(message);else queue.push(message);api?.receive(message).catch(error=>errors.push(error.message));});
  socket.addEventListener('close',()=>api?.disconnected());
  const challenge=await next('challenge');socket.send(JSON.stringify({type:'authenticate',key:user.key,signature:await user.sign(`screentask-directory-v1\n${user.id}\n${challenge.nonce}`)}));const ready=await next('ready');assert.equal(ready.capabilities.directMessages,1);
  api=window.VumiroDirectMessages.create({local:{sign:user.sign,verify},send:wire=>socket.send(JSON.stringify(wire)),getProfile:()=>user,getFriend:id=>contacts.find(peer=>peer.id===id),onMessage:(message,meta)=>received.push({message,meta}),onError:error=>errors.push(error.message)});
  socket.send(JSON.stringify({type:'profile-announce',name:user.name,socialVersion:2}));await next('profile-ready');socket.send(JSON.stringify({type:'watch',ids:contacts.map(peer=>peer.id)}));if(contacts.length)await next('presence');api.connected(ready.capabilities,ready.serverTime);
  const session={api,socket,received,errors,next,async close(){if(socket.readyState===3)return;await new Promise(resolve=>{socket.addEventListener('close',resolve,{once:true});socket.close();});}};sessions.push(session);return session;
}
try{
  const alice=await identity('Local Alice'),bob=await identity('Local Bob'),mallory=await identity('Local outsider'),a=await connect(alice,[bob]),b=await connect(bob,[alice]);
  const live=await a.api.sendMessage(bob,'Live signed direct message');assert.equal(live.sequence,1);assert.equal(live.from,alice.id);await b.next('dm-message',m=>m.message.id===live.id);for(let i=0;i<100&&!b.received.length;i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(b.received.length,1);
  await b.close();const offline=await a.api.sendMessage(bob,'Stored while Bob is offline');assert.equal(offline.sequence,2);
  const returning=await connect(bob,[alice]),inbox=await returning.api.inbox();assert.equal(inbox.threads[0].id,offline.id);assert.equal(inbox.threads[0].from,alice.id);
  const newest=await returning.api.history(alice,{limit:1});assert.equal(newest.messages[0].text,'Stored while Bob is offline');assert.equal(newest.before,'2');const older=await returning.api.history(alice,{limit:1,before:newest.before});assert.equal(older.messages[0].id,live.id);assert.equal(older.before,null);
  const retried=await a.api.sendMessage(bob,'Stored while Bob is offline',{id:offline.id});assert.equal(retried.sequence,2);assert.equal((await a.api.history(bob)).messages.length,2);
  const outsider=await connect(mallory,[alice]);await assert.rejects(outsider.api.history(alice),error=>error.code==='dm-forbidden');
  returning.socket.send(JSON.stringify({type:'profile-announce',name:bob.name,socialVersion:2,blockedIds:[alice.id]}));await returning.next('profile-ready');await returning.close();await assert.rejects(a.api.sendMessage(bob,'Blocked offline delivery must fail'),error=>error.code==='dm-forbidden');
  const report={passed:true,endpoint:endpoint.origin,verifiedAt:new Date().toISOString(),checks:['real Worker WebSocket identity authentication','live signed pushes','offline recipient durable append','inbox discovery after reconnect','history cursor pagination','idempotent retry','nonparticipant denial','offline persisted recipient block enforcement'],storage:'per-conversation SQLite Durable Object'};
  const output=new URL('../dist/direct-messages-e2e.json',import.meta.url);fs.mkdirSync(new URL('../dist/',import.meta.url),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await Promise.all(sessions.map(session=>session.close()));}
