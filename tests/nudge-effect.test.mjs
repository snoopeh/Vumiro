import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const path=new URL('../Vumiro.Client/WebServer/nudge.js',import.meta.url),source=fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';
function fixture(reduced=false){
  function element(){const classes=new Set();return {children:[],classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},setAttribute(name,value){this[name]=value;},append(node){this.children.push(node);node.parent=this;},remove(){this.parent.children=this.parent.children.filter(node=>node!==this);}};}
  const root=element(),head=element(),timers=new Map();let next=0;const media={matches:reduced,addEventListener(name,fn){this.changed=fn;}};
  const sandbox={window:{matchMedia:()=>media},document:{head,body:root,querySelector:()=>root,createElement:element},setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};vm.runInNewContext(source,sandbox);
  assert.ok(sandbox.window.VumiroNudge,'nudge effect is available');return {api:sandbox.window.VumiroNudge,root,head,timers,media,finish(){for(const [id,timer]of timers){timers.delete(id);timer.fn();}}};
}
test('normal nudge shakes only app content for at most 900ms and duplicate effects do not extend it',()=>{
  const f=fixture();assert.equal(f.api.effect({}),true);assert.equal(f.root.classList.contains('vumiro-nudge-shake'),true);assert.equal([...f.timers.values()][0].ms,900);const timer=[...f.timers.keys()][0];assert.equal(f.api.effect({}),false);assert.equal([...f.timers.keys()][0],timer);assert.equal(f.timers.size,1);f.finish();assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);assert.equal(f.root.children.length,0);
});
test('silent and reduced-motion nudges show a decorative frame without shaking',()=>{
  for(const options of [{silent:true},{reducedMotion:true}]){const f=fixture();f.api.effect(options);assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);assert.equal(f.root.children.length,1);assert.equal(f.root.children[0]['aria-hidden'],'true');f.finish();assert.equal(f.root.children.length,0);}
  const f=fixture(true);f.api.effect({reducedMotion:false});assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);assert.equal(f.root.children.length,1);
});
test('cancel removes the active effect and allows a later nudge',()=>{
  const f=fixture();f.api.effect({silent:true});f.api.cancel();assert.equal(f.timers.size,0);assert.equal(f.root.children.length,0);assert.equal(f.api.effect({}),true);f.api.cancel();assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);
});
test('turning reduced motion on during a shake switches to a frame without extending its timer',()=>{
  const f=fixture();f.api.effect({});const timer=[...f.timers.keys()][0];f.media.matches=true;f.media.changed();assert.equal(f.root.classList.contains('vumiro-nudge-shake'),false);assert.equal(f.root.children.length,1);assert.equal([...f.timers.keys()][0],timer);f.finish();assert.equal(f.root.children.length,0);
});

test('nudge preferences validate saved data and apply only after a successful write',()=>{
  const f=fixture(),writes=[];let fail=false;
  assert.equal(typeof f.api.preferences,'function');
  const prefs=f.api.preferences({getItem:()=>JSON.stringify({allow:'false',silent:true}),setItem:(key,value)=>{if(fail)throw Error('full');writes.push([key,value]);}});
  assert.equal(prefs.value.allow,true);assert.equal(prefs.value.silent,true);
  fail=true;assert.equal(prefs.save({allow:false,silent:false}),false);assert.equal(prefs.value.allow,true);
  fail=false;assert.equal(prefs.save({allow:false,silent:false}),true);assert.equal(prefs.value.allow,false);assert.equal(writes[0][0],'vumiro-nudge-preferences-v1');
});
