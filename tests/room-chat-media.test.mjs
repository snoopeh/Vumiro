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
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.classList={add(){}};this.textContent='';}
    append(...values){for(const value of values){if(value&&typeof value==='object')value.parentNode=this;this.children.push(value);}}
    replaceChildren(...values){this.children=[];this.append(...values);}
    querySelector(){return this.children[0];}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(item=>item!==this);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(){}
  }
  const elements=new Map(),revoked=[],created=[],$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  class BrowserURL extends URL {static createObjectURL(blob){created.push(blob);return 'blob:'+created.length;}static revokeObjectURL(url){revoked.push(url);}}
  const app={$,elements,created,revoked,peers:new Map(),identity:{id:'A'.repeat(43)},joined:true,disconnected:false,document:{createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},URL:BrowserURL,Blob,Uint8Array,ArrayBuffer,TextEncoder,encoder:new TextEncoder(),crypto:webcrypto,Date,setTimeout:()=>1,clearTimeout(){},btoa,atob,serverNow:()=>Date.now(),chatLine(text,sender){const row=new Element('li'),body=new Element();body.textContent=text;row.append(body);$('chatLog').append(row);return row;}};
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
test('HTTPS link cards expose no query tokens and load remote raster thumbnails only on request',()=>{
  const app=harness(),target=app.document.createElement('div');app.renderChatText(target,'Look https://example.com/animation.gif?secret=abc#token');
  assert.equal(all(target,'img').length,0);const buttons=all(target,'button');assert.equal(buttons.length,1);buttons[0].onclick();
  const image=all(target,'img')[0];assert.equal(image.referrerPolicy,'no-referrer');assert.equal(image.src,'https://example.com/animation.gif?secret=abc#token');
  assert.match(all(target,'a')[0].textContent,/example.com\/animation.gif/);assert.doesNotMatch(all(target,'a')[0].textContent,/secret|token/);
});
test('private, credential and active content URLs never gain previews',()=>{
  const app=harness(),target=app.document.createElement('div');app.renderChatText(target,'https://localhost/a.png https://localhost./a.png https://foo.local./a.png https://127.0.0.1/a.gif https://192.168.0.3/a.png https://name:secret@example.com/a.jpg https://example.com/a.svg https://example.com/a.html');
  assert.equal(all(target,'img').length,0);assert.equal(all(target,'button').length,0);
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
  await new Promise(setImmediate);assert.equal(prevented,2);assert.equal(all(app.$('chatLog'),'img').length,2);
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
