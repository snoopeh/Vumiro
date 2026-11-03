import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const localSource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/local-profile.js',import.meta.url),'utf8');
const audioSource=localSource.slice(localSource.indexOf('/* Local voice preferences'));
const callSource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.listeners=new Map();this.dataset={};this.style={};this.value='';this.hidden=false;this.open=false;this.disabled=false;this.volume=1;this.muted=false;this.sinkId='';this.classList={toggle(){},add(){}};}
  append(...children){for(const child of children){this.children.push(child);child.parentElement=this;}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
  setAttribute(name,value){this.attributes[name.toLowerCase()]=value;}
  removeAttribute(name){delete this.attributes[name.toLowerCase()];}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(callback);}
  removeEventListener(name,callback){this.listeners.get(name)?.delete(callback);}
  dispatch(name,event={}){for(const listener of this.listeners.get(name)||[])listener(event);}
  focus(){this.focused=true;}
  select(){}
  showModal(){this.open=true;}
  close(){if(!this.open)return;this.open=false;this.dispatch('close');}
  play(){this.played=true;return Promise.resolve();}
  pause(){this.paused=true;}
  async setSinkId(id){if(this.rejectSink?.(id))throw Error('Speaker unavailable');this.sinkId=id;}
  get firstElementChild(){return this.children[0];}
  querySelector(selector){const name=selector.slice(1,-1).toLowerCase();return descendants(this).find(node=>Object.hasOwn(node.attributes,name))||null;}
  set innerHTML(value){this.children=[];for(const match of value.matchAll(/<(button|h2|p|div|select|input|meter|output|span|label)\b([^>]*)>/g)){const node=new Element(match[1]);for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]||'');this.append(node);}}
}
const descendants=element=>[element,...element.children.flatMap(descendants)];
class Track {
  constructor(id='default'){this.id=id;this.kind='audio';this.enabled=true;this.readyState='live';this.muted=false;this.listeners=new Map();}
  stop(){this.stopped=true;this.readyState='ended';}
  addEventListener(name,fn){this.listeners.set(name,fn);}
  removeEventListener(name,fn){if(this.listeners.get(name)===fn)this.listeners.delete(name);}
  getSettings(){return {deviceId:this.id,echoCancellation:true,noiseSuppression:true,autoGainControl:true};}
  getCapabilities(){return {echoCancellation:[true,false],noiseSuppression:[true,false],autoGainControl:[true,false]};}
}
class Stream {
  constructor(tracks){this.tracks=tracks;}
  getTracks(){return this.tracks;}
  getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}
  getVideoTracks(){return this.tracks.filter(track=>track.kind==='video');}
}
function harness({getUserMedia,frames=[]}={}){
  const elements=new Map(),events=new Map(),timers=new Map(),saved=[],streams=[],contexts=[],recorders=[],urls=new Set();let timerId=0,captures=0;
  const document={head:new Element('head'),body:new Element('body'),activeElement:new Element('button'),createElement:tag=>new Element(tag),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},querySelectorAll:()=>frames};
  const navigator={mediaDevices:{getSupportedConstraints:()=>({echoCancellation:true,noiseSuppression:true,autoGainControl:true}),enumerateDevices:async()=>[{kind:'audioinput',deviceId:'mic-a',label:'USB microphone'},{kind:'audioinput',deviceId:'mic-b',label:'Headset'},{kind:'audiooutput',deviceId:'speaker-a',label:'Headphones'}],addEventListener(){},getUserMedia:async constraints=>{++captures;if(getUserMedia)return getUserMedia(constraints);const stream=new Stream([new Track(constraints.audio?.deviceId?.exact||'default')]);streams.push(stream);return stream;}}};
  class Context {
    constructor(){contexts.push(this);}
    async resume(){}
    async close(){this.closed=true;}
    createMediaStreamSource(){return {connect(){}};}
    createAnalyser(){return {fftSize:512,getFloatTimeDomainData(data){data.fill(.1);}};}
  }
  class Recorder {
    constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';recorders.push(this);}
    start(){this.state='recording';}
    stop(){if(this.state==='inactive')return;this.state='inactive';this.ondataavailable?.({data:new Blob(['voice'],{type:this.mimeType})});this.onstop?.();}
  }
  class TestURL extends URL {static createObjectURL(){const value='blob:test-'+urls.size;urls.add(value);return value;}static revokeObjectURL(value){urls.delete(value);}}
  const sandbox={document,navigator,location:new URL('https://vumiro.local/friends.html'),localStorage:{getItem:()=>null,setItem:(name,value)=>saved.push({name,value:JSON.parse(value)})},URL:TestURL,Blob,DataView,ArrayBuffer,Float32Array,MediaRecorder:Recorder,AudioContext:Context,console,TextEncoder,TextDecoder,crypto:webcrypto,URLSearchParams,MediaStream:Stream,btoa,atob,
    addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),setInterval(fn,ms){const id=++timerId;timers.set(id,{fn,ms,interval:true});return id;},clearInterval:id=>timers.delete(id)};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(audioSource,sandbox);
  const api=sandbox.VumiroAudioSettings;
  const dialog=()=>document.body.children.find(node=>node.tagName==='dialog');
  const field=name=>dialog().querySelector('[data-audio-'+name+']');
  return {sandbox,api,document,events,timers,saved,streams,contexts,recorders,urls,dialog,field,captures:()=>captures,element:document.getElementById,runTimer(ms){const found=[...timers].find(([,timer])=>timer.ms===ms);assert.ok(found,'timer '+ms+' exists');timers.delete(found[0]);found[1].fn();}};
}

