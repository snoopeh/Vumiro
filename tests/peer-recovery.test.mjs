import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function recoveryHarness({state='disconnected',ice=state,supported=true}={}) {
  let clock=0,next=0,restarts=0,current=true;
  const timers=new Map(),messages=[];
  const pc={connectionState:state,iceConnectionState:ice,signalingState:'stable'};
  if(supported)pc.restartIce=()=>{restarts++;pc.connectionState='connecting';pc.iceConnectionState='checking';};
  const app={setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:clock+delay});return id;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(app);vm.runInContext(section('  function createPeerRecovery(','  function peerError('),app);
  const recovery=app.createPeerRecovery(pc,()=>current,message=>messages.push(message));
  const advance=ms=>{const end=clock+ms;let budget=100;while(budget--){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;clock=entry[1].at;timers.delete(entry[0]);entry[1].fn();}assert.ok(budget>0,'timers must terminate');clock=end;};
  return {pc,recovery,timers,messages,advance,restarts:()=>restarts,invalidate:()=>{current=false;}};
}

test('transient disconnection has a grace period and cancels on recovery',()=>{
  const app=recoveryHarness();app.recovery.update();app.advance(3999);assert.equal(app.restarts(),0);
  app.pc.connectionState='connected';app.pc.iceConnectionState='connected';app.recovery.update();app.advance(30000);
  assert.equal(app.restarts(),0);assert.equal(app.timers.size,0);
});
test('failed ICE starts immediately and repeated callbacks keep one bounded cycle',()=>{
  const app=recoveryHarness({state:'connected',ice:'failed'});for(let i=0;i<20;i++)app.recovery.update();assert.equal(app.timers.size,1);
  app.advance(0);assert.equal(app.restarts(),1);for(let i=0;i<20;i++)app.recovery.update();assert.equal(app.timers.size,1);
  app.advance(30000);assert.equal(app.restarts(),3);assert.equal(app.timers.size,0);assert.match(app.messages.at(-1),/Use Reconnect/);
  app.pc.connectionState='failed';for(let i=0;i<20;i++)app.recovery.update();app.advance(60000);assert.equal(app.restarts(),3);
});
test('a later successful connection resets the next outage budget',()=>{
  const app=recoveryHarness({state:'failed'});app.recovery.update();app.advance(30000);assert.equal(app.restarts(),3);
  app.pc.connectionState='connected';app.pc.iceConnectionState='completed';app.recovery.update();
  app.pc.connectionState='disconnected';app.pc.iceConnectionState='disconnected';app.recovery.update();app.advance(4000);assert.equal(app.restarts(),4);
});
test('peer disposal or invalid session cannot restart a departed connection',()=>{
  for(const dispose of [true,false]){const app=recoveryHarness({state:'failed'});app.recovery.update();if(dispose)app.recovery.dispose();else app.invalidate();app.advance(60000);app.recovery.update();assert.equal(app.restarts(),0);assert.equal(app.timers.size,0);}
});
test('closed peers and unsupported restartIce fail safely without retry loops',()=>{
  const closed=recoveryHarness({state:'closed'});closed.recovery.update();assert.equal(closed.timers.size,0);
  const app=recoveryHarness({state:'failed',supported:false});app.recovery.update();app.advance(0);assert.match(app.messages.at(-1),/Use Reconnect/);assert.equal(app.timers.size,0);
});
test('restartIce exceptions terminate automatic attempts',()=>{
  const app=recoveryHarness({state:'failed'});app.pc.restartIce=()=>{throw Error('closed during restart');};app.recovery.update();app.advance(0);assert.equal(app.timers.size,0);assert.match(app.messages.at(-1),/could not recover/);
});
test('synchronous connected callback cancels the already-armed watchdog',()=>{
  const app=recoveryHarness({state:'failed'});app.pc.restartIce=()=>{app.pc.connectionState='connected';app.pc.iceConnectionState='connected';app.recovery.update();};app.recovery.update();app.advance(0);assert.equal(app.timers.size,0);
});

