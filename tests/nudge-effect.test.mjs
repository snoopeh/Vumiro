import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const path=new URL('../Vumiro.Client/WebServer/nudge.js',import.meta.url),source=fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';
function fixture(reduced=false,native=false,linuxCapabilities=null){
  function element(){const classes=new Set();return {children:[],classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},setAttribute(name,value){this[name]=value;},append(node){this.children.push(node);node.parent=this;},remove(){this.parent.children=this.parent.children.filter(node=>node!==this);}};}
  const root=element(),head=element(),timers=new Map(),messages=[];let next=0;const media={matches:reduced,addEventListener(name,fn){this.changed=fn;}};
  const sandbox={window:{matchMedia:()=>media,...(native?{chrome:{webview:{postMessage:value=>messages.push(value)}}}:{})},document:{head,body:root,querySelector:()=>root,createElement:element},setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};if(linuxCapabilities)sandbox.window.vumiroDesktop={platform:'linux',capabilities:linuxCapabilities,postMessage:value=>messages.push(value)};vm.runInNewContext(source,sandbox);
  assert.ok(sandbox.window.VumiroNudge,'nudge effect is available');return {api:sandbox.window.VumiroNudge,root,head,timers,media,messages,finish(){for(const [id,timer]of timers){timers.delete(id);timer.fn();}}};
}
test('desktop nudge requests bounded native window movement without transforming content',()=>{
 const f=fixture(false,true);assert.equal(f.api.effect({}),true);assert.equal(f.messages[0].action,'nudge');assert.equal(f.messages[0].silent,false);assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);assert.equal([...f.timers.values()][0].ms,900);assert.equal(f.api.effect({}),false);assert.equal(f.messages.length,1);f.finish();assert.equal(f.messages[1].action,'nudge-cancel');
});
test('desktop silent and reduced motion request screen glow',()=>{
 for(const options of [{silent:true},{reducedMotion:true}]){const f=fixture(false,true);f.api.effect(options);assert.equal(f.messages[0].silent,true);assert.equal(f.root.children.length,0);f.api.cancel();assert.equal(f.messages[1].action,'nudge-cancel');}
});
test('browser fallback is decorative glow without fake content shaking',()=>{
 const f=fixture();f.api.effect({});assert.equal(f.root.children.length,1);assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);f.finish();assert.equal(f.root.children.length,0);
});
test('local no-motion fallback uses neutral colors instead of the external-fullscreen yellow cue',()=>{
 const f=fixture();assert.doesNotMatch(f.head.children[0].textContent,/#ffd448|#ffdf57/);assert.match(f.head.children[0].textContent,/#f6f0eb/);
});
test('silent and reduced-motion nudges show a decorative frame without shaking',()=>{
  for(const options of [{silent:true},{reducedMotion:true}]){const f=fixture();f.api.effect(options);assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);assert.equal(f.root.children.length,1);assert.equal(f.root.children[0]['aria-hidden'],'true');f.finish();assert.equal(f.root.children.length,0);}
  const f=fixture(true);f.api.effect({reducedMotion:false});assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);assert.equal(f.root.children.length,1);
});
test('cancel removes the active effect and allows a later nudge',()=>{
  const f=fixture();f.api.effect({silent:true});f.api.cancel();assert.equal(f.timers.size,0);assert.equal(f.root.children.length,0);assert.equal(f.api.effect({}),true);f.api.cancel();assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);
});
test('turning reduced motion on requests native glow without extending the timer',()=>{
 const f=fixture(false,true);f.api.effect({});const timer=[...f.timers.keys()][0];f.media.matches=true;f.media.changed();assert.equal(f.messages.length,2);assert.equal(f.messages[1].silent,true);assert.equal([...f.timers.keys()][0],timer);f.finish();assert.equal(f.messages[2].action,'nudge-cancel');
});

test('nudge preferences validate saved data and apply only after a successful write',()=>{
  const f=fixture(),writes=[];let fail=false;
  assert.equal(typeof f.api.preferences,'function');
  const prefs=f.api.preferences({getItem:()=>JSON.stringify({allow:'false',silent:true}),setItem:(key,value)=>{if(fail)throw Error('full');writes.push([key,value]);}});
  assert.equal(prefs.value.allow,true);assert.equal(prefs.value.silent,true);
  fail=true;assert.equal(prefs.save({allow:false,silent:false}),false);assert.equal(prefs.value.allow,true);
  fail=false;assert.equal(prefs.save({allow:false,silent:false}),true);assert.equal(prefs.value.allow,false);assert.equal(writes[0][0],'vumiro-nudge-preferences-v1');
});

test('Wayland bridge without positioning capability uses bounded viewport glow',()=>{
 const f=fixture(false,false,{nativeWindowNudge:false,screenNudgeGlow:false});f.api.effect({});assert.equal(f.messages.length,0);assert.equal(f.root.children.length,1);f.finish();assert.equal(f.root.children.length,0);
});
