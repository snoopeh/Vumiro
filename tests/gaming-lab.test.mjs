import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
const require=createRequire(import.meta.url),mapping=require('../Vumiro.Client/WebServer/controller-mapping.js');
const source=new URL('../Vumiro.Client/WebServer/gaming-lab.js',import.meta.url);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(options={},environment={}) {
  const progress=[],requests=[],context={window:null,console,Date,Promise,Set,Map,Error,JSON,URL,setTimeout,clearTimeout,...environment};context.window=context;
  if(fs.existsSync(source))vm.runInNewContext(fs.readFileSync(source,'utf8'),context);
  assert.ok(context.VumiroGamingLab,'Reusable gaming test lab must exist.');
  const api=context.VumiroGamingLab.create({onProgress:value=>progress.push(value),requestNative:async(action,fields)=>{requests.push({action,...fields});return options.reply||{passed:true,checks:[{id:'controller-report',label:'Virtual Xbox controller report',status:'passed',detail:'Neutral report read back.'}]};},...options});
  return {api,progress,requests};
}
test('unsupported transport is reported as unavailable without native calls',async()=>{
  const h=harness(),result=await h.api.runTransport();assert.equal(result.passed,false);assert.equal(result.checks[0].status,'unavailable');assert.equal(h.requests.length,0);
});
test('native test is opt-in, preserves actual checks, and never treats a generic ok reply as a pass',async()=>{
  const h=harness();assert.equal(h.requests.length,0);const result=await h.api.runNative('controller');
  assert.equal(h.requests[0].action,'self-test');assert.equal(h.requests[0].kind,'controller');assert.equal(result.passed,true);assert.equal(result.checks[0].detail,'Neutral report read back.');
  const empty=harness({reply:{ok:true}});assert.equal((await empty.api.runNative('lan')).passed,false);
  await assert.rejects(()=>h.api.runNative('unknown'),/LAN|controller|kind/i);assert.equal(h.requests.length,1);
});
test('native rejection and timeout remain failures with actionable detail',async()=>{
  const h=harness({requestNative:async()=>{throw Error('The native helper could not start.');}}),result=await h.api.runNative('lan');
  assert.equal(result.passed,false);assert.match(result.checks[0].detail,/helper/);
  const timed=harness({timeoutMs:5,requestNative:()=>new Promise(()=>{})});const timeout=await timed.api.runNative('controller');assert.equal(timeout.passed,false);assert.match(timeout.checks[0].detail,/timed out/i);
});
test('cancellation finishes pending native work without later publishing a success',async()=>{
  const pending=deferred(),h=harness({requestNative:()=>pending.promise}),running=h.api.runNative('lan');
  h.api.cancel();const result=await running;assert.equal(result.cancelled,true);assert.equal(result.passed,false);const count=h.progress.length;
  pending.resolve({passed:true,checks:[{id:'late',label:'Late result',status:'passed',detail:'Should be ignored.'}]});await new Promise(r=>setImmediate(r));assert.equal(h.progress.length,count);
});
test('cancelling sandbox setup disposes a sandbox that arrives late',async()=>{
  const pending=deferred();let disposed=0;const h=harness({createSandbox:()=>pending.promise}),running=h.api.runTransport();h.api.cancel();
  assert.equal((await running).cancelled,true);pending.resolve({realm:{},dispose:()=>disposed++});await new Promise(r=>setImmediate(r));assert.equal(disposed,1);assert.equal(h.requests.length,0);
});
test('capture chooser runs synchronously and a late selection is stopped after cancellation',async()=>{
  const capture=deferred();let requested=0,stopped=0;
  const h=harness({}, {navigator:{mediaDevices:{getDisplayMedia:()=>{requested++;return capture.promise;}}}}),running=h.api.testCapture();
  assert.equal(requested,1,'Capture must preserve the button user gesture.');h.api.cancel();assert.equal((await running).cancelled,true);
  capture.resolve({getTracks:()=>[{stop:()=>stopped++}]});await new Promise(r=>setImmediate(r));assert.equal(stopped,1);
});
test('dispose cancels an active run and prevents resources being allocated by later runs',async()=>{
  const pending=deferred(),h=harness({requestNative:()=>pending.promise}),running=h.api.runNative('lan');h.api.dispose();
  assert.equal((await running).cancelled,true);const result=await h.api.runTransport();assert.equal(result.passed,false);assert.match(result.checks[0].detail,/disposed|closed/i);
});
test('overlapping runs cannot replace the active run or make it uncancellable',async()=>{
  const pending=deferred(),h=harness({requestNative:()=>pending.promise}),first=h.api.runNative('lan');const second=await h.api.runTransport();
  assert.equal(second.passed,false);assert.match(second.checks[0].detail,/running|busy/i);h.api.cancel();assert.equal((await first).cancelled,true);
});
test('selected mapping is validated before allocating a browser sandbox',async()=>{
  let allocated=0,read=0;const h=harness({getBindings:()=>{read++;return {a:'Escape'};},createSandbox:()=>{allocated++;return {realm:{}};}},{VumiroControllerMapping:mapping});
  const result=await h.api.runTransport();assert.equal(result.passed,false);assert.match(result.checks[0].detail,/mapping|bindings|unsupported/i);assert.equal(read,1);assert.equal(allocated,0);
});
function loaderHarness(packaged) {
  const loaded=[];let removed=0;
  const realm={document:{createElement:()=>({}),head:{append:script=>{
    const filename=new URL(script.src).pathname.split('/').at(-1);loaded.push(filename);
    if(packaged&&filename==='local-profile.js'){realm.VumiroGamingSession={};realm.VumiroControllerMapping={};}
    if(filename==='gaming-session.js')realm.VumiroGamingSession={};if(filename==='controller-mapping.js')realm.VumiroControllerMapping={};
    queueMicrotask(()=>script.onload());
  }}}};
  const document={currentScript:{src:'https://screentask.local/gaming-lab.js'},body:{append:()=>{}},createElement:()=>({style:{},setAttribute:()=>{},contentWindow:realm,remove:()=>removed++})};
  const h=harness({}, {document,RTCPeerConnection:class{},crypto:{subtle:{}}});return {...h,loaded,removed:()=>removed};
}
test('packaged sandbox loads frozen local-profile bundle without requesting unavailable standalone assets',async()=>{
  const h=loaderHarness(true);await h.api.runTransport();assert.deepEqual(h.loaded,['local-profile.js']);assert.equal(h.removed(),1);
});
test('development sandbox falls back to standalone mapping and session only after inspecting the base bundle',async()=>{
  const h=loaderHarness(false);await h.api.runTransport();assert.deepEqual(h.loaded,['local-profile.js','controller-mapping.js','gaming-session.js']);assert.equal(h.removed(),1);
});
test('loading the identity API defines it without opening a profile database or generating an account identity',()=>{
  const identitySource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/local-profile.js',import.meta.url),'utf8').split('/* Local diagnostics:')[0];let opened=0,generated=0;
  const context={window:null,TextEncoder,TextDecoder,crypto:{subtle:{...webcrypto.subtle,generateKey:()=>{generated++;throw Error('Identity creation must not run.');}}},indexedDB:{open:()=>{opened++;throw Error('Identity storage must not open.');}},isSecureContext:true};context.window=context;
  vm.runInNewContext(identitySource,context);assert.equal(typeof context.VumiroLocalProfile.initialize,'function');assert.equal(context.VumiroLocalProfile.profile(),null);assert.equal(opened,0);assert.equal(generated,0);
});


test('native diagnostics reserve time for Windows authorization while remaining cancellable',async()=>{
 const delays=[],pending=deferred();const h=harness({requestNative:()=>pending.promise},{setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms);}});
 const task=h.api.runNative('lan');assert.equal(delays[0],360000);h.api.cancel();assert.equal((await task).cancelled,true);
});