function peerHarness({polite=false}={}) {
  const sent=[],timers=new Map(),peers=new Map(),id='b'.repeat(43);
  class PC {
    constructor(){this.connectionState='new';this.iceConnectionState='new';this.signalingState='stable';this.remoteDescription={type:'answer'};this.transceivers=[];}
    addTransceiver(){const value={sender:{replaceTrack:async()=>{}},direction:'sendrecv'};this.transceivers.push(value);return value;}
    getTransceivers(){return this.transceivers;}
    createDataChannel(){return {};}
    async setLocalDescription(){this.localDescription={type:this.remoteDescription?.type==='offer'?'answer':'offer',sdp:'test'};}
    async setRemoteDescription(value){this.remoteDescription=value;this.signalingState='stable';}
    async addIceCandidate(){}
  }
  const app={RTCPeerConnection:PC,selfId:(polite?'z':'a').repeat(43),generation:1,joined:true,socket:{readyState:1},WebSocket:{OPEN:1},peers,profileCache:new Map(),local:{listFriends:async()=>[]},tile:()=>({stats:{},muteBadge:{},audios:[]}),currentTrack:()=>null,dataChannel(){},refreshLayout(){},updateControls(){},diagnostic(){},tune(){},announce(){},relay:()=>false,validDescription:()=>true,send:message=>sent.push(message),setTimeout:(fn,delay)=>{const key=timers.size+1;timers.set(key,{fn,delay});return key;},clearTimeout:key=>timers.delete(key)};
  vm.createContext(app);vm.runInContext(section('  function createPeerRecovery(','  function removePeer('),app);
  // Use the lightweight channel boundary, not transport tests, in this fixture.
  const peer=app.createPeer(id,'Friend');return {app,peer,sent,timers};
}

test('pending local negotiation cannot signal after peer removal or session replacement',async()=>{
  for(const leave of [true,false]){const {app,peer,sent}=peerHarness();let release;peer.pc.setLocalDescription=()=>new Promise(resolve=>{release=()=>{peer.pc.localDescription={type:'offer'};resolve();};});peer.pc.onnegotiationneeded();await Promise.resolve();assert.equal(typeof release,'function');if(leave)app.peers.delete(peer.id);else app.generation++;release();await peer.queue;assert.equal(sent.length,0);}
});
test('obsolete inbound offers cannot create answers after their await resolves',async()=>{
  const {app,peer,sent}=peerHarness();let release;peer.pc.setRemoteDescription=()=>new Promise(resolve=>{release=resolve;});app.receiveSignal({from:peer.id,description:{type:'offer'}});await Promise.resolve();app.peers.delete(peer.id);release();await peer.queue;assert.equal(sent.length,0);
});
test('perfect-negotiation collision roles remain intact',async()=>{
  for(const polite of [false,true]){const {app,peer,sent}=peerHarness({polite});peer.pc.signalingState='have-local-offer';app.receiveSignal({from:peer.id,description:{type:'offer',sdp:'remote'}});await peer.queue;assert.equal(peer.ignoreOffer,!polite);assert.equal(sent.length,polite?1:0);if(polite)assert.equal(sent[0].description.type,'answer');}
});
test('departed peers do not emit late ICE candidates',()=>{
  const {app,peer,sent}=peerHarness();app.peers.delete(peer.id);peer.pc.onicecandidate({candidate:null});assert.equal(sent.length,0);
});

test('exhaustion exposes a manual reconnect state and keeps its actionable explanation',()=>{
 const app=recoveryHarness({state:'failed'});app.recovery.update();app.advance(30000);
 assert.equal(app.pc.connectionState,'connecting');assert.equal(app.recovery.needsManualReconnect(),true);
 app.messages.length=0;app.pc.connectionState='failed';app.recovery.update();assert.match(app.messages.at(-1),/Use Reconnect/);assert.equal(app.timers.size,0);
 assert.match(source,/peer\.recovery\?\.needsManualReconnect\(\)/);
 app.pc.connectionState='connected';app.pc.iceConnectionState='completed';app.recovery.update();assert.equal(app.recovery.needsManualReconnect(),false);
});
test('even a saved callback from a cancelled timer checks disposal and session identity',()=>{
 for(const dispose of [true,false]){const app=recoveryHarness({state:'failed'});app.recovery.update();const callback=[...app.timers.values()][0].fn;if(dispose)app.recovery.dispose();else app.invalidate();callback();assert.equal(app.restarts(),0);}
});
test('obsolete connection-state callbacks do not render into the current room',()=>{
 const {app,peer}=peerHarness();app.peers.delete(peer.id);app.updateControls=()=>assert.fail('obsolete peer rendered');app.refreshLayout=()=>assert.fail('obsolete peer rendered');peer.pc.onconnectionstatechange();peer.pc.oniceconnectionstatechange();
});

