import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const file=new URL('../Vumiro.Client/WebServer/marketplace-entry.js',import.meta.url);
test('marketplace navigation cooperates with existing workspace and closes when another view opens',async()=>{
  const listeners=new Map(),nodes=new Map(),calls=[];
  function node(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,textContent:'',classList:{toggle(){}},setAttribute(){},addEventListener(type,fn){this[type]=fn;},append(){},appendChild(){}});return nodes.get(id);}
  const window={VumiroMarketplace:{init:options=>{calls.push(options);return {show:async()=>calls.push('show'),hide:()=>calls.push('hide')};},show:async()=>calls.push('show'),hide:()=>calls.push('hide')},VumiroAccount:{ready:async()=>true,getState:()=>({accountId:'account-uuid',signedIn:true,marketplaceEnabled:false})},VumiroProfileCosmetics:{applyLocal:async(...args)=>calls.push(['local-apply',...args]),refreshOwn:async()=>calls.push('refresh-public')},VumiroCommunityMarketplace:{targets:()=>[{id:'local'}],apply:(...args)=>calls.push(args)},VumiroWorkspace:{prepareExternal:async view=>{calls.push(view);return true;}}};
  const document={readyState:'complete',getElementById:node,querySelector:()=>node('nav'),createElement:tag=>node('new-'+tag),addEventListener:(type,fn)=>listeners.set(type,fn)};
  const context={window,document,console,addEventListener:(type,fn)=>listeners.set(type,fn),setTimeout,clearTimeout};
  if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),context);
  assert.equal(typeof node('marketplaceNav').click,'function','marketplace sidebar button is wired');
  await node('marketplaceNav').click();
  assert.equal(typeof calls.find(value=>typeof value==='object').personalApply,'function');assert.ok(calls.includes('marketplace'));assert.ok(calls.includes('show'));assert.equal(node('workspaceHeading').textContent,'Marketplace');
  const options=calls.find(value=>typeof value==='object'&&!Array.isArray(value));assert.equal(options.getTargets()[0].id,'local');const provenance={package:{id:'oak'},mode:'local-demo'};await options.applyBinding({id:'local'},{mode:'inherit'},provenance);assert.equal(calls.at(-1)[2],provenance);
  const frame={kind:'avatar-frame',id:'ring'};await options.personalApply({personal:true,kind:'avatar-frame'},{mode:'package',kind:'avatar-frame',package:frame});assert.deepEqual(calls.at(-1),['local-apply','avatar-frame',frame]);await options.personalApply({personal:true,kind:'avatar-frame'},{mode:'inherit'});assert.deepEqual(calls.at(-1),['local-apply','avatar-frame',null]);
  listeners.get('vumiro-workspace-change')({detail:{view:'friends'}});assert.ok(calls.includes('hide'));
});
