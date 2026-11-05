import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
const cacheStart=source.indexOf('let directoryTags={}'),cacheEnd=source.indexOf('function renderLinks(',cacheStart);
const lookupStart=source.indexOf('async function lookup('),lookupEnd=source.indexOf('async function refreshContact(',lookupStart);
const receiveStart=source.indexOf('async function receive(m,current,version)'),receiveEnd=source.indexOf('async function hydrateRequests(',receiveStart);
assert.ok(cacheStart>=0&&cacheEnd>cacheStart&&lookupStart>=0&&lookupEnd>lookupStart&&receiveStart>=0&&receiveEnd>receiveStart);
const ownId='A'.repeat(43),otherId='B'.repeat(43);

function harness(initialCache={},profileExtras={}) {
  const elements=new Map(),storage=new Map([['vumiro-directory-tags',JSON.stringify(initialCache)]]),sent=[],timers=new Map();
  let nextTimer=1;
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false});return elements.get(id);};
  const socket={readyState:1,close(code,reason){this.closed={code,reason};}},lookups=new Map();
  const context={
    $:element,profile:{id:ownId,name:'Owner',...profileExtras},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    socket,generation:1,stopped:false,ready:false,retry:0,socialV2Available:false,usernameCollision:false,frame:null,
    window:{VumiroServerClock:{sync(){},isSynced:()=>true}},WebSocket:{OPEN:1},
    serviceState(){},announce(){},watch(){},publishRoom(){},renderRequests(){},renderFriends(){},status(){},
    local:{async parseContactCode(){return {id:otherId};}},crypto:{randomUUID:()=> 'test_lookup_nonce'},lookups,
    send:message=>sent.push(message),setTimeout(callback){const id=nextTimer++;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
  };
  vm.runInNewContext(source.slice(cacheStart,cacheEnd)+source.slice(lookupStart,lookupEnd)+source.slice(receiveStart,receiveEnd)+
    ';globalThis.tagTest={receive,lookup,rememberDirectoryProfile,renderOwnTag,tags:()=>directoryTags};',context);
  context.tagTest.renderOwnTag();
  return {context,element,storage,sent,timers,lookups,receive:message=>context.tagTest.receive(message,socket,1),tags:()=>context.tagTest.tags()};
}

test('only directory messages populate the visible own friend tag and enable copying',async()=>{
  const app=harness({}, {friendTag:'#11111-11111'});
  assert.equal(app.element('ownFriendTag').textContent,'Connect to assign your tag');
  assert.equal(app.element('copyFriendTag').disabled,true);
  await app.receive({type:'ready',id:ownId,friendTag:'#12345-67890',socialVersion:2,serverTime:Date.now()});
  assert.equal(app.context.ready,true);
  assert.equal(app.element('ownFriendTag').textContent,'#12345-67890');
  assert.equal(app.element('copyFriendTag').disabled,false);
  assert.equal(JSON.parse(app.storage.get('vumiro-directory-tags'))[ownId],'#12345-67890');
});

test('profile-ready updates the provisional tag after a verified identity migration and survives reload',async()=>{
  const app=harness();
  await app.receive({type:'ready',id:ownId,friendTag:'#11111-11111',socialVersion:2,serverTime:Date.now()});
  await app.receive({type:'profile-ready',profile:{id:ownId,friendTag:'#99999-00000'}});
  assert.equal(app.element('ownFriendTag').textContent,'#99999-00000');
  const restored=harness(JSON.parse(app.storage.get('vumiro-directory-tags')));
  assert.equal(restored.element('ownFriendTag').textContent,'#99999-00000');
  assert.equal(restored.element('copyFriendTag').disabled,false);
});

test('malformed or unbounded cached tag values never appear in the interface',()=>{
  const app=harness({[ownId]:'<img src=x onerror=alert(1)>',[otherId]:'#1234567890','bad-id':'#12345-67890'});
  assert.equal(Object.keys(app.tags()).length,0);
  for(const value of [null,{}, {id:ownId,friendTag:'#1234-67890'},{id:'bad-id',friendTag:'#12345-67890'},{id:ownId,friendTag:1234567890}])app.context.tagTest.rememberDirectoryProfile(value);
  assert.equal(Object.keys(app.tags()).length,0);
  assert.equal(app.element('copyFriendTag').disabled,true);
});

test('cache remains bounded when many online identities are looked up',()=>{
  const app=harness();
  for(let n=0;n<300;n++)app.context.tagTest.rememberDirectoryProfile({id:String(n).padStart(43,'0'),friendTag:'#12345-'+String(n).padStart(5,'0')});
  assert.equal(Object.keys(app.tags()).length,256);
  assert.equal(Object.keys(JSON.parse(app.storage.get('vumiro-directory-tags'))).length,256);
  assert.equal(app.tags()[String(0).padStart(43,'0')],undefined);
  assert.equal(app.tags()[String(299).padStart(43,'0')],'#12345-00299');
});

