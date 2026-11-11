import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
const start=source.indexOf('/* Profile disclosure shares account state');
const end=source.indexOf('/* Local contacts and signed requests.',start);
assert.ok(start>=0&&end>start,'the independent disclosure controller exists');
const disclosure=source.slice(start,end);

function harness({signedIn=false,width=1000,height=800}={}) {
  const elements=new Map(),documentListeners=new Map(),windowListeners=new Map();
  const document={activeElement:null,getElementById:element,addEventListener:(name,callback)=>documentListeners.set(name,callback)};
  let state={signedIn,email:signedIn?'person@example.com':''},audioOpened=0,signOuts=0;
  function element(id) {
    if(!elements.has(id))elements.set(id,{
      id,hidden:id==='profileDisclosure',disabled:false,textContent:'',style:{},attributes:{},listeners:new Map(),
      setAttribute(name,value){this.attributes[name]=value;},
      addEventListener(name,callback){this.listeners.set(name,callback);},
      contains(target){return target===this||(id==='profileDisclosure'&&['profileNav','accountNav','audioNav','settingsNav','updatesNav','profileSignOut'].includes(target?.id));},
      querySelector(){return element('profileNav');},
      focus(){document.activeElement=this;},
      getBoundingClientRect(){return id==='selfProfile'?{left:15,top:context.innerHeight-80,width:180,height:66}:{width:Math.min(276,context.innerWidth-24),height:Math.min(370,context.innerHeight-24)};}
    });
    return elements.get(id);
  }
  element('serviceStatus').textContent='Online';
  const window={
    VumiroLocalProfile:{profile:()=>({name:'Local display name'})},
    VumiroAudioSettings:{open(){audioOpened++;}},
    VumiroAccount:{
      getState:()=>state,open(){},
      async signOut(){signOuts++;setState(false);}
    }
  };
  function setState(signed) {
    state={signedIn:signed,email:signed?'person@example.com':''};
    windowListeners.get('vumiro-account-state-changed')?.();
  }
  const context={window,document,innerWidth:width,innerHeight:height,addEventListener:(name,callback)=>windowListeners.set(name,callback),Promise};
  vm.runInNewContext(disclosure,context,{filename:'profile-disclosure.js'});
  return {element,document,context,setState,documentListeners,windowListeners,get audioOpened(){return audioOpened;},get signOuts(){return signOuts;}};
}

test('profile disclosure distinguishes local mode from signaling and opens audio without a room',()=>{
  const app=harness();
  assert.equal(app.element('selfAccountMode').textContent,'Local profile');
  assert.equal(app.element('profileAccountStatus').textContent,'Local profile · not signed in');
  assert.equal(app.element('profileSignOutSection').hidden,true);
  assert.equal(app.element('serviceStatus').textContent,'Online');
  app.element('selfProfile').onclick();
  assert.equal(app.element('profileDisclosure').hidden,false);
  assert.equal(app.element('profileMenuName').textContent,'Local display name');
  app.element('audioNav').onclick();
  assert.equal(app.audioOpened,1);
  assert.equal(app.element('profileDisclosure').hidden,true);
  assert.equal(app.document.activeElement,app.element('selfProfile'));
});

