import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
test('free Theme Studio reuses the shared creator and isolates drafts and assets to the account',async()=>{
  let options,opened=false,previewKind;const listeners=new Map(),records=new Map();
  const document={createElement:tag=>({tag,style:{},append(){},setAttribute(){},addEventListener(){},showModal(){opened=true;},close(){},remove(){}}),body:{append(){}}};
  const storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)},window={document,localStorage:storage,VumiroProfileCosmetics:{previewAvatar:(element,pkg)=>{previewKind=pkg.kind;return ()=>{};}},VumiroAccount:{getState:()=>({accountId:'stable-account',signedIn:true})},VumiroCommunityThemes:{createManager:opts=>opts,createIndexedDBAdapter:opts=>opts},VumiroCommunityStudio:{create:opts=>{options=opts;return {ready:Promise.resolve(),destroy(){}};}},addEventListener:(type,fn)=>listeners.set(type,fn)};
  const file=new URL('../Vumiro.Client/WebServer/marketplace-studio-entry.js',import.meta.url);if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,document,console});
  assert.ok(window.VumiroMarketplaceStudio,'shared Studio opener exists');await window.VumiroMarketplaceStudio.open();
  assert.equal(opened,true);assert.equal(typeof options.onPreview,'function');options.onPreview({}, {}, {kind:'avatar-frame'});assert.equal(previewKind,'avatar-frame');assert.match(options.draftKey,/stable-account/);assert.match(options.manager.adapter.name,/stable-account/);
  await options.onSave({packageId:'custom-theme',version:'1.0.0'});assert.equal(records.size,1);
  window.VumiroAccount.getState=()=>({signedIn:false,accountId:''});await assert.rejects(()=>window.VumiroMarketplaceStudio.open(),/sign in/i);
});

test('private authoring opens without marketplace sign-in and applies current drafts locally',async()=>{
  let options,applied,personal,opened=false;const records=new Map(),profile={id:'A'.repeat(43)},document={createElement:tag=>({tag,style:{},append(){},setAttribute(){},addEventListener(){},showModal(){opened=true;},close(){},remove(){}}),body:{append(){}}};
  const window={document,localStorage:{getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)},VumiroLocalProfile:{profile:()=>profile},VumiroAccount:{getState:()=>({signedIn:false})},VumiroLocalAppearance:{applyPackage:async pkg=>{applied=pkg;}},VumiroProfileCosmetics:{applyLocal:async(kind,pkg)=>{personal=[kind,pkg];return true;}},VumiroCommunityThemes:{createManager:opts=>opts,createIndexedDBAdapter:opts=>opts},VumiroCommunityStudio:{create:opts=>{options=opts;return {ready:Promise.resolve(),destroy(){}};}},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/marketplace-studio-entry.js',import.meta.url),'utf8'),{window,document,console});
  await window.VumiroMarketplaceStudio.open();assert.equal(opened,true);assert.match(options.draftKey,/AAAAAAAA/);assert.equal(typeof options.onApplyLocal,'function');
  await options.onApplyLocal({kind:'theme',id:'private-theme'});assert.equal(applied.id,'private-theme');await options.onApplyLocal({kind:'avatar-frame',id:'private-frame'});assert.equal(personal[0],'avatar-frame');assert.equal(personal[1].id,'private-frame');
});
