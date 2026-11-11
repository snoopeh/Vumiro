import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDQAAAABJRU5ErkJggg==','base64');
const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
function harness(){
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.value='';this.classList={add(){},remove(){}};this.textContent='';}
    append(...values){for(const value of values){if(value&&typeof value==='object')value.parentNode=this;this.children.push(value);}}
    replaceChildren(...values){this.children=[];this.append(...values);}
    querySelector(){return this.children[0];}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(item=>item!==this);}
    setAttribute(name,value){this[name]=value;}
    removeAttribute(name){delete this[name];}
    focus(){}
    addEventListener(){}
  }
  const elements=new Map(),revoked=[],created=[],$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  class BrowserURL extends URL {static createObjectURL(blob){created.push(blob);return 'blob:'+created.length;}static revokeObjectURL(url){revoked.push(url);}}
  const app={$,elements,created,revoked,peers:new Map(),identity:{id:'A'.repeat(43),key:'local-key',name:'Me'},local:{sign:async()=> 'signed'},joined:true,disconnected:false,document:{createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},URL:BrowserURL,Blob,Uint8Array,ArrayBuffer,TextEncoder,encoder:new TextEncoder(),crypto:webcrypto,Date,setTimeout:()=>1,clearTimeout(){},btoa,atob,serverNow:()=>Date.now(),chatLine(text,sender){const row=new Element('li'),body=new Element();body.textContent=text;row.append(body);$('chatLog').append(row);return row;}};
  vm.createContext(app);
  vm.runInContext(source.slice(source.indexOf('  const seenMessages='),source.indexOf('  let callSoundsEnabled='))+source.slice(source.indexOf('  const openChannels='),source.indexOf('  function cleanProfile(')),app);
  app.setChatRoom('test-room');return app;
}
function file(bytes,name){const value=new Blob([bytes]);Object.defineProperty(value,'name',{value:name});return value;}
function peer(app){const sent=[],value={id:'B'.repeat(43),pc:{connectionState:'connected'},channel:{readyState:'open',bufferedAmount:0,send:data=>sent.push(JSON.parse(data))},sent};app.peers.set(value.id,value);return value;}
function all(node,tag){return (node.children||[]).flatMap(child=>typeof child==='object'?[...(child.tagName===tag?[child]:[]),...all(child,tag)]:[]);}

test('paperclip selections stage while alone, preview real PNG and offer to late joiners only once',async()=>{
  const app=harness();await app.shareChatFile(file(png,'picture.png'));
  assert.match(app.$('chatStatus').textContent,/join|connect|waiting/i);
  assert.equal(all(app.$('chatLog'),'img').length,1);assert.equal(app.created[0].type,'image/png');
  const p=peer(app);app.queueChatHistory(p);app.flushChatHistory(p);
  assert.equal(p.sent.filter(message=>message.type==='file-offer').length,1);
  app.setChatRoom('other-room');app.queueChatHistory(p);assert.equal(p.sent.length,1);assert.deepEqual(app.revoked,['blob:1']);
});
test('raster magic identifies GIF bytes without flattening and rejects disguised SVG',async()=>{
  const app=harness();await app.shareChatFile(file(gif,'dance.gif'));await app.shareChatFile(file('<svg onload="alert(1)"/>','fake.png'));
  assert.equal(all(app.$('chatLog'),'img').length,1);assert.equal(app.created[0].type,'image/gif');
  assert.deepEqual(Buffer.from(await app.created[0].arrayBuffer()),gif);
});
test('incoming images stay private until Receive and keep a separate download link',()=>{
  const app=harness(),p=peer(app),id='f'.repeat(32);app.receiveChatFile(p,{type:'file-offer',id,name:'picture.png',size:png.length});
  assert.equal(all(app.$('chatLog'),'img').length,0);
  const button=all(app.$('chatLog'),'a')[0];button.onclick();
  app.receiveChatFile(p,{type:'file-chunk',id,index:0,data:png.toString('base64')});app.receiveChatFile(p,{type:'file-end',id});
  assert.equal(all(app.$('chatLog'),'img').length,1);assert.equal(button.download,'picture.png');assert.equal(app.created[0].type,'image/png');
  app.setChatRoom('');assert.deepEqual(app.revoked,['blob:1']);
});
test('local attachments share the bounded 20 MiB retained budget',async()=>{
  const app=harness();await app.shareChatFile(file(new Uint8Array(10*1024*1024),'one.bin'));await app.shareChatFile(file(new Uint8Array(10*1024*1024),'two.bin'));await app.shareChatFile(file('x','three.bin'));
  const p=peer(app);app.queueChatHistory(p);assert.equal(p.sent.filter(message=>message.type==='file-offer').length,2);assert.match(app.$('chatStatus').textContent,/20 MiB/);
});
test('room changes during local preview reads cannot leak the preview or offer',async()=>{
  const app=harness();let resolve;const value={name:'pending.png',size:png.length,slice:()=>({arrayBuffer:()=>new Promise(done=>{resolve=done;})})};
  const pending=app.shareChatFile(value);assert.equal(typeof resolve,'function');app.setChatRoom('another');resolve(png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength));await pending;
  assert.equal(all(app.$('chatLog'),'img').length,0);assert.equal(app.created.length,0);const p=peer(app);app.queueChatHistory(p);assert.equal(p.sent.length,0);
});
test('public raster links render inline automatically without load controls or visible URL text',()=>{
  const app=harness(),target=app.document.createElement('div');app.renderChatText(target,'Look https://example.com/animation.gif?secret=abc#token');
  assert.equal(all(target,'img').length,1);assert.equal(all(target,'button').length,0);
  const image=all(target,'img')[0];assert.equal(image.referrerPolicy,'no-referrer');assert.equal(image.src,'https://example.com/animation.gif?secret=abc#token');
  assert.equal(all(target,'a')[0].textContent,'');
});
test('private, credential and active content URLs never gain previews',()=>{
  const app=harness(),target=app.document.createElement('div');app.renderChatText(target,'https://localhost/a.png https://localhost./a.png https://foo.local./a.png https://127.0.0.1/a.gif https://192.168.0.3/a.png https://name:secret@example.com/a.jpg https://example.com/a.svg');
  assert.equal(all(target,'img').length,0);assert.equal(all(target,'button').length,0);
});

