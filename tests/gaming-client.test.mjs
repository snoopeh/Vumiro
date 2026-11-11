import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function module() {
  const context={module:{exports:{}},setTimeout,clearTimeout,crypto:globalThis.crypto};
  vm.runInNewContext(readFileSync(new URL('../Vumiro.Client/WebServer/gaming-client.js',import.meta.url),'utf8'),context);
  return context.module.exports;
}
const valid={a:'Space',leftUp:'KeyW'};
const validate=bindings=>({valid:!!bindings&&typeof bindings==='object'&&!Array.isArray(bindings)&&Object.keys(bindings).length>0&&Object.keys(bindings).every(k=>['a','leftUp'].includes(k)),bindings,errors:['Invalid bindings']});
test('profile import validates schema, size and bindings before replacing local data',()=>{
  const api=module();
  assert.equal(api.parseProfile(JSON.stringify({version:1,name:' My game ',bindings:valid}),validate).name,'My game');
  for(const value of ['null','[]','{}',JSON.stringify({version:2,name:'X',bindings:valid}),JSON.stringify({version:1,name:'X',bindings:{run:'KeyW'}}),' '.repeat(20000)])assert.throws(()=>api.parseProfile(value,validate));
});
test('storage corruption is contained, saved profiles are bounded and write failure is visible',()=>{
  const api=module();
  assert.deepEqual(Array.from(api.loadProfiles({getItem:()=>'{broken'},validate)),[]);
  assert.throws(()=>api.saveProfiles({setItem(){throw Error('quota');}},[{version:1,name:'Game',bindings:valid}],validate),/quota/);
  assert.throws(()=>api.saveProfiles({setItem(){}},Array(21).fill({version:1,name:'Game',bindings:valid}),validate));
});
test('bridge correlates out-of-order replies and rejects actual native failures',async()=>{
  const api=module(),messages=[];let listener;
  const host={postMessage:m=>messages.push(m),addEventListener:(type,fn)=>{listener=fn;},removeEventListener(){}};
  const bridge=api.createBridge(host,100);
  const first=bridge.request('status'),second=bridge.request('lan-start',{sessionId:'0123456789abcdef0123456789abcdef',address:'10.203.1.1'});
  listener({data:{type:'gaming-result',requestId:messages[1].requestId,ok:true,result:{name:'joined'}}});
  listener({data:{type:'gaming-result',requestId:messages[0].requestId,ok:false,error:'Permission required'}});
  assert.equal((await second).name,'joined');await assert.rejects(first,/Permission required/);bridge.dispose();
});
test('bridge reports unavailable platforms, times out and cleans pending requests on disposal',async()=>{
  const api=module();await assert.rejects(api.createBridge(null).request('status'),/Windows/);
  const bridge=api.createBridge({postMessage(){},addEventListener(){},removeEventListener(){}},5);
  await assert.rejects(bridge.request('status'),/respond/);
  const pending=bridge.request('status');bridge.dispose();await assert.rejects(pending,/closed/);
});
test('navigation and source assets include all gaming sections and packaged modules',()=>{
  const html=readFileSync(new URL('../Vumiro.Client/WebServer/friends.html',import.meta.url),'utf8');
  for(const id of ['gamingNav','gamingSubnav','gamingLanNav','gamingTogetherNav','gamingMappingNav'])assert.ok(html.includes(`id="${id}"`),id);
  for(const name of ['controller-mapping.js','gaming-directory.js','gaming-session.js','gaming-client.js']){
    assert.ok(html.includes(`src="/${name}"`));
    for(const file of ['../scripts/bundle-client-web.mjs','../Vumiro.Linux/build/prepare-assets.mjs','../Vumiro.Linux/main.cjs','../cloudflare/prepare-assets.mjs','../cloudflare/worker.js'])assert.ok(readFileSync(new URL(file,import.meta.url),'utf8').includes(name),`${file}: ${name}`);
  }
});
