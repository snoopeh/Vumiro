import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const friends=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
const room=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends.html',import.meta.url),'utf8');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function controls({fail=false}={}){
  const elements=new Map(),writes=[],messages=[],toasts=[];
  const app={appSounds:true,appSoundsDraft:true,appSoundVolume:100,appSoundVolumeDraft:100,profileSaving:false,avatarSelection:0,bannerSelection:0,profile:{},requestAnimationFrame:fn=>fn(),frame:{contentWindow:{postMessage:(...args)=>messages.push(args)}},location:{origin:'https://local.test'},save:(...args)=>{writes.push(args);return !fail;},toast:(...args)=>toasts.push(args),playUiCue:(...args)=>{app.preview=args;},$:id=>{if(!elements.has(id))elements.set(id,{textContent:'Save sound settings',value:'100',checked:true,setAttribute(){},addEventListener(){}});return elements.get(id);}};
  vm.createContext(app);vm.runInContext(section(friends,'function soundVolume(','function playUiCue('),app);
  vm.runInContext(section(friends,'function renderSoundSettings(','$(\'profileDialog\').addEventListener(\'cancel\''),app);
  return {app,writes,messages,toasts};
}
test('sound settings expose a separate, accessible volume range and navigation panel',()=>{
  assert.match(html,/<input[^>]*id="appSoundVolume"[^>]*type="range"[^>]*min="0"[^>]*max="300"/);
  assert.match(friends,/\['sounds', 'App sounds'\]/);assert.match(html,/<details id="appSoundSettings">/);
});
test('sound volume validates input, clamps to 0–300 and preserves intentional zero',()=>{
  const {app}=controls();for(const [input,want] of [[0,0],[500,300],[-1,0],['150',150],['',100],[null,100],['wrong',100],[Infinity,100]])assert.equal(app.soundVolume(input),want);
});
test('saving sound settings atomically persists both enabled state and volume, then updates open room',async()=>{
  const {app,writes,messages}=controls();app.$('appSounds').checked=false;app.$('appSounds').onchange();app.$('appSoundVolume').value='240';app.$('appSoundVolume').oninput();
  assert.equal(app.appSoundVolume,100);await app.$('saveAppSounds').onclick();assert.equal(writes.length,1);assert.equal(writes[0][0],'vumiro-app-sound-settings');assert.deepEqual(JSON.parse(writes[0][1]),{enabled:false,volume:240});assert.equal(app.appSounds,false);assert.equal(app.appSoundVolume,240);assert.equal(messages[0][0].type,'vumiro-app-sound-settings');assert.equal(messages[0][1],'https://local.test');
});
test('a failed sound Save leaves live settings and room unchanged and releases loading state',async()=>{
  const {app,messages,toasts}=controls({fail:true});app.$('appSoundVolume').value='300';app.$('appSoundVolume').oninput();await app.$('saveAppSounds').onclick();
  assert.equal(app.appSoundVolume,100);assert.equal(messages.length,0);assert.equal(app.$('saveAppSounds').disabled,false);assert.equal(app.$('saveAppSounds').textContent,'Save sound settings');assert.equal(toasts[0][1],'error');
});
test('preview is explicit and uses the staged volume',()=>{
  const {app}=controls();app.$('appSoundVolume').value='220';app.$('appSoundVolume').oninput();assert.equal(app.preview,undefined);app.$('previewAppSound').onclick();assert.deepEqual([...app.preview],['request',true,220]);
});
test('room accepts sound settings only from its trusted embedded parent, including live same-tab changes',()=>{
  const handlers=[],parent={},app={window:{},parent,embedded:true,location:{origin:'https://local.test'},callSoundsEnabled:true,callSoundVolume:100,localStorage:{getItem:()=>null},addEventListener:(kind,fn)=>handlers.push({kind,fn})};
  vm.createContext(app);vm.runInContext(section(room,'  function callSoundSettings(','  function playCallCue('),app);
  const message=handlers.find(item=>item.kind==='message').fn;
  for(const event of [{origin:'https://evil.test',source:parent},{origin:app.location.origin,source:{}}])message({...event,data:{type:'vumiro-app-sound-settings',settings:{enabled:false,volume:300}}});
  assert.equal(app.callSoundsEnabled,true);message({origin:app.location.origin,source:parent,data:{type:'vumiro-app-sound-settings',settings:{enabled:false,volume:250}}});assert.equal(app.callSoundsEnabled,false);assert.equal(app.callSoundVolume,250);
});
test('app and room load saved volume and preserve the previous explicit off preference',()=>{
  for(const [source,start,end,state] of [[friends,'let appSounds=true','function playUiCue(','[appSounds,appSoundVolume]'],[room,'  let callSoundsEnabled=true','  function playCallCue(','[callSoundsEnabled,callSoundVolume]']]){
    for(const [saved,legacy,want] of [[null,'off',[false,100]],[null,null,[true,100]],[{enabled:true,volume:280},'off',[true,280]],[{enabled:false,volume:0},null,[false,0]],[{enabled:true,volume:9999},null,[true,300]],[{enabled:true,volume:'corrupt'},null,[true,100]]]){
      const app={localStorage:{getItem:key=>key==='vumiro-app-sounds'?legacy:JSON.stringify(saved)},addEventListener(){}};vm.createContext(app);vm.runInContext(section(source,start,end),app);assert.deepEqual([...vm.runInContext(state,app)],want);
    }
  }
});
test('room sound settings update through storage events and reject corrupted records',()=>{
  const handlers=[],app={callSoundsEnabled:true,callSoundVolume:100,addEventListener:(kind,fn)=>handlers.push({kind,fn})};vm.createContext(app);vm.runInContext(section(room,'  function callSoundSettings(','  function playCallCue('),app);
  const storage=handlers.find(item=>item.kind==='storage').fn;
  storage({key:'vumiro-app-sound-settings',newValue:JSON.stringify({enabled:true,volume:230})});assert.equal(app.callSoundVolume,230);
  for(const newValue of ['not json','null',JSON.stringify({enabled:'false',volume:500})])storage({key:'vumiro-app-sound-settings',newValue});assert.equal(app.callSoundVolume,230);assert.equal(app.callSoundsEnabled,true);
  storage({key:'vumiro-app-sound-settings',newValue:JSON.stringify({enabled:false,volume:230})});assert.equal(app.callSoundsEnabled,false);
});