test('pasting a web GIF retains its animated source instead of the clipboard PNG still',async()=>{
  const app=harness(),input=app.$('chatText');input.value='Hello ';input.selectionStart=input.selectionEnd=6;app.bindChatMediaInputs(input);let prevented=false;
  input.onpaste({clipboardData:{items:[{kind:'file',getAsFile:()=>file(png,'image.png')}],getData:type=>type==='text/html'?'<img src="https://media.example.com/dance.gif?width=400&amp;height=300">':''},preventDefault(){prevented=true;}});
  await new Promise(setImmediate);assert.equal(prevented,true);assert.equal(input.value,'Hello ');assert.equal(app.created.length,0);assert.equal(all(app.$('chatLog'),'img').length,0);
  assert.equal(all(app.$('chatDrafts'),'img')[0].src,'https://media.example.com/dance.gif?width=400&height=300');
  const p=peer(app);await app.sendRoomChat({preventDefault(){}});assert.equal(p.sent[0].text,'Hello\nhttps://media.example.com/dance.gif?width=400&height=300');assert.equal(app.$('chatDrafts').hidden,true);
});

test('pasted private GIF URLs cannot replace safe image attachments',async()=>{
  const app=harness(),input=app.$('chatText');app.bindChatMediaInputs(input);
  input.onpaste({clipboardData:{items:[{kind:'file',getAsFile:()=>file(png,'image.png')}],getData:()=> 'https://127.0.0.1/private.gif'},preventDefault(){}});
  await new Promise(setImmediate);assert.equal(app.created[0].type,'image/png');
});

test('animated GIF bytes survive a full room send and receive with every frame',async()=>{
  const animated=Buffer.concat([gif.subarray(0,19),gif.subarray(19,-1),gif.subarray(19)]),sender=harness(),out=peer(sender);
  await sender.shareChatFile(file(animated,'animated.gif'));const offer=out.sent.find(message=>message.type==='file-offer'),receiver=harness(),incoming=peer(receiver);receiver.receiveChatFile(incoming,offer);all(receiver.$('chatLog'),'a')[0].onclick();
  sender.receiveChatFile(out,incoming.sent[0]);await new Promise(setImmediate);
  for(const message of out.sent.filter(message=>message.type!=='file-offer'))receiver.receiveChatFile(incoming,message);
  const blob=receiver.created[0];assert.equal(blob.type,'image/gif');assert.deepEqual(Buffer.from(await blob.arrayBuffer()),animated);assert.equal(all(receiver.$('chatLog'),'img')[0].src,'blob:1');
});

