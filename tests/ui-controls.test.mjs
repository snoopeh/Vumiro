import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);

test('only binary preferences become switches; consent and selections keep checkbox semantics',()=>{
 const {inputKind}=require('../Vumiro.Client/WebServer/ui-controls.js');
 const node=(type,id,scope=true)=>({type,id,getAttribute:()=>null,closest:()=>scope?{}:null});
 assert.equal(inputKind(node('checkbox','appSounds')),'switch');
 for(const id of ['accountPrivacyAck','acceptTerms','friendSelection'])assert.equal(inputKind(node('checkbox',id)),'checkbox',id);
 assert.equal(inputKind(node('checkbox','rowPick',false)),'checkbox');assert.equal(inputKind(node('radio','gamingKeyboardMode')),'radio');assert.equal(inputKind(node('range','appSoundVolume')),'range');
});

function input(type='checkbox',id='appSounds'){
 const attributes=new Map(),classes=new Set(),values=new Map(),events=new Map();
 const result={type,id,dataset:{},preference:true,min:'',max:'',value:'50',required:false,indeterminate:false,
  classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value)},
  getAttribute:key=>attributes.has(key)?attributes.get(key):null,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),hasAttribute:key=>attributes.has(key),
  closest:()=>result.preference?{}:null,matches:selector=>selector==='input',querySelectorAll:()=>[],
  style:{setProperty:(key,value)=>values.set(key,value)},addEventListener:(name,callback)=>{events.set(name,[...(events.get(name)||[]),callback]);},
  attributes,classes,values,events};return result;
}
test('acknowledgment matching does not classify unrelated preference names as consent',()=>{
 const {inputKind}=require('../Vumiro.Client/WebServer/ui-controls.js');
 for(const id of ['feedbackEnabled','appBackground','playbackAudio','packetLoss'])assert.equal(inputKind(input('checkbox',id)),'switch',id);
 for(const id of ['accountPrivacyAck','acceptTerms','friendSelection','privacy_ack','consent'])assert.equal(inputKind(input('checkbox',id)),'checkbox',id);
 const required=input('checkbox','confirm');required.required=true;assert.equal(inputKind(required),'checkbox');
 const mixed=input('checkbox','items');mixed.indeterminate=true;assert.equal(inputKind(mixed),'checkbox');
});
test('enhancement restores native checkbox semantics after preference reclassification',()=>{
 const {enhance}=require('../Vumiro.Client/WebServer/ui-controls.js');const node=input();
 enhance(node);assert.ok(node.classes.has('v-switch'));assert.equal(node.getAttribute('role'),'switch');
 node.setAttribute('data-checkbox','');enhance(node);assert.equal(node.classes.has('v-switch'),false);assert.equal(node.getAttribute('role'),null);
 node.removeAttribute('data-checkbox');enhance(node);node.preference=false;enhance(node);assert.equal(node.classes.has('v-switch'),false);assert.equal(node.getAttribute('role'),null);
 const explicit=input();explicit.setAttribute('role','checkbox');enhance(explicit);assert.equal(explicit.getAttribute('role'),'checkbox');assert.equal(explicit.classes.has('v-switch'),false);
});
test('range styling honors zero maxima and installs one listener per native event',()=>{
 const {enhance}=require('../Vumiro.Client/WebServer/ui-controls.js');const node=input('range','axisOffset');node.min='-1';node.max='0';node.value='0';
 enhance(node);enhance(node);assert.equal(node.values.get('--range-fill'),'100%');assert.equal(node.events.get('input').length,1);assert.equal(node.events.get('change').length,1);
 node.value='-0.5';node.events.get('input')[0]();assert.equal(node.values.get('--range-fill'),'50%');
});
test('dynamic and translated button labels regain one decorative icon without mutation loops',()=>{
 let observe;const classes=new Set();let svg=null,inserts=0;
 const button={id:'gamingSaveProfile',dataset:{},classList:{contains:value=>classes.has(value),add:value=>classes.add(value)},
  closest:selector=>selector.includes('.gamingWorkspace')?{}:null,matches:selector=>selector==='button',querySelectorAll:()=>[],hasAttribute:()=>false,
  querySelector:selector=>selector==='svg'?svg:null,insertAdjacentHTML:()=>{svg={nodeType:1,matches:()=>false,querySelectorAll:()=>[]};inserts++;}};
 const document={readyState:'complete',head:{append(){}},body:{},createElement:()=>({}),querySelectorAll:selector=>selector==='button'?[button]:[]};
 const window={document,MutationObserver:class{constructor(callback){observe=callback;}observe(){}}};
 vm.runInNewContext(readFileSync(new URL('../Vumiro.Client/WebServer/ui-controls.js',import.meta.url),'utf8'),{window});
 assert.equal(inserts,1);svg=null;
 observe([{target:button,addedNodes:[{nodeType:3,nodeValue:'Salvo'}]}]);assert.equal(inserts,2);
 observe([{target:button,addedNodes:[svg]},{target:button,addedNodes:[{nodeType:3,nodeValue:'Save profile'}]}]);assert.equal(inserts,2);
});

test('icons are local, decorative vectors and unknown names cannot inject markup',()=>{
 const {icon}=require('../Vumiro.Client/WebServer/ui-controls.js');
 for(const name of ['network','gamepad','sliders','play','flask','save','plus','upload','download','refresh']){
  const svg=icon(name);assert.match(svg,/aria-hidden="true"/);assert.match(svg,/viewBox="0 0 24 24"/);assert.doesNotMatch(svg,/<script|https?:|<image|onload/i);
 }
 assert.equal(icon('<script>alert(1)</script>'),'');
});


test('shared scrollbar activity follows nested native scrolling and clears after idle or disposal',()=>{
 const {observeScrolling}=require('../Vumiro.Client/WebServer/ui-controls.js');const listeners=new Map(),timers=new Map();let n=0;const rootClasses=new Set(),paneClasses=new Set();
 const rootNode={classList:{add:x=>rootClasses.add(x),remove:x=>rootClasses.delete(x)}},pane={classList:{add:x=>paneClasses.add(x),remove:x=>paneClasses.delete(x)}};const document={scrollingElement:rootNode,addEventListener:(type,fn,capture)=>listeners.set(type,{fn,capture}),removeEventListener:type=>listeners.delete(type)};
 const dispose=observeScrolling(document,{setTimeout:fn=>{timers.set(++n,fn);return n;},clearTimeout:id=>timers.delete(id)});assert.equal(listeners.get('scroll').capture,true);assert.equal(listeners.has('wheel'),false);
 listeners.get('scroll').fn({target:pane});assert.ok(paneClasses.has('v-scrolling'));listeners.get('scroll').fn({target:pane});assert.equal(timers.size,1);[...timers.values()][0]();assert.equal(paneClasses.has('v-scrolling'),false);
 listeners.get('scroll').fn({target:document});assert.ok(rootClasses.has('v-scrolling'));dispose();assert.equal(rootClasses.has('v-scrolling'),false);assert.equal(listeners.size,0);
});
