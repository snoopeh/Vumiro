import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,randomUUID} from 'node:crypto';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/account-client.js',import.meta.url),'utf8');
const instrumented=source.replace(/\}\)\(\);\s*$/,`window.syncTest={syncInitial,upload,restore,snapshot,scheduleSync,signOutLocally,setup(){authConfig={privacyNoticeVersion:NOTICE_VERSION};accountService='https://accounts.test';session={accessToken:'token',refreshToken:'refresh',expiresAt:Date.now()+3600000,user:{id:'account',email:'person@example.com'}};deviceId='device';deviceToken='device-token';},ack(){writeNoticeAck(new Date().toISOString());},unlock(value){identityUnlock=value;},active:()=>active};})();`);
class Element{constructor(){this.value='';this.checked=false;this.hidden=false;this.classList={add(){},toggle(){}};}append(){}before(){}after(){}setAttribute(){}addEventListener(){}querySelector(){return null;}replaceChildren(){}focus(){}close(){}}
const plain=value=>JSON.parse(JSON.stringify(value));
const empty=()=>({version:1,profile:{name:'Device',username:'',avatar:''},friends:[],blocked:[],settings:{}});
const contact={id:'F'.repeat(43),key:'public-key',name:'Friend'};
function harness({remote=null,local=empty(),profile={id:'device-key'},ack=true,request}={}){
 const state={remote:remote&&plain(remote),revision:remote?4:0,local:plain(local),profile,calls:[],timers:new Map(),events:[],applied:[]},elements=new Map(),storage=new Map();let timer=0;
 const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const sandbox={window:{vumiroDesktop:{secureStore:{async set(){},async delete(){}}},VumiroLocalProfile:{profile:()=>state.profile,async createProfile(name){state.profile={id:'new-key',name};},async accountSnapshot(){return plain(state.local);},async applyAccountSnapshot(data,cover,recovery){state.applied.push({data:plain(data),recovery});state.local=plain(data);if(recovery)state.profile={id:recovery.identityId};},async installRecoveredIdentity(value){state.profile={id:value.identityId};}}},document:{body:{dataset:{page:'friends'}},getElementById:element,createElement:()=>new Element()},location:{href:'https://vumiro.local/friends.html',assign(){}},URL,Blob,TextEncoder,crypto:{subtle:webcrypto.subtle,randomUUID},Event,StorageEvent:class{},setTimeout(callback){const id=++timer;state.timers.set(id,callback);return id;},clearTimeout(id){state.timers.delete(id);},addEventListener(){},dispatchEvent(event){state.events.push(event.type);},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},confirm:()=>true,
 async fetch(url,options={}){state.calls.push({url,options});const custom=await request?.(url,options,state);if(custom)return custom;if(options.method==='PUT'){const body=JSON.parse(options.body);assert.equal(body.expectedRevision,state.revision);state.remote=plain(body.snapshot);return new Response(JSON.stringify({revision:++state.revision}));}return new Response(JSON.stringify({revision:state.revision,data:state.remote,devices:[]}));}};
 vm.runInNewContext(instrumented,sandbox);const api=sandbox.window.syncTest;api.setup();if(ack)api.ack();
 return {api,state,sandbox,storage,element,async flush(){for(const [id,callback]of [...state.timers]){state.timers.delete(id);callback();}await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));}};
}
test('new account automatically backs up acknowledged profile and subsequent friend changes',async()=>{
 const app=harness();await app.api.syncInitial();assert.equal(app.api.active(),true);assert.equal(app.state.remote.profile.name,'Device');
 app.state.local.friends.push(contact);app.api.scheduleSync();await app.flush();assert.deepEqual(app.state.remote.friends,[contact]);
});
test('new device restores legacy remote friends blocks and preferences instead of treating its empty profile as a conflict',async()=>{
 const remote={...empty(),profile:{name:'Saved'},friends:[contact],blocked:['B'.repeat(43)],settings:{fps:30,audio:false}};const app=harness({remote});
 await app.api.syncInitial();assert.equal(app.state.applied.length,1);assert.deepEqual(app.state.local.friends,[contact]);assert.deepEqual(JSON.parse(app.storage.get('vumiro-stream-settings')),remote.settings);assert.equal(app.state.calls.some(call=>call.options.method==='PUT'),false);
});
test('populated unacknowledged local contacts stay intact and never replace the remote account automatically',async()=>{
 const local={...empty(),friends:[{...contact,id:'L'.repeat(43)}]},remote={...empty(),friends:[contact]};const app=harness({local,remote});await app.api.syncInitial();assert.equal(app.api.active(),false);assert.deepEqual(app.state.local,local);assert.deepEqual(app.state.remote,remote);assert.match(app.element('accountFeedback').textContent,/unbacked changes/);
});
test('first backup cannot overwrite a snapshot concurrently created on another device',async()=>{
 const app=harness({request:(_url,options)=>options.method==='PUT'?new Response(JSON.stringify({error:'Account data changed'}),{status:409}):null});await assert.rejects(app.api.syncInitial(),/changed/);assert.equal(app.api.active(),false);assert.equal(app.state.remote,null);assert.equal(JSON.parse(app.state.calls.find(call=>call.options.method==='PUT').options.body).expectedRevision,0);
});
test('first backup needs a recorded privacy acknowledgement',async()=>{const app=harness({ack:false});await app.api.syncInitial();assert.equal(app.api.active(),false);assert.equal(app.state.calls.some(call=>call.options.method==='PUT'),false);});
test('recoverable identity and account snapshot are passed to one atomic local restore',async()=>{
 const remote={...empty(),friends:[contact],identityRecovery:{identityId:'saved-key'}},app=harness({remote});const recovered={identityId:'saved-key',privateKey:'opaque'};app.sandbox.window.VumiroIdentityRecovery={validateEnvelope:async()=>{},recoverWithPassword:async()=>recovered};app.api.unlock({password:'long account password'});await app.api.syncInitial();assert.equal(app.state.applied[0].recovery?.identityId,'saved-key');assert.equal(app.state.profile.id,'saved-key');assert.deepEqual(app.state.local.friends,[contact]);
});
test('sign out flushes pending acknowledged local changes before clearing the session',async()=>{const app=harness();await app.api.syncInitial();app.state.local.friends.push(contact);app.api.scheduleSync();await app.api.signOutLocally();assert.deepEqual(app.state.remote.friends,[contact]);});

