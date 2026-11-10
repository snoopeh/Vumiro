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
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.value='';this.hidden=false;this.disabled=false;this.classes=new Set();this.listeners={};this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),toggle:name=>this.classes.has(name)?this.classes.delete(name):this.classes.add(name)};}
    append(...values){this.children.push(...values);for(const value of values)if(value&&typeof value==='object')value.parentElement=this;}
    replaceChildren(...values){this.children=values;}
    addEventListener(name,handler){this.listeners[name]=handler;}
    insertBefore(value,before){const at=this.children.indexOf(before);this.children.splice(at<0?0:at,0,value);}
    setAttribute(name,value){this[name]=value;}
    removeAttribute(name){delete this[name];}
    querySelector(){return this.children[0];}
    scrollIntoView(){this.scrolled=true;}
    focus(){this.focused=true;}
    remove(){this.removed=true;}
  }
  const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const app={window:{},$,Element,elements,lines,peers,revoked,timers,joined:true,joining:false,disconnected:false,identity:{id:'A'.repeat(43),key:'local-key',name:'Me'},profileCache:new Map(),local:{sign:async text=>signature(text),verify:async (author,text,sig)=>sig===signature(text),validateContact:async author=>{if(author.key!=='key:'+author.id)throw Error('key mismatch');return author;}},chatLine:(...args)=>{lines.push(args);const row=new Element('li');row.children=[new Element('div')];$('chatLog').append(row);return row;},document:{hidden:false,createElement:tag=>new Element(tag)},URL:{createObjectURL:()=> 'blob:accepted',revokeObjectURL:url=>revoked.push(url)},Blob,Uint8Array,ArrayBuffer,TextEncoder,encoder:new TextEncoder(),crypto:webcrypto,serverNow:()=>Date.now(),Date,setTimeout:(callback,delay)=>{const id=timers.size+1;timers.set(id,{callback,delay});return id;},clearTimeout:id=>timers.delete(id),btoa,atob,playCallCue(){},chatSending:false};
  vm.createContext(app);
  vm.runInContext(source.slice(source.indexOf('  const seenMessages='),source.indexOf('  function renderChatText('))+source.slice(source.indexOf('  const openChannels='),source.indexOf('  function cleanProfile(')),app);
  return app;
}
function uiHarness(){const app=harness();app.avatarElement=()=>new app.Element('img');app.renderChatText=(target,value)=>{target.textContent=value;};vm.runInContext(source.slice(source.indexOf('  function chatLine('),source.indexOf('  const openChannels=')),app);return app;}
function descendants(element){return [element,...element.children.flatMap(descendants)];}
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

