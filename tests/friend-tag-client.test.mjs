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

function harness(initialCache={},profileExtras={},initialHandles={}) {
  const elements=new Map(),storage=new Map([['vumiro-directory-tags',JSON.stringify(initialCache)],['vumiro-directory-handles',JSON.stringify(initialHandles)]]),sent=[],timers=new Map(),messages=[];
  let nextTimer=1;
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',disabled:false});return elements.get(id);};
  const socket={readyState:1,close(code,reason){this.closed={code,reason};}},lookups=new Map();
  const context={
    $:element,profile:{id:ownId,name:'Owner',...profileExtras},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    socket,generation:1,stopped:false,ready:false,retry:0,socialV2Available:false,usernameCollision:false,frame:null,
    window:{VumiroServerClock:{sync(){},isSynced:()=>true}},WebSocket:{OPEN:1},
    serviceState(){},announce(){},watch(){},publishRoom(){},renderRequests(){},renderFriends(){},status:message=>messages.push(message),requests:[],
    local:{async parseContactCode(){return {id:otherId};}},crypto:{randomUUID:()=> 'test_lookup_nonce'},lookups,
    send:message=>sent.push(message),setTimeout(callback){const id=nextTimer++;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
  };
  vm.runInNewContext(source.slice(cacheStart,cacheEnd)+source.slice(lookupStart,lookupEnd)+source.slice(receiveStart,receiveEnd)+
    ';globalThis.tagTest={receive,lookup,rememberDirectoryProfile,renderOwnTag,tags:()=>directoryTags};',context);
  context.tagTest.renderOwnTag();
  return {context,element,storage,sent,timers,lookups,messages,receive:message=>context.tagTest.receive(message,socket,1),tags:()=>context.tagTest.tags()};
}

test('directory-issued named handles replace legacy tags and survive reload independently of peer profiles',async()=>{
  const app=harness({}, {username:'owner',friendHandle:'fake#123'});
  assert.equal(app.element('ownFriendTag').textContent,'Connect to assign your tag');
  await app.receive({type:'ready',id:ownId,friendTag:'#12345-67890',friendHandle:'owner#123',namedFriendTagsVersion:1,socialVersion:2,serverTime:Date.now()});
  assert.equal(app.element('ownFriendTag').textContent,'owner#123');
  await app.receive({type:'profile-ready',profile:{id:ownId,friendTag:'#12345-67890',friendHandle:'new.name#4567'},namedFriendTagsVersion:1});
  assert.equal(app.element('ownFriendTag').textContent,'new.name#4567');
  const restored=harness(JSON.parse(app.storage.get('vumiro-directory-tags')),{},JSON.parse(app.storage.get('vumiro-directory-handles')));
  assert.equal(restored.element('ownFriendTag').textContent,'new.name#4567');
  assert.equal(restored.tags()[ownId],'#12345-67890');
});

test('malformed named handles cannot replace a valid directory tag',async()=>{
  for(const handle of ['ab#123','owner#12','Owner#123','owner#'+'1'.repeat(20),'<img>#123',123,{}]){
    const app=harness({[ownId]:'#12345-67890'}, {}, {[ownId]:handle});
    await app.receive({type:'ready',id:ownId,friendTag:'#12345-67890',friendHandle:handle,socialVersion:2,serverTime:Date.now()});
    assert.equal(app.element('ownFriendTag').textContent,'#12345-67890');
  }
});

test('an old service username collision preserves the requested name and explains the upgrade',async()=>{
  const app=harness({}, {username:'owner'});app.context.ready=true;
  app.context.local.updateProfile=()=>assert.fail('A service collision must not erase the saved username');
  await app.receive({type:'error',code:'username-taken',message:'That username is already taken.'});
  assert.equal(app.context.profile.username,'owner');
  assert.match(app.messages.at(-1),/updated Vumiro service/i);
});

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

test('named lookup on an older service explains that a backend upgrade is needed',async()=>{
  const app=harness();app.context.ready=true;
  const pending=app.context.tagTest.lookup('owner#123');
  const rejected=assert.rejects(pending,/updated Vumiro service/i);
  app.timers.values().next().value?.();await rejected;
  assert.equal(app.sent.length,0);
});

function addFriendHarness(){
  const app=harness();
  class Element{
    constructor(){this.textContent='';this.value='';this.children=[];this.dataset={};this.attributes={};}
    append(value){this.children.push(value);}
    replaceChildren(){this.children=[];this.textContent='';}
    querySelectorAll(){return this.children.filter(item=>item.type==='button');}
    setAttribute(key,value){this.attributes[key]=value;}
    close(){}
    reset(){}
  }
  const elements=new Map();app.element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  Object.assign(app.context,{$:app.element,document:{createElement:()=>new Element()},lookupTimer:0,lookupGeneration:0,selectedLookup:null,
    online:new Set(),blocked:[],friendById:()=>null,contactCapacity:async()=>{},serverNow:()=>Date.now(),social:async id=>({nonce:'sent-request',expires:Date.now()+60000}),storeRequest:async value=>{app.stored=value;}});
  app.context.local.validateContact=async contact=>contact;
  vm.runInNewContext(actionSection("$('friendCode').oninput=","$('nicknameForm').onsubmit="),app.context);
  return app;
}

test('search lists matching usernames with separate named handles and requires an explicit choice',async()=>{
  const app=addFriendHarness();
  await app.receive({type:'ready',id:ownId,namedFriendTagsVersion:1,socialVersion:2,serverTime:Date.now()});
  app.element('friendCode').value='sam';app.element('friendCode').oninput();
  const pending=app.timers.values().next().value();
  const contacts=[{id:otherId,name:'Sam',username:'sam',friendHandle:'sam#123'},{id:'C'.repeat(43),name:'Sam',username:'sam',friendHandle:'sam#456'}];
  await app.receive({type:'lookup-result',nonce:'test_lookup_nonce',profiles:contacts});await pending;
  const buttons=app.element('lookupPreview').querySelectorAll('button');
  assert.deepEqual(buttons.map(item=>item.textContent),['Sam · sam#123','Sam · sam#456']);
  await app.element('addForm').onsubmit({preventDefault(){}});
  assert.match(app.element('addError').textContent,/Choose a matching person/);
  app.context.online.add(contacts[1].id);buttons[1].onclick();
  await app.element('addForm').onsubmit({preventDefault(){}});
  assert.equal(app.stored.contact.id,contacts[1].id);
});

test('an exact named handle can send a request without an ambiguous name selection',async()=>{
  const app=addFriendHarness();await app.receive({type:'ready',id:ownId,namedFriendTagsVersion:1,socialVersion:2,serverTime:Date.now()});
  const contact={id:otherId,name:'Sam',username:'sam',friendHandle:'sam#123'};app.context.online.add(otherId);
  app.element('friendCode').value='sam#123';
  const pending=app.element('addForm').onsubmit({preventDefault(){}});
  assert.equal(app.sent[0].query,'sam#123');
  await app.receive({type:'lookup-result',nonce:'test_lookup_nonce',profile:contact});await pending;
  assert.equal(app.stored.contact.id,otherId);
});

function actionSection(start,end){const first=source.indexOf(start),last=source.indexOf(end,first);assert.ok(first>=0&&last>first);return source.slice(first,last);}

function friendActionsHarness(handle=''){
  const elements=new Map(),copied=[],renamed=[],messages=[],timers=[];
  let document;
  class Element {
    constructor(){this.children=[];this.value='';this.hidden=false;this.open=false;this.attributes={};}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
    replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
    setAttribute(name,value){this.attributes[name]=value;}
    addEventListener(){}
    focus(){document.activeElement=this;}
    showModal(){this.open=true;}
    close(){this.open=false;}
    click(){let stopped=false;const event={target:this,stopPropagation(){stopped=true;}};for(let node=this;node&&!stopped;node=node.parentElement)node.onclick?.(event);}
  }
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  document={activeElement:null,createElement:()=>new Element(),createTextNode:text=>({textContent:text})};
  const friend={id:'friend-id',name:'Friend',nickname:'My friend',nicknameOverride:true};
  const context={
    document,$:element,friends:[friend],selected:friend.id,userCardId:friend.id,profile:{id:'own-id'},directoryTags:{[friend.id]:'#12345-67890'},directoryHandles:{[friend.id]:handle},
    online:new Set(),filter:'all',pending:null,frame:null,updateAvailable:false,linuxHost:false,
    friendById:id=>id===friend.id?friend:null,avatar(){},setBanner(){},renderLinks(){},canCall:()=>false,renderProfileDetails(){},renderRooms(){},
    setTimeout(callback){timers.push(callback);return timers.length;},
    status:message=>messages.push(message),navigator:{clipboard:{async writeText(value){copied.push(value);}}},
    local:{async renameFriend(id,nickname){renamed.push({id,nickname});friend.nickname=nickname;}},
    async reloadFriends(){context.renderFriends();}
  };
  vm.runInNewContext(
    actionSection('function directoryFriendTag(','function rememberDirectoryProfile(')+
    actionSection('function renderUserCard(){','async function resizeBanner(')+
    actionSection('function renderDetails(){','async function reloadFriends(')+
    actionSection("$('nicknameForm').onsubmit=","$('removeFriend').onclick="),context);
  context.renderFriends();
  const buttons=element('friendsList').children[0].children[1].children[0].children;
  return {element,context,copied,renamed,messages,timers,nickname:buttons[0],nameChildren:buttons};
}

test('inspection card pencil opens the nickname editor and friend rows have no pencil',()=>{
  const app=friendActionsHarness();
  assert.equal(app.nameChildren.length,1);
  app.nickname.click();
  assert.equal(app.element('userCardDialog').open,true);
  app.element('userCardEditNickname').click();
  assert.equal(app.element('nicknameDialog').open,true);
  assert.equal(app.element('nickname').value,'My friend');
  assert.equal(app.context.document.activeElement,app.element('nickname'));
});

test('clicking a friend name opens their inspection card without copying',()=>{
  const app=friendActionsHarness();
  app.nickname.click();
  assert.deepEqual(app.copied,[]);
  assert.equal(app.element('nicknameDialog').open,false);
  assert.equal(app.element('userCardDialog').open,true);
  assert.equal(app.element('userCardName').textContent,'My friend');
});

test('selected friend nickname copies their tag without opening nickname editing',async()=>{
  const app=friendActionsHarness('friend#123');
  app.element('contactName').click();
  await new Promise(setImmediate);
  assert.deepEqual(app.copied,['friend#123']);
  assert.equal(app.element('nicknameDialog').open,false);
});

test('inspection card tag has a copy hint and shows temporary copied feedback',async()=>{
  const app=friendActionsHarness();app.nickname.click();
  const tag=app.element('userCardTag');
  assert.equal(tag.title,'Click to copy friend tag');
  tag.click();await new Promise(setImmediate);
  assert.deepEqual(app.copied,['#12345-67890']);
  assert.equal(tag.textContent,'Copied #12345-67890');
  assert.equal(tag.title,'Copied to clipboard');
  app.timers[0]();
  assert.equal(tag.textContent,'#12345-67890');
  assert.equal(tag.title,'Click to copy friend tag');
});

test('inspection card displays and copies the directory named handle without a redundant username',async()=>{
  const app=friendActionsHarness('friend#123');app.context.friends[0].username='friend';app.nickname.click();
  assert.equal(app.element('userCardTag').textContent,'friend#123');
  assert.equal(app.element('userCardUsername').hidden,true);
  app.element('userCardTag').click();await new Promise(setImmediate);
  assert.deepEqual(app.copied,['friend#123']);
});

test('saving a nickname updates the selected friend and closes the editor',async()=>{
  const app=friendActionsHarness();app.element('nicknameDialog').open=true;app.element('nickname').value='New nickname';
  await app.element('nicknameForm').onsubmit({preventDefault(){}});
  assert.deepEqual(app.renamed,[{id:'friend-id',nickname:'New nickname'}]);
  assert.equal(app.element('nicknameDialog').open,false);
  assert.match(app.messages.at(-1),/Nickname saved/);
});

async function startupServiceHarness(qa,override){
  const saved=[],app={window:{__VUMIRO_LOCAL_QA__:qa,__VUMIRO_LOCAL_QA_SIGNALING__:override},serviceUrl:'',
    read:()=> 'wss://saved.example/call-signaling',save:(...args)=>saved.push(args),normalizeService:value=>value,
    query:{get:()=> 'wss://query.example/call-signaling'},location:{origin:'https://app.example'},
    local:{initialize:async()=>null,listBlocked:async()=>[]},serviceState(){},status(){},dialog(){},$:()=>({})};
  const start=source.lastIndexOf('(async()=>{try{const savedService=');
  await vm.runInNewContext(source.slice(start,source.indexOf('\n',start)),app);
  return {url:app.serviceUrl,saved};
}

test('native LOCAL QA service override wins over saved production settings without persisting it',async()=>{
  const app=await startupServiceHarness(true,'ws://127.0.0.1:8787/call-signaling');
  assert.equal(app.url,'ws://127.0.0.1:8787/call-signaling');assert.deepEqual(app.saved,[]);
});

test('ordinary startup ignores the LOCAL QA override and retains the saved service',async()=>{
  const app=await startupServiceHarness(false,'ws://127.0.0.1:8787/call-signaling');
  assert.equal(app.url,'wss://saved.example/call-signaling');assert.deepEqual(app.saved,[]);
});
