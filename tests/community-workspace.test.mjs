import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

function harness({defer=false,realModel=false,realThemes=true,realStudio=false,marketplaceModel=false,liveApi,voiceApi,picker=false,friends=[],catalog=false}={}) {
  let profile={id:'A'.repeat(43),name:'Owner'},release,blockSave=false;
  const records=new Map(),calls=[],themeManagerCalls=[],studios=[],webRecords=new Map();
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
  const window={crypto:webcrypto,localStorage:{getItem:key=>webRecords.get(key)??null,setItem:(key,value)=>webRecords.set(key,String(value)),removeItem:key=>webRecords.delete(key)},VumiroCommunityModel:{createStore:async({identity})=>{records.set(identity,true);if(defer)await new Promise(r=>release=r);return model;},createLocalStorageAdapter:()=>({})}};
  if(liveApi)window.VumiroCommunityLive={create:options=>{liveApi.options=options;return liveApi;}};
  if(voiceApi)window.VumiroCommunityVoice={create:()=>voiceApi};
  const context={window,document,console,structuredClone,Date,URL,TextEncoder,atob,btoa};vm.createContext(context);
  if(catalog){vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-live.js',import.meta.url),'utf8'),context);window.VumiroCommunityLive={...window.VumiroCommunityLive,create:options=>{liveApi.options=options;return liveApi;}};}
  const visualFile=new URL('../Vumiro.Client/WebServer/community-ui.js',import.meta.url);if(fs.existsSync(visualFile))vm.runInContext(fs.readFileSync(visualFile,'utf8'),context);
  const storage={async load(id){return records.get(id)??null;},async save(id,value){if(blockSave){blockSave=false;await new Promise(r=>release=r);}records.set(id,structuredClone(value));}};
  if(realModel)vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-model.js',import.meta.url),'utf8'),context);
  if(realThemes){vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-themes.js',import.meta.url),'utf8'),context);const original=window.VumiroCommunityThemes.createManager;window.VumiroCommunityThemes.createManager=options=>{themeManagerCalls.push(options);return original(options);};}
  if(realStudio){vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-studio.js',import.meta.url),'utf8'),context);const original=window.VumiroCommunityStudio.createCustomizer;window.VumiroCommunityStudio.createCustomizer=options=>{const studio=original(options);studios.push(studio);return studio;};}
  if(marketplaceModel)vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/marketplace-model.js',import.meta.url),'utf8'),context);
  const file=new URL('../Vumiro.Client/WebServer/community-workspace.js',import.meta.url);
  if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);
  assert.ok(window.VumiroCommunityHub,'community view exists');
  const view=window.VumiroCommunityHub.create({mount,getProfile:()=>profile,getFriends:()=>friends,storage:realModel?storage:{},identityProvider:{profile:()=>profile}});
  const all=(node=mount)=>[node,...node.children.flatMap(c=>all(c)),...(node.shadowRoot?all(node.shadowRoot):[])];
  if(!picker){const open=view.open;view.open=async()=>{const result=await open();const card=all().find(n=>n.dataset.action==='enter-local-'+(realModel?'workshop':'hub'));if(card)await card.dispatch('click');return result;};}
  return {view,mount,all,calls,state,document,window,records,webRecords,themeManagerCalls,studios,find:key=>all().find(n=>n.dataset.action===key),profile:value=>profile=value,release:()=>release(),blockSave:()=>blockSave=true};
}
async function settings(h,key){if(!h.find(key))await h.find('scope-settings').dispatch('click');await h.find(key).dispatch('click');}

test('Community Hub opens the community library and returning preserves a channel draft',async()=>{
  const h=harness({realModel:true,picker:true});await h.view.open();assert.ok(h.find('community-library'));assert.equal(h.find('tree'),undefined);
  assert.ok(h.find('enter-local-workshop'));await h.find('enter-local-workshop').dispatch('click');await h.find('node-workbench').dispatch('click');h.find('message').value='Remember this';await h.find('message').dispatch('input');
  await h.find('back-to-communities').dispatch('click');assert.ok(h.find('community-library'));await h.find('enter-local-workshop').dispatch('click');assert.equal(h.find('message').value,'Remember this');
  h.view.hide();await h.view.open();assert.ok(h.find('community-library'),'each main-navigation entry starts at the library');
});

test('library creates and filters communities and reports simulated members honestly',async()=>{
  const h=harness({realModel:true,picker:true});await h.view.open();assert.ok(h.all().some(n=>n.textContent==='Local demo'));
  assert.equal(h.all().some(n=>n.textContent==='2 friends here'),false);await h.find('library-create').dispatch('click');h.find('library-hub-name').value='Night owls';await h.find('library-create-form').dispatch('submit');
  assert.ok(h.find('community-library'));assert.ok(h.all().some(n=>n.textContent==='Night owls'));h.find('library-search').value='no matches';await h.find('library-search').dispatch('input');assert.ok(h.all().some(n=>n.textContent==='No matching communities.'));
});

test('card artwork and frame controls persist without changing the open channel',async()=>{
  const h=harness({realModel:true,picker:true});await h.view.open();await h.find('enter-local-workshop').dispatch('click');await h.find('node-workbench').dispatch('click');await h.find('hub-settings').dispatch('click');await h.find('page-themes').dispatch('click');
  h.find('card-banner').value='https://example.test/banner.webp';h.find('card-icon').value='https://example.test/icon.png';h.find('card-frame').value='regal';h.find('card-frame-color').value='#dfb575';await h.find('card-artwork-form').dispatch('submit');
  const saved=h.records.get('A'.repeat(43));assert.equal(saved.hubs[0].card.frame,'regal');assert.equal(saved.selectedNodeId,'workbench');await h.find('settings-close').dispatch('click');await h.find('back-to-communities').dispatch('click');
  const card=h.find('card-local-workshop');assert.equal(card.dataset.frame,'regal');assert.ok(h.all().some(n=>n.tagName==='img'&&n.src==='https://example.test/banner.webp'));
});

test('remembered shared hubs show only saved friends observed inside and reenter from the library',async()=>{
  const me='A'.repeat(43),snapshot={hubId:'guild',name:'Guild',revision:1,nodes:[{id:'guild',type:'hub',name:'Guild'},{id:'chat',type:'text',name:'Raid plans',parentId:'guild'}],members:[{id:'offline-member',name:'Not inside'}],presence:[{id:me},{id:'friend',channelId:'chat'},{id:'stranger',channelId:'chat'},{id:'friend',channelId:'chat'}]},liveApi={disconnect(){},async connect(){return snapshot;},async snapshot(){return snapshot;}};
  const h=harness({realModel:true,picker:true,catalog:true,liveApi,friends:[{id:'friend',nickname:'Mira'},{id:'offline-member',nickname:'Offline friend'},{id:me,nickname:'Me'}]});
  h.window.VumiroCommunityLive.createCatalog({identity:me,storage:h.window.localStorage}).remember(snapshot);await h.view.open();await new Promise(r=>setImmediate(r));
  assert.ok(h.all().some(n=>n.textContent==='1 friend here'));assert.ok(h.all().some(n=>n.textContent==='Mira'));assert.ok(h.all().some(n=>n.textContent==='Raid plans'));assert.equal(h.all().some(n=>n.textContent==='Offline friend'),false);
  const details=h.find('friends-shared-guild');assert.equal(details.open,false);await details.dispatch('pointerenter');assert.equal(details.open,true,'hover opens the native details content');await details.dispatch('pointerleave');assert.equal(details.open,false);await details.dispatch('focusin');details.matches=selector=>selector===':focus-within';await details.dispatch('pointerleave');assert.equal(details.open,true,'pointer movement cannot close keyboard-focused details');await h.find('friends-summary-shared-guild').dispatch('click');assert.equal(details.open,true,'click pins friend details for touch and keyboard');await details.dispatch('pointerleave');assert.equal(details.open,true);
  await h.find('enter-shared-guild').dispatch('click');assert.ok(h.find('live-tree'));await h.find('back-to-communities').dispatch('click');assert.ok(h.find('enter-shared-guild'));await h.find('enter-shared-guild').dispatch('click');assert.ok(h.find('live-tree'));
});

test('failed presence refresh clears the previous count and a late refresh cannot cross profiles',async()=>{
  const snapshot={hubId:'guild',name:'Guild',nodes:[{id:'guild',type:'hub',name:'Guild'}],presence:[{id:'friend'}]};let fail=false,finish;
  const liveApi={disconnect(){},async connect(){if(fail)throw Error('Unavailable');return snapshot;}};
  const h=harness({realModel:true,picker:true,catalog:true,liveApi,friends:[{id:'friend',name:'Mira'}]});h.window.VumiroCommunityLive.createCatalog({identity:'A'.repeat(43),storage:h.window.localStorage}).remember(snapshot);
  await h.view.open();await new Promise(r=>setImmediate(r));assert.ok(h.all().some(n=>n.textContent==='1 friend here'));fail=true;await h.find('library-refresh').dispatch('click');assert.equal(h.all().some(n=>n.textContent==='1 friend here'),false);assert.ok(h.all().some(n=>n.textContent==='Unavailable · Try refreshing'));
  liveApi.connect=()=>new Promise(r=>finish=r);const pending=h.find('library-refresh').dispatch('click');h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();finish(snapshot);await pending;assert.equal(h.find('enter-shared-guild'),undefined);
});

test('a failed hub switch cannot leave the old hub attached to a disconnected transport',async()=>{
  let shouldFail=false,active=null;const connections=[],snapshot=id=>({hubId:id,name:id,nodes:[{id,type:'hub',name:id}],presence:[]}),liveApi={disconnect(){active=null;},async connect(id){connections.push(id);active=id;if(shouldFail&&id==='second')throw Error('Offline');return snapshot(id);},async snapshot(){return snapshot(active);}};
  const h=harness({realModel:true,picker:true,catalog:true,liveApi});const catalog=h.window.VumiroCommunityLive.createCatalog({identity:'A'.repeat(43),storage:h.window.localStorage});catalog.remember(snapshot('first'));catalog.remember(snapshot('second'));await h.view.open();await new Promise(r=>setImmediate(r));
  await h.find('enter-shared-first').dispatch('click');await h.find('back-to-communities').dispatch('click');shouldFail=true;await h.find('enter-shared-second').dispatch('click');assert.ok(h.find('community-library'));const before=connections.length;await h.find('enter-shared-first').dispatch('click');assert.equal(connections.length,before+1);assert.equal(active,'first');
});

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
  await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');assert.ok(h.find('live-tree'),'shared tree remains usable with a neutral fallback');const content=h.all().find(n=>n.className==='ch-content');assert.notEqual(content.style['--community-accent'],'#ff0000');assert.ok(h.all().some(n=>/curated|built-in|builtin/i.test(n.textContent)));
});