test('opening audio settings and refreshing devices never requests microphone capture',async()=>{
  const app=harness();app.api.open();await tick();assert.equal(app.dialog().open,true);assert.equal(app.captures(),0);
  await app.field('refresh').onclick();assert.equal(app.captures(),0);assert.equal(app.field('input').children.length,3);
  assert.ok(app.document.head.children[0].textContent.includes('vumiro-audio-dialog'));
});

test('active input failures do not save the requested device or report success',async()=>{
  const app=harness();app.api.registerRoom({apply:async()=>{throw Error('Device busy');}});
  await assert.rejects(app.api.update({inputId:'mic-b'}),/Device busy/);assert.equal(app.api.snapshot().inputId,'');assert.equal(app.saved.length,0);
});

test('concurrent preference changes serialize and merge against the last successful settings',async()=>{
  const app=harness();let release,started=0;app.api.registerRoom({apply:async()=>{if(++started===1)await new Promise(resolve=>release=resolve);}});
  const first=app.api.update({inputId:'mic-a'}),second=app.api.update({masterVolume:37});await tick();assert.equal(started,1);release();await Promise.all([first,second]);
  assert.equal(app.api.snapshot().inputId,'mic-a');assert.equal(app.api.snapshot().masterVolume,37);assert.equal(app.saved.length,2);
  assert.ok(app.saved.every(row=>row.name==='vumiro-audio-settings'));
});

test('master volume composes with peer levels and nested isolation preserves deafen',async()=>{
  const app=harness(),a=new Element('audio'),b=new Element('audio'),gates=[];let level=.4;
  app.api.registerRoom({gate:value=>gates.push(value)});await app.api.registerPlayback(a,()=>level);await app.api.registerPlayback(b,()=>.8);
  await app.api.update({masterVolume:50});assert.equal(a.volume,.2);assert.equal(b.volume,.4);
  const release=app.api.isolate(),release2=app.api.isolate();assert.equal(a.muted,true);release();assert.equal(a.muted,true);
  app.api.setDeafened(true);release2();assert.equal(a.muted,true);app.api.setDeafened(false);assert.equal(a.muted,false);assert.equal(a.volume,.2);
  level=0;app.api.refreshPlayback();assert.equal(a.muted,true);assert.equal(b.muted,false);assert.equal(gates.at(-1),false);
});