test('page previews load titles, descriptions and safe image metadata from the signaling service',async()=>{
  const app=harness(),target=app.document.createElement('div'),requests=[];app.signalUrl=()=>new URL('wss://signal.example.com/call-signaling?room=private');app.fetch=async(url,options)=>{requests.push({url:String(url),options});return {ok:true,json:async()=>({url:'https://github.com/example/project',title:'A useful project',description:'Project details',siteName:'GitHub',image:'https://images.example.com/cover.jpg'})};};
  app.renderChatText(target,'https://github.com/example/project');await new Promise(setImmediate);assert.equal(all(target,'button').length,0);
  assert.equal(requests.length,1);const request=new URL(requests[0].url);assert.equal(request.origin,'https://signal.example.com');assert.equal(request.pathname,'/api/link-preview');assert.equal(request.searchParams.get('url'),'https://github.com/example/project');assert.equal(request.searchParams.has('room'),false);assert.equal(requests[0].options.credentials,'omit');
  assert.equal(all(target,'strong').at(-1).textContent,'A useful project');assert.equal(all(target,'p').at(-1).textContent,'Project details');assert.equal(all(target,'img').at(-1).src,'https://images.example.com/cover.jpg');assert.equal(all(target,'a').at(-1).href,'https://github.com/example/project');
});

test('unavailable metadata leaves a plain link and malicious image metadata is ignored',async()=>{
  const app=harness(),target=app.document.createElement('div');app.signalUrl=()=>new URL('wss://signal.example.com/call-signaling');app.fetch=async()=>({ok:true,json:async()=>({title:'Title <script>',description:'Summary',siteName:'Site',image:'https://127.0.0.1/private.png'})});
  app.renderChatText(target,'https://example.com/story');await new Promise(setImmediate);assert.equal(all(target,'strong').at(-1)?.textContent,'Title <script>');assert.equal(all(target,'img').length,0);
  const fallback=app.document.createElement('div');app.fetch=async()=>({ok:false});app.renderChatText(fallback,'https://example.com/missing');await new Promise(setImmediate);assert.equal(all(fallback,'a').length,1);assert.equal(all(fallback,'a')[0].href,'https://example.com/missing');assert.equal(all(fallback,'strong').length,0);assert.equal(all(fallback,'button').length,0);
});
test('staged files are offered again to a reconnected participant and honor backpressure',async()=>{
  const app=harness();await app.shareChatFile(file('abc','hello.txt'));const p=peer(app);p.channel.bufferedAmount=131072;app.queueChatHistory(p);assert.equal(p.sent.length,0);
  p.channel.bufferedAmount=0;app.flushChatHistory(p);assert.equal(p.sent.length,1);app.clearPeerChat(p);app.queueChatHistory(p);assert.equal(p.sent.length,2);
});
test('a local preview read completed after its row is retired does not retain a detached object URL',async()=>{
  const app=harness();let resolve;const value={name:'pending.png',size:png.length,slice:()=>({arrayBuffer:()=>new Promise(done=>{resolve=done;})})};const pending=app.shareChatFile(value);
  app.releaseChatRow(app.$('chatLog').children[0]);resolve(png.buffer.slice(png.byteOffset,png.byteOffset+png.byteLength));await pending;assert.equal(app.created.length,0);
});
test('paste and drop accept files without swallowing ordinary text',async()=>{
  const app=harness(),input=app.$('chatText');app.bindChatMediaInputs(input);let prevented=0;
  input.onpaste({clipboardData:{items:[{kind:'file',getAsFile:()=>file(png,'paste.png')}]},preventDefault(){prevented++;}});
  input.ondrop({dataTransfer:{files:[file(gif,'drop.gif')]},preventDefault(){prevented++;}});
  input.onpaste({clipboardData:{items:[{kind:'string'}]},preventDefault(){prevented++;}});
  await new Promise(setImmediate);assert.equal(prevented,2);assert.equal(all(app.$('chatLog'),'img').length,0);assert.equal(all(app.$('chatDrafts'),'img').length,2);
});

test('pasted bytes remain removable drafts until Send and captions publish before their file offer',async()=>{
  const app=harness(),p=peer(app),input=app.$('chatText');app.bindChatMediaInputs(input);input.value='Caption';
  input.onpaste({clipboardData:{items:[{kind:'file',getAsFile:()=>file(gif,'dance.gif')}]},preventDefault(){}});await new Promise(setImmediate);
  assert.equal(p.sent.length,0);assert.equal(all(app.$('chatLog'),'img').length,0);assert.equal(app.created[0].type,'image/gif');assert.deepEqual(Buffer.from(await app.created[0].arrayBuffer()),gif);
  await app.sendRoomChat({preventDefault(){}});assert.deepEqual(p.sent.map(value=>value.type),['chat','file-offer']);assert.equal(p.sent[0].text,'Caption');assert.equal(app.$('chatDrafts').hidden,true);assert.equal(input.value,'');assert.equal(all(app.$('chatLog'),'img').length,1);assert.equal(app.created.length,1,'sending transfers the existing preview instead of retaining duplicate blobs');assert.deepEqual(app.revoked,[]);
  await app.stageChatFile(file(png,'remove.png'));all(app.$('chatDrafts'),'button')[0].onclick();assert.equal(app.$('chatDrafts').hidden,true);assert.equal(p.sent.length,2);
});

