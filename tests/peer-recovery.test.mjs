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
