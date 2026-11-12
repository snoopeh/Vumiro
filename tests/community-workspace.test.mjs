import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness({defer=false,realModel=false,realThemes=false,liveApi,voiceApi}={}) {
  let profile={id:'A'.repeat(43),name:'Owner'},release,blockSave=false;
  const records=new Map(),calls=[],themeManagerCalls=[];
  const state={hubs:[{id:'hub',name:'Workshop',description:'Welcome',home:{preset:'compact',welcome:'Make something'},members:[]}],nodes:[{id:'folder',hubId:'hub',parentId:null,kind:'folder',name:'Games',depth:0,hasChildren:true},{id:'text',hubId:'hub',parentId:'folder',kind:'text',name:'Plans',depth:1}],selectedHubId:'hub',selectedNodeId:null,messages:{text:[]},drafts:{text:''},collapsed:[]};
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.handlers={};this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};this.value='';this.hidden=false;this.textContent='';}
    get ownerDocument(){return document;}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
    removeAttribute(k){delete this.attributes[k];}
    append(...children){for(const child of children){child.parentNode=this;this.children.push(child);}}
    replaceChildren(...children){this.children=[];this.append(...children);}
    attachShadow(){this.shadowRoot=new Element('shadow');return this.shadowRoot;}
    setAttribute(k,v){this.attributes[k]=String(v);}
    addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
    removeEventListener(k,fn){this.handlers[k]=(this.handlers[k]||[]).filter(x=>x!==fn);}
    focus(){document.activeElement=this;}
    async dispatch(type,extra={}){for(const fn of this.handlers[type]||[])await fn({target:this,preventDefault(){},...extra});}
    set innerHTML(_){throw Error('unsafe HTML');}
  }
  const document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)},mount=new Element('section');
  const model={snapshot:()=>structuredClone(state),status:()=>({saved:true}),tree:(_,opts)=>state.nodes.filter(n=>!opts.query||n.name.includes(opts.query)||n.id==='folder'),breadcrumbs:()=>[state.nodes[0],state.nodes[1]],visibleActivity:()=>[],unreadTotal:()=>0,
    async selectNode(id){calls.push(['select',id]);state.selectedNodeId=id;},async selectHub(id){state.selectedHubId=id;state.selectedNodeId=null;},async setCollapsed(id,value){state.collapsed=value?[id]:[];},async setDraft(id,value){state.drafts[id]=value;},async postMessage(id,value){calls.push(['post',id,value]);state.messages[id].push({id:'m',author:'Owner',text:value,at:0});state.drafts[id]='';}};
  const window={VumiroCommunityModel:{createStore:async({identity})=>{records.set(identity,true);if(defer)await new Promise(r=>release=r);return model;},createLocalStorageAdapter:()=>({})}};
  if(liveApi)window.VumiroCommunityLive={create:options=>{liveApi.options=options;return liveApi;}};
  if(voiceApi)window.VumiroCommunityVoice={create:()=>voiceApi};
  const context={window,document,console,structuredClone,Date};vm.createContext(context);
  const visualFile=new URL('../Vumiro.Client/WebServer/community-ui.js',import.meta.url);if(fs.existsSync(visualFile))vm.runInContext(fs.readFileSync(visualFile,'utf8'),context);
  const storage={async load(id){return records.get(id)??null;},async save(id,value){if(blockSave){blockSave=false;await new Promise(r=>release=r);}records.set(id,structuredClone(value));}};
  if(realModel)vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-model.js',import.meta.url),'utf8'),context);
  if(realThemes){vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-themes.js',import.meta.url),'utf8'),context);const original=window.VumiroCommunityThemes.createManager;window.VumiroCommunityThemes.createManager=options=>{themeManagerCalls.push(options);return original(options);};}
  const file=new URL('../Vumiro.Client/WebServer/community-workspace.js',import.meta.url);
  if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);
  assert.ok(window.VumiroCommunityHub,'community view exists');
  const view=window.VumiroCommunityHub.create({mount,getProfile:()=>profile,storage:realModel?storage:{},identityProvider:{profile:()=>profile}});
  const all=(node=mount)=>[node,...node.children.flatMap(c=>all(c)),...(node.shadowRoot?all(node.shadowRoot):[])];
  return {view,mount,all,calls,state,document,window,records,themeManagerCalls,find:key=>all().find(n=>n.dataset.action===key),profile:value=>profile=value,release:()=>release(),blockSave:()=>blockSave=true};
}
async function settings(h,key){if(!h.find(key))await h.find('scope-settings').dispatch('click');await h.find(key).dispatch('click');}