test('keyboard opens the disclosure, Escape restores focus, and outside pointer/focus dismiss it',()=>{
  const app=harness(),trigger=app.element('selfProfile'),panel=app.element('profileDisclosure');
  let prevented=false,stopped=false;
  trigger.listeners.get('keydown')({key:'ArrowDown',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(panel.hidden,false);
  assert.equal(app.document.activeElement,app.element('profileNav'));
  app.documentListeners.get('pointerdown')({target:app.element('audioNav')});
  assert.equal(panel.hidden,false,'inside pointer actions do not dismiss before their handler');
  app.documentListeners.get('keydown')({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  assert.equal(stopped,true);assert.equal(panel.hidden,true);assert.equal(trigger.attributes['aria-expanded'],'false');
  assert.equal(app.document.activeElement,trigger);
  trigger.onclick();app.documentListeners.get('pointerdown')({target:{id:'outside'}});
  assert.equal(panel.hidden,true);
  trigger.onclick();app.documentListeners.get('focusin')({target:{id:'outside'}});
  assert.equal(panel.hidden,true);
});

test('account-state changes reveal logout and signing out returns the profile to local mode',async()=>{
  const app=harness();
  app.setState(true);
  assert.equal(app.element('selfAccountMode').textContent,'Signed in');
  assert.equal(app.element('profileAccountStatus').textContent,'Signed in · person@example.com');
  assert.equal(app.element('profileSignOutSection').hidden,false);
  app.element('selfProfile').onclick();
  await app.element('profileSignOut').onclick();
  assert.equal(app.signOuts,1);
  assert.equal(app.element('profileSignOut').disabled,false);
  assert.equal(app.element('profileSignOutSection').hidden,true);
  assert.equal(app.element('selfAccountMode').textContent,'Local profile');
  assert.equal(app.element('serviceStatus').textContent,'Online','account logout does not alter peer connectivity');
  assert.equal(app.document.activeElement,app.element('selfProfile'));
});

test('disclosure placement stays inside narrow and short viewports after resize',()=>{
  const app=harness({width:360,height:480});
  app.element('selfProfile').onclick();
  function assertFits() {
    const panel=app.element('profileDisclosure'),box=panel.getBoundingClientRect();
    const left=parseFloat(panel.style.left),top=parseFloat(panel.style.top);
    assert.ok(left>=12&&top>=12);
    assert.ok(left+box.width<=app.context.innerWidth-12);
    assert.ok(top+box.height<=app.context.innerHeight-12);
  }
  assertFits();app.context.innerWidth=280;app.context.innerHeight=300;
  app.windowListeners.get('resize')();assertFits();
});

function settingsHarness() {
  const settingsStart=source.indexOf('/* Full-page settings navigation. */');
  const routingStart=source.indexOf('  async function navigate(key, from)',settingsStart);
  const routingEnd=source.indexOf('  function navigation(',routingStart);
  const lifecycleStart=source.indexOf('  function syncSettingsSession()',settingsStart);
  const lifecycleEnd=source.indexOf('  function element(',lifecycleStart);
  const updatesStart=source.indexOf("$('updatesNav').onclick=");
  const updatesEnd=source.indexOf("$('checkUpdate').onclick",updatesStart);
  assert.ok(routingStart>=0&&routingEnd>routingStart&&lifecycleStart>=0&&updatesStart>=0);
  const events=[],field={value:'Saved display name'},avatar={value:'saved-avatar'};
  let context,renders=0,updates=0,closes=0,previewsStopped=0;
  const makeDialog=()=>({open:false,showModal(){this.open=true;},close(){closes++;this.open=false;context.sync();}});
  const profileDialog=makeDialog(),account=makeDialog(),audio=makeDialog(),dialogs=[profileDialog,account,audio];
  function showProfile(){renders++;field.value='Saved display name';avatar.value='saved-avatar';profileDialog.showModal();}
  const elements={profileDialog,status:{textContent:''},updateDetails:{open:false,scrollIntoView(){}},
    profileNav:{click:showProfile},updatesNav:{click(){this.onclick();}}};
  context={profileDialog,window:{VumiroAccount:{prepare(){events.push('prepare-account');return account;},open(){account.showModal();}},VumiroAudioSettings:{prepare(){events.push('prepare-audio');return audio;},open(){audio.showModal();},stopTest(){previewsStopped++;}}},
    document:{querySelector(){return dialogs.find(dialog=>dialog.open);}},$:id=>elements[id],
    closeSettings(){for(const dialog of dialogs)if(dialog.open)dialog.close();},
    async preparePanel(key){if(key==='account'||key==='audio')await context.window[key==='account'?'VumiroAccount':'VumiroAudioSettings'].prepare();},
    selectPanel(key){events.push(key);context.currentSection=key;},browseRoom(){events.push('browse');},showProfile,
    syncTitlebar(){events.push('titlebar');},requestUpdate(action){assert.equal(action,'state');updates++;}};
  vm.runInNewContext('let profileDraftInSession=false,settingsTransitions=0,navigationSerial=0;'+source.slice(updatesStart,updatesEnd)+
    source.slice(lifecycleStart,lifecycleEnd)+source.slice(routingStart,routingEnd)+
    ';globalThis.route=navigate;globalThis.sync=syncSettingsSession;',context);
  return {context,profileDialog,account,audio,field,avatar,events,elements,showProfile,
    get renders(){return renders;},get updates(){return updates;},get closes(){return closes;},get previewsStopped(){return previewsStopped;}};
}

test('shared settings retain field and avatar drafts across account, audio and updates',async()=>{
  const app=settingsHarness();
  app.showProfile();app.context.sync();
  app.field.value='Unsaved display name';app.avatar.value='unsaved-avatar';
  await app.context.route('stream',app.profileDialog);
  await app.context.route('connection',app.profileDialog);
  await app.context.route('account',app.profileDialog);
  assert.equal(app.profileDialog.open,true);
  assert.equal(app.account.open,false);
  await app.context.route('audio',app.profileDialog);
  assert.equal(app.audio.open,false);
  await app.context.route('updates',app.profileDialog);
  assert.equal(app.profileDialog.open,true);
  assert.equal(app.field.value,'Unsaved display name');
  assert.equal(app.avatar.value,'unsaved-avatar');
  assert.equal(app.renders,1,'section navigation reuses the existing profile fields');
  assert.equal(app.closes,0,'section navigation never closes the settings modal');
  assert.equal(app.updates,1,'the updates section still requests fresh native update state');
});

test('fully closing settings ends the draft session and reopens fresh from another entry',async()=>{
  const app=settingsHarness();
  app.showProfile();app.context.sync();app.field.value='Uncommitted name';
  await app.context.route('account',app.profileDialog);
  app.profileDialog.close();
  await app.context.route('profile');
  assert.equal(app.renders,2);
  assert.equal(app.field.value,'Saved display name');
  app.profileDialog.close();
  app.showProfile();app.context.sync();
  assert.equal(app.renders,3,'the original profile entry keeps its fresh render behavior');
});

test('failed async audio navigation reports the failure and keeps the current settings draft',async()=>{
  const app=settingsHarness();
  app.showProfile();app.context.sync();app.field.value='Uncommitted name';
  app.context.window.VumiroAudioSettings.prepare=()=>Promise.reject(Error('Audio device unavailable'));
  await app.context.route('audio',app.profileDialog);
  assert.equal(app.elements.status.textContent,'Audio device unavailable');
  assert.equal(app.profileDialog.open,true);
  await app.context.route('profile',app.profileDialog);
  assert.equal(app.renders,1);
  assert.equal(app.field.value,'Uncommitted name');
});

test('a delayed section cannot replace the section selected most recently',async()=>{
  const app=settingsHarness();app.showProfile();app.context.sync();let release;
  app.context.window.VumiroAudioSettings.prepare=()=>new Promise(resolve=>release=resolve);
  const pending=app.context.route('audio',app.profileDialog);
  await app.context.route('notifications',app.profileDialog);
  release(app.audio);await pending;
  assert.equal(app.events.filter(value=>['audio','notifications'].includes(value)).at(-1),'notifications');
  assert.equal(app.profileDialog.open,true);assert.equal(app.closes,0);
});


function workspaceHarness(){
  const elements=new Map(),classes=new Set(),events=[],opened=[],friend={id:'friend',nickname:'Friend'};
  const node=id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',classList:{toggle(){},add(){},remove(){}},setAttribute(){},focus(){},click(){}});return elements.get(id);};
  const context={$:node,document:{body:{classList:{toggle(name,value){value?classes.add(name):classes.delete(name);},remove(name){classes.delete(name);}}},querySelectorAll:()=>[]},profile:{id:'owner'},selected:friend.id,frame:null,friendById:id=>id===friend.id?friend:null,browseRoom(){},setRoomView(){},renderFriends(){},status(){},startDirectMessages(){},dispatchEvent:event=>events.push(event),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},window:{VumiroDirectChatController:{visible:false,active:'',hide(){this.visible=false;},async open(id){this.visible=true;this.active=id;opened.push(id);}},VumiroGaming:{close(){}}}};
  const start=source.indexOf('/* Workspace destinations. */'),end=source.indexOf('/* End workspace destinations. */',start);
  assert.ok(start>=0&&end>start,'workspace routing exists');
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {context,node,classes,events,opened};
}

test('Friends and Conversations are distinct destinations and return safely from the server sandbox',async()=>{
  const h=workspaceHarness();h.node('serverWorkspace').hidden=false;
  await h.context.showFriendsOverview();assert.equal(h.context.window.VumiroDirectChatController.visible,false);assert.equal(h.node('directChatPane').hidden,true);assert.equal(h.node('workspaceHeading').textContent,'Friends');assert.equal(h.node('serverWorkspace').hidden,true);
  await h.context.openDirectConversation('friend');assert.deepEqual(h.opened,['friend']);assert.equal(h.context.workspaceView,'conversations');
  await h.context.showFriendsOverview();assert.equal(h.context.window.VumiroDirectChatController.visible,false);assert.equal(h.context.selected,'friend');
});

test('a kept settings draft prevents switching to Servers or Conversations',async()=>{
  const h=workspaceHarness();let opened=0;h.context.document.querySelectorAll=()=>[{classList:{contains:()=>true}}];h.context.window.VumiroSettingsExit={requestClose:async()=>false};h.context.window.VumiroServers={create(){opened++;return {open(){}};}};
  assert.equal(await h.context.showServerWorkspace(),false);assert.equal(opened,0);
  assert.equal(await h.context.openDirectConversation('friend'),false);assert.deepEqual(h.opened,[]);
});

test('server navigation leaves a running room browsing and hides conversation controls',async()=>{
  const h=workspaceHarness();let browsed=0;h.context.browseRoom=()=>browsed++;h.context.window.VumiroDirectChatController.visible=true;
  h.context.window.VumiroServers={create:()=>({async open(){h.node('serverWorkspace').hidden=false;},hide(){h.node('serverWorkspace').hidden=true;}})};
  await h.context.showServerWorkspace();assert.equal(browsed,1);assert.equal(h.context.workspaceView,'servers');assert.equal(h.node('friendsBody').hidden,true);assert.equal(h.context.window.VumiroDirectChatController.visible,false);
  await h.context.showFriendsOverview();assert.equal(h.node('serverWorkspace').hidden,true);assert.equal(h.node('friendsBody').hidden,false);
});


test('opening a room hides the server workspace and conversation pane without disposing their drafts',async()=>{
  const h=workspaceHarness();await h.context.openDirectConversation('friend');h.node('serverWorkspace').hidden=false;
  h.context.window.VumiroWorkspace.suspendForRoom();
  assert.equal(h.node('serverWorkspace').hidden,true);assert.equal(h.context.window.VumiroDirectChatController.visible,false);assert.equal(h.node('directChatPane').hidden,true);assert.equal(h.context.selected,'friend');
});

test('initializing direct messages prepares unread transport without replacing the Friends overview',()=>{
  const start=source.indexOf('function startDirectMessages(){'),end=source.indexOf('/* Workspace destinations. */',start);let opens=0;
  const context={profile:{id:'owner'},local:{},send(){},friendById(){},friends:[],blocked:[],blocking:new Set(),status(){},renderFriends(){},runtimeNow(){},notifySocial(){},selected:''};
  context.window={VumiroDirectMessages:{create:()=>({})},VumiroDirectChat:{create:()=>({open(){opens++;}})}};
  vm.runInNewContext(source.slice(start,end),context);context.startDirectMessages();
  assert.ok(context.window.VumiroDirectChatController);assert.equal(opens,0);
});

test('Support entry uses the shared settings navigation above the profile card',async()=>{
  const app=settingsHarness();await app.context.route('support');assert.equal(app.context.currentSection,'support');assert.equal(app.profileDialog.open,true);
  const html=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends.html',import.meta.url),'utf8');assert.ok(html.indexOf('id="supportNav"')<html.indexOf('id="selfProfile"'));
});


test('in-place profile identity replacement destroys the visible server workspace without dismissing settings',async()=>{
  const h=workspaceHarness(),records=new Map();h.context.profile={id:'A'.repeat(43),name:'Person A'};
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.handlers={};this.value='';this.textContent='';this.style={};}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    setAttribute(key,value){this.attributes[key]=value;}addEventListener(key,fn){(this.handlers[key]??=[]).push(fn);}removeEventListener(key,fn){this.handlers[key]=(this.handlers[key]||[]).filter(item=>item!==fn);}focus(){}
    async dispatch(type){for(const fn of this.handlers[type]||[])await fn({preventDefault(){}});}
  }
  const mount=h.node('serverWorkspace');Object.assign(mount,new Element('section'));Object.setPrototypeOf(mount,Element.prototype);h.context.document.createElement=tag=>new Element(tag);
  h.context.window.localStorage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)};
  vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/server-workspace.js',import.meta.url),'utf8'),h.context);
  await h.context.showServerWorkspace();
  const all=(node=mount)=>[node,...node.children.flatMap(child=>all(child))],find=action=>all().find(node=>node.dataset.action===action);
  await find('channel-welcome').dispatch('click');find('message').value='private A draft';await find('message').dispatch('input');
  let settingsOpen=true,exits=0;h.context.document.querySelectorAll=()=>settingsOpen?[{classList:{contains:()=>true}}]:[];
  h.context.window.VumiroSettingsExit={async requestClose(){exits++;return false;}};
  Object.assign(h.context,{lobbyInitialized:true,local:{profile:()=>({id:'B'.repeat(43),name:'Person B'})},renderOwnProfile(){},clearNotificationSession(){},clearPending(){},connect(){}});
  const start=source.indexOf('async function shareOwnProfile()'),end=source.indexOf("addEventListener('vumiro-profile-changed'",start);
  vm.runInContext(source.slice(start,end),h.context);await h.context.shareOwnProfile();
  assert.equal(mount.hidden,true);assert.equal(mount.children.length,0,'previous identity content is removed immediately');assert.equal(h.context.workspaceView,'friends');assert.equal(exits,0);assert.equal(settingsOpen,true);
  settingsOpen=false;await h.context.showServerWorkspace();await find('channel-welcome').dispatch('click');assert.equal(find('message').value,'');
});