test('lookup forwards the friendly number intact and only correlates matching responses',async()=>{
  const app=harness();app.context.ready=true;
  const waiting=app.context.tagTest.lookup('#12345-67890');
  assert.deepEqual(JSON.parse(JSON.stringify(app.sent[0])),{type:'lookup',query:'#12345-67890',nonce:'test_lookup_nonce'});
  await app.receive({type:'lookup-result',nonce:'unknown_nonce',profile:{id:otherId,friendTag:'#11111-11111'}});
  assert.equal(app.tags()[otherId],undefined);assert.equal(app.lookups.size,1);
  const contact={id:otherId,name:'Friend',friendTag:'#12345-67890'};
  await app.receive({type:'lookup-result',nonce:'test_lookup_nonce',profile:contact});
  assert.equal(await waiting,contact);
  assert.equal(app.tags()[otherId],'#12345-67890');assert.equal(app.lookups.size,0);assert.equal(app.timers.size,0);
});

test('tag lookup timeout clears its pending task and an offline result stays empty',async()=>{
  const app=harness();app.context.ready=true;
  const expired=app.context.tagTest.lookup('1234567890');
  const rejection=assert.rejects(expired,/Lookup timed out/);
  app.timers.values().next().value();await rejection;
  assert.equal(app.lookups.size,0);
  const waiting=app.context.tagTest.lookup('#12345-67890');
  await app.receive({type:'lookup-result',nonce:'test_lookup_nonce',profile:null});
  assert.equal(await waiting,null);assert.equal(app.tags()[otherId],undefined);
});

function actionSection(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert.ok(first>=0&&last>first);return source.slice(first,last);}

function friendActionsHarness(){
  const elements=new Map(),copied=[],renamed=[],messages=[];
  let document;
  class Element {
    constructor(){this.children=[];this.value='';this.hidden=false;this.open=false;this.attributes={};}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(){}
    focus(){document.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document={activeElement:null,createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
  const friend={id:'friend-id',name:'Friend',nickname:'My friend',nicknameOverride:true};
  const context={
    document,$:element,friends:[friend],selected:friend.id,profile:{id:'own-id'},directoryTags:{[friend.id]:'#12345-67890'},
    online:new Set(),filter:'all',pending:null,frame:null,updateAvailable:false,linuxHost:false,
    friendById:id=>id===friend.id?friend:null,avatar(){},canCall:()=>false,renderProfileDetails(){},renderRooms(){},
    status:message=>messages.push(message),navigator:{clipboard:{async writeText(value){copied.push(value);}}},
    local:{async renameFriend(id,nickname){renamed.push({id,nickname});friend.nickname=nickname;}},
    async reloadFriends(){context.renderFriends();}
  };
  vm.runInNewContext(
    actionSection('async function copyFriendTag(','async function resizeBanner(')+
    actionSection('function renderDetails(){','async function reloadFriends(')+
    actionSection("$('nicknameForm').onsubmit=","$('removeFriend').onclick="),context);
  context.renderFriends();
  const buttons=element('friendsList').children[0].children[1].children[0].children;
  return {element,context,copied,renamed,messages,nickname:buttons[0],pencil:buttons[1]};
}

for(const entry of ['list','details'])test(`${entry} pencil opens a modal nickname editor outside the responsive side pane`,()=>{
  const app=friendActionsHarness();let stopped=false;
  const pencil=entry==='list'?app.pencil:app.element('editNickname');
  pencil.onclick({stopPropagation(){stopped=true;}});
  assert.equal(app.element('nicknameDialog').open,true);
  assert.equal(app.element('nickname').value,'My friend');
  assert.equal(app.context.document.activeElement,app.element('nickname'));
  if(entry==='list')assert.equal(stopped,true);
});

test('nickname click copies the friend tag without opening the editor or profile card',async()=>{
  const app=friendActionsHarness();let stopped=false;
  app.nickname.onclick({stopPropagation(){stopped=true;}});await Promise.resolve();
  assert.deepEqual(app.copied,['#12345-67890']);
  assert.equal(stopped,true);
  assert.equal(app.element('nicknameDialog').open,false);
  assert.equal(app.element('userCardDialog').open,false);
});

test('saving a nickname updates the selected friend and closes the editor',async()=>{
  const app=friendActionsHarness();app.element('nicknameDialog').open=true;app.element('nickname').value='New nickname';
  await app.element('nicknameForm').onsubmit({preventDefault(){}});
  assert.deepEqual(app.renamed,[{id:'friend-id',nickname:'New nickname'}]);
  assert.equal(app.element('nicknameDialog').open,false);
  assert.match(app.messages.at(-1),/Nickname saved/);
});