test('persistent tree opens a text channel and preserves a draft through home navigation',async()=>{
  const h=harness();await h.view.open();assert.ok(h.mount.shadowRoot,'community styles have a shadow boundary');
  assert.ok(h.all().some(n=>n.textContent==='Community Hub'));assert.ok(h.find('tree'));
  await h.find('node-text').dispatch('click');const draft=h.find('message');draft.value='<img onerror=bad()>';await draft.dispatch('input');
  await h.find('home').dispatch('click');assert.ok(h.find('node-text'),'tree remains beside home');
  await h.find('node-text').dispatch('click');assert.equal(h.find('message').value,'<img onerror=bad()>');
  await h.find('message-form').dispatch('submit');assert.equal(h.calls.at(-1)[0],'post');
});

test('community dropdown and channel menus preserve the attached composer and close with focus restored',async()=>{
 const h=harness({realModel:true});await h.view.open();await h.find('node-workbench').dispatch('click');const input=h.find('message');input.value='Keep this draft';await input.dispatch('input');
 const trigger=h.find('hub-menu');assert.ok(trigger,'community name opens its dropdown');await trigger.dispatch('click');assert.equal(h.find('community-menu').attributes.role,'menu');assert.equal(h.find('message'),input);assert.equal(input.value,'Keep this draft');
 await h.find('community-menu').dispatch('keydown',{key:'End'});assert.equal(h.document.activeElement,h.find('menu-connections'));
 await h.find('community-menu').dispatch('keydown',{key:'Home'});assert.equal(h.document.activeElement,h.find('menu-create-text'));
 await h.find('community-menu').dispatch('keydown',{key:'Escape'});assert.equal(h.find('community-menu'),undefined);assert.equal(h.document.activeElement,trigger);assert.equal(trigger.attributes['aria-expanded'],'false');
 await trigger.dispatch('click');await h.find('community-menu').dispatch('keydown',{key:'Tab'});assert.equal(h.find('community-menu'),undefined);assert.equal(h.document.activeElement,trigger,'Tab returns focus to the live trigger');
 const channel=h.find('node-builds');await channel.dispatch('contextmenu');assert.ok(h.find('menu-edit'));assert.equal(h.find('message'),input);assert.equal(h.records.get('A'.repeat(43)).selectedNodeId,'workbench');
 await h.find('menu-layer').dispatch('pointerdown');assert.equal(h.find('community-menu'),undefined);assert.equal(h.document.activeElement,channel);
});

test('visible overflow and keyboard context menu route settings to their scope without navigating',async()=>{
 const h=harness({realModel:true});await h.view.open();await h.find('node-workbench').dispatch('click');
 await h.find('node-builds').dispatch('keydown',{key:'F10',shiftKey:true});await h.find('menu-edit').dispatch('click');assert.equal(h.find('edit-name').value,'Builds');assert.equal(h.records.get('A'.repeat(43)).selectedNodeId,'workbench');await h.find('settings-close').dispatch('click');
 const more=h.find('more-valheim');assert.ok(more);assert.equal(more.attributes['aria-haspopup'],'menu');await more.dispatch('click');await h.find('menu-create-category').dispatch('click');assert.equal(h.find('quick-create-kind').value,'folder');h.find('quick-create-name').value='Expeditions';await h.find('quick-create-name').parentNode.parentNode.dispatch('submit');
 const saved=h.records.get('A'.repeat(43)),category=saved.nodes.find(n=>n.name==='Expeditions');assert.equal(category.kind,'folder');assert.equal(category.parentId,'valheim');
});

test('channel menu archive acts on its target while preserving an unrelated conversation',async()=>{
 const h=harness({realModel:true});await h.view.open();await h.find('node-workbench').dispatch('click');h.find('message').value='Still here';await h.find('message').dispatch('input');
 await h.find('more-builds').dispatch('click');assert.equal(h.find('menu-create-text'),undefined,'a channel cannot contain another channel');await h.find('menu-archive').dispatch('click');
 const state=h.records.get('A'.repeat(43));assert.equal(state.nodes.find(n=>n.id==='builds').archived,true);assert.equal(state.selectedNodeId,'workbench');assert.equal(h.find('message').value,'Still here');
});