test('speaker routing failure restores old sinks and never persists a failed selection',async()=>{
  const app=harness(),audio=new Element('audio');await app.api.registerPlayback(audio);audio.rejectSink=id=>id==='unavailable';
  await assert.rejects(app.api.update({outputId:'unavailable'}),/Speaker unavailable/);assert.equal(audio.sinkId,'');assert.equal(app.api.snapshot().outputId,'');assert.equal(app.saved.length,0);
});

test('closing while microphone permission is pending stops the late stream and restores isolation',async()=>{
  let resolve;const app=harness({getUserMedia:()=>new Promise(done=>resolve=done)}),gates=[];app.api.registerRoom({gate:value=>gates.push(value)});
  app.api.open();const pending=app.field('test').onclick();await tick();assert.equal(gates.at(-1),true);assert.equal(app.field('stop').disabled,false);app.dialog().close();assert.equal(gates.at(-1),false);
  const stream=new Stream([new Track()]);resolve(stream);await pending;assert.equal(stream.getTracks()[0].stopped,true);assert.equal(app.contexts.length,0);assert.equal(app.timers.size,0);
});

test('record/replay test isolates room audio through playback, then frees tracks, nodes and blob',async()=>{
  const app=harness(),gates=[];app.api.registerRoom({gate:value=>gates.push(value)});await app.api.update({outputId:'speaker-a',masterVolume:65});
  app.api.open();await app.field('test').onclick();assert.equal(gates.at(-1),true);assert.equal(app.recorders[0].state,'recording');
  app.runTimer(3000);await tick();const audio=app.dialog().children.find(node=>node.tagName==='audio');assert.equal(audio.sinkId,'speaker-a');assert.equal(audio.volume,.65);assert.equal(audio.played,true);assert.equal(gates.at(-1),true);
  audio.onended();assert.equal(gates.at(-1),false);assert.equal(app.streams[0].getTracks()[0].stopped,true);assert.equal(app.contexts[0].closed,true);assert.equal(app.urls.size,0);assert.equal(app.timers.size,0);
});

test('microphone test error preserves an already deafened room',async()=>{
  const app=harness({getUserMedia:async()=>{throw Error('Permission denied');}});app.api.setDeafened(true);app.api.open();await app.field('test').onclick();
  assert.equal(app.api.isDeafened(),true);assert.equal(app.api.isSuppressed(),true);assert.match(app.field('status').textContent,/Permission denied/);assert.equal(app.timers.size,0);
});

test('parent dialog stays visible while a hidden same-origin call owns test isolation',async()=>{
  const room=harness(),gates=[];room.api.registerRoom({active:()=>true,gate:value=>gates.push(value)});
  const frame={hidden:true,contentWindow:{location:new URL('https://vumiro.local/call.html'),VumiroAudioSettings:room.api}},parent=harness({frames:[frame]});
  parent.api.open();assert.equal(parent.dialog().open,true);assert.equal(room.dialog(),undefined);await parent.field('test').onclick();assert.equal(gates.at(-1),true);
  parent.dialog().close();assert.equal(gates.at(-1),false);assert.equal(parent.streams[0].getTracks()[0].stopped,true);
});

test('room disposal cancels a test hosted in its visible parent',async()=>{
  const room=harness();room.api.registerRoom({active:()=>true,gate(){}});
  const parent=harness({frames:[{contentWindow:{location:new URL('https://vumiro.local/call.html'),VumiroAudioSettings:room.api}}]});
  parent.api.open();await parent.field('test').onclick();room.api.dispose();assert.equal(parent.streams[0].getTracks()[0].stopped,true);assert.equal(parent.timers.size,0);
});

test('cross-origin frames cannot receive local audio settings or test control',async()=>{
  let touched=0;const frame={contentWindow:{location:new URL('https://untrusted.example/call.html'),VumiroAudioSettings:{hasRoom(){++touched;return true;}}}},app=harness({frames:[frame]});
  app.api.open();await app.field('permission').onclick();assert.equal(touched,0);assert.equal(app.captures(),1);app.dialog().close();
});

