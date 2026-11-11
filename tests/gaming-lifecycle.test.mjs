import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const mapping=createRequire(import.meta.url)('../Vumiro.Client/WebServer/controller-mapping.js');
function harness(){
 const nodes=new Map(),events=new Map(),calls=[],nativeRequests=[],signals=[],windowEvents=new Map(),created=[];let callbacks;
 const docEvents=new Map();
 function element(){const classes=new Set();const value={id:'',value:'',dataset:{},style:{},hidden:false,disabled:false,files:[],classList:{add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n),toggle(){}},setAttribute(){},removeAttribute(){},append(){},replaceChildren(){},insertBefore(){},addEventListener(type,fn){events.set(this.id+':'+type,fn);},querySelectorAll(){return [];},closest(){return null;},focus(){},click(){},showModal(){this.open=true;},close(){this.open=false;},play(){return Promise.resolve();}};created.push(value);return value;}
 const document={readyState:'complete',body:element(),head:element(),getElementById:id=>{if(!nodes.has(id)){const e=element();e.id=id;nodes.set(id,e);}return nodes.get(id);},createElement:element,querySelector:element,querySelectorAll:()=>[],addEventListener:(type,fn)=>docEvents.set(type,fn)};
 const ctx={local:{profile:()=>({id:'self'})},send(){},getFriend:id=>({id,name:'Friend'}),listFriends:()=>[{id:'friend',name:'Friend'}],isOnline:()=>true};
 const engine={snapshot:()=>({state:'idle',participants:[]}),invite:async(id,mode)=>calls.push(['invite',id,mode]),accept:async id=>calls.push(['accept',id]),decline:async id=>calls.push(['decline',id]),stop:async()=>calls.push(['stop']),releaseInput:()=>calls.push(['release']),setInputFocused:value=>calls.push(['focus',value]),setKey:(code,down)=>calls.push(['key',code,down]),setBindings(){},setInputMode(){},startSharing:async()=>calls.push(['share']),stopSharing:async()=>{},receive:async()=>{}};
 const view=createRequire(import.meta.url)('../Vumiro.Client/WebServer/gaming-view.js');
 const window={document,VumiroGamingView:view,chrome:{webview:{postMessage:message=>nativeRequests.push(message),addEventListener(){},removeEventListener(){}}},localStorage:{getItem(){return null;},setItem(){}},navigator:{},VumiroControllerMapping:mapping,VumiroGamingSession:{create(opts){callbacks=opts;return engine;}},VumiroGamingDirectory:{getContext:()=>ctx,subscribe:fn=>{signals.push(fn);return()=>{};}},addEventListener:(name,fn)=>windowEvents.set(name,fn),VumiroI18n:{catalogs:{en:{},'pt-BR':{}},t:k=>k,refresh(){}}};
 vm.runInNewContext(readFileSync(new URL('../Vumiro.Client/WebServer/gaming-client.js',import.meta.url),'utf8'),{window,document,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},console});
 return{window,nodes,calls,nativeRequests,events,docEvents,windowEvents,created,callbacks:()=>callbacks,engine};
}
test('LAN and remote play invite a saved friend through Vumiro without external apps',async()=>{
 const h=harness();h.window.VumiroGaming.open('lan');h.nodes.get('gamingLanFriend').value='friend';await h.nodes.get('gamingLanInvite').onclick();assert.deepEqual(h.calls.at(-1),['invite','friend','lan']);h.nodes.get('gamingRemoteFriend').value='friend';await h.nodes.get('gamingRemoteInvite').onclick();assert.deepEqual(h.calls.at(-1),['invite','friend','together']);
});
test('browsing away releases guest input while preserving a running LAN session',()=>{
 const h=harness();h.window.VumiroGaming.open('mapping');h.window.VumiroGaming.close();assert.ok(h.calls.some(c=>c[0]==='release'));assert.equal(h.calls.filter(c=>c[0]==='stop').length,0);
});
test('normal navigation keys outside the focused video are never converted',()=>{
 const h=harness();h.window.VumiroGaming.open('mapping');let blocked=false;h.docEvents.get('keydown')({code:'Tab',target:{closest:()=>null},preventDefault(){blocked=true;}});assert.equal(blocked,false);assert.equal(h.calls.filter(c=>c[0]==='key').length,0);
});