test('a delegated Space manager can moderate through inherited permissions',async()=>{
  const me='A'.repeat(43),snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'space',type:'space',name:'Space',parentId:'live',managers:[me]},{id:'chat',type:'text',name:'Chat',parentId:'space'}],members:[{id:me,roles:['Leader']},{id:'C'.repeat(43),roles:['Member']}],roles:[{id:'Leader',authority:50,permissions:['view']},{id:'Member',authority:10,permissions:['view']}]},liveApi={disconnect(){},async publish(){return {hubId:'live'};},async connect(){return snapshot;},async history(){return {messages:[{id:'m',authorId:'C'.repeat(43),sequence:2,text:'Message'}]};}};
  const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');await h.find('live-node-chat').dispatch('click');assert.ok(h.find('live-remove-2'));
});


test('appearance settings invoke the curated customizer and offer marketplace browsing',async()=>{
  const h=harness({realModel:true,realThemes:true}),opened=[];let browsed=0;
  h.document.getElementById=id=>id==='marketplaceNav'?{click(){browsed++;}}:null;
  h.window.VumiroCommunityStudio={create(){assert.fail('Consumer must not open the raw creator');},createCustomizer(options){opened.push(options);return {destroy(){}};}};
  await h.view.open();await settings(h,'page-themes');assert.equal(opened.length,1);assert.equal(opened[0].manager,undefined);assert.equal(opened[0].packages.length,0);const preview=opened[0].previewRoot;for(const slot of ['banner','heading','card','navigation','message','input','button'])assert.ok(h.all(preview).some(n=>n.dataset.communitySlot===slot),'preview includes '+slot);opened[0].onBrowse();assert.equal(browsed,1);
});