async function callHarness(options={}){
  const app=harness(options),sockets=[],connections=[],ownId='a'.repeat(43),peerId='b'.repeat(43),room=ownId+'_'+'c'.repeat(48);
  class Socket {static OPEN=1;constructor(){this.readyState=1;sockets.push(this);}send(){}close(){}}
  class Connection {
    constructor(){this.connectionState='connected';this.transceivers=[];connections.push(this);}
    addTransceiver(kind){const value={receiver:{},sender:{track:typeof kind==='string'?null:kind,replaceTrack:async track=>{if(this.failReplacement){this.failReplacement=false;throw Error('Replace rejected');}value.sender.track=track;},getParameters:()=>({}),setParameters:async()=>{}},direction:'sendrecv'};this.transceivers.push(value);return value;}
    getTransceivers(){return this.transceivers;}
    createDataChannel(){return {readyState:'connecting',close(){}};}
    close(){this.connectionState='closed';}
  }
  Object.assign(app.sandbox,{location:new URL('/call.html?autojoin=1&room='+room+'&mode=public&signaling='+encodeURIComponent('wss://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling'),'https://vumiro.local'),VumiroLocalProfile:{initialize:async()=>({id:ownId,key:'public-key',name:'Host'}),profile:()=>({name:'Host'}),listFriends:async()=>[],listBlocked:async()=>[],sign:async()=>''},RTCPeerConnection:Connection,WebSocket:Socket,parent:{},history:{replaceState(){}}});
  vm.runInContext(callSource,app.sandbox);await tick();assert.equal(sockets.length,1);await sockets[0].onmessage({data:JSON.stringify({type:'welcome',id:ownId,peers:[{id:peerId,name:'Guest'}],policy:{mode:'public'}})});
  return {...app,connection:connections[0]};
}

test('call microphone switching preserves user mute and deafen restores previous state',async()=>{
  const app=await callHarness();await app.element('mic').onclick();const first=app.streams[0].getAudioTracks()[0];assert.equal(first.enabled,true);
  app.element('mute').onclick();assert.equal(first.enabled,false);await app.api.update({inputId:'mic-b'});const second=app.streams[1].getAudioTracks()[0];
  assert.equal(second.enabled,false);assert.equal(first.stopped,true);assert.equal(app.connection.transceivers[2].sender.track,second);
  app.element('deafen').onclick();app.element('deafen').onclick();assert.equal(second.enabled,false,'un-deafen preserves a previously muted mic');
  app.element('mute').onclick();assert.equal(second.enabled,true);app.element('deafen').onclick();assert.equal(second.enabled,false);app.element('deafen').onclick();assert.equal(second.enabled,true);
});

test('failed sender replacement keeps the old mic alive, stops the new capture and rolls back preferences',async()=>{
  const app=await callHarness();await app.element('mic').onclick();const first=app.streams[0].getAudioTracks()[0];app.connection.failReplacement=true;
  await assert.rejects(app.api.update({inputId:'mic-b'}),/Replace rejected/);assert.equal(first.stopped,undefined);assert.equal(app.streams[1].getAudioTracks()[0].stopped,true);assert.equal(app.api.snapshot().inputId,'');assert.equal(app.connection.transceivers[2].sender.track,first);
});

test('leaving while microphone permission is pending stops late capture and leaves no active microphone',async()=>{
  let resolve;const app=await callHarness({getUserMedia:()=>new Promise(done=>resolve=done)});const pending=app.element('mic').onclick();await tick();await app.element('leave').onclick();
  const stream=new Stream([new Track()]);resolve(stream);await pending;assert.equal(stream.getAudioTracks()[0].stopped,true);assert.equal(app.api.getMicrophone(),null);
});