test('shared invitation menu uses the real invitation service and hides unavailable member mutations',async()=>{
 const me='A'.repeat(43),snapshot={hubId:'live',id:'live',ownerId:me,name:'Guild',revision:7,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'live'}],members:[{id:me,roles:[]}],roles:[]},invites=[];
 const liveApi={disconnect(){},async connect(){return snapshot;},async invite(value){invites.push(value);return {hubId:'live',token:'issued-service-token'};}};
 const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('hub-menu').dispatch('click');await h.find('menu-invite').dispatch('click');await h.find('live-invite-member').parentNode.parentNode.dispatch('submit');assert.equal(invites.length,1);assert.ok(h.find('invitation-link').value.includes('issued-service-token'));
 snapshot.ownerId='B'.repeat(43);
 // Reconnect through the existing invitation flow to load changed service authority.
 await h.find('local-demo').dispatch('click');await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('hub-menu').dispatch('click');
 assert.equal(h.find('menu-invite'),undefined);assert.equal(h.find('menu-create-text'),undefined);assert.equal(h.find('menu-manage'),undefined);assert.ok(h.find('menu-connections'));assert.equal(h.find('add-root'),undefined);await h.find('community-menu').dispatch('keydown',{key:'Escape'});await h.find('scope-settings').dispatch('click');assert.equal(h.find('live-edit-name'),undefined);assert.ok(h.find('connection-disconnect'));
});

test('delegated shared rename preserves existing access, managers, themes and home metadata',async()=>{
 const me='A'.repeat(43),target={id:'chat',type:'text',name:'Plans',description:'Original',parentId:'space',access:{mode:'restricted',members:[me]},managers:[me],themeBinding:{mode:'inherit'},home:{welcome:'Retain this'}},snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:4,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'space',type:'space',name:'Workshop',parentId:'live',managers:[me]},target],members:[{id:me,roles:['Member']}],roles:[{id:'Member',permissions:['view','post']}]},mutations=[];
 const liveApi={disconnect(){},async connect(){return snapshot;},async mutate(operations,revision){mutations.push({operations:structuredClone(operations),revision});return snapshot;}};
 const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('more-chat').dispatch('click');assert.ok(h.find('menu-rename'));assert.equal(h.find('menu-permissions'),undefined);await h.find('menu-rename').dispatch('click');h.find('live-edit-name').value='New plans';await h.find('live-edit-name').parentNode.parentNode.dispatch('submit');
 const saved=mutations[0].operations[0].node;assert.equal(saved.name,'New plans');for(const key of ['access','managers','themeBinding','home'])assert.deepEqual(saved[key],target[key],key);assert.equal(mutations[0].revision,4);
});

test('shared Builders can create root children without gaining community identity settings',async()=>{
 const me='A'.repeat(43),snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:2,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null}],members:[{id:me,roles:['Builder']}],roles:[{id:'Builder',permissions:['view','structure']}]},operations=[];
 const liveApi={disconnect(){},async connect(){return snapshot;},async mutate(value){operations.push(...value);return snapshot;}};
 const h=harness({realModel:true,liveApi});h.window.crypto={randomUUID:()=> 'new-category'};await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('hub-menu').dispatch('click');assert.ok(h.find('add-root'));assert.ok(h.find('menu-create-category'));assert.equal(h.find('menu-manage'),undefined);await h.find('menu-create-category').dispatch('click');h.find('quick-create-name').value='Meetups';await h.find('quick-create-name').parentNode.parentNode.dispatch('submit');assert.equal(operations[0].node.parentId,'live');assert.equal(operations[0].node.type,'folder');
});

test('conversation has independently scrolling history and an anchored composer with keyboard sending',async()=>{
  const h=harness();await h.view.open();await h.find('node-text').dispatch('click');const input=h.find('message'),frame=h.find('chat-frame'),history=h.find('message-list'),form=h.find('message-form');
  assert.ok(frame);assert.equal(history.parentNode,frame);assert.equal(form.parentNode,frame);assert.ok(history.className.includes('ch-history'));assert.ok(form.className.includes('ch-composer'));
  input.value='A keyboard message';await input.dispatch('keydown',{key:'Enter',shiftKey:true});assert.equal(h.calls.some(c=>c[0]==='post'),false);await input.dispatch('keydown',{key:'Enter',isComposing:true});assert.equal(h.calls.some(c=>c[0]==='post'),false);await input.dispatch('keydown',{key:'Enter'});assert.equal(h.calls.at(-1)[0],'post');
});

