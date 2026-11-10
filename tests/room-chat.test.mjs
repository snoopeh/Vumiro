import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const signature=text=>createHash('sha256').update(text).digest('hex');

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
function harness() {
  const elements=new Map(),lines=[],peers=new Map(),revoked=[],timers=new Map();
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.value='';this.hidden=false;this.disabled=false;}
    append(...values){this.children.push(...values);}
    replaceChildren(...values){this.children=values;}
    querySelector(){return this.children[0];}
    remove(){this.removed=true;}
  }
  const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const app={window:{},$,Element,elements,lines,peers,revoked,timers,joined:true,joining:false,disconnected:false,identity:{id:'A'.repeat(43),key:'local-key',name:'Me'},profileCache:new Map(),local:{sign:async text=>signature(text),verify:async (author,text,sig)=>sig===signature(text),validateContact:async author=>{if(author.key!=='key:'+author.id)throw Error('key mismatch');return author;}},chatLine:(...args)=>{lines.push(args);const row=new Element('li');row.children=[new Element('div')];$('chatLog').append(row);return row;},document:{hidden:false,createElement:tag=>new Element(tag)},URL:{createObjectURL:()=> 'blob:accepted',revokeObjectURL:url=>revoked.push(url)},Blob,Uint8Array,ArrayBuffer,TextEncoder,encoder:new TextEncoder(),crypto:webcrypto,serverNow:()=>Date.now(),Date,setTimeout:(callback,delay)=>{const id=timers.size+1;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),btoa,atob,playCallCue(){},chatSending:false};
  vm.createContext(app);
  vm.runInContext(source.slice(source.indexOf('  const seenMessages='),source.indexOf('  function renderChatText('))+source.slice(source.indexOf('  const openChannels='),source.indexOf('  function cleanProfile(')),app);
  return app;
}
function peer(app,id='B'.repeat(43)) {const sent=[],value={id,name:'Friend',pc:{connectionState:'connected'},channel:{readyState:'open',bufferedAmount:0,send:data=>sent.push(JSON.parse(data))},sent};app.peers.set(id,value);return value;}
function envelope(app,patch={}) {const value={type:'chat',version:2,room:'room-one',id:'m'.repeat(32),text:'Before you arrived',timestamp:Date.now(),author:{id:'B'.repeat(43),name:'Friend',key:'key:'+'B'.repeat(43)},...patch};value.signature=signature(app.chatSignatureText(value));return value;}
function connectApps(first,second) {
  for(const app of [first,second]){app.announce=()=>{};app.announceProfile=()=>{};app.receiveProfile=()=>{};vm.runInContext(source.slice(source.indexOf('  function dataChannel('),source.indexOf('  function peerError(')),app);}
  const a=peer(first,second.identity.id),b=peer(second,first.identity.id),aChannel={readyState:'open',bufferedAmount:0},bChannel={readyState:'open',bufferedAmount:0};a.channel=null;b.channel=null;
  aChannel.send=value=>bChannel.onmessage({data:value});bChannel.send=value=>aChannel.onmessage({data:value});first.dataChannel(a,aChannel);second.dataChannel(b,bChannel);aChannel.onopen();bChannel.onopen();return [a,b];
}