test('first received audio cannot autoplay or unmute before the selected speaker is ready',async()=>{
  const app=await callHarness();assert.equal(app.element('deafen').disabled,false);await app.api.update({outputId:'speaker-a'});
  const create=app.document.createElement;let release;
  app.document.createElement=tag=>{const node=create(tag);if(tag==='audio')node.setSinkId=id=>new Promise(resolve=>release=()=>{node.sinkId=id;resolve();});return node;};
  const track=new Track('remote');app.connection.ontrack({track,transceiver:app.connection.transceivers[2],receiver:{}});await tick();
  const audio=descendants(app.element('tiles')).find(node=>node.tagName==='audio');assert.equal(audio.autoplay,false);assert.equal(audio.played,undefined);assert.equal(audio.muted,true);
  release();await tick();assert.equal(audio.sinkId,'speaker-a');assert.equal(audio.played,true);assert.equal(audio.muted,false);
});

test('a saved explicit speaker failure never falls back to an audible default route',async()=>{
  const app=await callHarness();await app.api.update({outputId:'speaker-a'});const create=app.document.createElement,calls=[];
  app.document.createElement=tag=>{const node=create(tag);if(tag==='audio')node.setSinkId=async id=>{calls.push(id);throw Error('Headphones missing');};return node;};
  app.connection.ontrack({track:new Track('remote'),transceiver:app.connection.transceivers[2],receiver:{}});await tick();
  const audio=descendants(app.element('tiles')).find(node=>node.tagName==='audio');assert.equal(audio.muted,true);assert.equal(audio.played,undefined);assert.deepEqual(calls,['speaker-a']);
});

test('audio arriving during a speaker change is finally routed to the newly saved device',async()=>{
  const app=harness();let finish;app.api.registerRoom({apply:async()=>new Promise(resolve=>finish=resolve)});
  const changing=app.api.update({outputId:'speaker-a'});await tick();const audio=new Element('audio'),ready=app.api.registerPlayback(audio);assert.equal(audio.muted,true);
  finish();await changing;await ready;assert.equal(audio.sinkId,'speaker-a');assert.equal(audio.muted,false);
});

test('mute, deafen and local-test isolation gate both captures during an in-flight mic swap',async()=>{
  const app=await callHarness();await app.element('mic').onclick();const original=app.streams[0].getAudioTracks()[0],sender=app.connection.transceivers[2].sender;let finish;
  sender.replaceTrack=track=>new Promise(resolve=>finish=()=>{sender.track=track;resolve();});
  const changing=app.api.update({inputId:'mic-b'});await tick();const replacement=app.streams[1].getAudioTracks()[0];assert.equal(original.enabled,true);
  app.element('mute').onclick();assert.equal(original.enabled,false);assert.equal(replacement.enabled,false);
  app.element('mute').onclick();const release=app.api.isolate();assert.equal(original.enabled,false);assert.equal(replacement.enabled,false);release();assert.equal(original.enabled,true);
  app.element('deafen').onclick();assert.equal(original.enabled,false);assert.equal(replacement.enabled,false);finish();await changing;
  assert.equal(original.stopped,true);assert.equal(replacement.enabled,false);app.element('deafen').onclick();assert.equal(replacement.enabled,true);
});

test('an ended previous mic cannot be restored by a failed in-flight swap',async()=>{
  const app=await callHarness();await app.element('mic').onclick();const original=app.streams[0].getAudioTracks()[0],sender=app.connection.transceivers[2].sender;let fail,first=true;
  sender.replaceTrack=track=>{if(first){first=false;return new Promise((resolve,reject)=>fail=()=>reject(Error('Device rejected')));}sender.track=track;return Promise.resolve();};
  const changing=app.api.update({inputId:'mic-b'});await tick();original.stop();original.onended();fail();await assert.rejects(changing,/Device rejected/);
  assert.equal(app.api.getMicrophone(),null);assert.equal(app.element('mic').disabled,false);assert.equal(app.element('mic').hidden,false);assert.equal(sender.track,null);
});