test('a failed signing keeps attachment previews and caption; successful retry clears only its own draft',async()=>{
  const app=harness(),p=peer(app);await app.stageChatFile(file(png,'picture.png'));app.$('chatText').value='Keep caption';app.local.sign=async()=>{throw Error('no key');};
  await app.sendRoomChat({preventDefault(){}});assert.equal(app.$('chatText').value,'Keep caption');assert.equal(all(app.$('chatDrafts'),'img').length,1);assert.equal(p.sent.length,0);
  let release;app.local.sign=()=>new Promise(done=>{release=done;});const sending=app.sendRoomChat({preventDefault(){}});await new Promise(setImmediate);
  assert.equal(app.$('chatText').value,'Keep caption');assert.equal(all(app.$('chatDrafts'),'img').length,1);const duplicate=app.sendRoomChat({preventDefault(){}});
  app.$('chatText').value='New draft';await app.stageChatFile(file(gif,'new.gif'));release('signed');await Promise.all([sending,duplicate]);
  assert.equal(app.$('chatText').value,'New draft');assert.equal(all(app.$('chatDrafts'),'img').length,1);assert.equal(p.sent.filter(value=>value.type==='file-offer').length,1);
});

test('binary-only drafts send on explicit submit and room changes cancel previews and pending reads',async()=>{
  const app=harness(),p=peer(app);await app.stageChatFile(file(gif,'dance.gif'));await app.sendRoomChat({preventDefault(){}});assert.equal(p.sent[0].type,'file-offer');assert.equal(app.$('chatDrafts').hidden,true);
  let release;const pending=app.stageChatFile({name:'pending.png',size:png.length,slice:()=>({arrayBuffer:()=>new Promise(done=>{release=done;})})});app.setChatRoom('new-room');release(png);await pending;
  assert.equal(app.$('chatDrafts').hidden,true);assert.equal(app.created.length,1);assert.equal(p.sent.length,1);
});

test('YouTube falls back to an automatic thumbnail when the metadata service is not deployed',async()=>{
  const app=harness(),target=app.document.createElement('div');app.signalUrl=()=>new URL('wss://signal.example.com/call-signaling');app.fetch=async()=>({ok:false});app.renderChatText(target,'https://youtu.be/dQw4w9WgXcQ');await new Promise(setImmediate);
  assert.equal(all(target,'img')[0].src,'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');assert.equal(all(target,'button').length,0);assert.equal(all(target,'strong').at(-1).textContent,'YouTube');
});