test('voice joins inline and retains its dock while text drafts and navigation remain independent',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('node-workbench').dispatch('click');h.find('message').value='Keep my text draft';await h.find('message').dispatch('input');await h.find('node-viking-longhouse').dispatch('click');
  assert.equal(h.find('message').value,'Keep my text draft');assert.ok(h.find('voice-dock'));assert.ok(h.all().some(n=>n.textContent.includes('Simulated voice')));await h.find('voice-mute').dispatch('click');assert.equal(h.find('voice-mute').attributes['aria-pressed'],'true');await h.find('node-builds').dispatch('click');assert.ok(h.find('voice-leave'));await h.find('voice-leave').dispatch('click');assert.equal(h.find('voice-leave'),undefined);
});

test('tree plus creates in its exact Space and a gear opens scoped settings without changing chat',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('node-workbench').dispatch('click');await h.find('add-valheim').dispatch('click');h.find('quick-create-name').value='Raid plans';h.find('quick-create-kind').value='text';await h.find('quick-create-name').parentNode.parentNode.dispatch('submit');const saved=h.records.get('A'.repeat(43)),created=saved.nodes.find(n=>n.name==='Raid plans');assert.equal(created.parentId,'valheim');assert.equal(saved.selectedNodeId,created.id);
  await h.find('edit-builds').dispatch('click');assert.ok(h.find('settings-panel'));assert.ok(h.all().some(n=>n.textContent==='Builds settings'));h.find('edit-name').value='City builds';await h.find('edit-name').parentNode.parentNode.dispatch('submit');assert.equal(h.records.get('A'.repeat(43)).nodes.find(n=>n.id==='builds').name,'City builds');await h.find('settings-close').dispatch('click');assert.ok(h.find('message'));assert.equal(h.records.get('A'.repeat(43)).selectedNodeId,created.id);
});

test('channel drawer has explicit open/close state and selecting a channel closes it',async()=>{
  const h=harness();await h.view.open();await h.find('toggle-channels').dispatch('click');assert.equal(h.find('community-root').dataset.navOpen,'true');await h.find('node-text').dispatch('click');assert.equal(h.find('community-root').dataset.navOpen,'false');
});

test('shared incoming messages preserve the reading position and reveal connection errors',async()=>{
  const snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'live'}],members:[]},liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');const log=h.find('live-log');log.clientHeight=200;log.scrollHeight=1000;log.scrollTop=120;liveApi.options.onEvent({type:'community-message',message:{id:'incoming',channelId:'chat',sequence:1,text:'New message'}});assert.equal(log.scrollTop,120);assert.equal(h.find('new-messages').hidden,false);liveApi.options.onEvent({type:'community-error',message:'Connection lost'});assert.equal(h.find('workspace-error').hidden,false);
});

test('settings focus trap uses the shadow root active control',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('scope-settings').dispatch('click');const layer=h.find('settings-panel'),first=h.find('page-manage'),last=h.find('settings-close');layer.querySelectorAll=()=>[first,last];h.document.activeElement=h.mount;h.mount.shadowRoot.activeElement=last;let prevented=false;await layer.dispatch('keydown',{key:'Tab',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(h.document.activeElement,first);
});

test('older history keeps its visible anchor when transport emits the page before resolving',async()=>{
  let phase=0,observedTop,h;const snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'live'}],members:[]},liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){if(!phase++)return {messages:[{id:'m3',sequence:3,text:'Third'},{id:'m4',sequence:4,text:'Fourth'}]};const messages=[{id:'m1',sequence:1,text:'First'},{id:'m2',sequence:2,text:'Second'}];liveApi.options.onEvent({type:'community-history',channelId:'chat',messages});observedTop=h.find('live-log').scrollTop;return {messages};}};
  h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');const log=h.find('live-log');Object.defineProperty(log,'scrollHeight',{get:()=>log.children.filter(n=>n.className==='ch-message').length*100});log.clientHeight=50;log.scrollTop=50;await h.find('live-history').dispatch('click');assert.equal(observedTop,250);
});

test('Space overview activity stays within that Space and voice destination cards join inline',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('node-valheim').dispatch('click');assert.equal(h.all().some(n=>n.textContent==='What should we make here first?'),false);await settings(h,'page-manage');h.find('home-featured').value='viking-longhouse';await h.find('home-featured').parentNode.parentNode.dispatch('submit');await settings(h,'page-home');await h.find('featured-viking-longhouse').dispatch('click');assert.ok(h.find('voice-leave'));assert.equal(h.records.get('A'.repeat(43)).selectedNodeId,'valheim');
});