test('offline local changes upload on relogin only when the remote snapshot is still the acknowledged copy',async()=>{
 const app=harness();await app.api.syncInitial();const acknowledged=plain(app.state.remote);app.state.local.friends.push(contact);
 await app.api.syncInitial();assert.deepEqual(app.state.remote.friends,[contact]);assert.equal(app.api.active(),true);
 app.state.local.friends=[];app.state.remote={...acknowledged,blocked:['B'.repeat(43)]};const before=plain(app.state.local);await app.api.syncInitial();assert.equal(app.api.active(),false);assert.deepEqual(app.state.local,before);assert.deepEqual(app.state.remote.blocked,['B'.repeat(43)]);
});
test('initial password recovery backup reaches the server before the local signing key changes',async()=>{
 const app=harness(),order=[];app.sandbox.window.VumiroIdentityRecovery={create:async()=>({identityRecovery:{identityId:'account-key'},recoveryCode:'saved-code'})};
 app.sandbox.window.VumiroLocalProfile.prepareIdentityMigration=async()=>({transition:{fromId:'device-key'}});
 app.sandbox.window.VumiroLocalProfile.commitIdentityMigration=async()=>{assert.equal(app.state.remote.identityRecovery.identityId,'account-key');order.push('commit');};app.api.unlock({password:'long account password'});
 await app.api.syncInitial();assert.deepEqual(order,['commit']);assert.equal(app.state.calls.filter(call=>call.options.method==='GET').length,1,'first backup does not replace a newer revision by fetching it');assert.equal(app.api.active(),true);
});
test('failed first encrypted backup preserves local signing identity and remains paused',async()=>{
 const app=harness({request:(_url,options)=>options.method==='PUT'?new Response(JSON.stringify({error:'Sync unavailable'}),{status:503}):null});let committed=false;
 app.sandbox.window.VumiroIdentityRecovery={create:async()=>({identityRecovery:{identityId:'account-key'}})};app.sandbox.window.VumiroLocalProfile.prepareIdentityMigration=async()=>({transition:{fromId:'device-key'}});app.sandbox.window.VumiroLocalProfile.commitIdentityMigration=async()=>{committed=true;};app.api.unlock({password:'long account password'});
 await assert.rejects(app.api.syncInitial(),/unavailable/);assert.equal(committed,false);assert.equal(app.api.active(),false);assert.equal(app.state.profile.id,'device-key');
});
test('automatic upload failures stay visible and leave the local contacts available for retry',async()=>{
 let offline=false;const app=harness({request:(_url,options)=>offline&&options.method==='PUT'?new Response(JSON.stringify({error:'Sync unavailable'}),{status:503}):null});await app.api.syncInitial();offline=true;app.state.local.friends.push(contact);app.api.scheduleSync();await app.flush();assert.match(app.element('accountFeedback').textContent,/Sync unavailable/);assert.deepEqual(app.state.local.friends,[contact]);assert.deepEqual(app.state.remote.friends,[]);offline=false;await app.api.syncInitial();assert.deepEqual(app.state.remote.friends,[contact]);
});

test('legacy restore tells the user when the saved data cannot recover their contact identity',async()=>{const app=harness({remote:{...empty(),friends:[contact]}});await app.api.syncInitial();assert.match(app.element('accountFeedback').textContent,/identity recovery|contact identity/i);});

test('a changed account identity cannot erase previously backed up offline contacts',async()=>{
 const app=harness();await app.api.syncInitial();app.state.local.friends.push(contact);app.state.remote={...empty(),identityRecovery:{identityId:'different-key'}};let recovered=false;app.sandbox.window.VumiroIdentityRecovery={validateEnvelope:async()=>{},recoverWithPassword:async()=>{recovered=true;return {identityId:'different-key'};}};app.api.unlock({password:'long account password'});
 await app.api.syncInitial();assert.equal(recovered,false);assert.deepEqual(app.state.local.friends,[contact]);assert.equal(app.api.active(),false);assert.match(app.element('accountFeedback').textContent,/unbacked changes/);
});

test('startup-generated default stream settings do not conflict with newer account friends',async()=>{
 const app=harness();await app.api.syncInitial();app.storage.set('vumiro-stream-settings',JSON.stringify({fps:60,mbps:20,resolution:'native',contentHint:'detail',audio:true,excludeDiscord:true}));app.state.remote.friends=[contact];app.state.revision++;
 await app.api.syncInitial();assert.deepEqual(app.state.local.friends,[contact]);assert.equal(app.api.active(),true);
});