test('marketplace adapter applies curated packages to local targets while hidden and isolates identities',async()=>{
  const h=harness({realModel:true,realThemes:true});assert.equal(typeof h.window.VumiroCommunityMarketplace?.targets,'function');assert.equal(h.window.VumiroCommunityMarketplace.targets().length,0);
  await h.view.open();const adapter=h.window.VumiroCommunityMarketplace,target=adapter.targets().find(t=>t.scope==='hub'),pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='curated-market';pkg.tokens.accent='#125abc';
  h.view.hide();await adapter.apply(target,{mode:'package',packageId:pkg.id,version:pkg.version},{package:pkg,mode:'local-demo'});await h.view.open();assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#125abc');
  h.profile({id:'B'.repeat(43),name:'Other'});assert.equal(adapter.targets().length,0);await assert.rejects(adapter.apply(target,{mode:'inherit'},{mode:'local-demo'}),/identity|account|session/i);await h.view.open();assert.notEqual(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#125abc');
  h.profile({id:'A'.repeat(43),name:'Owner'});await h.view.open();assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#125abc');await assert.rejects(adapter.apply(target,{mode:'inherit'},{mode:'local-demo'}),/identity|account|session/i);
});

test('private Spaces accept local imports but detect substituted bytes of a recorded marketplace version',async()=>{
  const h=harness({realModel:true,realThemes:true}),api=h.window.VumiroCommunityThemes;let malicious=structuredClone(api.builtins[0]);malicious.id='legacy-import';malicious.tokens.accent='#ff0011';const original=api.createManager;
  api.createManager=options=>{const manager=original(options);return {...manager,list:async()=>[...await manager.list(),malicious],get:async(id,version)=>id===malicious.id?structuredClone(malicious):manager.get(id,version)};};
  await h.view.open();const adapter=h.window.VumiroCommunityMarketplace,target=adapter?.targets().find(t=>t.scope==='hub');assert.ok(target,'local marketplace target exists');
  await adapter.apply(target,{mode:'package',packageId:malicious.id,version:malicious.version},{mode:'local-demo'});assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#ff0011');
  const builtin=structuredClone(api.builtins[0]);builtin.id='curated-good';builtin.tokens.accent='#123abc';await adapter.apply(target,{mode:'package',packageId:builtin.id,version:builtin.version},{package:builtin,mode:'local-demo'});
  malicious={...builtin,tokens:{...builtin.tokens,accent:'#ff0011'}};h.view.hide();await h.view.open();assert.notEqual(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#ff0011');
});

test('shared context never hydrates raw themes or exposes local marketplace targets after hiding',async()=>{
  const binding={mode:'package',packageId:'raw-shared',version:'1.0.0',sharedPackage:{assets:[],css:'bad'}},snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null,themeBinding:binding}],members:[]};let hydrates=0;
  const h=harness({realModel:true,realThemes:true,liveApi:{disconnect(){},async connect(){return snapshot;}}});h.window.VumiroCommunityThemeSharing={create(){return {async hydrate(){hydrates++;return [];}};}};
  await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');assert.equal(hydrates,0);assert.deepEqual(Array.from(h.window.VumiroCommunityMarketplace.targets()),[]);h.view.hide();assert.deepEqual(Array.from(h.window.VumiroCommunityMarketplace.targets()),[]);await h.view.open();assert.ok(h.window.VumiroCommunityMarketplace.targets().length,'explicitly reopening the local Hub restores local destinations');
});

