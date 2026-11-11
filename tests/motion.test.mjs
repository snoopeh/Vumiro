import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const path=new URL('../Vumiro.Client/WebServer/motion.js',import.meta.url);
const source=fs.existsSync(path)?fs.readFileSync(path,'utf8'):'';
function harness({reduced=false,storage=new Map(),native,launchId,disabled=false,now=1000,nodes={},accountReady,readyState,waitForHost=false}={}) {
  const timers=new Map(),listeners=new Map();let next=0;
  const hostListeners=new Map(),hostMessages=[];
  const media={matches:reduced,addEventListener(name,fn){this.changed=fn;},removeEventListener(){}};
  const document={hidden:false,readyState,getElementById:id=>nodes[id]||null,addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);}};
  const windowListeners=new Map();
  const app={document,__VUMIRO_LAUNCH_ID__:launchId,__VUMIRO_WAIT_FOR_HOST__:waitForHost,Date:{now:()=>now},localStorage:{getItem:()=>disabled?'true':null},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},matchMedia:()=>media,setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener(name,fn){windowListeners.set(name,fn);},removeEventListener(name){windowListeners.delete(name);}};
  const host={addEventListener:(name,fn)=>hostListeners.set(name,fn),postMessage:message=>hostMessages.push(message)};
  if(native==='linux')app.vumiroDesktop={...host,launchId};else if(native)app.chrome={webview:host};
  if(accountReady)app.VumiroAccount={ready:accountReady};
  app.window=app;vm.createContext(app);vm.runInContext(source,app);
  assert.ok(app.VumiroMotion,'motion controller is available');
  return {api:app.VumiroMotion,timers,media,document,listeners,hostMessages,hostReady(){app.__VUMIRO_HOST_READY__=true;windowListeners.get('vumiro-host-ready')?.();},hostState(data){hostListeners.get('message')?.({data});},advance(ms){for(const [id,timer] of [...timers])if(timer.ms<=ms){timers.delete(id);timer.fn();}}};
}
function element(){const classes=new Set();return {hidden:false,inert:false,dataset:{},textContent:'',attributes:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},addEventListener(name,fn){this[name]=fn;},removeEventListener(name){delete this[name];},setAttribute(name,value){this.attributes[name]=value;},focus(){this.focused=true;}};}
function bootNodes(){return {overlay:element(),content:element(),skip:element(),art:{setCurrentTime(){},unpauseAnimations(){},pauseAnimations(){}}};}

test('native startup update overlay cannot consume the intro before the app is visible',()=>{
  const nodes=bootNodes(),app=harness({waitForHost:true,nodes:{bootReveal:nodes.overlay,authContent:nodes.content,bootSkip:nodes.skip,bootArt:nodes.art}});
  assert.equal(nodes.overlay.hidden,true);assert.equal(app.timers.size,0);
  app.hostReady();assert.equal(nodes.overlay.hidden,false);assert.equal(app.timers.size,2);assert.equal(nodes.content.inert,true);
  const host=fs.readFileSync(new URL('../Vumiro.Client/Program.cs',import.meta.url),'utf8'),navigation=host.slice(host.indexOf('browser.CoreWebView2.NavigationCompleted +='),host.indexOf('var signaling = DefaultSignaling;'));
  assert.ok(navigation.indexOf('vumiro-host-ready')>navigation.indexOf('DismissStartupOverlay()'));
});

