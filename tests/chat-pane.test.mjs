import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function element(){const listeners=new Map(),attributes=new Map(),classes=new Set(),styles=new Map();return {listeners,attributes,classes,styles,hidden:false,style:{setProperty:(key,value)=>styles.set(key,value)},classList:{add:key=>classes.add(key),remove:key=>classes.delete(key)},setAttribute:(key,value)=>attributes.set(key,String(value)),addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key),setPointerCapture(id){this.capture=id;},hasPointerCapture(id){return this.capture===id;},releasePointerCapture(){this.capture=null;},emit(key,data={}){let prevented=false;listeners.get(key)?.({button:0,isPrimary:true,preventDefault(){prevented=true;},...data});return prevented;}};}
function harness({width=1600,saved,blockedStorage=false}={}){
  const app={innerWidth:width,listeners:new Map(),addEventListener(key,fn){this.listeners.set(key,fn);},removeEventListener(key){this.listeners.delete(key);}},layout=element(),handle=element(),values=new Map(saved===undefined?[]:[['vumiro-chat-pane-ratio-v1',saved]]);
  app.window=app;vm.createContext(app);
  const path=new URL('../Vumiro.Client/WebServer/chat-pane.js',import.meta.url);if(fs.existsSync(path))vm.runInContext(fs.readFileSync(path,'utf8'),app);
  assert.equal(typeof app.VumiroChatPane?.create,'function','chat pane controller must be available');
  const controller=app.VumiroChatPane.create({layout,handle,storage:{getItem:key=>values.get(key),setItem(key,value){if(blockedStorage)throw Error('Storage unavailable');values.set(key,value);}}});
  return {app,layout,handle,values,controller,resize(width){app.innerWidth=width;app.listeners.get('resize')?.();},pixels(){return Number.parseFloat(layout.styles.get('--chat-pane-width'));}};
}

test('chat defaults larger and clamps restored sizes to thirty percent of the viewport',()=>{
  const app=harness();assert.equal(app.pixels(),384);assert.equal(app.handle.attributes.get('aria-valuemax'),'480');
  assert.equal(harness({saved:'0.95'}).pixels(),384);assert.equal(harness({saved:'NaN'}).pixels(),384);
  const restored=harness({saved:'0.30'});assert.equal(restored.pixels(),480);restored.resize(1000);assert.equal(restored.pixels(),300);
});

test('drag capture follows the separator direction and saves only a completed drag',()=>{
  const app=harness();app.handle.emit('pointerdown',{pointerId:7,clientX:1000});assert.equal(app.handle.capture,7);
  app.handle.emit('pointermove',{pointerId:8,clientX:0});assert.equal(app.pixels(),384);
  app.handle.emit('pointermove',{pointerId:7,clientX:500});assert.equal(app.pixels(),480);assert.equal(app.values.size,0);
  app.handle.emit('pointerup',{pointerId:7});assert.equal(app.values.get('vumiro-chat-pane-ratio-v1'),'0.3');assert.equal(app.handle.capture,null);assert.equal(app.layout.classes.has('chat-resizing'),false);
});

test('cancelled or lost pointer capture restores the starting size without persisting',()=>{
  for(const event of ['pointercancel','lostpointercapture']){
    const app=harness();app.handle.emit('pointerdown',{pointerId:1,clientX:900});app.handle.emit('pointermove',{pointerId:1,clientX:800});app.handle.emit(event,{pointerId:1});
    assert.equal(app.pixels(),384);assert.equal(app.values.size,0);assert.equal(app.layout.classes.has('chat-resizing'),false);
  }
});

test('keyboard resizing has bounds and compact windows preserve the desktop preference',()=>{
  const app=harness();assert.equal(app.handle.emit('keydown',{key:'ArrowLeft'}),true);assert.equal(app.pixels(),400);
  app.handle.emit('keydown',{key:'Home'});assert.equal(app.pixels(),280);app.handle.emit('keydown',{key:'End'});assert.equal(app.pixels(),480);
  app.resize(700);assert.equal(app.handle.hidden,true);assert.equal(app.handle.emit('keydown',{key:'ArrowLeft'}),false);assert.equal(app.values.get('vumiro-chat-pane-ratio-v1'),'0.3');
  app.resize(1200);assert.equal(app.handle.hidden,false);assert.equal(app.pixels(),360);
});

test('viewport changes safely end dragging and blocked storage never prevents resizing',()=>{
  const app=harness({blockedStorage:true});app.handle.emit('pointerdown',{pointerId:1,clientX:900});app.handle.emit('pointermove',{pointerId:1,clientX:800});app.resize(900);
  assert.equal(app.layout.classes.has('chat-resizing'),false);assert.ok(app.pixels()<=270);
  assert.doesNotThrow(()=>app.handle.emit('keydown',{key:'End'}));assert.equal(app.pixels(),270);
  app.controller.destroy();assert.equal(app.app.listeners.size,0);assert.equal(app.handle.listeners.size,0);
});