test('room text composer stays usable without peers and through signaling recovery',()=>{
  const app=harness();app.chatControls();assert.equal(app.$('chatText').disabled,false);assert.equal(app.$('chatSend').disabled,false);assert.equal(app.$('chatAttach').disabled,false);
  app.setChatRoom('room-one');app.joined=false;app.disconnected=true;app.chatControls();assert.equal(app.$('chatText').disabled,false);
});
test('sending alone stores a signed message and syncs it when a participant connects',async()=>{
  const app=harness();assert.equal(typeof app.setChatRoom,'function');app.setChatRoom('room-one');
  app.$('chatText').value='Hello future friends';await app.sendRoomChat({preventDefault(){}});
  assert.equal(app.lines.length,1);assert.equal(app.$('chatText').value,'');
  const p=peer(app);app.queueChatHistory(p);assert.equal(p.sent.length,1);assert.equal(p.sent[0].type,'chat-history');assert.equal(p.sent[0].message.text,'Hello future friends');
});
test('signed history retains original attribution and rejects tampering, duplicates and other rooms',async()=>{
  const app=harness();assert.equal(typeof app.acceptRoomChat,'function');app.setChatRoom('room-one');const p=peer(app,'C'.repeat(43)),message=envelope(app);
  assert.equal(await app.acceptRoomChat(p,message,true),true);assert.equal(app.lines[0][1],message.author.id);
  assert.equal(await app.acceptRoomChat(p,message,true),false);
  assert.equal(await app.acceptRoomChat(p,{...message,id:'n'.repeat(32),text:'forged'},true),false);
  assert.equal(await app.acceptRoomChat(p,envelope(app,{room:'old-room',id:'o'.repeat(32)}),true),false);
  assert.equal(await app.acceptRoomChat(p,envelope(app,{id:'p'.repeat(32),author:{...message.author,key:'wrong'}}),true),false);
  assert.equal(app.lines.length,1);
});
test('recent history is bounded, pauses on backpressure, and clears on a new room or leave',async()=>{
  const app=harness();assert.equal(typeof app.acceptRoomChat,'function');app.setChatRoom('room-one');const p=peer(app);
  for(let i=0;i<110;i++)await app.acceptRoomChat(p,envelope(app,{id:String(i).padStart(32,'0')}),false);
  p.channel.bufferedAmount=131072;app.queueChatHistory(p);assert.equal(p.sent.length,0);p.channel.bufferedAmount=0;app.flushChatHistory(p);assert.equal(p.sent.length,100);
  app.setChatRoom('room-two');p.sent.length=0;app.queueChatHistory(p);assert.equal(p.sent.length,0);
  app.setChatRoom('');assert.equal(app.$('chatLog').children.length,0);
});
test('file offers validate bounds and require a user request before chunks are accepted',async()=>{
  const app=harness();assert.equal(typeof app.receiveChatFile,'function');app.setChatRoom('room-one');const p=peer(app),id='f'.repeat(32);
  assert.equal(app.receiveChatFile(p,{type:'file-offer',id,name:'huge',size:10485761}),false);
  assert.equal(app.receiveChatFile(p,{type:'file-offer',id,name:'<img onerror=bad>.txt',size:3}),true);
  assert.equal(p.sent.length,0);assert.equal(app.receiveChatFile(p,{type:'file-chunk',id,index:0,data:'YWJj'}),false);
  const button=app.$('chatLog').children.at(-1).children[0].children.at(-1);assert.match(button.textContent,/<img onerror=bad>/);button.onclick();
  assert.equal(p.sent.at(-1).type,'file-request');assert.equal(app.receiveChatFile(p,{type:'file-chunk',id,index:0,data:'YWJj'}),true);
  assert.equal(app.receiveChatFile(p,{type:'file-end',id}),true);assert.equal(button.href,'blob:accepted');assert.equal(button.download,'<img onerror=bad>.txt');
  app.setChatRoom('');assert.deepEqual(app.revoked,['blob:accepted']);
});
test('completed downloads and pending file receivers stay within a 20 MiB room budget',()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app);
  for(let i=0;i<3;i++){
    app.receiveChatFile(p,{type:'file-offer',id:String(i).padStart(32,'f'),name:'file.txt',size:10485760});
    const button=app.$('chatLog').children.at(-1).children[0].children.at(-1);button.onclick();
    if(i<2){const files=vm.runInContext('[...receivedChatFiles.values()]',app);files.at(-1).active=false;files.at(-1).url='blob:complete-'+i;}
  }
  assert.equal(p.sent.filter(item=>item.type==='file-request').length,2);
});
test('history signatures use the real P-256 verifier and bind room, author, time and body',async()=>{
  const app=harness();app.setChatRoom('room-one');const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const key=Buffer.from(await webcrypto.subtle.exportKey('spki',keys.publicKey)).toString('base64url'),id=Buffer.from(await webcrypto.subtle.digest('SHA-256',Buffer.from(key,'base64url'))).toString('base64url');
  app.local.validateContact=async author=>{assert.equal(author.id,id);assert.equal(author.key,key);return author;};
  app.local.verify=async (author,text,sig)=>webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},keys.publicKey,Buffer.from(sig,'base64url'),new TextEncoder().encode(text));
  const p=peer(app),message=envelope(app,{author:{id,key,name:'Verified author'}});
  message.signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(app.chatSignatureText(message)))).toString('base64url');
  assert.equal(await app.acceptRoomChat(p,{...message,text:'tampered'},true),false);assert.equal(await app.acceptRoomChat(p,message,true),true);
  assert.equal(app.lines[0][1],id);
});
test('a busy connection catches up a new live message after its initial history budget',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app);p.channel.bufferedAmount=131072;app.$('chatText').value='Live catch-up';await app.sendRoomChat({preventDefault(){}});
  p.channel.bufferedAmount=0;app.flushChatHistory(p);assert.equal(p.sent.length,1);assert.equal(p.sent[0].type,'chat');assert.equal(p.sent[0].text,'Live catch-up');
});
test('idle incoming transfers time out and release their bounded buffers',()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),id='t'.repeat(32);app.receiveChatFile(p,{type:'file-offer',id,name:'small.txt',size:3});
  const button=app.$('chatLog').children.at(-1).children[0].children.at(-1);button.onclick();app.receiveChatFile(p,{type:'file-chunk',id,index:0,data:'YQ=='});
  [...app.timers.values()][0].callback();assert.match(button.textContent,/timed out/);assert.equal(app.receiveChatFile(p,{type:'file-end',id}),false);
});
test('two real room channel handlers exchange late-join history and a requested file',async()=>{
  const sender=harness(),receiver=harness();sender.identity.key='key:'+sender.identity.id;receiver.identity={id:'C'.repeat(43),key:'key:'+'C'.repeat(43),name:'New arrival'};
  sender.setChatRoom('room-one');receiver.setChatRoom('room-one');sender.$('chatText').value='Before you arrived';await sender.sendRoomChat({preventDefault(){}});
  const [sendingPeer,receivingPeer]=connectApps(sender,receiver);await receivingPeer.chatQueue;assert.ok(receiver.lines.some(([text,id])=>text==='Before you arrived'&&id===sender.identity.id));
  const file=new Blob(['abc']);Object.defineProperty(file,'name',{value:'hello.txt'});sender.shareChatFile(file);
  const button=receiver.$('chatLog').children.at(-1).children[0].children.at(-1);assert.match(button.textContent,/Receive hello.txt/);button.onclick();
  for(let i=0;i<20&&sendingPeer.fileSending;i++)await new Promise(setImmediate);
  assert.equal(button.download,'hello.txt');assert.equal(button.href,'blob:accepted');assert.equal(sendingPeer.fileSending,false);
});
test('a busy channel retries the final file marker so a completed file does not remain stuck receiving',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),original=app.channelSend;let endings=0;
  app.setTimeout=callback=>setImmediate(callback);
  app.channelSend=(target,message)=>message.type==='file-end'&&++endings===1?false:original(target,message);
  await app.sendChatFile(p,{id:'z'.repeat(32),file:new Blob(['abc'])});
  assert.equal(endings,2);assert.equal(p.sent.at(-1).type,'file-end');assert.equal(p.fileSending,false);
});
test('two room transports recover a staged file offer after disconnect and reconnect',async()=>{
  const sender=harness(),receiver=harness();receiver.identity={id:'C'.repeat(43),key:'key:'+'C'.repeat(43),name:'Friend'};sender.setChatRoom('room-one');receiver.setChatRoom('room-one');
  const file=new Blob(['after reconnect']);Object.defineProperty(file,'name',{value:'recover.txt'});await sender.shareChatFile(file);
  const [firstSenderPeer,firstReceiverPeer]=connectApps(sender,receiver);const firstButton=receiver.$('chatLog').children.find(row=>row.children[0].children.some(node=>node.className==='chat-file')).children[0].children.at(-1);
  assert.match(firstButton.textContent,/Receive recover.txt/);sender.clearPeerChat(firstSenderPeer);receiver.clearPeerChat(firstReceiverPeer);
  const [newSenderPeer]=connectApps(sender,receiver);const buttons=receiver.$('chatLog').children.flatMap(row=>row.children[0].children.filter(node=>node.className==='chat-file'));assert.equal(buttons.length,2);const button=buttons.at(-1);button.onclick();
  for(let i=0;i<20&&newSenderPeer.fileSending;i++)await new Promise(setImmediate);assert.equal(button.download,'recover.txt');assert.equal(button.href,'blob:accepted');assert.equal(firstButton.onclick,null);
});