test('marketplace apply fences async installation before writing a new identity binding',async()=>{
  const h=harness({realModel:true,realThemes:true}),api=h.window.VumiroCommunityThemes,original=api.createManager;let release,started;const paused=new Promise(resolve=>started=resolve);
  api.createManager=options=>{const manager=original(options);return {...manager,install:async pkg=>{started();await new Promise(resolve=>release=resolve);return manager.install(pkg);}};};
  await h.view.open();const adapter=h.window.VumiroCommunityMarketplace;assert.ok(adapter);const target=adapter.targets().find(t=>t.scope==='hub'),pkg=structuredClone(api.builtins[0]);pkg.id='delayed-market';h.view.hide();const operation=adapter.apply(target,{mode:'package',packageId:pkg.id,version:pkg.version},{package:pkg,mode:'local-demo'});await paused;h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();release();await assert.rejects(operation,/identity|account|session/i);assert.equal(h.records.has('B'.repeat(43)),false);
});


test('retained customizer saves cannot target a later identity',async()=>{
 const h=harness({realModel:true,realThemes:true}),opened=[];h.window.VumiroCommunityStudio={createCustomizer:options=>{opened.push(options);return {destroy(){}};}};
 await h.view.open();await settings(h,'page-themes');const save=opened[0].onSave;h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();assert.equal(await save({mode:'package',packageId:'cyberpunk',version:'1.0.0'}),false);assert.equal(h.records.has('B'.repeat(43)),false);
});

test('blocked publication keeps a private marketplace appearance intact without sending artwork',async()=>{
 const published=[],h=harness({realModel:true,realThemes:true,liveApi:{disconnect(){},async publish(value){published.push(value);throw Error('not expected');}}});await h.view.open();const adapter=h.window.VumiroCommunityMarketplace,target=adapter.targets().find(t=>t.scope==='hub'),pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='private-marketplace-appearance';await adapter.apply(target,{mode:'package',packageId:pkg.id,version:pkg.version},{package:pkg,mode:'local-demo'});await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');assert.equal(published.length,0);assert.equal(adapter.targets().find(t=>t.id===target.id).binding.packageId,pkg.id);assert.ok(h.all().some(n=>/review/i.test(n.textContent)));
});


test('a curated decorative pack preserves the same scope theme and explicit layout',async()=>{
 const h=harness({realModel:true,realThemes:true,realStudio:true});await h.view.open();await h.find('node-valheim').dispatch('click');await settings(h,'page-themes');h.studios.at(-1).setLayout('home','split');await h.studios.at(-1).save();const api=h.window.VumiroCommunityThemes,adapter=h.window.VumiroCommunityMarketplace,space=adapter.targets().find(t=>t.id==='valheim'),pkg=structuredClone(api.builtins[0]);pkg.id='local-curated-decoration';pkg.kind='decorative-pack';pkg.tokens={};pkg.layouts={};pkg.css='';pkg.components={banner:{borderColor:'#135ace',borderWidth:'2px',borderStyle:'solid'}};
 await adapter.apply(space,{mode:'package',packageId:pkg.id,version:pkg.version},{package:pkg,mode:'local-demo'});await h.find('node-valheim').dispatch('click');const content=h.all().find(n=>n.className==='ch-content');assert.equal(content.style['--community-accent'],api.builtins.find(pkg=>pkg.id==='viking').tokens.accent);assert.ok(h.all(content).some(n=>n.className==='ch-split'));assert.ok(h.all(content).some(n=>n.dataset.communitySlot==='banner')); assert.ok(h.all(content).some(n=>n.tagName==='style'&&n.textContent.includes('#135ace')));
});


test('child package home layout resets an ancestor split override while unthemed home keeps its placement',async()=>{
 const h=harness({realModel:true,realThemes:true,realStudio:true});await h.view.open();const localAdapter=h.window.VumiroCommunityMarketplace;await localAdapter.apply(localAdapter.targets().find(t=>t.id==='valheim'),{mode:'inherit'},{mode:'local-demo'});await h.find('node-valheim').dispatch('click');assert.ok(h.all().some(n=>n.className==='ch-banner'),'legacy home placement applies before any explicit theme selection');
 await h.find('home').dispatch('click');await settings(h,'page-themes');h.studios.at(-1).setLayout('home','split');await h.studios.at(-1).save();const adapter=h.window.VumiroCommunityMarketplace,space=adapter.targets().find(t=>t.id==='valheim');await adapter.apply(space,{mode:'package',packageId:'aurora',version:'1.0.0'},{mode:'local-demo'});await h.find('node-valheim').dispatch('click');assert.ok(h.all().some(n=>n.className==='ch-banner'),'Aurora starts a fresh banner layout');assert.equal(h.all().some(n=>n.className==='ch-split'),false,'ancestor split does not leak past the child package reset');
});

