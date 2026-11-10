import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const path=new URL('../Vumiro.Client/WebServer/motion.js',import.meta.url);
const source=fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';
function harness({reduced=false,storage=new Map()}={}) {
  const timers=new Map(),listeners=new Map();let next=0;
  const media={matches:reduced,addEventListener(name,fn){this.changed=fn;},removeEventListener(){}};
  const document={hidden:false,getElementById:()=>null,addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  const app={document,sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},matchMedia:()=>media,setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener(){},removeEventListener(){}};
  app.window=app;vm.createContext(app);vm.runInContext(source,app);
  assert.ok(app.VumiroMotion,'motion controller is available');
  return {api:app.VumiroMotion,timers,media,document,listeners,advance(ms){for(const [id,timer] of [...timers])if(timer.ms<=ms){timers.delete(id);timer.fn();}}};
}
function element(){const classes=new Set();return {hidden:false,inert:false,dataset:{},textContent:'',attributes:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},addEventListener(name,fn){this[name]=fn;},removeEventListener(name){delete this[name];},setAttribute(name,value){this.attributes[name]=value;},focus(){this.focused=true;}};}
function bootNodes(){return {overlay:element(),content:element(),skip:element(),art:{setCurrentTime(){},unpauseAnimations(){},pauseAnimations(){}}};}

test('launch reveal completes once per browser session and unlocks sign in',()=>{
  const storage=new Map(),app=harness({storage}),nodes=bootNodes();app.api.boot(nodes);
  assert.equal(nodes.overlay.hidden,false);assert.equal(nodes.content.inert,true);
  app.advance(3850);assert.equal(nodes.overlay.classList.contains('boot-exiting'),true);
  app.advance(4800);assert.equal(nodes.overlay.hidden,true);assert.equal(nodes.content.inert,false);
  const later=harness({storage}),second=bootNodes();later.api.boot(second);
  assert.equal(second.overlay.hidden,true);assert.equal(later.timers.size,0);
});
test('skip cancels reveal timers and restores keyboard access immediately',()=>{
  const app=harness(),nodes=bootNodes();app.api.boot(nodes);nodes.skip.click();
  assert.equal(nodes.overlay.hidden,true);assert.equal(nodes.content.inert,false);assert.equal(app.timers.size,0);
});
test('a restored signed-in launch can suppress the reveal on a later sign out',()=>{
  const storage=new Map(),app=harness({storage});assert.equal(typeof app.api.markLaunchSeen,'function');app.api.markLaunchSeen();
  const auth=harness({storage}),nodes=bootNodes();auth.api.boot(nodes);assert.equal(nodes.overlay.hidden,true);assert.equal(auth.timers.size,0);
});
test('reduced motion skips launch and changing the preference ends an active reveal',()=>{
  const app=harness({reduced:true}),nodes=bootNodes();app.api.boot(nodes);assert.equal(nodes.overlay.hidden,true);assert.equal(app.timers.size,0);
  const running=harness(),active=bootNodes();running.api.boot(active);running.media.matches=true;running.media.changed();assert.equal(active.overlay.hidden,true);assert.equal(active.content.inert,false);
});
test('petals pause while hidden, by user choice, and for reduced motion',()=>{
  const app=harness(),toggle=element(),layer=element(),actions=[];const art={pauseAnimations:()=>actions.push('pause'),unpauseAnimations:()=>actions.push('play')};
  app.api.petals({art,layer,toggle});assert.equal(actions.at(-1),'play');
  app.document.hidden=true;app.listeners.get('visibilitychange')();assert.equal(actions.at(-1),'pause');
  app.document.hidden=false;app.listeners.get('visibilitychange')();assert.equal(actions.at(-1),'play');
  toggle.click();assert.equal(actions.at(-1),'pause');assert.equal(toggle.attributes['aria-pressed'],'true');
  app.document.hidden=true;app.listeners.get('visibilitychange')();app.document.hidden=false;app.listeners.get('visibilitychange')();assert.equal(actions.at(-1),'pause');
  toggle.click();app.media.matches=true;app.media.changed();assert.equal(layer.hidden,true);assert.equal(actions.at(-1),'pause');
});
test('connection screen follows joining, recovery, terminal errors and connected state',()=>{
  const app=harness(),nodes={overlay:element(),title:element(),detail:element(),retry:element(),cancel:element()},events=[];
  const connection=app.api.connection({...nodes,onRetry:()=>events.push('retry'),onCancel:()=>events.push('cancel')});
  connection.set('joining');assert.equal(nodes.overlay.hidden,false);assert.match(nodes.title.textContent,/Establishing/);assert.equal(nodes.retry.hidden,true);
  app.advance(15000);assert.equal(nodes.retry.hidden,false);assert.match(nodes.detail.textContent,/longer/);
  nodes.retry.click();assert.deepEqual(events,['retry']);
  connection.set('reconnecting','Rejoining in 4 seconds…');assert.match(nodes.title.textContent,/Reconnecting/);assert.match(nodes.detail.textContent,/4 seconds/);
  connection.set('error','Room is full.');assert.equal(nodes.detail.textContent,'Room is full.');assert.equal(nodes.retry.hidden,false);
  nodes.cancel.click();assert.deepEqual(events,['retry','cancel']);
  connection.set('connected');assert.equal(nodes.overlay.hidden,true);assert.equal(app.timers.size,0);
});
test('password entry and cancellation dismiss connection screen without a late timeout',()=>{
  const app=harness(),nodes={overlay:element(),title:element(),detail:element(),retry:element(),cancel:element()};const connection=app.api.connection(nodes);
  for(const state of ['password','idle']){connection.set('joining');connection.set(state);app.advance(30000);assert.equal(nodes.overlay.hidden,true);assert.equal(app.timers.size,0);}
});
test('connection screen blocks covered controls and restores them for password entry',()=>{
  const app=harness(),main=element(),dock=element(),nodes={overlay:element(),title:element(),detail:element(),retry:element(),cancel:element(),content:[main,dock]};
  const connection=app.api.connection(nodes);connection.set('joining');assert.equal(main.inert,true);assert.equal(dock.inert,true);assert.equal(nodes.cancel.focused,true);
  connection.set('password');assert.equal(main.inert,false);assert.equal(dock.inert,false);
});
test('chat scrolling exposes thumb temporarily and clears its previous timer',()=>{
  const app=harness(),log=element();app.api.scrollbar(log);log.scroll();assert.equal(log.classList.contains('is-scrolling'),true);log.scroll();assert.equal(app.timers.size,1);app.advance(900);assert.equal(log.classList.contains('is-scrolling'),false);
});
