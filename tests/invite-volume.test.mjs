import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const ownId='a'.repeat(43),peerId='b'.repeat(43),room=ownId+'_'+'c'.repeat(48);

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.style={};this.className='';this.hidden=false;this.disabled=false;this.open=false;this.value='';this.volume=1;this.listeners=new Map();this.classList={toggle(){},add(){}};}
  append(...children){for(const child of children){this.children.push(child);child.parentElement=this;}}
  replaceChildren(...children){this.children=[];this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,callback){this.listeners.set(type,callback);}
  focus(){this.focused=true;}
  select(){this.selected=true;}
  showModal(){this.open=true;}
  close(){this.open=false;this.listeners.get('close')?.();}
  play(){this.played=(this.played||0)+1;return Promise.resolve();}
  querySelector(){return null;}
  get firstElementChild(){return this.children[0];}
}
class Stream {
  constructor(tracks){this.tracks=tracks;}
  getAudioTracks(){return this.tracks.filter(track=>track.kind==='audio');}
  getVideoTracks(){return this.tracks.filter(track=>track.kind==='video');}
  getTracks(){return this.tracks;}
}

function descendants(element){return [element,...element.children.flatMap(descendants)];}
async function harness({clipboard='success',origin='https://vumiro.local',mode='public'}={}){
  const elements=new Map(),sockets=[],connections=[],copied=[];
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  class Socket {
    static OPEN=1;
    constructor(){this.readyState=1;sockets.push(this);}
    close(){}
    send(){}
  }
  class PeerConnection {
    constructor(){this.connectionState='connected';this.transceivers=[];connections.push(this);}
    addTransceiver(kind){const value={receiver:{},sender:{track:typeof kind==='string'?null:kind,replaceTrack:async()=>{},getParameters:()=>({}),setParameters:async()=>{}},direction:'sendrecv'};this.transceivers.push(value);return value;}
    getTransceivers(){return this.transceivers;}
    createDataChannel(){return {readyState:'connecting',close(){}};}
    close(){this.connectionState='closed';}
  }
  const local={initialize:async()=>({id:ownId,key:'public-key',name:'Host'}),profile:()=>({name:'Host'}),listFriends:async()=>[],listBlocked:async()=>[],sign:async()=>''};
  const location=new URL('/call?autojoin=1&room='+room+'&mode='+mode+'&signaling='+encodeURIComponent('wss://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling'),origin);
  const sandbox={window:{VumiroLocalProfile:local},document:{getElementById:element,body:new Element('body'),createElement:tag=>new Element(tag)},location,URL,URLSearchParams,TextEncoder,crypto:webcrypto,MediaStream:Stream,RTCPeerConnection:PeerConnection,WebSocket:Socket,
    navigator:{clipboard:{writeText:async value=>{if(clipboard==='failure')throw Error('Clipboard unavailable');copied.push(value);}}},
    parent:{location:new URL('/friends.html',origin),VumiroAccount:{getState:()=>({signedIn:true})},postMessage(){}},localStorage:{getItem:()=>null,setItem(){}},history:{replaceState(){}},addEventListener(){},setInterval(){},setTimeout,clearTimeout,console,btoa,atob};
  vm.runInNewContext(source,sandbox,{filename:'call-client.js'});
  // Profile initialization and automatic join each await one promise.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sockets.length,1);
  await sockets[0].onmessage({data:JSON.stringify({type:'welcome',id:ownId,peers:[{id:peerId,name:'Guest'}],policy:{mode}})});
  const remote=element('tiles').children[1];
  return {element,copied,remote,connection:connections[0],sockets};
}

test('Invite displays a public selectable link and confirms clipboard copy',async()=>{
  const app=await harness();app.element('copyInvite').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('inviteDialog').open,true);
  const url=new URL(app.element('inviteLink').value);
  assert.equal(url.origin,'https://vumiro-rooms.vumiro-signaling.workers.dev');
  assert.equal(url.searchParams.get('room'),room);
  assert.equal(url.searchParams.has('grant'),false);
  assert.equal(url.searchParams.has('embedded'),false);
  assert.equal(app.element('inviteLink').selected,true);
  assert.equal(app.copied[0],url.href);
  assert.equal(app.element('inviteCopyStatus').textContent,'Invitation link copied.');
});

test('Clipboard denial keeps the full invitation available with manual copy instructions',async()=>{
  const app=await harness({clipboard:'failure',mode:'friends'});app.element('copyInvite').onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.element('inviteDialog').open,true);
  assert.equal(app.element('inviteLink').selected,true);
  assert.match(app.element('inviteCopyStatus').textContent,/Ctrl\+C/);
  assert.match(app.element('inviteHint').textContent,/Only mutual friends/);
  assert.match(app.element('inviteHint').textContent,/Public or Private/);
});

test('Private invitation explains separate password sharing and closes when leaving',async()=>{
  const app=await harness({mode:'private'});app.element('copyInvite').onclick();
  assert.match(app.element('inviteHint').textContent,/password separately/);
  assert.equal(new URL(app.element('inviteLink').value).searchParams.has('password'),false);
  await app.element('leave').onclick();assert.equal(app.element('inviteDialog').open,false);
});

test('Screen and voice playback volumes control independent received tracks and survive replacement',async()=>{
  const app=await harness(),pc=app.connection;
  const controls=descendants(app.remote).find(node=>node.className==='audio-controls');
  assert.ok(controls);
  assert.equal(controls.parentElement.className,'stage','volume controls remain in the fullscreen element');
  const sliders=descendants(controls).filter(node=>node.type==='range');
  assert.equal(sliders.length,2);assert.ok(sliders.every(slider=>slider.disabled));
  const track=()=>({kind:'audio',muted:false,readyState:'live'}),screen=track(),voice=track();
  pc.ontrack({track:screen,transceiver:pc.getTransceivers()[1],receiver:{}});
  pc.ontrack({track:voice,transceiver:pc.getTransceivers()[2],receiver:{}});
  const audio=descendants(app.remote).filter(node=>node.tagName==='audio');
  assert.equal(audio.length,2);assert.ok(sliders.every(slider=>!slider.disabled));
  sliders[0].value='25';sliders[0].oninput();
  assert.equal(audio[0].volume,.25);assert.equal(audio[1].volume,1);
  sliders[1].value='0';sliders[1].oninput();
  assert.equal(audio[1].muted,true);assert.equal(audio[0].muted,false);
  const replacement=track();pc.ontrack({track:replacement,transceiver:pc.getTransceivers()[1],receiver:{}});
  assert.equal(descendants(app.remote).filter(node=>node.tagName==='audio').length,2,'replacement reuses the player instead of doubling audio');
  assert.equal(audio[0].volume,.25);assert.equal(audio[0].srcObject.getAudioTracks()[0],replacement);
  screen.readyState='ended';screen.onended();assert.equal(sliders[0].disabled,false,'an old track cannot disable its replacement');
  replacement.readyState='ended';replacement.onended();assert.equal(sliders[0].disabled,true);
  sliders[1].value='55';sliders[1].oninput();assert.equal(audio[1].muted,false);assert.equal(audio[1].volume,.55);
});
