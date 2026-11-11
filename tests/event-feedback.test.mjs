import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const room=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const friends=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function audioHarness(source,kind,{hidden=false,enabled=true,volume=100,gainFailure=false,resumeFailure=false}={}) {
  const contexts=[];
  class Context {
    constructor(){this.currentTime=10;this.destination={};this.tones=[];this.ramps=[];this.state=resumeFailure?'suspended':'running';contexts.push(this);}
    createOscillator(){const ctx=this;return this.osc={frequency:{setValueAtTime:(value,time)=>ctx.tones.push({value,time})},connect(){},start(time){ctx.start=time;},stop(time){ctx.stop=time;}};}
    createGain(){if(gainFailure)throw Error('device not available');return {gain:{setValueAtTime(){},exponentialRampToValueAtTime:(value,time)=>this.ramps.push({value,time})},connect(){}};}
    async resume(){if(resumeFailure)throw Error('device not available');}
    async close(){this.closed=true;}
  }
  const app={window:{AudioContext:Context},document:{hidden},callSoundsEnabled:enabled,appSounds:enabled,callSoundVolume:volume,appSoundVolume:volume};vm.createContext(app);
  if(kind==='ui')vm.runInContext(section(source,'function soundVolume(','function playUiCue('),app);
  vm.runInContext(kind==='call'?section(source,'  function playCallCue(','  function chatLine('):section(source,'function playUiCue(','let generation='),app);
  return {app,contexts};
}
test('incoming chat can sound in a background room while hidden connection cues stay quiet',()=>{
  const {app,contexts}=audioHarness(room,'call',{hidden:true});app.playCallCue('chat');assert.equal(contexts.length,1);
  app.playCallCue('join');app.playCallCue('leave');assert.equal(contexts.length,1);
});
test('join and leave cues sequence distinct notes and close their context after the final decay',async()=>{
  for(const kind of ['join','leave']){
    const {app,contexts}=audioHarness(room,'call');app.playCallCue(kind);const ctx=contexts[0];
    assert.equal(ctx.tones.length,2);assert.ok(ctx.tones[1].time>ctx.tones[0].time);
    assert.ok(ctx.ramps.at(-1).time>ctx.tones.at(-1).time+.07);assert.ok(ctx.stop>=ctx.ramps.at(-1).time);
    await ctx.osc.onended();assert.equal(ctx.closed,true);
  }
});
test('muted sound settings suppress call and app cues; explicit preview still plays',()=>{
  const call=audioHarness(room,'call',{enabled:false});call.app.playCallCue('chat');assert.equal(call.contexts.length,0);
  const ui=audioHarness(friends,'ui',{enabled:false});ui.app.playUiCue('request');assert.equal(ui.contexts.length,0);ui.app.playUiCue('request',true);assert.equal(ui.contexts.length,1);
});
test('app cues sequence notes and leave time for their final decay',()=>{
  for(const kind of ['ring','request','room','leave']){
    const {app,contexts}=audioHarness(friends,'ui');app.playUiCue(kind);const ctx=contexts[0];
    assert.ok(ctx.tones.every((note,index)=>index===0||note.time>ctx.tones[index-1].time));assert.ok(ctx.ramps.at(-1).time>ctx.tones.at(-1).time+.07);
  }
});
test('app and room notification volume has a louder default and independent 300 percent boost',()=>{
  for(const [source,kind,cue] of [[friends,'ui','request'],[room,'call','chat']]){
    const regular=audioHarness(source,kind),boost=audioHarness(source,kind,{volume:300});
    (kind==='ui'?regular.app.playUiCue:regular.app.playCallCue)(cue);(kind==='ui'?boost.app.playUiCue:boost.app.playCallCue)(cue);
    assert.equal(regular.contexts[0].ramps[0].value,.12);assert.equal(boost.contexts[0].ramps[0].value,.36);
  }
});
test('zero volume suppresses app and room sounds, including the volume preview',()=>{
  const ui=audioHarness(friends,'ui',{volume:0}),call=audioHarness(room,'call',{volume:0});
  ui.app.playUiCue('request',true,0);call.app.playCallCue('chat');assert.equal(ui.contexts.length,0);assert.equal(call.contexts.length,0);
});
test('preview uses the draft volume while ordinary notifications retain the saved volume',()=>{
  const {app,contexts}=audioHarness(friends,'ui');app.playUiCue('request',true,250);app.playUiCue('request');
  assert.equal(contexts[0].ramps[0].value,.3);assert.equal(contexts[1].ramps[0].value,.12);
});
test('app and room contexts are closed if audio device setup or resume fails',async()=>{
  for(const [source,kind,cue] of [[friends,'ui','request'],[room,'call','chat']])for(const options of [{gainFailure:true},{resumeFailure:true}]){
    const {app,contexts}=audioHarness(source,kind,options);(kind==='ui'?app.playUiCue:app.playCallCue)(cue);await Promise.resolve();assert.equal(contexts[0].closed,true);
  }
});
function statusHarness(source,start,end){
  const elements=new Map(),app={$:id=>{if(!elements.has(id))elements.set(id,{setAttribute(key,value){this[key]=value;}});return elements.get(id);}};vm.createContext(app);vm.runInContext(section(source,start,end),app);return app;
}
test('room status exposes pending work and clears busy state on success or failure',()=>{
  const app=statusHarness(room,'  function status(','  const seenMessages=');
  app.status('Connecting securely…');assert.equal(app.$('status')['aria-busy'],'true');
  app.status('Joining room…');assert.equal(app.$('status')['aria-busy'],'true');
  app.status('Connection failed. Try again.');assert.equal(app.$('status')['aria-busy'],'false');
  app.status('Starting screen share…');assert.equal(app.$('status')['aria-busy'],'true');
  app.status('Screen sharing started.');assert.equal(app.$('status')['aria-busy'],'false');
});
test('profile feedback exposes processing and clears busy state on readiness, cancellation and rejection',()=>{
  const app=statusHarness(friends,'const status=text=>','let toastTimer=');
  for(const text of ['Preparing picture…','Saving profile…']){app.profileFeedback(text);assert.equal(app.$('profileError')['aria-busy'],'true');}
  for(const text of ['Picture ready. Save your profile to keep this change.','Picture change cancelled.','This picture is not suitable.','']){app.profileFeedback(text);assert.equal(app.$('profileError')['aria-busy'],'false');}
});
test('cancelling a profile picture picker clears its processing feedback',async()=>{
  const app=statusHarness(friends,'const status=text=>','let toastTimer=');Object.assign(app,{avatarSelection:0,avatarWork:Promise.resolve(),window:{VumiroAvatarEditor:{edit:async()=>null}}});app.$('avatarFile').files=[{}];
  vm.runInContext(section(friends,"$('avatarFile').onchange=", "$('removeAvatar').onclick="),app);app.$('avatarFile').onchange();await app.avatarWork;
  assert.equal(app.$('profileError')['aria-busy'],'false');assert.doesNotMatch(app.$('profileError').textContent,/Preparing/);
});
test('successful profile save clears the saving feedback and its spinner',async()=>{
  const app=statusHarness(friends,'const status=text=>','let toastTimer=');Object.assign(app,{profileSaving:false,profile:{name:'Test'},avatarWork:Promise.resolve(),bannerWork:Promise.resolve(),profileProviders:{},local:{validateBio:()=>'',validateConnections:()=>[],updateProfile:async value=>value},avatarDraft:'',bannerDraft:'',renderProfile(){},ready:false,toast(){},document:{querySelectorAll:()=>[]}});
  vm.runInContext(section(friends,"$('profileForm').onsubmit=",'async function saveAvatar('),app);await app.$('profileForm').onsubmit({preventDefault(){},submitter:{}});
  assert.equal(app.$('profileError')['aria-busy'],'false');assert.doesNotMatch(app.$('profileError').textContent,/Saving/);
});
test('remote mute badges contain a decorative mic-off icon and accessible text',()=>{
  class Element {constructor(tag){this.tagName=tag;this.children=[];this.style={};this.hidden=false;this.classList={toggle(){}};}append(...children){this.children.push(...children);}setAttribute(key,value){this[key]=value;}}
  const app={document:{createElement:tag=>new Element(tag)},$:()=>new Element('section'),refreshLayout(){},status(){},fallbackAvatar:()=>'',peers:new Map()};vm.createContext(app);vm.runInContext(section(room,'  function tile(','  function play('),app);
  const badge=app.tile('Friend',true).muteBadge;assert.ok(badge.children.some(child=>child['aria-hidden']==='true'&&child.innerHTML?.includes('#i-mic-off')));assert.ok(badge.children.some(child=>child.textContent==='Mic off'));
});
test('connection loss clears untrustworthy mute state until a new announcement arrives',()=>{
  let renders=0;const tile={micMuted:true,muteBadge:{hidden:false},stats:{}},pc={connectionState:'disconnected'},peer={tile},app={pc,peer,diagnostic(){},peers:new Map(),updateControls(){},refreshLayout(){renders++;}};
  vm.createContext(app);vm.runInContext(section(room,'    pc.onconnectionstatechange=()=>{','    return peer;'),app);
  for(const state of ['disconnected','failed','closed']){tile.micMuted=true;tile.muteBadge.hidden=false;pc.connectionState=state;pc.onconnectionstatechange();assert.equal(tile.micMuted,null);assert.equal(tile.muteBadge.hidden,true);}
  assert.equal(renders,3,'People list must discard stale mute labels too');
});
test('live legacy and signed chat alert on every screen while self, history and replay remain quiet',async()=>{
  for(const version of [1,2]){
    const cues=[],seen=new Set(),view={hidden:true},peer={id:'B'.repeat(43)},identity={id:'A'.repeat(43),key:'own'},peers=new Map([[peer.id,peer]]);
    const app={identity,peers,seenMessages:seen,profileCache:new Map(),chatRoom:'room',chatEpoch:1,document:{hidden:false},$:()=>view,validChatMessage:()=>true,validChatReply:()=>true,rememberMessage:key=>{if(seen.has(key))return false;seen.add(key);return true;},storeChatMessage:message=>{const key=message.author.id+':'+message.id;if(seen.has(key))return false;seen.add(key);return true;},local:{validateContact:async author=>author,verify:async()=>true},chatSignatureText:()=>'',chatLine(){},playCallCue:kind=>cues.push(kind)};
    app.persistRoomChat=()=>{};
    vm.createContext(app);vm.runInContext(section(room,'  function validSignedRoomChat(','  function storeChatMessage(')+section(room,'  async function acceptRoomChat(','  function queueChatHistory('),app);
    let index=0;const message=()=>({version,id:'msg'+index++,room:'room',text:'Hello',timestamp:Date.now(),author:{id:peer.id,key:'other',name:'Friend'},signature:'valid'});
    const first=message();await app.acceptRoomChat(peer,first);assert.deepEqual(cues,['chat']);await app.acceptRoomChat(peer,first);assert.equal(cues.length,1);
    view.hidden=false;await app.acceptRoomChat(peer,message());assert.equal(cues.length,2);
    view.hidden=true;await app.acceptRoomChat(peer,message(),true);assert.equal(cues.length,2);
    peer.id=identity.id;peers.set(peer.id,peer);const own=message();own.author.key='own';await app.acceptRoomChat(peer,own);assert.equal(cues.length,2);
  }
});
