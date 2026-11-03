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
  let context,renders=0,updates=0;
  const makeDialog=()=>({open:false,showModal(){this.open=true;},close(){this.open=false;context.sync();}});
  const profileDialog=makeDialog(),account=makeDialog(),audio=makeDialog(),dialogs=[profileDialog,account,audio];
  function showProfile(){renders++;field.value='Saved display name';avatar.value='saved-avatar';profileDialog.showModal();}
  const elements={profileDialog,status:{textContent:''},updateDetails:{open:false,scrollIntoView(){}},
    profileNav:{click:showProfile},updatesNav:{click(){this.onclick();}}};
  context={profileDialog,window:{VumiroAccount:{open(){account.showModal();}},VumiroAudioSettings:{open(){audio.showModal();}}},
    document:{querySelector(){return dialogs.find(dialog=>dialog.open);}},$:id=>elements[id],
    closeSettings(){for(const dialog of dialogs)if(dialog.open)dialog.close();},
    selectPanel(key){events.push(key);},browseRoom(){events.push('browse');},showProfile,
    syncTitlebar(){events.push('titlebar');},requestUpdate(action){assert.equal(action,'state');updates++;}};
  vm.runInNewContext('let profileDraftInSession=false,settingsTransitions=0;'+source.slice(updatesStart,updatesEnd)+
    source.slice(lifecycleStart,lifecycleEnd)+source.slice(routingStart,routingEnd)+
    ';globalThis.route=navigate;globalThis.sync=syncSettingsSession;',context);
  return {context,profileDialog,account,audio,field,avatar,events,elements,showProfile,
    get renders(){return renders;},get updates(){return updates;}};
}

test('shared settings retain field and avatar drafts across account, audio and updates',async()=>{
  const app=settingsHarness();
  app.showProfile();app.context.sync();
  app.field.value='Unsaved display name';app.avatar.value='unsaved-avatar';
  await app.context.route('stream',app.profileDialog);
  await app.context.route('connection',app.profileDialog);
  await app.context.route('account',app.profileDialog);
  assert.equal(app.account.open,true);
  await app.context.route('audio',app.account);
  assert.equal(app.audio.open,true);
  await app.context.route('updates',app.audio);
  assert.equal(app.profileDialog.open,true);
  assert.equal(app.field.value,'Unsaved display name');
  assert.equal(app.avatar.value,'unsaved-avatar');
  assert.equal(app.renders,1,'cross-dialog navigation reuses the existing profile fields');
  assert.equal(app.updates,1,'the updates section still requests fresh native update state');
});

test('fully closing settings ends the draft session and reopens fresh from another entry',async()=>{
  const app=settingsHarness();
  app.showProfile();app.context.sync();app.field.value='Uncommitted name';
  await app.context.route('account',app.profileDialog);
  app.account.close();
  app.account.showModal();app.context.sync();
  await app.context.route('profile',app.account);
  assert.equal(app.renders,2);
  assert.equal(app.field.value,'Saved display name');
  app.profileDialog.close();
  app.showProfile();app.context.sync();
  assert.equal(app.renders,3,'the original profile entry keeps its fresh render behavior');
});

test('failed async audio navigation reports the failure and releases the draft session',async()=>{
  const app=settingsHarness();
  app.showProfile();app.context.sync();app.field.value='Uncommitted name';
  app.context.window.VumiroAudioSettings.open=()=>Promise.reject(Error('Audio device unavailable'));
  await app.context.route('audio',app.profileDialog);
  assert.equal(app.elements.status.textContent,'Audio device unavailable');
  assert.equal(app.profileDialog.open||app.account.open||app.audio.open,false);
  app.account.showModal();app.context.sync();
  await app.context.route('profile',app.account);
  assert.equal(app.renders,2);
  assert.equal(app.field.value,'Saved display name');
});
