import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto, randomUUID} from 'node:crypto';
const source = fs.readFileSync(new URL('../Vumiro.Client/WebServer/account-client.js', import.meta.url), 'utf8');
// Test-only closure access; production code exposes no privileged helpers.
const instrumented = source.replace(/\}\)\(\);\s*$/, `window.mediaTest={upload,restore,exportData,setup(enabled){authConfig={profileMediaEnabled:enabled,privacyNoticeVersion:NOTICE_VERSION};accountService='https://vumiro-rooms.vumiro-signaling.workers.dev';session={accessToken:'owner-token',expiresAt:Date.now()+3600000,user:{id:'owner-account'}};deviceId='owner-device';deviceToken='owner-device-token';active=true;writeNoticeAck(new Date().toISOString());}};})();`);
class Element {
  constructor(){this.hidden=false;this.value='';this.checked=false;this.listeners=new Map();this.classList={toggle(){},add(){}};}
  append(){} appendChild(){} after(){} before(){} setAttribute(){} addEventListener(k,v){this.listeners.set(k,v);} querySelector(){return null;} replaceChildren(){} insertBefore(){} click(){} focus(){} showModal(){} close(){}
}
const cover = () => ({version:1,revision:randomUUID(),digest:'A'.repeat(43),thumbnailDigest:'B'.repeat(43),mime:'image/png',width:900,height:300,bytes:15});
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function harness({enabled=true,route}={}) {
  const manifest=cover(),finished=new Blob(['finished-pixels'],{type:'image/png'}),original=new Blob(['private-original-image'],{type:'image/png'});
  const state={snapshot:{version:1,profile:{name:'Local',username:'',avatar:'',banner:'legacy-preview',cover:manifest},friends:[],blocked:[],settings:{}},calls:[],applied:[],validations:[],downloads:[],blobReads:0,timers:new Map(),timerCounter:0};
  const elements=new Map(),storage=new Map();const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const local={profile:()=>({id:'local-owner'}),accountSnapshot:async()=>structuredClone(state.snapshot),coverBlob:async()=>{state.blobReads++;return finished;},
    validateBanner:value=>value,validateBio:value=>value,validateConnections:value=>value,
    applyAccountSnapshot:async(data,record)=>{state.applied.push({data,record});},getCover:async()=>({manifest,blob:finished,source:original,crop:{x:0,y:0,width:900,height:300}})};
  const tools={MAX_BYTES:1048576,validateManifest(value){assert.ok(value && value.revision && value.mime);},async validateBlob(value,blob,banner){state.validations.push({value,blob,banner});assert.equal(await blob.text(),'finished-pixels');}};
  class TestURL extends URL {static createObjectURL(blob){state.downloads.push(blob);return 'blob:export';}static revokeObjectURL(){}}
  const sandbox={window:{VumiroLocalProfile:local,VumiroCoverMedia:tools,vumiroDesktop:{secureStore:{async delete(){},async set(){}}}},
    document:{body:{dataset:{page:'friends'}},getElementById:element,createElement:()=>new Element(),querySelector:()=>null},location:{href:'https://vumiro.local/friends.html',assign(){}},
    URL:TestURL,Blob,TextEncoder,AbortController,crypto:{subtle:webcrypto.subtle,randomUUID,getRandomValues:x=>webcrypto.getRandomValues(x)},
    btoa:x=>Buffer.from(x,'binary').toString('base64'),localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    addEventListener(){},dispatchEvent(){},Event,StorageEvent:class{},setTimeout(callback,ms){const id=++state.timerCounter;state.timers.set(id,{callback,ms});return id;},clearTimeout(id){state.timers.delete(id);},confirm:()=>true,
    async fetch(url,options={}) {state.calls.push({url,options});const custom=await route?.(url,options,state);if(custom)return custom;
      if(url.endsWith('/cover')&&options.method==='POST')return json({cover:JSON.parse(options.headers['X-Vumiro-Cover-Manifest'])},201);
      if(url.includes('/cover/'))return new Response(finished,{headers:{'Content-Type':'image/png','Content-Length':String(finished.size)}});
      if(url.endsWith('/export'))return json({data:structuredClone(state.snapshot)});
      if(options.method==='PUT')return json({revision:state.calls.filter(x=>x.options.method==='PUT').length});
      return json({revision:0,data:null});}}
  vm.runInNewContext(instrumented,sandbox);sandbox.window.mediaTest.setup(enabled);
  return {state,api:sandbox.window.mediaTest,local,tools,manifest,finished,original,storage};
}
test('media disabled strips only wire cover, preserving local finished cover and original',async()=>{
  const app=harness({enabled:false});const before=JSON.stringify(app.state.snapshot);await app.api.upload();
  const request=app.state.calls.find(x=>x.options.method==='PUT'),wire=JSON.parse(request.options.body).snapshot;
  assert.equal(wire.profile.cover,undefined);assert.equal(wire.profile.banner,'legacy-preview');
  assert.equal(request.options.headers['X-Vumiro-Profile-Media'],undefined);assert.equal(app.state.calls.some(x=>x.url.includes('/cover')),false);
  assert.equal(JSON.stringify(app.state.snapshot),before);assert.equal(app.state.blobReads,0);assert.equal(await (await app.local.getCover()).source.text(),'private-original-image');
});
test('enabled upload sends only finished Blob before snapshot CAS with authenticated owner headers',async()=>{
  const app=harness();await app.api.upload();const [post,put]=app.state.calls;
  assert.equal(post.options.method,'POST');assert.ok(post.url.endsWith('/account/cover'));assert.equal(post.options.body,app.finished);assert.notEqual(post.options.body,app.original);
  assert.equal(post.options.headers.Authorization,'Bearer owner-token');assert.equal(post.options.headers['X-Vumiro-Device-Token'],'owner-device-token');
  assert.equal(post.options.redirect,'error');assert.equal(post.options.credentials,'omit');
  assert.equal(put.options.method,'PUT');const body=JSON.parse(put.options.body);assert.equal(body.expectedRevision,0);assert.deepEqual(body.snapshot.profile.cover,app.manifest);
  assert.doesNotMatch(put.options.body,/private-original|source|crop/);
});
test('failed CAS cannot cache staging; retry reuploads and does not alter local data',async()=>{
  let fail=true;const app=harness({route:(_url,options)=>options.method==='PUT'&&fail?(fail=false,json({error:'changed'},409)):null});
  const before=JSON.stringify(app.state.snapshot);await assert.rejects(app.api.upload(),/changed/);await app.api.upload();
  assert.equal(app.state.calls.filter(x=>x.url.endsWith('/cover')&&x.options.method==='POST').length,2);
  assert.equal(JSON.stringify(app.state.snapshot),before);assert.equal(app.state.applied.length,0);
});
test('reusing a formerly uploaded revision re-stages after a replacement removed it',async()=>{
  const app=harness(),old=structuredClone(app.manifest);await app.api.upload();app.state.snapshot.profile.cover=cover();await app.api.upload();app.state.snapshot.profile.cover=old;await app.api.upload();
  const revisions=app.state.calls.filter(x=>x.url.endsWith('/cover')).map(x=>JSON.parse(x.options.headers['X-Vumiro-Cover-Manifest']).revision);
  assert.equal(revisions.length,3);assert.equal(revisions[0],revisions[2]);assert.notEqual(revisions[0],revisions[1]);
});
test('successful server manifest acknowledgement is independent of property order',async()=>{
  const app=harness({route:(url,options)=>url.endsWith('/cover')?json({cover:Object.fromEntries(Object.entries(JSON.parse(options.headers['X-Vumiro-Cover-Manifest'])).reverse())}):null});
  await app.api.upload();assert.equal(app.state.calls.at(-1).options.method,'PUT');
});
test('owner restore downloads and validates finished media and never restores editable source',async()=>{
  const app=harness();await app.api.restore(app.state.snapshot);
  const request=app.state.calls[0];assert.equal(request.url,`https://vumiro-rooms.vumiro-signaling.workers.dev/api/v1/account/cover/${app.manifest.revision}`);
  assert.equal(request.options.headers.Authorization,'Bearer owner-token');assert.equal(request.options.headers['X-Vumiro-Device'],'owner-device');
  assert.equal(app.state.applied.length,1);const record=app.state.applied[0].record;assert.equal(record.source,null);assert.equal(record.crop,null);assert.equal(await record.blob.text(),'finished-pixels');
  assert.ok(app.state.validations.some(x=>x.banner==='legacy-preview'));
});
test('download or upload failure leaves local cover/source and restored settings untouched',async()=>{
  const app=harness({route:url=>url.includes('/cover')?json({error:'unavailable'},503):null});const before=JSON.stringify(app.state.snapshot);app.storage.set('vumiro-stream-settings','original-settings');
  await assert.rejects(app.api.restore(app.state.snapshot),/unavailable/);await assert.rejects(app.api.upload(),/unavailable/);
  assert.equal(app.state.applied.length,0);assert.equal(app.storage.get('vumiro-stream-settings'),'original-settings');assert.equal(JSON.stringify(app.state.snapshot),before);
  assert.equal(app.state.calls.some(x=>x.options.method==='PUT'),false);assert.equal(await (await app.local.getCover()).source.text(),'private-original-image');
});
test('account export includes only downloaded finished cover, not local editable source',async()=>{
  const app=harness();await app.api.exportData();assert.equal(app.state.downloads.length,1);
  const content=await app.state.downloads[0].text(),out=JSON.parse(content);assert.equal(out.finishedCover.dataUrl,'data:image/png;base64,'+Buffer.from('finished-pixels').toString('base64'));
  assert.deepEqual(out.finishedCover.manifest,app.manifest);assert.doesNotMatch(content,/private-original|"source"|"crop"/);assert.equal(app.state.blobReads,0);
});

