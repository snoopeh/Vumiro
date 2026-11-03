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