test('shared package home layout resets inherited overrides and wins over saved home placement',async()=>{
 const snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null,themeBinding:{mode:'inherit',overrides:{layout:{home:'split'}}}},{id:'space',type:'space',name:'Aurora Space',parentId:'live',home:{preset:'compact'},themeBinding:{mode:'package',packageId:'aurora',version:'1.0.0'}}],members:[]},h=harness({realModel:true,realThemes:true,liveApi:{disconnect(){},async connect(){return snapshot;}}});
 await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('live-node-space').dispatch('click');assert.ok(h.all().some(n=>n.className==='ch-banner'));assert.equal(h.all().some(n=>n.className==='ch-split'),false);
});

test('customizer home and room layout changes update the miniature Space regions immediately',async()=>{
 const h=harness({realModel:true,realThemes:true,realStudio:true});await h.view.open();await settings(h,'page-themes');const studio=h.studios.at(-1),preview=h.all().find(n=>n.className==='ch-theme-preview'),activity=()=>h.all(preview).find(n=>n.className==='ch-theme-preview-activity'),hero=()=>h.all(preview).find(n=>n.className.includes('ch-theme-preview-hero'));
 studio.setLayout('home','split');assert.equal(preview.attributes['data-home-layout'],'split');assert.equal(activity().hidden,false);assert.ok(!hero().className.includes('ch-banner'));
 studio.setLayout('home','banner');assert.equal(preview.attributes['data-home-layout'],'banner');assert.equal(activity().hidden,true);assert.ok(hero().className.includes('ch-banner'));
 studio.setLayout('home','compact');studio.setLayout('room','compact');assert.equal(preview.attributes['data-home-layout'],'compact');assert.equal(preview.attributes['data-room-layout'],'compact');assert.equal(activity().hidden,true);assert.ok(!hero().className.includes('ch-banner'));
});


test('oversized decoration composition leaves the current scoped appearance intact',async()=>{
 const h=harness({realModel:true,realThemes:true});await h.view.open();const api=h.window.VumiroCommunityThemes,adapter=h.window.VumiroCommunityMarketplace,target=adapter.targets().find(t=>t.id==='valheim'),base=structuredClone(api.builtins[0]),asset=id=>({id,mime:'image/png',data:'iVBORw0KGgo='});base.id='bounded-curated-base';base.assets=[asset('base-art')];await adapter.apply(target,{mode:'package',packageId:base.id,version:base.version},{package:base,mode:'local-demo'});
 const pack={...structuredClone(base),id:'maximum-decoration',kind:'decorative-pack',tokens:{},components:{},layouts:{},assets:Array.from({length:16},(_,i)=>asset('decoration-'+i))};await assert.rejects(adapter.apply(target,{mode:'package',packageId:pack.id,version:pack.version},{package:pack,mode:'local-demo'}),/16|asset|compos|oversized/i);assert.equal(adapter.targets().find(t=>t.id===target.id).binding.packageId,base.id);
});

test('decoration preserves saved home placement when the scope inherits its appearance',async()=>{
  for(const preset of ['banner','split']){
    const h=harness({realModel:true,realThemes:true});await h.view.open();const api=h.window.VumiroCommunityThemes,adapter=h.window.VumiroCommunityMarketplace,target=adapter.targets().find(t=>t.id==='valheim');
    await adapter.apply(target,{mode:'inherit'},{mode:'local-demo'});await h.find('node-valheim').dispatch('click');await settings(h,'page-manage');const placement=h.find('home-preset');placement.value=preset;await placement.parentNode.parentNode.dispatch('submit');await h.find('settings-close').dispatch('click');
    const expected=preset==='banner'?'ch-banner':'ch-split';assert.ok(h.all().some(n=>n.className===expected),'saved placement applies before decoration');
    const pkg={...structuredClone(api.builtins[0]),id:'inherited-placement-decoration',kind:'decorative-pack',tokens:{},layouts:{},components:{badge:{borderWidth:'2px'}},css:'',motion:'none'};
    await adapter.apply(adapter.targets().find(t=>t.id==='valheim'),{mode:'package',packageId:pkg.id,version:pkg.version},{package:pkg,mode:'local-demo'});assert.ok(h.all().some(n=>n.className===expected),preset+' placement survives decoration');
  }
});

test('local Spaces open the full private editor and apply unreviewed artwork packages on this device',async()=>{
 const h=harness({realModel:true,realThemes:true});let editor;h.window.VumiroMarketplaceStudio={async open(options){editor=options;}};await h.view.open();await h.find('node-valheim').dispatch('click');await settings(h,'page-themes');assert.ok(h.find('private-theme-editor'));await h.find('private-theme-editor').dispatch('click');assert.equal(typeof editor.onApplyLocal,'function');
 const pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='my-unreviewed-private-space';pkg.tokens.accent='#ab1245';await editor.onApplyLocal(pkg);await h.find('settings-close').dispatch('click');assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#ab1245');
});