for(const phase of ['fetch','download','upload acknowledgement'])test(`cover timeout bounds stalled ${phase} and preserves local state`,async()=>{
  let stalled,streamCancelled=false;
  const started=new Promise(resolve=>{stalled=resolve;});
  const app=harness({route:(url,options)=>{
    if(!url.includes('/cover'))return null;
    if(phase==='fetch'){stalled();return new Promise(()=>{});}
    if(phase==='upload acknowledgement'){stalled();return {ok:true,json:()=>new Promise(()=>{})};}
    return new Response(new ReadableStream({pull(){stalled();return new Promise(()=>{});},cancel(){streamCancelled=true;}}),{headers:{'Content-Type':'image/png'}});
  }});
  const before=JSON.stringify(app.state.snapshot);app.storage.set('vumiro-stream-settings','original-settings');
  const work=phase==='upload acknowledgement'?app.api.upload():app.api.restore(app.state.snapshot);
  const rejected=assert.rejects(work,/Cover transfer timed out/);
  await started;await Promise.resolve();
  const timer=[...app.state.timers.values()].find(value=>value.ms===20000);assert.ok(timer);timer.callback();await rejected;
  assert.equal(app.state.calls.find(value=>value.url.includes('/cover')).options.signal.aborted,true);
  assert.equal(app.state.timers.size,0);assert.equal(app.state.applied.length,0);assert.equal(JSON.stringify(app.state.snapshot),before);
  assert.equal(app.storage.get('vumiro-stream-settings'),'original-settings');assert.equal(await (await app.local.getCover()).source.text(),'private-original-image');
  if(phase==='download')assert.equal(streamCancelled,true);
});
test('cover transfer clears its deadline on success and ordinary HTTP failure',async()=>{
  const success=harness();await success.api.upload();assert.equal(success.state.timers.size,0);await success.api.restore(success.state.snapshot);assert.equal(success.state.timers.size,0);
  const failure=harness({route:url=>url.includes('/cover')?json({error:'no storage'},503):null});await assert.rejects(failure.api.upload(),/no storage/);assert.equal(failure.state.timers.size,0);
});