function resourcesHarness() {
 const events=[],peers=new Map();
 const track=name=>({enabled:true,onended(){},onunmute(){},stop(){events.push('stop:'+name);if(name==='screen-fault')throw Error('device cleanup failed');}});
 const captures={screen:[track('screen-fault'),track('screen-audio')],mic:[track('mic')],changing:[track('changing')]};
 const stream=tracks=>({getTracks:()=>tracks});
 const app={generation:3,microphoneEpoch:2,joined:true,joining:true,disconnected:true,screen:stream(captures.screen),microphone:stream(captures.mic),changingMicrophones:new Set([stream(captures.changing)]),micChanging:true,micSuppressed:false,reconnectTimer:7,socket:{close(){events.push('socket');throw Error('socket close failed');}},audioContext:{close(){events.push('context');return Promise.reject(Error('audio cleanup failed'));}},audioDestination:{},nativeAudioTrack:{},localTile:{element:{remove(){events.push('local-tile');}}},selfId:'self',peers,voice:{forgetPlayback(){events.push('forget');throw Error('playback cleanup failed');},stopTest(){events.push('test');throw Error('test cleanup failed');},setDeafened(){events.push('deafen');}},stopNativeAudioCapture(){events.push('native');throw Error('native cleanup failed');},clearTimeout:id=>events.push('timer:'+id),clearPeerChat(){events.push('chat');throw Error('chat cleanup failed');},chatControls(){},refreshLayout(){},currentTrack:()=>null,tune:async()=>{},announce(){},events,captures};
 vm.createContext(app);vm.runInContext(section('  function safeCleanup(','  async function stopShare('),app);
 for(const id of ['first','second']){const media={srcObject:stream([track(id+'-remote')]),pause(){events.push('pause:'+id);}};peers.set(id,{id,recovery:{dispose(){events.push('dispose:'+id);}},pc:{ontrack(){},close(){events.push('peer:'+id);throw Error('peer close failed');}},channel:{onmessage(){},close(){events.push('channel:'+id);throw Error('channel close failed');}},tile:{video:media,audios:[],element:{remove(){events.push('remove:'+id);}}}});}
 return app;
}
test('departure stops all local capture before independently releasing failing remote resources',async()=>{
 const app=resourcesHarness(),oldPeers=[...app.peers.values()];app.releaseRoomResources();await Promise.resolve();
 assert.deepEqual(app.events.slice(0,4),['stop:screen-fault','stop:screen-audio','stop:mic','stop:changing']);
 for(const tracks of Object.values(app.captures))for(const track of tracks){assert.equal(track.enabled,false);assert.equal(track.onended,null);assert.equal(track.onunmute,null);}
 for(const id of ['first','second']){assert.ok(app.events.includes('peer:'+id));assert.ok(app.events.includes('remove:'+id));}
 for(const peer of oldPeers){assert.equal(peer.pc.ontrack,null);assert.equal(peer.channel.onmessage,null);assert.equal(peer.tile.video.srcObject,null);}
 assert.equal(app.peers.size,0);assert.equal(app.screen,null);assert.equal(app.microphone,null);assert.equal(app.changingMicrophones.size,0);assert.equal(app.socket,null);assert.equal(app.audioContext,null);assert.equal(app.joined,false);assert.equal(app.joining,false);assert.equal(app.generation,4);assert.equal(app.reconnectTimer,0);
 assert.doesNotThrow(()=>app.releaseRoomResources(),'repeated departure remains harmless');
});
test('leaving during identity initialization prevents the pending join from opening a socket',async()=>{
 let resolve,opened=0;const app={joined:false,joining:false,generation:2,identityReady:new Promise(done=>{resolve=done;}),status(){},openSocket(){opened++;}};
 vm.createContext(app);vm.runInContext(section('  async function join() {','  async function leave() {'),app);
 const joining=app.join();app.generation++;resolve();await joining;assert.equal(opened,0);
});
test('a departed peer replacement failure does not roll back healthy local capture',async()=>{
 const app=resourcesHarness();app.peers.clear();let reject;
 const peer={id:'peer',pc:{signalingState:'stable'},slots:[{sender:{replaceTrack:()=>new Promise((_,fail)=>{reject=fail;})}}]};app.peers.set(peer.id,peer);
 const replacing=app.replaceTracks();app.peers.delete(peer.id);reject(Error('closed while replacing'));await replacing;
});
test('an active peer replacement error remains observable to the microphone rollback path',async()=>{
 const app=resourcesHarness();app.peers.clear();const peer={id:'peer',pc:{signalingState:'stable'},slots:[{sender:{replaceTrack:async()=>{throw Error('device rejected');}}}]};app.peers.set(peer.id,peer);
 await assert.rejects(app.replaceTracks(),/device rejected/);
});
test('saved data-channel callbacks cannot announce or clear chat for a departed peer',()=>{
 const app={peers:new Map(),Date,announce:()=>assert.fail('late announcement'),clearPeerChat:()=>assert.fail('late chat cleanup')};vm.createContext(app);vm.runInContext(section('  function dataChannel(','  // One bounded recovery cycle'),app);
 const peer={id:'gone'},channel={close(){}};app.dataChannel(peer,channel);channel.onopen();channel.onclose();
});
test('Stop sharing clears every track even when one stop and native cleanup fail',async()=>{
 const app=resourcesHarness();app.peers.clear();Object.assign(app,{diagnostic(){},status(){},localTile:{show(){},video:{}},updateControls(){}});vm.runInContext(section('  async function stopShare() {','  async function share() {'),app);
 await app.stopShare();assert.equal(app.screen,null);assert.ok(app.events.includes('stop:screen-audio'));assert.ok(app.events.includes('native'));assert.equal(app.localTile.video.srcObject,null);
});