test('private shared-Space styling never mutates the community',async()=>{
 const snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null}],members:[{id:'A'.repeat(43),roles:['Member']}],roles:[{id:'Member',permissions:['view']}]};let editor,mutations=0;const h=harness({realModel:true,realThemes:true,liveApi:{disconnect(){},async connect(){return snapshot;},async mutate(){mutations++;return snapshot;}}});h.window.VumiroMarketplaceStudio={async open(options){editor=options;}};
 await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await settings(h,'live-page-themes');assert.ok(h.find('private-theme-editor'));await h.find('private-theme-editor').dispatch('click');const pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='private-shared-view';pkg.tokens.accent='#123abc';await editor.onApplyLocal(pkg);assert.equal(mutations,0);assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#123abc');
});

test('publishing a private unreviewed appearance requires review before any network publication',async()=>{
 let publications=0;const h=harness({realModel:true,realThemes:true,liveApi:{async publish(){publications++;throw Error('should not publish');},disconnect(){}}});await h.view.open();const adapter=h.window.VumiroCommunityMarketplace,target=adapter.targets().find(t=>t.scope==='hub'),pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='private-not-reviewed';await adapter.apply(target,{mode:'package',packageId:pkg.id,version:pkg.version},{package:pkg,mode:'local-demo'});await settings(h,'page-connections');await h.find('publish-hub').dispatch('click');assert.equal(publications,0);assert.ok(h.all().some(n=>/review/i.test(n.textContent)));
});


test('Marketplace repeated decoration and undo restore the exact prior scoped composition',async()=>{
 const h=harness({realModel:true,realThemes:true,realStudio:true,marketplaceModel:true});await h.view.open();await h.find('node-valheim').dispatch('click');await settings(h,'page-themes');h.studios.at(-1).setLayout('home','split');await h.studios.at(-1).save();const engine=h.window.VumiroCommunityThemes,adapter=h.window.VumiroCommunityMarketplace,target=adapter.targets().find(t=>t.id==='valheim'),pack=(id,components)=>({...structuredClone(engine.builtins[0]),id,kind:'decorative-pack',tokens:{},layouts:{},css:'',components}),first=pack('first-decoration',{banner:{borderColor:'#125abc',borderWidth:'2px',borderStyle:'solid'}}),second=pack('second-decoration',{message:{borderColor:'#de45ac',borderWidth:'2px',borderStyle:'solid'}}),catalog=[first,second].map(pkg=>({id:pkg.id,title:pkg.name,creatorId:'maker',creatorName:'Maker',kind:pkg.kind,priceCents:0,scopes:['space'],slots:Object.keys(pkg.components),package:pkg,status:'approved'})),library=engine.createManager({adapter:engine.createMemoryAdapter(),metadataStorage:h.window.localStorage,storageKey:'marketplace-install-test'}),model=h.window.VumiroMarketplaceModel.createStore({accountId:'local-account',storage:h.window.localStorage,engine,catalog}),apply=async(t,b)=>{let pkg;try{pkg=await library.get(b.packageId,b.version);}catch{}return adapter.apply(t,b,{package:pkg,mode:'local-demo'});};
 for(const pkg of [first,second]){const destination=adapter.targets().find(t=>t.id===target.id);await model.acquire(pkg.id);await model.install(pkg.id,library);await model.sponsor(pkg.id,destination);await model.apply(pkg.id,destination,apply);}const previous=model.snapshot().previousBindings[target.id];assert.match(previous.packageId,/^curated-/);await model.undo(target,apply);assert.equal(adapter.targets().find(t=>t.id===target.id).binding.packageId,previous.packageId);const content=h.all().find(n=>n.className==='ch-content'),css=h.all(content).filter(n=>n.tagName==='style').map(n=>n.textContent).join(' ');assert.equal(content.style['--community-accent'],engine.builtins.find(pkg=>pkg.id==='viking').tokens.accent);assert.ok(h.all(content).some(n=>n.className==='ch-split'));assert.ok(css.includes('#125abc'));assert.equal(css.includes('#de45ac'),false);
});


test('reviewed shared packages resist private-library collisions and invalid refreshes fall back safely',async()=>{
 const snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null}],members:[]};let response;
 const liveApi={disconnect(){},async connect(){return snapshot;},async snapshot(){return snapshot;},async themePackage(){return response;}};
 const h=harness({realModel:true,liveApi});await h.view.open();const api=h.window.VumiroCommunityThemes,pkg=structuredClone(api.builtins[0]);pkg.id='reviewed-exact-theme';pkg.tokens.accent='#123abc';const checked=api.validate(pkg).package,digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(checked)))).toString('hex');
 const local={...structuredClone(pkg),tokens:{...pkg.tokens,accent:'#ff1234'}},adapter=h.window.VumiroCommunityMarketplace;await adapter.apply(adapter.targets().find(t=>t.scope==='hub'),{mode:'package',packageId:local.id,version:local.version},{package:local,mode:'local-demo'});
 snapshot.nodes[0].themeBinding={mode:'package',packageId:pkg.id,version:pkg.version,marketplace:{itemId:'item-1',versionId:'version-1',digest}};response={itemId:'item-1',versionId:'version-1',digest,package:checked};
 await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#123abc');
 response={...response,digest:'0'.repeat(64)};await liveApi.options.onEvent({type:'community-changed'});await new Promise(r=>setImmediate(r));assert.notEqual(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#123abc');assert.ok(h.all().some(n=>/could not be verified/.test(n.textContent)));
});