test('a pasted public image address becomes a draft, while plain text and private addresses keep normal paste',async()=>{
  const app=harness(),input=app.$('chatText');input.value='Caption';app.bindChatMediaInputs(input);let prevented=0;
  for(const text of ['https://images.example.com/animated.gif','ordinary text','https://127.0.0.1/private.gif'])input.onpaste({clipboardData:{items:[],getData:type=>type==='text/plain'?text:''},preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.equal(input.value,'Caption');assert.equal(all(app.$('chatDrafts'),'img')[0].src,'https://images.example.com/animated.gif');assert.equal(all(app.$('chatLog'),'img').length,0);
});

test('removing an attachment during signing cancels its send without discarding the caption',async()=>{
  const app=harness(),p=peer(app);await app.stageChatFile(file(gif,'cancel.gif'));app.$('chatText').value='Keep me';let release;app.local.sign=()=>new Promise(done=>{release=done;});const sending=app.sendRoomChat({preventDefault(){}});await new Promise(setImmediate);
  all(app.$('chatDrafts'),'button')[0].onclick();release('signed');await sending;assert.equal(p.sent.length,0);assert.equal(app.$('chatText').value,'Keep me');assert.equal(app.$('chatDrafts').hidden,true);
});

test('failed attachment reads keep the draft and prevent caption or file delivery',async()=>{
  const app=harness(),p=peer(app);await app.stageChatFile({name:'broken.png',size:3,slice:()=>({arrayBuffer:async()=>{throw Error('file unavailable');}})});app.$('chatText').value='Keep caption';await app.sendRoomChat({preventDefault(){}});
  assert.equal(p.sent.length,0);assert.equal(app.$('chatText').value,'Keep caption');assert.equal(all(app.$('chatDrafts'),'button').length,1);assert.match(app.$('chatStatus').textContent,/could not be read/);
});

test('draft bytes obey the room budget and removed previews release their object URLs',async()=>{
  const app=harness();await app.stageChatFile(file(gif,'one.gif'));await app.stageChatFile(file(new Uint8Array(10*1024*1024),'two.bin'));await app.stageChatFile(file(new Uint8Array(10*1024*1024),'three.bin'));
  assert.equal(all(app.$('chatDrafts'),'button').length,2);assert.match(app.$('chatStatus').textContent,/20 MiB/);app.clearChatDrafts();assert.deepEqual(app.revoked,['blob:1']);assert.equal(app.$('chatDrafts').hidden,true);
});

test('file budget changes before send preserve the attachment and caption without partial delivery',async()=>{
  const app=harness(),p=peer(app);await app.stageChatFile(file(gif,'dance.gif'));await app.shareChatFile(file(new Uint8Array(10*1024*1024),'one.bin'));await app.shareChatFile(file(new Uint8Array(10*1024*1024),'two.bin'));p.sent.length=0;app.$('chatText').value='Keep caption';
  await app.sendRoomChat({preventDefault(){}});assert.equal(p.sent.length,0);assert.equal(app.$('chatText').value,'Keep caption');assert.equal(all(app.$('chatDrafts'),'img').length,1);assert.match(app.$('chatStatus').textContent,/20 MiB/);
});

test('pending attachment bytes reserve space against incoming file downloads',async()=>{
  const app=harness(),p=peer(app),other={...p,id:'C'.repeat(43),sent:[]};other.channel={...p.channel,send:data=>other.sent.push(JSON.parse(data))};app.peers.set(other.id,other);await app.stageChatFile(file(new Uint8Array(10*1024*1024),'draft.bin'));app.receiveChatFile(p,{type:'file-offer',id:'a'.repeat(32),name:'incoming.bin',size:10*1024*1024});app.receiveChatFile(other,{type:'file-offer',id:'b'.repeat(32),name:'extra.bin',size:1});
  const buttons=all(app.$('chatLog'),'a');buttons[0].onclick();buttons[1].onclick();assert.equal(p.sent.length,1);assert.equal(other.sent.length,0);assert.match(app.$('chatStatus').textContent,/20 MiB/);
});
test('receiver accepts a fresh offer after the sender reconnects with the same staged file ID',()=>{
  const app=harness(),p=peer(app),offer={type:'file-offer',id:'r'.repeat(32),name:'resume.txt',size:3};app.receiveChatFile(p,offer);const old=all(app.$('chatLog'),'a').at(-1);old.onclick();app.clearPeerChat(p);
  const reconnected=peer(app);assert.equal(app.receiveChatFile(reconnected,offer),true);const button=all(app.$('chatLog'),'a').at(-1);button.onclick();assert.equal(reconnected.sent[0].type,'file-request');app.clearPeerChat(reconnected);
});
test('a second file from the same sender waits visibly until its first transfer finishes',()=>{
  const app=harness(),p=peer(app);for(const id of ['a','b'])app.receiveChatFile(p,{type:'file-offer',id:id.repeat(32),name:id+'.txt',size:3});const buttons=all(app.$('chatLog'),'a');buttons[0].onclick();buttons[1].onclick();
  assert.equal(p.sent.length,1);assert.match(app.$('chatStatus').textContent,/sender|finish|one file/i);assert.match(buttons[1].textContent,/Receive/);
  app.receiveChatFile(p,{type:'file-chunk',id:'a'.repeat(32),index:0,data:'YWJj'});app.receiveChatFile(p,{type:'file-end',id:'a'.repeat(32)});buttons[1].onclick();assert.equal(p.sent.length,2);app.clearPeerChat(p);
});
test('oversized raster dimensions are rejected before creating a preview object URL',async()=>{
  const app=harness(),large=Buffer.from(png);large.writeUInt32BE(100000,16);large.writeUInt32BE(100000,20);await app.shareChatFile(file(large,'huge.png'));
  assert.equal(app.created.length,0);const p=peer(app),id='g'.repeat(32);app.receiveChatFile(p,{type:'file-offer',id,name:'huge.png',size:large.length});all(app.$('chatLog'),'a').at(-1).onclick();app.receiveChatFile(p,{type:'file-chunk',id,index:0,data:large.toString('base64')});app.receiveChatFile(p,{type:'file-end',id});
  assert.equal(all(app.$('chatLog'),'img').length,0);assert.equal(app.created[0].type,'application/octet-stream');
});
