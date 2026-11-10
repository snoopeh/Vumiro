import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=new URL('../Vumiro.Client/WebServer/chat-scrollbar.js',import.meta.url);
const source=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
function target(){
  const listeners=new Map(),classes=new Set(),attributes=new Map();
  return {listeners,style:{},children:[],hidden:false,clientHeight:500,scrollHeight:1000,scrollTop:0,
    classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    emit(type,event={}){for(const fn of [...listeners.get(type)||[]])fn({type,preventDefault(){this.prevented=true;},...event});},
    setAttribute:(k,v)=>attributes.set(k,String(v)),getAttribute:k=>attributes.get(k),
    getBoundingClientRect(){return {top:100,height:this.clientHeight};},
    setPointerCapture(id){this.capture=id;},hasPointerCapture(id){return this.capture===id;},releasePointerCapture(id){if(this.capture===id)this.capture=null;},
    focus(){this.focused=true;}
  };
}
function fixture(){
  const log=target(),shell=target(),track=target(),thumb=target(),window=target(),frames=new Map(),resizes=[],mutations=[];let next=0;
  class ResizeObserver{constructor(fn){this.fn=fn;this.observed=new Set();resizes.push(this);}observe(node){this.observed.add(node);}unobserve(node){this.observed.delete(node);}disconnect(){this.observed.clear();this.disconnected=true;}}
  class MutationObserver{constructor(fn){this.fn=fn;mutations.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  vm.runInNewContext(source,{window,ResizeObserver,MutationObserver,requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)});
  assert.ok(window.VumiroChatScrollbar,'chat scrollbar module is available');
  return {api:window.VumiroChatScrollbar,log,shell,track,thumb,window,frames,resizes,mutations,
    create(){return this.api.create({log,shell,track,thumb});},
    flush(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}}
  };
}
test('thumb keeps proportional size clamped to 20–60 percent of its track',()=>{
  const {api}=fixture();
  for(const [content,height]of [[510,300],[1000,250],[10000,100]]){
    const result=api.measure(500,content,0,500);assert.equal(result.visible,true);assert.equal(result.thumbHeight,height);
  }
  assert.equal(api.measure(500,1000,500,300).thumbHeight,150,'track geometry may differ from viewport');
});
test('thumb reaches both endpoints and remains hidden when the log fits or pane is hidden',()=>{
  const {api}=fixture();
  assert.equal(api.measure(500,500,0,500).visible,false);assert.equal(api.measure(0,1000,0,0).visible,false);
  assert.equal(api.measure(500,10000,-20,500).thumbTop,0);
  assert.equal(api.measure(500,10000,10000,500).thumbTop,400);
});
test('controller reflects the same native scroll range without handling wheel or content keyboard events',()=>{
  const f=fixture();f.log.scrollTop=250;const controller=f.create();
  assert.equal(f.thumb.style.height,'250px');assert.equal(f.thumb.style.transform,'translateY(125px)');
  assert.equal(f.thumb.getAttribute('aria-controls'),'chatLog');assert.equal(f.thumb.getAttribute('aria-valuemax'),'500');assert.equal(f.thumb.getAttribute('aria-valuenow'),'250');
  assert.equal(f.log.listeners.has('wheel'),false);assert.equal(f.log.listeners.has('keydown'),false);
  f.log.scrollTop=500;f.log.emit('scroll');f.flush();assert.equal(f.thumb.style.transform,'translateY(250px)');controller.dispose();
});
test('drag maps the bounded thumb to the full scroll range and releases pointer capture',()=>{
  const f=fixture();f.log.scrollHeight=10000;f.create();
  f.thumb.emit('pointerdown',{button:0,pointerId:7,clientY:150});assert.equal(f.thumb.capture,7);
  f.thumb.emit('pointermove',{pointerId:8,clientY:500});assert.equal(f.log.scrollTop,0,'other pointers do not move the thumb');
  f.thumb.emit('pointermove',{pointerId:7,clientY:550});assert.equal(f.log.scrollTop,9500);
  f.thumb.emit('pointerup',{pointerId:7});assert.equal(f.thumb.capture,null);assert.equal(f.shell.classList.contains('is-dragging'),false);
});
test('scrollbar keyboard controls operate on native log and ignore unrelated keys',()=>{
  const f=fixture();f.create();
  f.thumb.emit('keydown',{key:'End'});assert.equal(f.log.scrollTop,500);
  f.thumb.emit('keydown',{key:'Home'});assert.equal(f.log.scrollTop,0);
  f.thumb.emit('keydown',{key:'ArrowDown'});assert.equal(f.log.scrollTop,40);
  f.thumb.emit('keydown',{key:'PageDown'});assert.equal(f.log.scrollTop,490);
  f.thumb.emit('keydown',{key:'x'});assert.equal(f.log.scrollTop,490);
});
test('content growth, image load and pane resizing update geometry and hide the thumb when content fits',()=>{
  const f=fixture(),message=target();f.log.children=[message];f.create();
  assert.ok(f.resizes[0].observed.has(message));
  f.log.scrollHeight=10000;f.mutations[0].fn();f.flush();assert.equal(f.thumb.style.height,'100px');
  f.log.clientHeight=f.shell.clientHeight=300;f.resizes[0].fn();f.flush();assert.equal(f.thumb.style.height,'60px');
  f.log.scrollHeight=300;f.log.emit('load');f.flush();assert.equal(f.track.hidden,true);
});
test('dispose or page exit disconnects observers, cancels frames and releases an active drag',()=>{
  const f=fixture(),controller=f.create();f.thumb.emit('pointerdown',{button:0,pointerId:3,clientY:150});f.log.emit('scroll');
  controller.dispose();assert.equal(f.frames.size,0);assert.equal(f.thumb.capture,null);assert.equal(f.resizes[0].disconnected,true);assert.equal(f.mutations[0].disconnected,true);
  assert.equal(f.log.listeners.get('scroll').size,0);assert.equal(f.thumb.listeners.get('pointerdown').size,0);
  assert.equal(f.shell.classList.contains('chat-scroll-custom'),false);
  controller.dispose();
  const other=fixture();other.create();other.window.emit('pagehide');assert.equal(other.resizes[0].disconnected,true);
});


test('a detached pointer target cannot prevent scrollbar cleanup',()=>{
  const f=fixture(),controller=f.create();f.thumb.emit('pointerdown',{button:0,pointerId:9,clientY:150});
  f.thumb.releasePointerCapture=()=>{throw Error('Pointer is no longer active');};
  assert.doesNotThrow(()=>controller.dispose());assert.equal(f.resizes[0].disconnected,true);assert.equal(f.mutations[0].disconnected,true);
});