test('shared voice participants and mute dock survive navigating away from the joined voice row',async()=>{
  const me='A'.repeat(43),snapshot={hubId:'live',id:'live',ownerId:me,name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'live'},{id:'voice',type:'voice',name:'Campfire',parentId:'live'}],members:[]};let voiceOptions;const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[]};}},voiceApi={async join(id){voiceOptions.onState({phase:'connected',channelId:id,muted:false});voiceOptions.onParticipants([{id:'p',name:'Avery'}]);},state:()=>({phase:'connected',channelId:'voice',muted:false}),setMuted(){},async leave(){voiceOptions.onState({phase:'idle',channelId:null,muted:false});},async dispose(){}};
  voiceApi.setMuted=muted=>voiceOptions.onState({phase:'connected',channelId:'voice',muted});
  const h=harness({realModel:true,liveApi});h.window.VumiroCommunityVoice={create:options=>{voiceOptions=options;return voiceApi;}};await h.view.open();await h.find('page-connections')?.dispatch('click');
  if(!h.find('publish-hub')){await h.find('scope-settings').dispatch('click');await settings(h,'page-connections');}await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');await h.find('live-node-voice').dispatch('click');assert.ok(h.find('live-message'));assert.ok(h.find('voice-leave'));assert.ok(h.all().some(n=>n.textContent==='Avery'));await h.find('voice-mute').dispatch('click');assert.equal(h.find('voice-mute').attributes['aria-pressed'],'true');await h.find('voice-mute').dispatch('click');assert.equal(h.find('voice-mute').attributes['aria-pressed'],'false');await h.find('live-home').dispatch('click');assert.ok(h.find('voice-leave'));assert.ok(h.all().some(n=>n.textContent==='Avery'));
});
test('search preserves its native input and exposes matching ancestors',async()=>{
  const h=harness();await h.view.open();const input=h.find('tree-search');input.value='Plans';await input.dispatch('input');
  assert.equal(h.find('tree-search'),input);assert.ok(h.find('node-folder'));assert.ok(h.find('node-text'));
});
test('identity switch prevents retained composer callbacks posting old drafts',async()=>{
  const h=harness();await h.view.open();await h.find('node-text').dispatch('click');const form=h.find('message-form');
  h.profile({id:'B'.repeat(43),name:'New'});await form.dispatch('submit');assert.equal(h.calls.some(c=>c[0]==='post'),false);
  await h.view.open();assert.ok(h.find('tree'));h.view.destroy();assert.equal(await h.view.open(),false);
});
test('a delayed load cannot render after hide',async()=>{
  const h=harness({defer:true});const pending=h.view.open();h.view.hide();h.release();assert.equal(await pending,false);assert.equal(h.mount.hidden,true);
});
test('real model supports creation, home presets, channel moves and access previews through forms',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('home').dispatch('click');await settings(h,'page-manage');
  const name=h.find('create-name');name.value='My Space';h.find('create-kind').value='space';await name.parentNode.parentNode.dispatch('submit');
  let saved=h.records.get('A'.repeat(43)),space=saved.nodes.find(n=>n.name==='My Space');assert.ok(space);
  await h.find('node-'+space.id).dispatch('click');await settings(h,'page-manage');
  const preset=h.find('home-preset');preset.value='banner';h.find('home-welcome').value='Guild welcome';await preset.parentNode.parentNode.dispatch('submit');
  saved=h.records.get('A'.repeat(43));assert.equal(saved.nodes.find(n=>n.id===space.id).home.preset,'banner');
  await settings(h,'page-access');const access=h.find('access-mode');access.value='restricted';h.find('access-members').value='demo-luca';await access.parentNode.parentNode.dispatch('submit');
  await h.find('preview-access').dispatch('click');assert.ok(h.find('access-result').children.some(n=>n.children.some(c=>c.textContent==='Read channels')));
});
test('owners configure scoped permission dimensions, delegation, and equal authority role brackets',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('node-valheim').dispatch('click');await settings(h,'page-access');
  const managers=h.find('space-managers');managers.value='demo-luca';await managers.parentNode.parentNode.dispatch('submit');
  const permission=h.find('permission-post');permission.value='deny';await permission.parentNode.parentNode.dispatch('submit');
  let saved=h.records.get('A'.repeat(43)),scope=saved.nodes.find(n=>n.id==='valheim');assert.deepEqual(scope.managerIds,['demo-luca']);assert.ok(scope.access.permissions.post.denyRoles.includes('Member'));
  h.find('authority-Moderator').value='10';await h.find('authority-Moderator').parentNode.parentNode.dispatch('submit');
  saved=h.records.get('A'.repeat(43));assert.equal(saved.hubs[0].roles.find(r=>r.id==='Moderator').authority,10);
});
test('adjacent Space themes reset inheritance and simplified personal styling wins',async()=>{
  const h=harness({realModel:true,realThemes:true});await h.view.open();await h.find('node-valheim').dispatch('click');
  let content=h.all().find(n=>n.className==='ch-content');assert.equal(content.style['--community-font-heading'],'Georgia, serif');
  await h.find('node-cyberpunk').dispatch('click');content=h.all().find(n=>n.className==='ch-content');assert.equal(content.style['--community-font-heading'],'Consolas, monospace');
  await settings(h,'page-themes');await h.find('simplified-style').dispatch('click');content=h.all().find(n=>n.className==='ch-content');assert.equal(content.style['--community-font-heading'],'"Segoe UI", sans-serif');
});
test('an in-flight authority save cannot apply its second mutation to another identity',async()=>{
  const h=harness({realModel:true});await h.view.open();await settings(h,'page-access');h.find('equal-authority').value='yes';
  h.blockSave();const pending=h.find('authority-Moderator').parentNode.parentNode.dispatch('submit');await new Promise(r=>setImmediate(r));
  h.profile({id:'B'.repeat(43),name:'Other owner'});await h.view.open();h.release();await pending;
  assert.equal(h.records.has('B'.repeat(43)),false,'old action must not write B state');
});
test('effective access previews unsaved mode and permission edits without persisting them',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('node-valheim').dispatch('click');await settings(h,'page-access');
  h.find('preview-member').value='demo-luca';h.find('access-mode').value='restricted';await h.find('preview-access').dispatch('click');
  assert.equal(h.find('access-result').dataset.permissionView,'false');assert.equal(h.records.get('A'.repeat(43)).nodes.find(n=>n.id==='valheim').access.mode,'all');
});
test('explicit publishing opens a shared tree and sends through live transport without changing demo history',async()=>{
  const calls=[],snapshot={hubId:'live-hub',id:'live-hub',name:'Shared guild',revision:1,nodes:[{id:'live-hub',type:'hub',name:'Shared guild',parentId:null},{id:'shared-text',type:'text',name:'Shared chat',parentId:'live-hub'}],members:[]};
  const liveApi={disconnect(){},async publish(){calls.push('publish');return {hubId:'live-hub'};},async connect(){return snapshot;},async history(){return {messages:[{id:'remote-message',text:'From the community',authorId:'Other',sequence:1}]};},async send(channel,text){calls.push(['send',channel,text]);return {message:{id:'new',channelId:channel,text,authorId:'Owner',sequence:2}};}};
  const h=harness({realModel:true,liveApi});await h.view.open();assert.equal(calls.length,0);await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');
  assert.ok(h.all().some(n=>n.textContent==='Live community'));await h.find('live-node-shared-text').dispatch('click');assert.ok(h.all().some(n=>n.textContent==='From the community'));
  h.find('live-message').value='Shared reply';await h.find('live-message-form').dispatch('submit');assert.deepEqual(calls.at(-1),['send','shared-text','Shared reply']);
  assert.equal(h.records.get('A'.repeat(43))?.messages?.['shared-text'],undefined);
});
test('retrying an unacknowledged shared message reuses its author-scoped message ID',async()=>{
  const attempts=[],snapshot={hubId:'hub-live',id:'hub-live',name:'Shared',revision:1,nodes:[{id:'hub-live',type:'hub',name:'Shared',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'hub-live'}],members:[]};
  const liveApi={disconnect(){},async publish(){return {hubId:'hub-live'};},async connect(){return snapshot;},async history(){return {messages:[]};},async send(channel,text,options){attempts.push(options?.id);if(attempts.length===1){const error=Error('Acknowledgment lost');error.messageId='same-message-id-123';throw error;}return {message:{id:options.id,text,channelId:channel,sequence:1}};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');
  h.find('live-message').value='Retry safely';await h.find('live-message-form').dispatch('submit');await h.find('live-message-form').dispatch('submit');assert.equal(attempts[1],'same-message-id-123');
});
test('hiding the workspace stops media and awaits backend cleanup before disconnecting its transport',async()=>{
  let finish,disposed=false,disconnected=false;const snapshot={hubId:'live',id:'live',name:'Live',revision:1,nodes:[{id:'live',type:'hub',name:'Live',parentId:null}],members:[]};
  const liveApi={disconnect(){disconnected=true;},async publish(){return {hubId:'live'};},async connect(){return snapshot;}},voiceApi={leave(){},async dispose(){disposed=true;await new Promise(r=>finish=r);}};
  const h=harness({realModel:true,liveApi,voiceApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');h.view.hide();
  assert.equal(disposed,true);assert.equal(disconnected,false);finish();await new Promise(r=>setImmediate(r));assert.equal(disconnected,true);
});
test('home configuration exposes announcements and featured destinations and owner can add a role',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('home').dispatch('click');await settings(h,'page-manage');
  h.find('home-announcements').value='Guild gathering tonight';h.find('home-featured').value='valheim';await h.find('home-announcements').parentNode.parentNode.dispatch('submit');
  await settings(h,'page-home');assert.ok(h.all().some(n=>n.textContent==='Guild gathering tonight'));assert.ok(h.find('featured-valheim'));
  await settings(h,'page-access');h.find('new-role-name').value='Raid leader';h.find('new-role-authority').value='50';await h.find('new-role-name').parentNode.parentNode.dispatch('submit');
  assert.ok(h.records.get('A'.repeat(43)).hubs[0].roles.some(r=>r.name==='Raid leader'));
});
test('shared search reveals matching ancestors while preserving collapse and keyboard navigation',async()=>{
  const snapshot={hubId:'live',id:'live',name:'Live',revision:1,nodes:[{id:'live',type:'hub',name:'Live',parentId:null},{id:'folder',type:'folder',name:'Games',parentId:'live'},{id:'chat',type:'text',name:'Plans',parentId:'folder'}],members:[]},liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');
  await h.find('live-collapse-folder').dispatch('click');assert.equal(h.find('live-node-chat'),undefined);const search=h.find('live-tree-search');search.value='Plans';await search.dispatch('input');assert.equal(h.find('live-tree-search'),search);assert.ok(h.find('live-node-folder'));assert.ok(h.find('live-node-chat'));
});
test('theme libraries have separate identity metadata and asset namespaces',async()=>{
  const h=harness({realModel:true,realThemes:true});await h.view.open();h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();
  assert.equal(h.themeManagerCalls.length,2);assert.ok(h.themeManagerCalls[0].storageKey.endsWith('A'.repeat(43)));assert.ok(h.themeManagerCalls[1].storageKey.endsWith('B'.repeat(43)));
});
test('shared Space managers review pending approvals through revision-checked service actions',async()=>{
  const reviews=[],snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Live',revision:3,nodes:[{id:'live',type:'hub',name:'Live',parentId:null},{id:'space',type:'space',name:'Members',parentId:'live'}],members:[{id:'A'.repeat(43),roles:['Member','Admissions']}],roles:[{id:'Member',permissions:['view']},{id:'Admissions',scopeId:'space',permissions:['view','roles']}]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async accessRequests(){return {revision:3,requests:[{scopeId:'space',memberId:'requester',name:'Applicant'}]};},async reviewAccess(value){reviews.push(value);return {status:'approved',revision:4};},async snapshot(){return {...snapshot,revision:4};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await h.find('live-node-space').dispatch('click');await settings(h,'live-page-access');await h.find('load-access-requests').dispatch('click');await h.find('approve-requester').dispatch('click');
  assert.deepEqual(structuredClone(reviews[0]),{scopeId:'space',memberId:'requester',approve:true,expectedRevision:3});
});
test('all new community scripts reach development hosts and frozen release bundles',()=>{
  const root=new URL('../',import.meta.url);
  const names=['community-ui.js','community-model.js','community-themes.js','community-studio.js','community-theme-sharing.js','community-live.js','community-voice.js','community-workspace.js'];
  for(const path of ['Vumiro.Client/WebServer/friends.html','scripts/bundle-client-web.mjs','Vumiro.Linux/main.cjs','Vumiro.Linux/build/prepare-assets.mjs','cloudflare/prepare-assets.mjs','cloudflare/worker.js']) {
    const source=fs.readFileSync(new URL(path,root),'utf8');for(const name of names)assert.ok(source.includes(name),`${path} serves ${name}`);
  }
});

test('shared owners configure home placement, authority roles and restore archived nodes',async()=>{
  const mutations=[],snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:5,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null,home:{preset:'banner',welcome:'Welcome guild',announcements:'Tonight we build',featuredIds:['space']}},{id:'space',type:'space',name:'Valheim',parentId:'live'}],members:[{id:'A'.repeat(43),roles:[]}],roles:[{id:'Member',name:'Member',authority:10,permissions:['view','post']}]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async mutate(ops,revision){mutations.push({ops:structuredClone(ops),revision});return snapshot;},async archives(){return {revision:5,nodes:[{id:'old',name:'Old channel'}]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');
  assert.ok(h.all().some(n=>n.className==='ch-banner'));assert.ok(h.all().some(n=>n.textContent==='Tonight we build'));assert.ok(h.find('live-featured-space'));
  await settings(h,'live-page-manage');h.find('live-home-preset').value='split';await h.find('live-home-preset').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].node.home.preset,'split');
  await settings(h,'live-page-access');h.find('live-equal-authority').value='yes';await h.find('live-equal-authority').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].equalAuthorityModeration,true);
  h.find('live-role-name').value='Raid leader';h.find('live-role-authority').value='50';await h.find('live-role-name').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].role.name,'Raid leader');
  h.find('live-access-mode').value='restricted';h.find('live-access-members').value='selected-member';await h.find('live-access-mode').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].node.access.mode,'restricted');assert.deepEqual(mutations.at(-1).ops[0].node.access.memberIds,['selected-member']);
  h.find('live-permission-post').value='deny';await h.find('live-permission-post').parentNode.parentNode.dispatch('submit');assert.ok(mutations.at(-1).ops[0].node.access.permissions.post.denyRoles.includes('Member'));
  await settings(h,'live-page-manage');await h.find('live-load-archives').dispatch('click');await h.find('live-restore-old').dispatch('click');assert.deepEqual(mutations.at(-1),{ops:[{type:'node.archive',id:'old',archived:false}],revision:5});
});

