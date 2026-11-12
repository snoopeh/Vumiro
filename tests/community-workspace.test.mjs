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
  const document={createElement:tag=>new Element(tag)},mount=new Element('section');
  const model={snapshot:()=>structuredClone(state),status:()=>({saved:true}),tree:(_,opts)=>state.nodes.filter(n=>!opts.query||n.name.includes(opts.query)||n.id==='folder'),breadcrumbs:()=>[state.nodes[0],state.nodes[1]],visibleActivity:()=>[],unreadTotal:()=>0,
    async selectNode(id){calls.push(['select',id]);state.selectedNodeId=id;},async selectHub(id){state.selectedHubId=id;state.selectedNodeId=null;},async setCollapsed(id,value){state.collapsed=value?[id]:[];},async setDraft(id,value){state.drafts[id]=value;},async postMessage(id,value){calls.push(['post',id,value]);state.messages[id].push({id:'m',author:'Owner',text:value,at:0});state.drafts[id]='';}};
  const window={VumiroCommunityModel:{createStore:async({identity})=>{records.set(identity,true);if(defer)await new Promise(r=>release=r);return model;},createLocalStorageAdapter:()=>({})}};
  if(liveApi)window.VumiroCommunityLive={create:options=>{liveApi.options=options;return liveApi;}};
  if(voiceApi)window.VumiroCommunityVoice={create:()=>voiceApi};
  const context={window,document,console,structuredClone,Date};vm.createContext(context);
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
test('persistent tree opens a text channel and preserves a draft through home navigation',async()=>{
  const h=harness();await h.view.open();assert.ok(h.mount.shadowRoot,'community styles have a shadow boundary');
  assert.ok(h.all().some(n=>n.textContent==='Community Hub'));assert.ok(h.find('tree'));
  await h.find('node-text').dispatch('click');const draft=h.find('message');draft.value='<img onerror=bad()>';await draft.dispatch('input');
  await h.find('home').dispatch('click');assert.ok(h.find('node-text'),'tree remains beside home');
  await h.find('node-text').dispatch('click');assert.equal(h.find('message').value,'<img onerror=bad()>');
  await h.find('message-form').dispatch('submit');assert.equal(h.calls.at(-1)[0],'post');
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
  const h=harness({realModel:true});await h.view.open();await h.find('home').dispatch('click');await h.find('page-manage').dispatch('click');
  const name=h.find('create-name');name.value='My Space';h.find('create-kind').value='space';await name.parentNode.parentNode.dispatch('submit');
  let saved=h.records.get('A'.repeat(43)),space=saved.nodes.find(n=>n.name==='My Space');assert.ok(space);
  await h.find('node-'+space.id).dispatch('click');await h.find('page-manage').dispatch('click');
  const preset=h.find('home-preset');preset.value='banner';h.find('home-welcome').value='Guild welcome';await preset.parentNode.parentNode.dispatch('submit');
  saved=h.records.get('A'.repeat(43));assert.equal(saved.nodes.find(n=>n.id===space.id).home.preset,'banner');
  await h.find('page-access').dispatch('click');const access=h.find('access-mode');access.value='restricted';h.find('access-members').value='demo-luca';await access.parentNode.parentNode.dispatch('submit');
  await h.find('preview-access').dispatch('click');assert.ok(h.find('access-result').textContent.includes('view'));
});
test('owners configure scoped permission dimensions, delegation, and equal authority role brackets',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('node-valheim').dispatch('click');await h.find('page-access').dispatch('click');
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
  await h.find('page-themes').dispatch('click');await h.find('simplified-style').dispatch('click');content=h.all().find(n=>n.className==='ch-content');assert.equal(content.style['--community-font-heading'],'"Segoe UI", sans-serif');
});
test('an in-flight authority save cannot apply its second mutation to another identity',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('page-access').dispatch('click');h.find('equal-authority').value='yes';
  h.blockSave();const pending=h.find('authority-Moderator').parentNode.parentNode.dispatch('submit');await new Promise(r=>setImmediate(r));
  h.profile({id:'B'.repeat(43),name:'Other owner'});await h.view.open();h.release();await pending;
  assert.equal(h.records.has('B'.repeat(43)),false,'old action must not write B state');
});
test('effective access previews unsaved mode and permission edits without persisting them',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('node-valheim').dispatch('click');await h.find('page-access').dispatch('click');
  h.find('preview-member').value='demo-luca';h.find('access-mode').value='restricted';await h.find('preview-access').dispatch('click');
  assert.equal(JSON.parse(h.find('access-result').textContent).view,false);assert.equal(h.records.get('A'.repeat(43)).nodes.find(n=>n.id==='valheim').access.mode,'all');
});
test('explicit publishing opens a shared tree and sends through live transport without changing demo history',async()=>{
  const calls=[],snapshot={hubId:'live-hub',id:'live-hub',name:'Shared guild',revision:1,nodes:[{id:'live-hub',type:'hub',name:'Shared guild',parentId:null},{id:'shared-text',type:'text',name:'Shared chat',parentId:'live-hub'}],members:[]};
  const liveApi={disconnect(){},async publish(){calls.push('publish');return {hubId:'live-hub'};},async connect(){return snapshot;},async history(){return {messages:[{id:'remote-message',text:'From the community',authorId:'Other',sequence:1}]};},async send(channel,text){calls.push(['send',channel,text]);return {message:{id:'new',channelId:channel,text,authorId:'Owner',sequence:2}};}};
  const h=harness({realModel:true,liveApi});await h.view.open();assert.equal(calls.length,0);await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');
  assert.ok(h.all().some(n=>n.textContent==='Live community'));await h.find('live-node-shared-text').dispatch('click');assert.ok(h.all().some(n=>n.textContent==='From the community'));
  h.find('live-message').value='Shared reply';await h.find('live-message-form').dispatch('submit');assert.deepEqual(calls.at(-1),['send','shared-text','Shared reply']);
  assert.equal(h.records.get('A'.repeat(43))?.messages?.['shared-text'],undefined);
});
test('retrying an unacknowledged shared message reuses its author-scoped message ID',async()=>{
  const attempts=[],snapshot={hubId:'hub-live',id:'hub-live',name:'Shared',revision:1,nodes:[{id:'hub-live',type:'hub',name:'Shared',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'hub-live'}],members:[]};
  const liveApi={disconnect(){},async publish(){return {hubId:'hub-live'};},async connect(){return snapshot;},async history(){return {messages:[]};},async send(channel,text,options){attempts.push(options?.id);if(attempts.length===1){const error=Error('Acknowledgment lost');error.messageId='same-message-id-123';throw error;}return {message:{id:options.id,text,channelId:channel,sequence:1}};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');
  h.find('live-message').value='Retry safely';await h.find('live-message-form').dispatch('submit');await h.find('live-message-form').dispatch('submit');assert.equal(attempts[1],'same-message-id-123');
});
test('hiding the workspace stops media and awaits backend cleanup before disconnecting its transport',async()=>{
  let finish,disposed=false,disconnected=false;const snapshot={hubId:'live',id:'live',name:'Live',revision:1,nodes:[{id:'live',type:'hub',name:'Live',parentId:null}],members:[]};
  const liveApi={disconnect(){disconnected=true;},async publish(){return {hubId:'live'};},async connect(){return snapshot;}},voiceApi={leave(){},async dispose(){disposed=true;await new Promise(r=>finish=r);}};
  const h=harness({realModel:true,liveApi,voiceApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');h.view.hide();
  assert.equal(disposed,true);assert.equal(disconnected,false);finish();await new Promise(r=>setImmediate(r));assert.equal(disconnected,true);
});
test('home configuration exposes announcements and featured destinations and owner can add a role',async()=>{
  const h=harness({realModel:true});await h.view.open();await h.find('home').dispatch('click');await h.find('page-manage').dispatch('click');
  h.find('home-announcements').value='Guild gathering tonight';h.find('home-featured').value='valheim';await h.find('home-announcements').parentNode.parentNode.dispatch('submit');
  await h.find('page-home').dispatch('click');assert.ok(h.all().some(n=>n.textContent==='Guild gathering tonight'));assert.ok(h.find('featured-valheim'));
  await h.find('page-access').dispatch('click');h.find('new-role-name').value='Raid leader';h.find('new-role-authority').value='50';await h.find('new-role-name').parentNode.parentNode.dispatch('submit');
  assert.ok(h.records.get('A'.repeat(43)).hubs[0].roles.some(r=>r.name==='Raid leader'));
});
test('shared search reveals matching ancestors while preserving collapse and keyboard navigation',async()=>{
  const snapshot={hubId:'live',id:'live',name:'Live',revision:1,nodes:[{id:'live',type:'hub',name:'Live',parentId:null},{id:'folder',type:'folder',name:'Games',parentId:'live'},{id:'chat',type:'text',name:'Plans',parentId:'folder'}],members:[]},liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');
  await h.find('live-collapse-folder').dispatch('click');assert.equal(h.find('live-node-chat'),undefined);const search=h.find('live-tree-search');search.value='Plans';await search.dispatch('input');assert.equal(h.find('live-tree-search'),search);assert.ok(h.find('live-node-folder'));assert.ok(h.find('live-node-chat'));
});
test('theme libraries have separate identity metadata and asset namespaces',async()=>{
  const h=harness({realModel:true,realThemes:true});await h.view.open();h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();
  assert.equal(h.themeManagerCalls.length,2);assert.ok(h.themeManagerCalls[0].storageKey.endsWith('A'.repeat(43)));assert.ok(h.themeManagerCalls[1].storageKey.endsWith('B'.repeat(43)));
});
test('shared Space managers review pending approvals through revision-checked service actions',async()=>{
  const reviews=[],snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Live',revision:3,nodes:[{id:'live',type:'hub',name:'Live',parentId:null},{id:'space',type:'space',name:'Members',parentId:'live'}],members:[],roles:[]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async accessRequests(){return {revision:3,requests:[{scopeId:'space',memberId:'requester',name:'Applicant'}]};},async reviewAccess(value){reviews.push(value);return {status:'approved',revision:4};},async snapshot(){return {...snapshot,revision:4};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');await h.find('live-node-space').dispatch('click');await h.find('live-page-manage').dispatch('click');await h.find('load-access-requests').dispatch('click');await h.find('approve-requester').dispatch('click');
  assert.deepEqual(structuredClone(reviews[0]),{scopeId:'space',memberId:'requester',approve:true,expectedRevision:3});
});
test('all new community scripts reach development hosts and frozen release bundles',()=>{
  const root=new URL('../',import.meta.url);
  const names=['community-model.js','community-themes.js','community-studio.js','community-theme-sharing.js','community-live.js','community-voice.js','community-workspace.js'];
  for(const path of ['Vumiro.Client/WebServer/friends.html','scripts/bundle-client-web.mjs','Vumiro.Linux/main.cjs','Vumiro.Linux/build/prepare-assets.mjs','cloudflare/prepare-assets.mjs','cloudflare/worker.js']) {
    const source=fs.readFileSync(new URL(path,root),'utf8');for(const name of names)assert.ok(source.includes(name),`${path} serves ${name}`);
  }
});

test('shared owners configure home placement, authority roles and restore archived nodes',async()=>{
  const mutations=[],snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:5,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null,home:{preset:'banner',welcome:'Welcome guild',announcements:'Tonight we build',featuredIds:['space']}},{id:'space',type:'space',name:'Valheim',parentId:'live'}],members:[],roles:[{id:'Member',name:'Member',authority:10,permissions:['view','post']}]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async mutate(ops,revision){mutations.push({ops:structuredClone(ops),revision});return snapshot;},async archives(){return {revision:5,nodes:[{id:'old',name:'Old channel'}]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');
  assert.ok(h.all().some(n=>n.className==='ch-banner'));assert.ok(h.all().some(n=>n.textContent==='Tonight we build'));assert.ok(h.find('live-featured-space'));
  await h.find('live-page-manage').dispatch('click');h.find('live-home-preset').value='split';await h.find('live-home-preset').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].node.home.preset,'split');
  h.find('live-equal-authority').value='yes';await h.find('live-equal-authority').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].equalAuthorityModeration,true);
  h.find('live-role-name').value='Raid leader';h.find('live-role-authority').value='50';await h.find('live-role-name').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].role.name,'Raid leader');
  h.find('live-access-mode').value='restricted';h.find('live-access-members').value='selected-member';await h.find('live-access-mode').parentNode.parentNode.dispatch('submit');assert.equal(mutations.at(-1).ops[0].node.access.mode,'restricted');assert.deepEqual(mutations.at(-1).ops[0].node.access.memberIds,['selected-member']);
  h.find('live-permission-post').value='deny';await h.find('live-permission-post').parentNode.parentNode.dispatch('submit');assert.ok(mutations.at(-1).ops[0].node.access.permissions.post.denyRoles.includes('Member'));
  await h.find('live-load-archives').dispatch('click');await h.find('live-restore-old').dispatch('click');assert.deepEqual(mutations.at(-1),{ops:[{type:'node.archive',id:'old',archived:false}],revision:5});
});

