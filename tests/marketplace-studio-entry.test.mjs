import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('free Theme Studio reuses the shared creator and isolates drafts and assets to the account',async()=>{
  let options,opened=false;const listeners=new Map(),records=new Map();
  const document={createElement:tag=>({tag,style:{},append(){},setAttribute(){},addEventListener(){},showModal(){opened=true;},close(){},remove(){}}),body:{append(){}}};
  const storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)},window={document,localStorage:storage,VumiroAccount:{getState:()=>({accountId:'stable-account',signedIn:true})},VumiroCommunityThemes:{createManager:opts=>opts,createIndexedDBAdapter:opts=>opts},VumiroCommunityStudio:{create:opts=>{options=opts;return {ready:Promise.resolve(),destroy(){}};}},addEventListener:(type,fn)=>listeners.set(type,fn)};
  const file=new URL('../Vumiro.Client/WebServer/marketplace-studio-entry.js',import.meta.url);if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,document,console});
  assert.ok(window.VumiroMarketplaceStudio,'shared Studio opener exists');await window.VumiroMarketplaceStudio.open();
  assert.equal(opened,true);assert.match(options.draftKey,/stable-account/);assert.match(options.manager.adapter.name,/stable-account/);
  await options.onSave({packageId:'custom-theme',version:'1.0.0'});assert.equal(records.size,1);
  window.VumiroAccount.getState=()=>({signedIn:false,accountId:''});await assert.rejects(()=>window.VumiroMarketplaceStudio.open(),/sign in/i);
});