test('keyboard preview shows analog values locally and releases them on keyup',()=>{
 const h=harness();h.window.VumiroGaming.open('mapping');const event={code:'KeyW',target:{closest:()=>null},preventDefault(){}};
 h.docEvents.get('keydown')(event);assert.match(h.nodes.get('gamingLeftAxis').textContent,/LY 1.00/);assert.equal(h.nativeRequests.length,0);
 h.docEvents.get('keyup')(event);assert.match(h.nodes.get('gamingLeftAxis').textContent,/LY 0.00/);
});
test('invitations require explicit acceptance before entering a game',async()=>{
 const h=harness();h.callbacks().onInvitation({id:'abc',sessionId:'abc',peerId:'friend',mode:'together'});assert.equal(h.calls.filter(c=>c[0]==='accept').length,0);await h.nodes.get('gamingAcceptInvite').onclick();assert.deepEqual(h.calls.at(-1),['accept','abc']);
});

test('audio and video tracks sharing one stream do not reset the player source',()=>{
 const h=harness(),video=h.window.document.getElementById('gamingVideo');let loads=0,current;Object.defineProperty(video,'srcObject',{get:()=>current,set:value=>{loads++;current=value;}});const stream={};h.callbacks().onTrack({stream,local:false});h.callbacks().onTrack({stream,local:false});assert.equal(loads,1);
});

test('live streams hide the empty preview placeholder through focus and restore it when cleared',()=>{
 const h=harness(),hint=h.window.document.getElementById('gamingVideoHint');
 h.callbacks().onTrack({stream:{},local:false});assert.equal(hint.hidden,true);
 h.events.get('gamingVideoShell:focus')();assert.equal(hint.hidden,true);
 h.events.get('gamingVideoShell:blur')();assert.equal(hint.hidden,true);
 h.callbacks().onTrack({stream:null,local:false});assert.equal(hint.hidden,false);
});

test('directory loss clears playback, invitation and connected controls immediately',()=>{
 const h=harness();h.callbacks().onState({state:'connected',mode:'together',role:'host',accepted:true,sharing:true});h.callbacks().onTrack({stream:{},local:false});h.callbacks().onInvitation({id:'abc',peerId:'friend',mode:'together'});
 h.window.VumiroGamingDirectory.getContext=()=>null;h.windowEvents.get('vumiro:gaming-directory')();
 assert.equal(h.nodes.get('gamingSessionStatus').textContent,'Offline');assert.equal(h.nodes.get('gamingShare').disabled,true);assert.equal(h.nodes.get('gamingStopShare').disabled,true);assert.equal(h.nodes.get('gamingVideo').srcObject,null);assert.equal(h.created.find(e=>e.id==='gamingInviteDialog').open,false);assert.equal(h.calls.filter(c=>c[0]==='stop').length,1);
 assert.equal(h.window.document.getElementById('gamingVideoHint').hidden,false);
});

test('workspace navigation cancellation leaves an invitation unaccepted',async()=>{
 const h=harness();h.window.VumiroWorkspace={prepareExternal:async()=>false,isCurrent:()=>false};
 h.callbacks().onInvitation({id:'abc',peerId:'friend',mode:'together'});await h.nodes.get('gamingAcceptInvite').onclick();
 assert.equal(h.calls.some(c=>c[0]==='accept'),false);assert.equal(h.window.document.body.classList.contains('gaming-view'),false);
});


test('Gaming waits for the shared workspace gate and Keep editing leaves it closed',async()=>{
  const h=harness();let attempts=0;
  h.window.VumiroWorkspace={async prepareExternal(view){assert.equal(view,'gaming');attempts++;return false;}};
  await h.window.VumiroGaming.open('mapping');
  assert.equal(attempts,1);assert.equal(h.nativeRequests.length,0,'no services start while settings exit is declined');
});


test('same-turn Gaming then Friends navigation keeps the newer Friends destination',async()=>{
  const h=harness(),source=readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
  const context={window:h.window,document:h.window.document,$:id=>h.window.document.getElementById(id),profile:{id:'A'.repeat(43)},frame:null,browseRoom(){},setRoomView(){},renderFriends(){},dispatchEvent(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
  const start=source.indexOf('/* Workspace destinations. */'),end=source.indexOf('/* End workspace destinations. */',start);vm.runInNewContext(source.slice(start,end),context);
  const gaming=h.window.VumiroGaming.open('mapping'),friends=h.window.VumiroWorkspace.showFriends();await Promise.all([gaming,friends]);
  await new Promise(resolve=>setImmediate(resolve));const requests=h.nativeRequests.length;
  assert.equal(context.workspaceView,'friends');assert.equal(requests,0,'superseded Gaming cannot start native status/services');
});
