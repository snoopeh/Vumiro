import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const localSource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/local-profile.js',import.meta.url),'utf8');
const audioSource=localSource.slice(localSource.indexOf('/* Local voice preferences'));
const callSource=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('embedded call audio opens the app settings only in the trusted app parent',()=>{
  const start=callSource.indexOf('  function openAudioSettings()');
  const end=callSource.indexOf("  $('audioOpen').onclick",start);
  assert.ok(start>=0&&end>start);
  function route(parent) {
    let appOpens=0,localOpens=0;
    const window={parent:parent==='self'?null:parent};
    if(parent==='self')window.parent=window;
    else if(parent?.VumiroAudioSettings)parent.VumiroAudioSettings.open=()=>{appOpens++;};
    const context={window,location:{origin:'https://app.example'},URL,voice:{open(){localOpens++;}}};
    vm.runInNewContext(callSource.slice(start,end)+';openAudioSettings();',context);
    return {appOpens,localOpens};
  }
  assert.deepEqual(route({location:{href:'https://app.example/friends.html'},VumiroAudioSettings:{open(){}}}),{appOpens:1,localOpens:0});
  assert.deepEqual(route({location:{href:'https://other.example/friends.html'},VumiroAudioSettings:{open(){}}}),{appOpens:0,localOpens:1});
  assert.deepEqual(route({location:{href:'https://app.example/unrelated.html'},VumiroAudioSettings:{open(){}}}),{appOpens:0,localOpens:1});
  assert.deepEqual(route({get location(){throw Error('Cross-origin access denied');}}),{appOpens:0,localOpens:1});
  assert.deepEqual(route('self'),{appOpens:0,localOpens:1});
});

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.listeners=new Map();this.dataset={};this.style={};this.value='';this.hidden=false;this.open=false;this.disabled=false;this.volume=1;this.muted=false;this.sinkId='';this.classList={toggle(){},add(){}};}
  append(...children){for(const child of children){child.remove();this.children.push(child);child.parentElement=this;}}
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
  querySelector(selector){if(selector.startsWith('.'))return descendants(this).find(node=>(node.attributes.class||'').split(' ').includes(selector.slice(1)))||null;const name=selector.slice(1,-1).toLowerCase();return descendants(this).find(node=>Object.hasOwn(node.attributes,name))||null;}
  set innerHTML(value){this.children=[];const stack=[this];for(const match of value.matchAll(/<(\/)?([a-z][\w-]*)\b([^>]*)>/gi)){if(match[1]){if(stack.length>1)stack.pop();continue;}const node=new Element(match[2]);for(const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]||'');stack.at(-1).append(node);if(!['input','br','hr','img'].includes(match[2]))stack.push(node);}}
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
function harness({getUserMedia,frames=[],resumeError}={}){
  const elements=new Map(),events=new Map(),timers=new Map(),saved=[],streams=[],contexts=[],recorders=[],urls=new Set();let timerId=0,captures=0;
  const document={head:new Element('head'),body:new Element('body'),activeElement:new Element('button'),createElement:tag=>new Element(tag),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},querySelectorAll:()=>frames};
  const navigator={mediaDevices:{getSupportedConstraints:()=>({echoCancellation:true,noiseSuppression:true,autoGainControl:true}),enumerateDevices:async()=>[{kind:'audioinput',deviceId:'mic-a',label:'USB microphone'},{kind:'audioinput',deviceId:'mic-b',label:'Headset'},{kind:'audiooutput',deviceId:'speaker-a',label:'Headphones'}],addEventListener(){},getUserMedia:async constraints=>{++captures;if(getUserMedia)return getUserMedia(constraints);const stream=new Stream([new Track(constraints.audio?.deviceId?.exact||'default')]);streams.push(stream);return stream;}}};
  class Context {
    constructor(options){this.options=options;this.sources=[];this.gains=[];this.destinations=[];contexts.push(this);}
    async resume(){if(resumeError)throw Error(resumeError);}
    async close(){this.closed=true;}
    createMediaStreamSource(stream){const node={stream,connect(target){this.target=target;},disconnect(){this.disconnected=true;}};this.sources.push(node);return node;}
    createGain(){const node={gain:{value:1},connect(target){this.target=target;},disconnect(){this.disconnected=true;}};this.gains.push(node);return node;}
    createMediaStreamDestination(){const node={stream:new Stream([new Track('boost')]),disconnect(){this.disconnected=true;}};this.destinations.push(node);return node;}
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

test('audio controls mount in the common settings panel and keep local tests operable',async()=>{
  const app=harness(),panel=new Element('section');panel.closest=()=>({open:true});app.document.body.append(panel);
  assert.equal(typeof app.api.prepare,'function');
  app.api.prepare(panel);await tick();
  assert.equal(app.dialog().open,false,'preparing a section never opens a second modal');
  assert.equal(app.captures(),0);
  const field=name=>panel.querySelector('[data-audio-'+name+']');
  await field('permission').onclick();
  assert.equal(app.captures(),1);assert.equal(field('stop').disabled,false);
  app.api.stopTest();assert.equal(app.streams[0].getTracks()[0].stopped,true);
  assert.equal(field('stop').disabled,true);
  let navigations=0;app.api.setSettingsNavigation(()=>navigations++);app.api.open();
  assert.equal(navigations,1);assert.equal(app.dialog().open,false);
});

test('leaving mounted audio controls stops a microphone granted after the panel was hidden',async()=>{
  let release;const stream=new Stream([new Track()]);
  const app=harness({getUserMedia:()=>new Promise(resolve=>release=resolve)}),panel=new Element('section');
  panel.closest=()=>({open:true});app.document.body.append(panel);app.api.prepare(panel);await tick();
  const pending=panel.querySelector('[data-audio-permission]').onclick();await tick();
  panel.hidden=true;app.api.stopTest();release(stream);await pending;
  assert.equal(stream.getTracks()[0].stopped,true);
  assert.equal(app.api.isSuppressed(),false,'preview isolation is released when leaving the section');
});

test('injected audio styles cannot change shared settings navigation or shell controls',()=>{
  const app=harness();app.api.open();
  const css=app.document.head.children[0].textContent;
  // This stylesheet is added after the app shell. Every audio descendant rule
  // must be bounded by its content wrapper; dialog rules are standalone only.
  const selectors=[...css.matchAll(/(?:^|})([^{}]+)\{/g)]
    .flatMap(match=>match[1].trim().startsWith('@')?[]:match[1].split(','));
  assert.ok(selectors.length>20);
  for(const selector of selectors)assert.ok(selector.includes('.va-content')||selector.includes('dialog.vumiro-audio-dialog:not(.settingsScreen)'),selector);
  assert.ok(!css.includes('.vumiro-audio-dialog button'));
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

test('boost amplifies quiet received audio without changing the selected speaker or the other voice stream',async()=>{
  const app=harness(),screen=new Element('audio'),voice=new Element('audio');let screenLevel=1;
  const original=new Stream([new Track('screen')]);screen.srcObject=original;voice.srcObject=new Stream([new Track('voice')]);
  await app.api.update({outputId:'speaker-a'});await app.api.registerPlayback(screen,()=>screenLevel);await app.api.registerPlayback(voice);
  assert.equal(app.contexts.length,0,'ordinary playback needs no extra audio graph');
  screenLevel=4;app.api.refreshPlayback();await tick();
  assert.equal(app.contexts.length,1);const context=app.contexts[0];
  assert.equal(context.options?.sampleRate,undefined,'use the hardware default rate');
  assert.equal(context.sources[0].stream,original);assert.equal(context.gains[0].gain.value,4);
  assert.equal(screen.srcObject,context.destinations[0].stream);assert.equal(screen.sinkId,'speaker-a');assert.equal(screen.volume,1);
  assert.equal(voice.srcObject.getAudioTracks()[0].id,'voice');assert.equal(voice.volume,1);
  await app.api.update({masterVolume:50});assert.equal(context.gains[0].gain.value,2);assert.equal(voice.volume,.5);
  app.api.setDeafened(true);assert.equal(screen.muted,true);app.api.setDeafened(false);assert.equal(screen.muted,false);
  screenLevel=0;app.api.refreshPlayback();assert.equal(screen.muted,true);
  app.api.forgetPlayback(screen);assert.equal(context.sources[0].disconnected,true);assert.equal(context.destinations[0].stream.getTracks()[0].stopped,true);assert.equal(context.closed,true);assert.equal(original.getTracks()[0].stopped,undefined);
});

test('a boost engine failure preserves normal audio and reports the failure once',async()=>{
  const app=harness({resumeError:'Audio device unavailable'}),audio=new Element('audio'),reports=[];
  audio.srcObject=new Stream([new Track('remote')]);const original=audio.srcObject;
  app.api.registerRoom({report:message=>reports.push(message)});await app.api.registerPlayback(audio,()=>4);await tick();
  assert.equal(audio.srcObject,original);assert.equal(audio.volume,1);assert.equal(audio.muted,false);assert.match(reports[0],/boost.*Audio device unavailable/i);
  app.api.refreshPlayback();await tick();assert.equal(reports.length,1);assert.equal(app.contexts[0].closed,true);
});

test('replacing a boosted remote track disposes the old graph without stopping the incoming track',async()=>{
  const app=harness(),audio=new Element('audio');audio.srcObject=new Stream([new Track('old')]);
  await app.api.registerPlayback(audio,()=>3);await tick();const old=app.contexts[0];
  const replacement=new Stream([new Track('new')]);audio.srcObject=replacement;await app.api.registerPlayback(audio,()=>2);await tick();
  assert.equal(old.sources[0].disconnected,true);assert.equal(old.destinations[0].stream.getTracks()[0].stopped,true);assert.equal(replacement.getTracks()[0].stopped,undefined);
  app.api.dispose();assert.equal(audio.muted,true);assert.equal(audio.srcObject,null);assert.ok(app.contexts.every(context=>context.closed));
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
  const app=harness(options),diagnostics=[],sockets=[],connections=[],ownId='a'.repeat(43),peerId='b'.repeat(43),room=ownId+'_'+'c'.repeat(48);
  app.sandbox.VumiroDiagnostics={record:(event,details)=>diagnostics.push({event,details})};
  class Socket {static OPEN=1;constructor(){this.readyState=1;sockets.push(this);}send(){}close(){}}
  class Connection {
    constructor(){this.connectionState='connected';this.transceivers=[];connections.push(this);}
    addTransceiver(kind){const value={receiver:{},sender:{track:typeof kind==='string'?null:kind,replaceTrack:async track=>{if(this.failReplacement){this.failReplacement=false;throw Error('Replace rejected');}value.sender.track=track;},getParameters:()=>({}),setParameters:async()=>{}},direction:'sendrecv'};this.transceivers.push(value);return value;}
    getTransceivers(){return this.transceivers;}
    createDataChannel(){return {readyState:'connecting',close(){}};}
    close(){this.connectionState='closed';}
  }
  Object.assign(app.sandbox,{location:new URL('/call.html?autojoin=1&embedded=1&room='+room+'&mode=public&signaling='+encodeURIComponent('wss://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling'),'https://vumiro.local'),VumiroLocalProfile:{initialize:async()=>({id:ownId,key:'public-key',name:'Host'}),profile:()=>({name:'Host'}),listFriends:async()=>[],listBlocked:async()=>[],sign:async()=>''},RTCPeerConnection:Connection,WebSocket:Socket,parent:{location:new URL('https://vumiro.local/friends.html'),VumiroAccount:{getState:()=>({signedIn:true})},postMessage(){}},history:{replaceState(){}}});
  vm.runInContext(callSource,app.sandbox);await tick();assert.equal(sockets.length,1);await sockets[0].onmessage({data:JSON.stringify({type:'welcome',id:ownId,peers:[{id:peerId,name:'Guest'}],policy:{mode:'public'}})});
  return {...app,connection:connections[0],diagnostics};
}

test('failed screen capture records the error class and audio configuration without private error text',async()=>{
  const app=await callHarness();app.sandbox.navigator.mediaDevices.getDisplayMedia=async()=>{throw Object.assign(Error('private device path'),{name:'NotReadableError'});};
  await app.element('share').onclick();const failed=app.diagnostics.find(row=>row.event==='capture-error');assert.ok(failed);assert.equal(failed.details.name,'NotReadableError');
  assert.equal(app.diagnostics.find(row=>row.event==='capture-requested').details.audio,true);assert.doesNotMatch(JSON.stringify(app.diagnostics),/private device path|bbbbbbbb|cccccccc/);
});

test('peer failures record transport states without identities or session descriptions',async()=>{
  const app=await callHarness();app.connection.connectionState='failed';app.connection.iceConnectionState='disconnected';app.connection.signalingState='stable';app.connection.onconnectionstatechange();
  const failed=app.diagnostics.find(row=>row.event==='peer-state');assert.ok(failed);assert.equal(failed.details.connectionState,'failed');assert.equal(failed.details.iceConnectionState,'disconnected');assert.equal(failed.details.signalingState,'stable');
  assert.doesNotMatch(JSON.stringify(failed),/bbbbbbbb|cccccccc|sdp|candidate/);
});

test('unsupported Discord exclusion remains visible with an explanation',async()=>{
  const app=await callHarness();assert.equal(app.element('settingExcludeDiscordLabel').hidden,false);assert.equal(app.element('settingExcludeDiscord').disabled,true);
  assert.equal(app.element('excludeDiscordHelp').hidden,false);assert.match(app.element('roomAudioCapability').textContent,/Windows|Linux|native/i);
});

test('native audio graph accepts the hardware rate instead of requiring a 48 kHz output device',async()=>{
  let options;const destination={stream:new Stream([new Track('native-output')])};
  class DeviceContext {constructor(value){options=value;this.state='running';this.sampleRate=44100;}createMediaStreamDestination(){return destination;}}
  const start=callSource.indexOf('  async function ensureNativeAudioGraph()'),end=callSource.indexOf('  function stopNativeAudioCapture',start);
  const context={window:{AudioContext:DeviceContext},audioContext:null,audioDestination:null,nativeAudioTrack:null};vm.createContext(context);
  vm.runInContext(callSource.slice(start,end),context);await context.ensureNativeAudioGraph();
  assert.equal(options.sampleRate,undefined);assert.equal(context.audioContext.sampleRate,44100);assert.equal(context.nativeAudioTrack,destination.stream.getAudioTracks()[0]);
});

test('participant Screen and Voice controls independently reach 400 percent',async()=>{
  const app=await callHarness(),nodes=descendants(app.element('tiles')),sliders=nodes.filter(node=>node.tagName==='input'&&node.attributes['aria-label']?.includes('volume for Guest'));
  assert.equal(sliders.length,2);for(const slider of sliders)assert.equal(slider.max,'400');
  app.connection.ontrack({track:new Track('screen'),transceiver:app.connection.transceivers[1],receiver:{}});
  app.connection.ontrack({track:new Track('voice'),transceiver:app.connection.transceivers[2],receiver:{}});await tick();
  sliders[0].value='350';sliders[0].oninput();await tick();assert.equal(sliders[0].value,'350');assert.equal(sliders[1].value,'100');
  assert.equal(app.contexts[0].gains[0].gain.value,3.5);
});

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