test('shared moderators remove messages with service authorization',async()=>{
  const removed=[],snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'chat',type:'text',name:'Chat',parentId:'live'}],members:[]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[{id:'m',text:'Review me',authorId:'B'.repeat(43),sequence:9}]};},async moderate(value){removed.push(value.sequence);return {removed:true};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');await h.find('live-remove-9').dispatch('click');assert.deepEqual(removed,[9]);assert.ok(h.all().some(n=>n.textContent==='Message removed'));
});

test('invitation notices never survive a shared disconnect or identity switch',async()=>{
  const snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null}],members:[],roles:[]};
  const liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async invite(){return {hubId:'live',token:'PRIVATE-INVITE-TOKEN'};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');await h.find('live-page-manage').dispatch('click');await h.find('live-invite-member').parentNode.parentNode.dispatch('submit');assert.ok(h.all().some(n=>n.textContent.includes('PRIVATE-INVITE-TOKEN')));
  await h.find('local-demo').dispatch('click');h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');assert.equal(h.all().some(n=>n.textContent.includes('PRIVATE-INVITE-TOKEN')),false);
});

test('shared themes cannot collide with or fall back to an unrelated personal package',async()=>{
  const binding={mode:'package',packageId:'custom',version:'1.0.0'},snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null,themeBinding:binding}],members:[]},liveApi={disconnect(){},async connect(){return snapshot;}};
  const h=harness({realModel:true,realThemes:true,liveApi}),api=h.window.VumiroCommunityThemes,local=structuredClone(api.builtins[0]);local.id='custom';local.tokens.accent='#ff0000';
  const original=api.createManager;api.createManager=options=>{const manager=original(options);if(options?.storageKey)return {...manager,async list(){return [local];},async get(){return local;}};return manager;};
  h.window.VumiroCommunityThemeSharing={create:({manager})=>({async hydrate(){assert.equal((await manager.list()).some(p=>p.id==='custom'),false,'receiving cache starts without personal packages');throw Error('Shared artwork unavailable');}})};
  await h.view.open();await h.find('page-connections').dispatch('click');h.find('live-hub-id').value='live';await h.find('live-hub-id').parentNode.parentNode.dispatch('submit');assert.ok(h.find('live-tree'),'shared tree remains usable with a neutral fallback');const content=h.all().find(n=>n.className==='ch-content');assert.notEqual(content.style['--community-accent'],'#ff0000');assert.ok(h.all().some(n=>n.textContent==='Shared artwork unavailable'));
});

test('a delegated Space manager can moderate through inherited permissions',async()=>{
  const me='A'.repeat(43),snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'space',type:'space',name:'Space',parentId:'live',managers:[me]},{id:'chat',type:'text',name:'Chat',parentId:'space'}],members:[{id:me,roles:['Leader']},{id:'C'.repeat(43),roles:['Member']}],roles:[{id:'Leader',authority:50,permissions:['view']},{id:'Member',authority:10,permissions:['view']}]},liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[{id:'m',authorId:'C'.repeat(43),sequence:2,text:'Message'}]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await h.find('page-connections').dispatch('click');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');assert.ok(h.find('live-remove-2'));
});