test('recovery disposal and callback detachment failures cannot skip peer close',()=>{
 const app=resourcesHarness(),peer=app.peers.get('first');peer.recovery.dispose=()=>{throw Error('dispose failed');};Object.defineProperty(peer.pc,'ontrack',{set(){throw Error('callback setter failed');}});Object.defineProperty(peer.channel,'onmessage',{set(){throw Error('channel setter failed');}});
 app.removePeer(peer.id);assert.ok(app.events.includes('peer:first'));assert.ok(app.events.includes('remove:first'));assert.equal(peer.tile.video.srcObject,null);
});
test('peer removal during sender tuning prevents a late announcement',async()=>{
 const app=resourcesHarness();app.peers.clear();let release;app.tune=()=>new Promise(done=>{release=done;});app.announce=()=>assert.fail('late announce');const peer={id:'peer',pc:{signalingState:'stable'},slots:[{sender:{replaceTrack:async()=>{}}}]};app.peers.set(peer.id,peer);
 const replacing=app.replaceTracks();await new Promise(setImmediate);assert.equal(typeof release,'function');app.peers.delete(peer.id);release();await replacing;
});
test('native audio local cleanup completes before a failing bridge notification',()=>{
 const app=resourcesHarness();app.nativeAudioSession={id:'capture',sources:new Set([{stop(){app.events.push('source-stop');throw Error('source failed');},disconnect(){app.events.push('source-disconnect');}}])};app.nativeAudioGeneration=2;app.nativeAudioTrack={enabled:true};app.embedded=true;app.parentMessage=()=>{assert.equal(app.nativeAudioTrack.enabled,false);app.events.push('bridge');throw Error('bridge failed');};
 vm.runInContext(section('  function stopNativeAudioCapture(','  function startNativeAudioCapture('),app);app.stopNativeAudioCapture();assert.equal(app.nativeAudioSession,null);assert.equal(app.nativeAudioGeneration,3);assert.deepEqual(app.events,['source-stop','source-disconnect','bridge']);
});
test('failed departure status rendering cannot suppress the host call-ended notification',async()=>{
 const app=resourcesHarness();let notified=0;Object.assign(app,{policyAck:null,password:'secret',passwordResolve:null,setChatRoom(){},syncMuteControl(){},updateControls(){},status(){throw Error('status unavailable');},chatLine(){throw Error('chat unavailable');},embedded:true,parent:{postMessage:message=>{assert.equal(message.type,'vumiro-call-ended');notified++;}},location:{origin:'https://vumiro.local'}});
 vm.runInContext(section('  async function leave() {',"  $('name').value="),app);await app.leave();assert.equal(notified,1);assert.equal(app.password,'');
});