test('fresh verified incoming messages notify even while focused on chat; self, history and replay stay quiet',async()=>{
  const app=harness(),posts=[];app.setChatRoom('room-one');const sender=peer(app);
  app.embedded=true;app.parentMessage=value=>posts.push(value);app.document.hasFocus=()=>true;app.document.hidden=false;app.$('chatView').hidden=false;app.roomValue=()=> 'raw-room';
  const message=envelope(app);await app.acceptRoomChat(sender,message);
  assert.equal(posts.length,1);assert.equal(posts[0].type,'vumiro-chat-notification');assert.equal(posts[0].sender.name,'Friend');assert.equal(posts[0].text,message.text);
  assert.equal(posts[0].room,'raw-room');
  await app.acceptRoomChat(sender,message);assert.equal(posts.length,1);
  await app.acceptRoomChat(sender,envelope(app,{id:'h'.repeat(32)}),true);assert.equal(posts.length,1);
  const invalid=envelope(app,{id:'i'.repeat(32)});invalid.text='tampered';await app.acceptRoomChat(sender,invalid);assert.equal(posts.length,1);
  const own=envelope(app,{id:'s'.repeat(32),author:{...app.identity}});await app.acceptRoomChat(sender,own);assert.equal(posts.length,1);
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
test('a separately signed reply reference survives verified room history',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),target=envelope(app,{id:'t'.repeat(32),text:'Original'});
  assert.equal(await app.acceptRoomChat(p,target,true),true);
  const reply=envelope(app,{id:'r'.repeat(32),text:'Answer',replyTo:{authorId:target.author.id,id:target.id}});
  reply.replySignature=signature(app.chatReplySignatureText(reply));
  assert.equal(await app.acceptRoomChat(p,reply,true),true);
  const stored=vm.runInContext('chatHistory',app).find(item=>item.id===reply.id);
  assert.equal(stored.replyTo.id,target.id);assert.equal(stored.replySignature,reply.replySignature);
  p.sent.length=0;app.queueChatHistory(p);assert.equal(p.sent.find(item=>item.message?.id===reply.id).message.replyTo.id,target.id);
  assert.equal(signature(app.chatSignatureText(reply)),reply.signature,'older v2 clients can still verify the base text');
});
test('reply metadata cannot be forged, split, or retargeted without its own signature',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),target=envelope(app,{id:'t'.repeat(32)});
  await app.acceptRoomChat(p,target,true);
  const valid=envelope(app,{id:'r'.repeat(32),text:'Answer',replyTo:{authorId:target.author.id,id:target.id}});
  valid.replySignature=signature(app.chatReplySignatureText(valid));
  for(const patch of [
    {replyTo:{authorId:target.author.id,id:'x'.repeat(32)}},
    {replySignature:'invalid'},
    {replySignature:undefined},
    {replyTo:undefined},
    {replyTo:{authorId:'wrong',id:target.id}}
  ])assert.equal(await app.acceptRoomChat(p,{...valid,...patch},true),false);
  assert.equal(await app.acceptRoomChat(p,valid,true),true);
});
test('reply selection preserves the draft, signs the reference, and clears after send',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),target=envelope(app,{id:'t'.repeat(32),text:'Original text'});
  await app.acceptRoomChat(p,target,true);app.$('chatText').value='My draft';
  assert.equal(app.selectChatReply(target.author.id,target.id),true);
  assert.equal(app.$('chatText').value,'My draft');
  assert.equal(app.$('replyPreview').hidden,false);
  assert.match(app.$('replyExcerpt').textContent,/Original text/);
  await app.sendRoomChat({preventDefault(){}});
  const sent=vm.runInContext('chatHistory',app).find(item=>item.author.id===app.identity.id);
  assert.equal(sent.replyTo.id,target.id);
  assert.equal(sent.replySignature,signature(app.chatReplySignatureText(sent)));
  assert.equal(app.$('replyPreview').hidden,true);
  assert.equal(app.$('chatText').value,'');
});
test('cancel, room change, and history eviction clear reply selection without clearing draft',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),target=envelope(app,{id:'t'.repeat(32)});
  await app.acceptRoomChat(p,target,true);app.$('chatText').value='Keep me';
  app.selectChatReply(target.author.id,target.id);app.clearChatReply();assert.equal(app.$('replyPreview').hidden,true);assert.equal(app.$('chatText').value,'Keep me');
  app.selectChatReply(target.author.id,target.id);app.setChatRoom('room-two');assert.equal(app.$('replyPreview').hidden,true);
  app.setChatRoom('room-one');await app.acceptRoomChat(p,target,true);app.selectChatReply(target.author.id,target.id);
  for(let i=0;i<101;i++)await app.acceptRoomChat(p,envelope(app,{id:String(i).padStart(32,'0'),timestamp:Date.now()+i}),true);
  assert.equal(app.$('replyPreview').hidden,true);
});
test('verified text rows offer Reply and a one-level citation to a retained original',async()=>{
  const app=uiHarness();app.setChatRoom('room-one');const p=peer(app),target=envelope(app,{id:'t'.repeat(32),text:'Original text'});
  await app.acceptRoomChat(p,target,true);
  const row=app.$('chatLog').children[0],button=descendants(row).find(item=>item.className==='chat-reply-action');
  assert.ok(button);assert.equal(button.textContent,'Reply');assert.equal(row.draggable,true);
  button.onclick();assert.equal(app.$('replyPreview').hidden,false);
  const reply=envelope(app,{id:'r'.repeat(32),text:'Answer',replyTo:{authorId:target.author.id,id:target.id}});reply.replySignature=signature(app.chatReplySignatureText(reply));
  await app.acceptRoomChat(p,reply,true);
  const citation=descendants(app.$('chatLog').children[1]).find(item=>item.className==='chat-reply-citation');
  assert.ok(citation);assert.match(citation.textContent,/Friend.*Original text/);citation.onclick();assert.equal(row.scrolled,true);
});
test('unavailable reply citations use neutral text and evicted messages lose Reply',async()=>{
  const app=uiHarness();app.setChatRoom('room-one');const p=peer(app);
  const orphan=envelope(app,{id:'r'.repeat(32),replyTo:{authorId:'C'.repeat(43),id:'missing'.padEnd(16,'x')}});orphan.replySignature=signature(app.chatReplySignatureText(orphan));
  await app.acceptRoomChat(p,orphan,true);
  const citation=descendants(app.$('chatLog').children[0]).find(item=>item.className==='chat-reply-citation');
  assert.equal(citation.textContent,'Original message unavailable');
  const first=envelope(app,{id:'f'.repeat(32),text:'First'});await app.acceptRoomChat(p,first,true);
  const row=app.$('chatLog').children[1],button=descendants(row).find(item=>item.className==='chat-reply-action');
  for(let i=0;i<101;i++)await app.acceptRoomChat(p,envelope(app,{id:String(i).padStart(32,'0'),timestamp:Date.now()+i}),true);
  assert.equal(button.disabled,true);assert.equal(row.draggable,false);
});
test('dragging a verified row onto the composer selects that reply without changing draft text',async()=>{
  const app=uiHarness();app.setChatRoom('room-one');const p=peer(app),target=envelope(app,{id:'t'.repeat(32)});
  await app.acceptRoomChat(p,target,true);app.$('chatText').value='Keep draft';app.bindChatReplyDrag();
  const row=app.$('chatLog').children[0],payload=new Map(),transfer={types:[],setData:(type,value)=>payload.set(type,value),getData:type=>payload.get(type)||'',effectAllowed:'',dropEffect:''};
  app.$('chatLog').listeners.dragstart({target:row,dataTransfer:transfer,preventDefault(){throw Error('valid drag cancelled');}});
  assert.ok(payload.get('application/x-vumiro-room-reply'));assert.equal(payload.get('text/plain'),undefined);
  let prevented=false;app.$('chatForm').listeners.dragover({dataTransfer:transfer,preventDefault(){prevented=true;}});assert.equal(prevented,true);
  app.$('chatForm').listeners.drop({dataTransfer:transfer,preventDefault(){}});
  assert.equal(app.$('replyPreview').hidden,false);assert.equal(app.$('chatText').value,'Keep draft');
});
test('outside, interactive, and selected-text drags leave the current reply alone',async()=>{
  const app=uiHarness();app.setChatRoom('room-one');const p=peer(app),first=envelope(app,{id:'f'.repeat(32)}),second=envelope(app,{id:'s'.repeat(32)});
  await app.acceptRoomChat(p,first,true);await app.acceptRoomChat(p,second,true);app.selectChatReply(first.author.id,first.id);app.bindChatReplyDrag();
  const row=app.$('chatLog').children[1],button=descendants(row).find(item=>item.className==='chat-reply-action'),payload=new Map(),transfer={types:[],setData:(type,value)=>payload.set(type,value),getData:type=>payload.get(type)||''};
  let cancelled=0;app.$('chatLog').listeners.dragstart({target:button,dataTransfer:transfer,preventDefault(){cancelled++;}});assert.equal(cancelled,1);
  app.window.getSelection=()=>({toString:()=> 'selected'});app.$('chatLog').listeners.dragstart({target:row,dataTransfer:transfer,preventDefault(){cancelled++;}});assert.equal(cancelled,2);
  app.window.getSelection=()=>({toString:()=> ''});app.$('chatLog').listeners.dragstart({target:row,dataTransfer:transfer,preventDefault(){cancelled++;}});
  app.$('chatLog').listeners.dragend({});assert.equal(app.$('replyAuthor').textContent,first.author.name);assert.equal(app.$('replyExcerpt').textContent,first.text);
  assert.equal(app.$('chatForm').classes.has('chat-reply-drop'),false);
});
test('reply preview announces its target and Escape cancels from any composer control',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),target=envelope(app,{id:'t'.repeat(32)});
  await app.acceptRoomChat(p,target,true);
  vm.runInContext(source.slice(source.indexOf('  function setupChatReplyComposer()'),source.indexOf('  setupChatReplyComposer();')),app);
  app.setupChatReplyComposer();for(const node of descendants(app.$('chatForm')))if(node.id)app.elements.set(node.id,node);
  app.bindChatReplyKeys();app.$('chatText').value='Keep draft';app.selectChatReply(target.author.id,target.id);
  assert.equal(app.$('replyPreview').role,'status');
  assert.match(app.$('chatText')['aria-describedby'],/replyAuthor.*replyExcerpt/);
  let prevented=false;app.$('chatView').listeners.keydown({key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(app.$('replyPreview').hidden,true);assert.equal(app.$('chatText').value,'Keep draft');
  assert.equal(app.$('chatText')['aria-describedby'],undefined);
});
test('a future chat version is not downgraded to unsigned legacy text',async()=>{
  const app=harness();app.setChatRoom('room-one');const p=peer(app),future=envelope(app,{version:3});
  assert.equal(await app.acceptRoomChat(p,future,false),false);
  assert.equal(app.lines.length,0);
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
