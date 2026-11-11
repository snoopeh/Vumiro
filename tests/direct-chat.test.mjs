import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness(options={}){
  const elements=new Map(),friends=[{id:'B'.repeat(43),name:'Friend',nickname:'Friend'}],owner='A'.repeat(43),records=[],notifications=[];
  class Element{constructor(){this.children=[];this.value='';this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};this.listeners=new Map();this.classList={toggle(){},add(){},remove(){}};this._scrollTop=0;this.renderCount=0;}append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}replaceChildren(...nodes){this.children=[];this.append(...nodes);this.renderCount++;}setAttribute(key,value){this.attributes[key]=value;}addEventListener(key,fn){this.listeners.set(key,fn);}removeEventListener(key){this.listeners.delete(key);}focus(){document.activeElement=this;}scrollIntoView(){}get lastElementChild(){return this.children.at(-1);}get scrollHeight(){return this.isViewport?(this.children[0]?.scrollHeight||0):this.children.length*20;}get clientHeight(){return 100;}get scrollTop(){return this._scrollTop;}set scrollTop(value){this._scrollTop=Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight));}getBoundingClientRect(){const top=this.parent?this.parent.getBoundingClientRect().top+this.parent.children.indexOf(this)*20-this.parent.scrollTop:0;return {top,bottom:top+(this.isViewport?100:20)};}}
  const node=id=>{if(!elements.has(id))elements.set(id,new Element());const element=elements.get(id);if(id==='directChatLog'&&!element.parent){const viewport=node('directHistoryViewport');viewport.isViewport=true;viewport.append(element);}return element;};
  const values=new Map(),document={getElementById:node,createElement:()=>new Element(),hidden:false,hasFocus:()=>true,addEventListener(){},removeEventListener(){}};
  const app={document,localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},Date,Map,Set,console,crypto:{randomUUID:()=> 'request-id'},URL,addEventListener(){},removeEventListener(){}};app.window=app;vm.createContext(app);vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/direct-chat.js',import.meta.url),'utf8'),app);
  let failure=false,resolveHistory;
  const transport={history:async()=>({messages:[],before:null}),inbox:async()=>({threads:[]}),sendMessage:async(friend,text)=>{if(failure)throw Error('Service unavailable');return {version:1,from:owner,to:friend.id,id:'m'.repeat(32),text,timestamp:100,storedAt:100,sequence:1,key:'key',signature:'signature'};}};
  const store={append:async(...args)=>records.push(args),history:async()=>[]};
  const ui=app.VumiroDirectChat.create({transport,getProfile:()=>({id:app.currentOwner||owner,name:'Me'}),getFriends:()=>friends,onEnter(){},onExit:()=>options.onExit?.(node),onNotify:(...args)=>notifications.push(args),localStore:store,validate:options.validate});
  return {ui,node,owner,friends,records,notifications,transport,store,values,app,fail:()=>{failure=true;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const message=(app,sequence)=>({version:1,from:app.friends[0].id,to:app.owner,id:'m'+sequence,text:'message '+sequence,timestamp:sequence,storedAt:sequence,sequence,key:'key',signature:'signature'});
const logIds=app=>app.node('directChatLog').children.map(row=>row.dataset.messageId);
test('friend messages persist outside a call and failed sends keep the composer draft',async()=>{
  const app=harness();app.ui.state({connected:true,available:true});await app.ui.open(app.friends[0].id);app.node('directChatText').value='Hello offline friend';await app.ui.submit();
  assert.equal(app.records.length,1);assert.equal(app.records[0][0],app.owner);assert.equal(app.node('directChatText').value,'');
  app.fail();app.node('directChatText').value='Keep my draft';await app.ui.submit();assert.equal(app.node('directChatText').value,'Keep my draft');assert.match(app.node('directChatStatus').textContent,/unavailable/i);
});
test('live duplicates do not create duplicate unread alerts and active history stays quiet',async()=>{
  const app=harness(),message={version:1,from:app.friends[0].id,to:app.owner,id:'m'.repeat(32),text:'Hello',timestamp:100,storedAt:100,sequence:1,key:'key',signature:'sig'};
  await app.ui.receive(message,{history:false});await app.ui.receive(message,{history:false});assert.equal(app.notifications.length,1);
  app.ui.state({connected:true,available:true});await app.ui.open(app.friends[0].id);await app.ui.receive({...message,id:'n'.repeat(32),sequence:2},{history:true});assert.equal(app.notifications.length,1);
  await app.ui.receive({...message,id:'o'.repeat(32),sequence:3},{history:false});assert.equal(app.notifications.length,1);
});
test('old asynchronous history cannot switch the selected friend or leak another identity',async()=>{
  const app=harness();app.friends.push({id:'C'.repeat(43),name:'Other',nickname:'Other'});let release;
  app.ui.state({connected:true,available:true});await new Promise(resolve=>setImmediate(resolve));
  app.transport.history=friend=>friend.id===app.friends[0].id?new Promise(resolve=>{release=resolve;}):Promise.resolve({messages:[],before:null});
  const first=app.ui.open(app.friends[0].id);await new Promise(resolve=>setImmediate(resolve));await app.ui.open(app.friends[1].id);release({messages:[],before:null});await first;
  assert.equal(app.node('directChatName').textContent,'Other');
  const alien={from:'D'.repeat(43),to:'E'.repeat(43),id:'m'.repeat(32),text:'foreign',timestamp:1,sequence:1};await app.ui.receive(alien,{history:false});assert.equal(app.records.length,0);
});

test('a stale inbox response cannot erase a newer live unread message',async()=>{
  const app=harness();app.ui.state({connected:true,available:true});await flush();const pending=deferred();app.transport.inbox=()=>pending.promise;
  const sync=app.ui.syncInbox();await app.ui.receive(message(app,2));assert.equal(app.node('messagesCount').hidden,false);
  pending.resolve({threads:[{friend:app.friends[0].id,sequence:1,storedAt:1,from:app.owner}]});await sync;assert.equal(app.node('messagesCount').hidden,false);
});

test('opening empty history does not mark unseen inbox messages read when loading fails',async()=>{
  const app=harness(),id=app.friends[0].id;app.transport.inbox=async()=>({threads:[{friend:id,sequence:99,storedAt:99,from:id}]});app.ui.state({connected:true,available:true});await flush();app.transport.history=async()=>{throw Error('Offline');};
  await app.ui.open(id);assert.equal(app.node('directChatLog').children.length,0);assert.equal(app.node('messagesCount').hidden,false);assert.notEqual(app.values.get('vumiro-dm-read:'+app.owner+':'+id),'99');
});

test('an old owner send cannot clear another account draft after its cache write completes',async()=>{
  const app=harness();app.ui.state({connected:true,available:true});await flush();await app.ui.open(app.friends[0].id);const pending=deferred();app.store.append=()=>pending.promise;
  app.node('directChatText').value='Keep this';const send=app.ui.submit();await flush();app.ui.destroy();app.app.currentOwner='C'.repeat(43);app.node('directChatText').value='Keep this';app.node('directChatStatus').textContent='New identity';pending.resolve();await send;
  assert.equal(app.node('directChatText').value,'Keep this');assert.equal(app.node('directChatStatus').textContent,'New identity');
});

test('switching conversations preserves new drafts while another send awaits stored acknowledgment',async()=>{
  const app=harness();app.friends.push({id:'C'.repeat(43),name:'Other'});app.ui.state({connected:true,available:true});await flush();await app.ui.open(app.friends[0].id);const pending=deferred();app.transport.sendMessage=()=>pending.promise;
  app.node('directChatText').value='First send';const send=app.ui.submit();assert.equal(app.node('directChatSend').disabled,true);assert.equal(app.node('directChatText').value,'First send');
  app.node('directChatText').value='Next draft';await app.ui.open(app.friends[1].id);app.node('directChatText').value='Other draft';pending.resolve({...message(app,1),from:app.owner,to:app.friends[0].id,text:'First send'});await send;
  assert.equal(app.node('directChatText').value,'Other draft');await app.ui.open(app.friends[0].id);assert.equal(app.node('directChatText').value,'Next draft');
});

test('older pages remain in a bounded window and preserve the reading anchor with one render',async()=>{
  const app=harness();app.store.history=async()=>Array.from({length:400},(_,i)=>message(app,i+101));let page=0;app.transport.history=async(friend,options)=>{if(++page===1)return {messages:[],before:'101'};assert.equal(options.before,'101');return {messages:Array.from({length:50},(_,i)=>message(app,i+51)),before:'51'};};
  app.ui.state({connected:true,available:true});await flush();await app.ui.open(app.friends[0].id);const log=app.node('directChatLog'),viewport=app.node('directHistoryViewport');assert.equal(viewport.scrollTop,viewport.scrollHeight-viewport.clientHeight,'initial view shows latest');viewport.scrollTop=200;const anchor=log.children[10].dataset.messageId,offset=log.children[10].getBoundingClientRect().top,count=log.renderCount;
  app.node('directHistoryMore').listeners.get('click')();await flush();assert.equal(log.children.length,400);assert.equal(log.children[0].dataset.messageId,'m51');assert.equal(log.children.find(row=>row.dataset.messageId===anchor).getBoundingClientRect().top,offset);assert.equal(log.renderCount,count+1);
  await app.ui.receive(message(app,501));assert.equal(log.children.length,400);assert.equal(log.children[0].dataset.messageId,'m51');assert.equal(log.children.find(row=>row.dataset.messageId===anchor).getBoundingClientRect().top,offset);assert.equal(app.records.at(-1)[2].sequence,501,'new arrivals still persist while the older reading window stays in place');
});

test('live messages preserve an older scroll position and follow only an already near-bottom reader',async()=>{
  const app=harness();app.store.history=async()=>Array.from({length:30},(_,i)=>message(app,i+1));await app.ui.open(app.friends[0].id);const log=app.node('directChatLog'),viewport=app.node('directHistoryViewport');assert.equal(viewport.scrollTop,500);viewport.scrollTop=100;
  await app.ui.receive(message(app,31));assert.equal(viewport.scrollTop,100);viewport.scrollTop=viewport.scrollHeight-viewport.clientHeight;await app.ui.receive(message(app,32));assert.equal(viewport.scrollTop,viewport.scrollHeight-viewport.clientHeight);
});

test('cached history revalidates envelopes and keeps owner and participant scope',async()=>{
  const checked=[],app=harness({validate:async value=>{checked.push(value.id);return value.id==='m1';}});app.store.history=async(owner,id)=>{assert.equal(owner,app.owner);assert.equal(id,app.friends[0].id);return [message(app,1),message(app,2)];};
  await app.ui.open(app.friends[0].id);assert.deepEqual(checked,['m1','m2']);assert.deepEqual(logIds(app),['m1']);assert.equal(app.records.length,0);
});

test('visibility includes the Messages welcome view without an active friend',async()=>{
  const app=harness();await app.ui.open('');assert.equal(app.ui.visible,true);assert.equal(app.ui.active,'');app.ui.hide();assert.equal(app.ui.visible,false);
});

test('a scroll cannot mark a cached live message read before its row is rendered',async()=>{
  const app=harness(),id=app.friends[0].id;app.store.history=async()=>[message(app,1)];await app.ui.open(id);const pending=deferred();app.store.append=()=>pending.promise;
  const incoming=app.ui.receive(message(app,2));app.node('directHistoryViewport').listeners.get('scroll')();assert.equal(app.values.get('vumiro-dm-read:'+app.owner+':'+id),'1');
  pending.resolve();await incoming;assert.equal(app.values.get('vumiro-dm-read:'+app.owner+':'+id),'2');
});

test('people summaries expose only real conversation activity and unread state survives filtering',async()=>{
  const app=harness(),id=app.friends[0].id;
  assert.equal(app.ui.conversation(id).storedAt,0);assert.equal(app.ui.conversation(id).unread,false);
  await app.ui.receive(message(app,2));
  assert.equal(app.ui.conversation(id).storedAt,2);assert.equal(app.ui.conversation(id).unread,true);
  app.ui.refresh();assert.equal(app.ui.conversation(id).unread,true);
  await app.ui.open(id);assert.equal(app.ui.conversation(id).unread,false);
});

test('refreshing a renamed selected person updates its header without losing the draft',async()=>{
  const app=harness();await app.ui.open(app.friends[0].id);app.node('directChatText').value='Keep this draft';
  app.friends[0].nickname='New nickname';app.ui.refresh();
  assert.equal(app.node('directChatName').textContent,'New nickname');assert.equal(app.node('directChatText').value,'Keep this draft');
});

test('accepting or importing another friend synchronizes the highlighted person and active recipient while preserving drafts',async()=>{
  const app=harness(),first=app.friends[0];app.friends.push({id:'C'.repeat(43),name:'Other',nickname:'Other'});
  await app.ui.open(first.id);app.node('directChatText').value='Draft for the first person';
  Object.assign(app.app,{friends:app.friends,selected:app.friends[1].id,online:new Set(),pending:null,peerProfiles:null,local:{listFriends:async()=>app.friends},friendById:id=>app.friends.find(person=>person.id===id),watch(){},renderFriends:()=>app.ui.refresh(),renderNotifications(){},window:app.app});app.app.VumiroDirectChatController=app.ui;
  const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8'),start=source.indexOf('async function reloadFriends(){');
  vm.runInContext(source.slice(start,source.indexOf('\n',start)),app.app);
  await app.app.reloadFriends();await flush();
  assert.equal(app.ui.active,app.app.selected);assert.equal(app.node('directChatName').textContent,'Other');assert.equal(app.node('directChatText').value,'');
  await app.ui.open(first.id);assert.equal(app.node('directChatText').value,'Draft for the first person');
});

test('Back returns focus through the People exit route after hiding the conversation controls',async()=>{
  const app=harness({onExit:node=>{assert.equal(node('directChatConversation').hidden,true);node('search').focus();}});
  await app.ui.open(app.friends[0].id);app.node('directChatText').value='Keep after Back';
  app.node('directChatBack').listeners.get('click')();await flush();
  assert.equal(app.ui.active,'');assert.equal(app.ui.visible,true);assert.equal(app.app.document.activeElement,app.node('search'));
  await app.ui.open(app.friends[0].id);assert.equal(app.node('directChatText').value,'Keep after Back');
});