test('launch reveal completes once per browser session and unlocks sign in',()=>{
  const storage=new Map(),app=harness({storage}),nodes=bootNodes();app.api.boot(nodes);
  assert.equal(nodes.overlay.hidden,false);assert.equal(nodes.content.inert,true);
  app.advance(3850);assert.equal(nodes.overlay.classList.contains('boot-exiting'),true);
  app.advance(4800);assert.equal(nodes.overlay.hidden,true);assert.equal(nodes.content.inert,false);
  const later=harness({storage}),second=bootNodes();later.api.boot(second);
  assert.equal(second.overlay.hidden,true);assert.equal(later.timers.size,0);
});
test('native cold launch replays artwork while reloads in the same process stay quiet',()=>{
  for(const native of ['windows','linux']){
    const storage=new Map(),first=harness({native,launchId:'process-one',storage}),one=bootNodes();first.api.boot(one);first.advance(4800);
    const reload=harness({native,launchId:'process-one',storage}),two=bootNodes();reload.api.boot(two);assert.equal(two.overlay.hidden,true);
    const cold=harness({native,launchId:'process-two',storage}),three=bootNodes();cold.api.boot(three);assert.equal(three.overlay.hidden,false);assert.equal(three.content.inert,true);
  }
});
test('persistent disable preference skips launch without trapping lobby controls',()=>{const app=harness({disabled:true}),nodes=bootNodes();app.api.boot(nodes);assert.equal(nodes.overlay.hidden,true);assert.equal(nodes.content.inert,false);assert.equal(app.timers.size,0);});
test('redirect during launch resumes the remaining animation on the destination page',()=>{
  const storage=new Map(),first=harness({launchId:'process-one',storage,now:1000});first.api.boot(bootNodes());
  const next=harness({launchId:'process-one',storage,now:3000}),nodes=bootNodes();let time;nodes.art.setCurrentTime=value=>{time=value;};nodes.overlay.classList.add('boot-exiting');next.api.boot(nodes);
  assert.equal(nodes.overlay.hidden,false);assert.equal(nodes.overlay.classList.contains('boot-exiting'),false);assert.equal(time,2);assert.ok([...next.timers.values()].some(timer=>timer.ms===2800));
});
test('friends auto boot targets the lobby content shell',()=>{const nodes=bootNodes();harness({nodes:{bootReveal:nodes.overlay,friendsContent:nodes.content,bootSkip:nodes.skip,bootArt:nodes.art}});assert.equal(nodes.overlay.hidden,false);assert.equal(nodes.content.inert,true);});
test('bundled lobby boot waits for account readiness and is not consumed by markLaunchSeen',async()=>{
 const nodes=bootNodes(),storage=new Map(),app=harness({storage,readyState:'loading',accountReady:async()=>true,nodes:{bootReveal:nodes.overlay,friendsContent:nodes.content,bootSkip:nodes.skip,bootArt:nodes.art}});
 app.api.markLaunchSeen();assert.equal(storage.has('vumiro-launch-reveal-seen'),false);app.listeners.get('DOMContentLoaded')();await Promise.resolve();assert.equal(nodes.content.inert,true);assert.equal(nodes.overlay.hidden,false);
});
test('signed-out lobby redirect does not consume launch artwork before auth loads',async()=>{
 const nodes=bootNodes(),storage=new Map(),app=harness({storage,accountReady:async()=>false,nodes:{bootReveal:nodes.overlay,friendsContent:nodes.content}});await Promise.resolve();assert.equal(storage.has('vumiro-launch-reveal-seen'),false);assert.equal(app.timers.size,0);assert.equal(nodes.overlay.hidden,true);assert.equal(nodes.content.inert,false);
 const auth=harness({storage}),authNodes=bootNodes();auth.api.boot(authNodes);assert.equal(authNodes.overlay.hidden,false);
});
test('actual reveal restarts the CSS failsafe after a slow account startup',()=>{
 const app=harness(),nodes=bootNodes(),changes=[];nodes.overlay.style={set animation(value){changes.push(value);}};Object.defineProperty(nodes.overlay,'offsetWidth',{get(){changes.push('layout');return 100;}});
 app.api.boot(nodes);assert.deepEqual(changes,['none','layout','']);assert.equal(nodes.overlay.hidden,false);
});
test('native hosts expose an immutable launch identifier from the current process',()=>{
 const windows=fs.readFileSync(new URL('../Vumiro.Client/Program.cs',import.meta.url),'utf8'),linux=fs.readFileSync(new URL('../Vumiro.Linux/main.cjs',import.meta.url),'utf8'),preload=fs.readFileSync(new URL('../Vumiro.Linux/preload.js',import.meta.url),'utf8');
 assert.match(windows,/readonly string launchId\s*=\s*Guid.NewGuid\(\)/);assert.match(windows,/AddScriptToExecuteOnDocumentCreatedAsync\([^\n]*__VUMIRO_LAUNCH_ID__/);assert.match(windows,/writable:false,configurable:false/);
 assert.match(linux,/const launchId\s*=\s*randomUUID\(\)/);assert.match(linux,/additionalArguments:[^\n]*--vumiro-launch-id=/);
 let bridge;vm.runInNewContext(preload,{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:{on(){}}}),process:{argv:['--vumiro-launch-id=11111111-1111-4111-8111-111111111111']}});
 assert.equal(bridge.launchId,'11111111-1111-4111-8111-111111111111');assert.equal(Object.isFrozen(bridge),true);
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
test('native minimize pauses petals even when the WebView document remains visible',()=>{
  for(const native of ['windows','linux']){
    const app=harness({native}),toggle=element(),actions=[];app.api.petals({art:{pauseAnimations:()=>actions.push('pause'),unpauseAnimations:()=>actions.push('play')},layer:element(),toggle});
    assert.deepEqual(JSON.parse(JSON.stringify(app.hostMessages)),[{type:'window',action:'state'}]);assert.equal(app.document.hidden,false);
    app.hostState({type:'window-state',minimized:true});assert.equal(actions.at(-1),'pause');
    app.listeners.get('visibilitychange')();assert.equal(actions.at(-1),'pause');
    app.hostState({type:'window-state',minimized:false,focused:false});assert.equal(actions.at(-1),'play');
    toggle.click();app.hostState({type:'window-state',minimized:true});app.hostState({type:'window-state',minimized:false});assert.equal(actions.at(-1),'pause');
    toggle.click();app.document.hidden=true;app.listeners.get('visibilitychange')();app.hostState({type:'window-state',minimized:false});assert.equal(actions.at(-1),'pause');
  }
});
test('Linux native state publishes minimized and restored window state',()=>{
  const linux=fs.readFileSync(new URL('../Vumiro.Linux/main.cjs',import.meta.url),'utf8'),sent=[];let minimized=true;
  const app={mainWindow:{isDestroyed:()=>false,isMinimized:()=>minimized,isMaximized:()=>false,isFullScreen:()=>false,webContents:{mainFrame:{},send:(channel,value)=>sent.push(value)}},validAccountFrame:()=>true};
  vm.createContext(app);vm.runInContext(linux.slice(linux.indexOf('function sendWindowState()'),linux.indexOf('function setUpdateState(')),app);
  app.sendWindowState();assert.equal(sent.at(-1).minimized,true);minimized=false;app.sendWindowState();assert.equal(sent.at(-1).minimized,false);
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