test('shared moderators remove messages with service authorization',async()=>{
  const removed=[],snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'live'}],members:[]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[{id:'m',text:'Review me',authorId:'B'.repeat(43),sequence:9}]};},async moderate(value){removed.push(value.sequence);return {removed:true};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');await h.find('live-remove-9').dispatch('click');assert.deepEqual(removed,[9]);assert.ok(h.all().some(n=>n.textContent==='Message removed'));
});

test('invitation notices never survive a shared disconnect or identity switch',async()=>{
  const snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null}],members:[{id:'A'.repeat(43),roles:[]}],roles:[]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async invite(){return {hubId:'live',token:'PRIVATE-INVITE-TOKEN'};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await settings(h,'live-page-connections');await h.find('live-invite-member').parentNode.parentNode.dispatch('submit');assert.ok(h.all().some(n=>n.textContent.includes('PRIVATE-INVITE-TOKEN')));
  await h.find('local-demo').dispatch('click');h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');assert.equal(h.all().some(n=>n.textContent.includes('PRIVATE-INVITE-TOKEN')),false);
});

test('shared themes cannot collide with or fall back to an unrelated personal package',async()=>{
  const binding={mode:'package',packageId:'custom',version:'1.0.0'},snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null,themeBinding:binding}],members:[]},liveApi={disconnect(){},async connect(){return snapshot;}};
  const h=harness({realModel:true,realThemes:true,liveApi}),api=h.window.VumiroCommunityThemes,local=structuredClone(api.builtins[0]);local.id='custom';local.tokens.accent='#ff0000';
  const original=api.createManager;api.createManager=options=>{const manager=original(options);if(options?.storageKey)return {...manager,async list(){return [local];},async get(){return local;}};return manager;};
  h.window.VumiroCommunityThemeSharing={create:({manager})=>({async hydrate(){assert.equal((await manager.list()).some(p=>p.id==='custom'),false,'receiving cache starts without personal packages');throw Error('Shared artwork unavailable');}})};
  await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');assert.ok(h.find('live-tree'),'shared tree remains usable with a neutral fallback');const content=h.all().find(n=>n.className==='ch-content');assert.notEqual(content.style['--community-accent'],'#ff0000');assert.ok(h.all().some(n=>n.textContent==='Shared artwork unavailable'));
});

test('a delegated Space manager can moderate through inherited permissions',async()=>{
  const me='A'.repeat(43),snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'space',type:'space',name:'Space',parentId:'live',managers:[me]},{id:'chat',type:'text',name:'Chat',parentId:'space'}],members:[{id:me,roles:['Leader']},{id:'C'.repeat(43),roles:['Member']}],roles:[{id:'Leader',authority:50,permissions:['view']},{id:'Member',authority:10,permissions:['view']}]},liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[{id:'m',authorId:'C'.repeat(43),sequence:2,text:'Message'}]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');assert.ok(h.find('live-remove-2'));
});
