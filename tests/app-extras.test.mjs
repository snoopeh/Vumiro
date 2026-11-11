import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('support destination allows explicit PayPal payment links and rejects lookalikes',()=>{
  const app={window:{},URL,document:{getElementById:()=>null}};vm.createContext(app);vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/app-extras.js',import.meta.url),'utf8'),app);
  const validate=app.window.VumiroAppExtras.paypalDestination;
  assert.equal(validate('https://paypal.me/MyProject'),'https://paypal.me/MyProject');
  assert.equal(validate('https://www.paypal.com/donate/?hosted_button_id=ABC'),'https://www.paypal.com/donate/?hosted_button_id=ABC');
  for(const value of ['','https://paypal.me.evil.example/user','http://paypal.me/user','https://user:pass@paypal.me/user','https://www.paypal.com/signin','https://paypal.me/'])assert.equal(validate(value),'');
});
test('failed private-server probe preserves saved settings and storage drafts join the exit controller',async()=>{
  const nodes=new Map(),sections=[];let saved={mode:'local',endpoint:'',token:''},configures=0;
  const element=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,open:false,classList:{toggle(){}},replaceChildren(){},append(){},addEventListener(name,fn){this[name]=fn;}});return nodes.get(id);};
  const app={URL,document:{readyState:'complete',getElementById:element,createElement:()=>element('created')},crypto:{randomUUID:()=> 'server'},localStorage:{getItem:()=>null},VumiroAccount:{ready:async()=>true},VumiroLocalProfile:{initialize:async()=>({id:'alice'})},VumiroSettingsExit:{add:section=>sections.push(section)},VumiroChatStorage:{configuration:()=>saved,configure(_owner,value){configures++;saved=value;},create:()=>({listServers:async()=>[],test:async()=>{throw Error('offline');}})}};app.window=app;
  vm.createContext(app);vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/app-extras.js',import.meta.url),'utf8'),app);
  await new Promise(resolve=>setImmediate(resolve));element('chatStorageEndpoint').value='https://archive.example';element('chatStorageToken').value='secret';
  assert.equal(sections.length,1);assert.equal(sections[0].dirty(),true);
  await element('chatStorageTest').click();assert.equal(configures,0);assert.equal(saved.mode,'local');assert.equal(element('chatStorageMode').value,'local');assert.match(element('chatStorageStatus').textContent,/offline/);
  await sections[0].discard();assert.equal(sections[0].dirty(),false);
});
