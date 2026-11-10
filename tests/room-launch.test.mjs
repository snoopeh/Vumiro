import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness(){
  class Element{constructor(){this.style={};this.hidden=false;this.children=[];this.attributes={};}append(...nodes){this.children.push(...nodes);}setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this[k]=fn;}}
  const timers=new Map(),document={head:new Element(),body:new Element(),getElementById(){return null;},createElement:()=>new Element()};let tick=0,cancelled=0,retried=0,current;
  const app={window:{},document,setTimeout:fn=>{const id=++tick;timers.set(id,()=>{timers.delete(id);fn();});return id;},clearTimeout:id=>timers.delete(id)};vm.runInNewContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/motion.js',import.meta.url),'utf8'),app);
  assert.equal(typeof app.window.VumiroMotion.roomLaunch,'function','parent startup controller exists');
  const slot=new Element(),api=app.window.VumiroMotion.roomLaunch({slot,getFrame:()=>current,origin:'https://app.test',onCancel:()=>cancelled++,onRetry:()=>retried++});
  const frame=()=>({style:{},contentWindow:{}}),begin=(id='launch-1')=>{current=frame();api.start(current,id);return current;};
  return{api,slot,timers,begin,get current(){return current;},cancelled:()=>cancelled,retried:()=>retried,ready:(frame,id='launch-1',origin='https://app.test')=>api.receive({source:frame.contentWindow,origin,data:{type:'vumiro-room-ui-ready',launchId:id}})};
}
test('parent feedback covers iframe navigation and dismisses only for the current authenticated frame handshake',()=>{
  const h=harness(),frame=h.begin(),surface=h.slot.children[0];assert.equal(surface.hidden,false);assert.equal(frame.style.visibility,'hidden');
  assert.equal(h.ready(frame,'wrong'),false);assert.equal(h.ready(frame,'launch-1','https://other.test'),false);assert.equal(surface.hidden,false);
  assert.equal(h.ready(frame),true);assert.equal(surface.hidden,true);assert.equal(frame.style.visibility,'');assert.equal(h.timers.size,0);
});
test('retry offers bounded recovery and old frames cannot dismiss or revive a later attempt',()=>{
  const h=harness(),old=h.begin();[...h.timers.values()][0]();const surface=h.slot.children[0],buttons=surface.children[0].children.at(-1).children;
  assert.equal(buttons[1].hidden,false);buttons[1].click();assert.equal(h.retried(),1);
  const current=h.begin('launch-2');assert.equal(h.ready(old),false);assert.equal(surface.hidden,false);
  h.api.stop();assert.equal(surface.hidden,true);assert.equal(h.ready(current,'launch-2'),false);assert.equal(h.timers.size,0);
});
test('cancel remains available before any child script has loaded',()=>{
  const h=harness();h.begin();const surface=h.slot.children[0],buttons=surface.children[0].children.at(-1).children;buttons[0].click();assert.equal(h.cancelled(),1);
});