test('private shared appearance can be reset without a community mutation',async()=>{
 const snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null}],members:[{id:'A'.repeat(43),roles:['Member']}],roles:[{id:'Member',permissions:['view']}]};let editor,mutations=0;const h=harness({realModel:true,liveApi:{disconnect(){},async connect(){return snapshot;},async mutate(){mutations++;return snapshot;}}});h.window.VumiroMarketplaceStudio={async open(options){editor=options;}};
 await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await settings(h,'live-page-themes');await h.find('private-theme-editor').dispatch('click');const pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.tokens.accent='#123abc';await editor.onApplyLocal(pkg);await h.find('private-theme-reset').dispatch('click');assert.equal(mutations,0);assert.notEqual(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#123abc');
});


test('shared theme chooser sends an exact reviewed reference while the server supplies the digest',async()=>{
 const snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null}],members:[{id:'A'.repeat(43),roles:['Member']}],roles:[{id:'Member',permissions:['view']}]};let request;const h=harness({realModel:true,realStudio:true,liveApi:{disconnect(){},async connect(){return snapshot;},async mutate(ops){request=ops[0];return snapshot;}}});const pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='published-theme';h.window.VumiroAccount={async marketplaceRequest(path){if(path==='/catalog')return {items:[{id:'listed',title:'Reviewed artwork',price_minor:0,latest_version_id:'version-2',summary:{kind:'theme'}}]};assert.equal(path,'/versions/version-2/preview');return {previewOnly:true,package:pkg};}};
 await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await settings(h,'live-page-themes');await h.find('load-reviewed-themes').dispatch('click');h.find('reviewed-theme').value='listed';await h.find('apply-reviewed-theme').dispatch('click');assert.equal(request.type,'theme');assert.equal(request.binding.packageId,pkg.id);assert.equal(request.binding.marketplace.itemId,'listed');assert.equal(request.binding.marketplace.versionId,'version-2');assert.equal(request.binding.marketplace.digest,undefined);
});


test('private app themes reach community navigation without replacing scoped community appearance',async()=>{
 const h=harness({realModel:true});const pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='private-app-navigation';pkg.tokens.accent='#ab1245';h.window.VumiroLocalAppearance={snapshot:()=>({identity:'A'.repeat(43),binding:{mode:'package',packageId:pkg.id,version:pkg.version},packages:[pkg]})};await h.view.open();assert.equal(h.find('community-root').style['--ch-accent'],'var(--community-accent)');assert.equal(h.find('community-root').style['--community-accent'],'#ab1245');await h.find('node-valheim').dispatch('click');assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],h.window.VumiroCommunityThemes.builtins.find(pkg=>pkg.id==='viking').tokens.accent);
});


test('offline reviewed artwork falls back while channel navigation and incoming messages stay consistent',async()=>{
 const snapshot={hubId:'live',id:'live',name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'first',type:'text',name:'First',parentId:'live'},{id:'second',type:'text',name:'Second',parentId:'live',themeBinding:{mode:'package',packageId:'reviewed-offline',version:'1.0.0',marketplace:{itemId:'item',versionId:'version',digest:'a'.repeat(64)}}}],members:[]},liveApi={disconnect(){},async connect(){return snapshot;},async history(){return {messages:[]};},async themePackage(){throw Error('Artwork temporarily offline');}};const h=harness({realModel:true,liveApi});await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('live-node-first').dispatch('click');const firstLog=h.find('live-log');await h.find('live-node-second').dispatch('click');assert.notEqual(h.find('live-log'),firstLog);assert.ok(h.all().some(n=>n.tagName==='h1'&&n.textContent==='Second'));liveApi.options.onEvent({type:'community-message',message:{id:'m',channelId:'second',sequence:1,text:'Second channel message'}});assert.ok(h.all(h.find('live-log')).some(n=>n.textContent==='Second channel message'));assert.equal(h.all(firstLog).some(n=>n.textContent==='Second channel message'),false);
});


test('private decorative editor application preserves the same-scope theme and layout',async()=>{
 const h=harness({realModel:true});let editor;h.window.VumiroMarketplaceStudio={async open(options){editor=options;}};await h.view.open();await h.find('node-valheim').dispatch('click');const before=h.all().find(n=>n.className==='ch-content').style['--community-accent'];await settings(h,'page-themes');await h.find('private-theme-editor').dispatch('click');const pkg={...structuredClone(h.window.VumiroCommunityThemes.builtins[0]),id:'private-decoration',kind:'decorative-pack',tokens:{},layouts:{},css:'',components:{banner:{borderColor:'#125abc',borderWidth:'2px',borderStyle:'solid'}}};await editor.onApplyLocal(pkg);assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],before);assert.ok(h.all().some(n=>n.tagName==='style'&&n.textContent.includes('#125abc')));
});


test('appearance settings hydrate their edited Space while preserving the viewed scope',async()=>{
 const snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'other',type:'space',name:'Other',parentId:'live'}],members:[{id:'A'.repeat(43),roles:['Member']}],roles:[{id:'Member',permissions:['view']}]};let response,reads=0;const h=harness({realModel:true,realStudio:true,liveApi:{disconnect(){},async connect(){return snapshot;},async themePackage(scope){assert.equal(scope,'other');reads++;return response;}}});const api=h.window.VumiroCommunityThemes,pkg={...structuredClone(api.builtins[0]),id:'reviewed-other'},checked=api.validate(pkg).package,digest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(checked)))).toString('hex');snapshot.nodes[1].themeBinding={mode:'package',packageId:pkg.id,version:pkg.version,marketplace:{itemId:'item',versionId:'version',digest}};response={itemId:'item',versionId:'version',digest,package:checked};await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('edit-other').dispatch('click');await h.find('live-page-themes').dispatch('click');assert.equal(reads,1);assert.equal(h.studios.at(-1).getDraft().packageId,pkg.id);
});


test('unavailable reviewed appearance keeps the stored selection and exposes retry instead of inherited Save',async()=>{
 const binding={mode:'package',packageId:'reviewed-other',version:'1.0.0',marketplace:{itemId:'item',versionId:'version',digest:'a'.repeat(64)}},snapshot={hubId:'live',id:'live',ownerId:'A'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'other',type:'space',name:'Other',parentId:'live',themeBinding:binding}],members:[{id:'A'.repeat(43),roles:['Member']}],roles:[{id:'Member',permissions:['view']}]};let mutations=0;const h=harness({realModel:true,realStudio:true,liveApi:{disconnect(){},async connect(){return snapshot;},async themePackage(){throw Error('Offline');},async mutate(){mutations++;return snapshot;}}});await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('edit-other').dispatch('click');await h.find('live-page-themes').dispatch('click');assert.ok(h.find('retry-reviewed-theme'));assert.equal(h.studios.length,0);assert.equal(mutations,0);assert.equal(snapshot.nodes[1].themeBinding,binding);
});


test('private decoration retains hub appearance both on the hub and inheriting descendants',async()=>{
 for(const descendant of [false,true]){const h=harness({realModel:true});let editor;h.window.VumiroMarketplaceStudio={async open(options){editor=options;}};await h.view.open();const adapter=h.window.VumiroCommunityMarketplace;await adapter.apply(adapter.targets().find(t=>t.scope==='hub'),{mode:'package',packageId:'viking',version:'1.0.0'},{mode:'local-demo'});if(descendant){await adapter.apply(adapter.targets().find(t=>t.id==='valheim'),{mode:'inherit'},{mode:'local-demo'});await h.find('node-valheim').dispatch('click');}await settings(h,'page-themes');await h.find('private-theme-editor').dispatch('click');const pkg={...structuredClone(h.window.VumiroCommunityThemes.builtins[0]),id:'root-inheriting-decoration',kind:'decorative-pack',tokens:{},layouts:{},css:'',components:{banner:{borderColor:'#125abc',borderWidth:'2px',borderStyle:'solid'}}};await editor.onApplyLocal(pkg);assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],h.window.VumiroCommunityThemes.builtins.find(pkg=>pkg.id==='viking').tokens.accent);}
});


test('shared members can open private appearance from menus without community mutation controls',async()=>{
 const me='A'.repeat(43),snapshot={hubId:'live',id:'live',ownerId:'B'.repeat(43),name:'Guild',revision:1,nodes:[{id:'live',type:'hub',name:'Guild',parentId:null},{id:'space',type:'space',name:'Workshop',parentId:'live'}],members:[{id:me,roles:['Member']}],roles:[{id:'Member',permissions:['view']}]};let editor,mutations=0;
 const h=harness({realModel:true,realStudio:true,liveApi:{disconnect(){},async connect(){return snapshot;},async mutate(){mutations++;return snapshot;}}});h.window.VumiroMarketplaceStudio={async open(options){editor=options;}};
 await h.view.open();await settings(h,'page-connections');h.find('live-hub-id').value='live';await h.find('invite-code').parentNode.parentNode.dispatch('submit');await h.find('more-space').dispatch('click');
 assert.ok(h.find('menu-appearance'),'private appearance is available to members');assert.equal(h.find('menu-edit'),undefined);await h.find('menu-appearance').dispatch('click');assert.ok(h.find('private-theme-editor'));assert.equal(h.find('apply-reviewed-theme'),undefined);assert.equal(h.find('load-reviewed-themes'),undefined);assert.equal(h.studios.length,0);
 await h.find('private-theme-editor').dispatch('click');const pkg=structuredClone(h.window.VumiroCommunityThemes.builtins[0]);pkg.id='member-private-view';pkg.tokens.accent='#123abc';await editor.onApplyLocal(pkg);await h.find('settings-close').dispatch('click');await h.find('live-node-space').dispatch('click');assert.equal(h.all().find(n=>n.className==='ch-content').style['--community-accent'],'#123abc');assert.equal(mutations,0);
});
