import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends.html',import.meta.url),'utf8');

function harness(saved){
  const start=source.indexOf('const notificationCategories='),end=source.indexOf('let generation=0',start);
  assert.ok(start>=0&&end>start,'notification controller exists');
  const elements=new Map(),storage=new Map(saved?[['vumiro-social-notifications-v1',JSON.stringify(saved)]]:[]),sounds=[],attention=[],opened=[],popups=[],dialogs=[];
  class Element{
    constructor(){this.children=[];this.dataset={};this.attributes={};this.textContent='';this.hidden=false;this.checked=false;this.value='';this.open=false;this.classList={contains:name=>this.settings===true&&name==='settingsScreen'};}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(name,value){this.attributes[name]=value;}
    focus(){this.focused=true;}
    click(){opened.push(this.id);}
    close(){this.open=false;}
    scrollIntoView(){this.scrolled=true;}
  }
  const $=id=>{if(!elements.has(id))elements.set(id,Object.assign(new Element(),{id}));return elements.get(id);};
  const context={$,document:{createElement:()=>new Element(),hasFocus:()=>false,querySelectorAll:()=>dialogs.filter(item=>item.open)},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    appSounds:true,playUiCue:kind=>sounds.push(kind),host:{postMessage:message=>attention.push(message)},
    friends:[],rooms:[],blocked:[],blocking:new Set(),requests:[],pending:null,profile:{id:'A'.repeat(43)},runtimeNow:()=>1000,
    dialog:id=>{opened.push(id);$(id).open=true;},status:message=>opened.push(message),renderRequests:()=>{},friendById:()=>null,frame:null,currentRoom:'',location:{origin:'https://app.test'},returnToRoom:()=>opened.push('room')};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(source.slice(start,end)+';globalThis.notificationsTest={setCenter:value=>notificationCenter=value,notificationItems,notificationAction,notifySocial,notificationSettings,renderNotifications,openNotifications,saveNotificationPreferences,resetNotificationDraft,notificationAvailable,clearNotificationSession:typeof clearNotificationSession===\'function\'?clearNotificationSession:null};',context);
  return {api:context.notificationsTest,$,storage,sounds,attention,opened,popups,dialogs,context};
}

test('notification settings default to useful categories and validate persisted values',()=>{
  const app=harness({friend:{visual:false,sound:false},call:{visual:'yes',sound:true},malicious:{visual:true,sound:true}});
  assert.equal(app.api.notificationSettings.friend.visual,false);
  assert.equal(app.api.notificationSettings.friend.sound,false);
  assert.equal(app.api.notificationSettings.call.visual,true);
  assert.equal(app.api.notificationSettings.roomActivity.visual,true);
  assert.equal(app.api.notificationSettings.roomActivity.sound,true);
  assert.equal(Object.hasOwn(app.api.notificationSettings,'malicious'),false);
});

test('same validated event alerts once; visual and sound settings are independent',()=>{
  const app=harness();
  assert.equal(app.api.notifySocial('friend','nonce-1','A friend sent a request',{type:'request',id:'nonce-1'},5000),true);
  assert.equal(app.api.notifySocial('friend','nonce-1','A friend sent a request',{type:'request',id:'nonce-1'},5000),false);
  assert.equal(app.$('notificationList').children.length,1);
  assert.equal(app.sounds.length,1);
  assert.equal(app.attention.length,1);
  assert.equal(app.attention[0].action,'notify');
  app.api.notificationSettings.roomActivity={visual:false,sound:false};
  app.api.notifySocial('roomActivity','room-1','Room opened',{type:'rooms'},5000);
  assert.equal(app.$('notificationList').children.length,2);
  assert.equal(app.sounds.length,1);
  assert.equal(app.attention.length,1);
});

test('desktop alerts identify the sender and carry only a bounded local action ID',()=>{
  const app=harness();
  app.api.notifySocial('friend','request-nonce','Kai sent you a friend request.',null,5000,{id:'B'.repeat(43),nickname:'Kai',avatar:''});
  const payload=app.attention.at(-1)?.notification;
  assert.ok(payload,'desktop popup payload exists');
  assert.equal(payload.senderName,'Kai');assert.equal(payload.body,'sent you a friend request.');
  assert.match(payload.id,/^notification-\d+$/);assert.equal(payload.avatar,'');
});

test('notification list bounds entries, expires actions, and uses text nodes for peer names',()=>{
  const app=harness();
  for(let n=0;n<75;n++)app.api.notifySocial('friend','nonce-'+n,'<img onerror=alert(1)>',{type:'request',id:'nonce-'+n},5000);
  assert.equal(app.$('notificationList').children.length,64);
  assert.equal(app.$('notificationList').children[0].children[0].textContent,'<img onerror=alert(1)>');
  app.context.runtimeNow=()=>6000;
  app.api.renderNotifications();
  assert.equal(app.$('notificationList').children[0].children.length,3);
  assert.equal(app.$('notificationList').children[0].children[2].textContent,'Expired');
});

test('actions disappear when a request, call or room is no longer current',()=>{
  const app=harness(),request={id:'nonce-1',direction:'incoming',expires:5000,contact:{id:'B'.repeat(43)}};
  app.context.requests=[request];
  app.context.requestNow=()=>1000;
  const current={action:{type:'request',id:'nonce-1'},expires:5000};
  assert.equal(app.api.notificationAvailable(current),true);
  app.context.blocked=[request.contact.id];
  assert.equal(app.api.notificationAvailable(current),false);
  app.context.blocked=[];app.context.requests=[];
  assert.equal(app.api.notificationAvailable(current),false);
  app.context.pending={direction:'incoming',nonce:'call-1',expires:5000,friend:request.contact.id};
  assert.equal(app.api.notificationAvailable({action:{type:'call',id:'call-1'},expires:5000}),true);
  app.context.pending=null;
  assert.equal(app.api.notificationAvailable({action:{type:'call',id:'call-1'},expires:5000}),false);
});

test('discovered room activity loses its View action after block, removal, or room closure',()=>{
  const app=harness(),owner='B'.repeat(43),room=owner+'_'+'b'.repeat(48);
  app.context.friendById=id=>id===owner?{id}:null;
  app.context.rooms=[{room,owner,live:true}];
  assert.match(source,/notifySocial\('roomActivity',first\.room\+':'\+first\.live,message,\{type:'rooms',id:first\.room\}/);
  app.api.notifySocial('roomActivity',room+':true','Friend is live',{type:'rooms',id:room},5000);
  assert.equal(app.$('notificationList').children[0].children[2].textContent,'View');
  app.context.blocked=[owner];app.api.renderNotifications();
  assert.equal(app.$('notificationList').children[0].children[2].textContent,'No longer available');
  app.context.blocked=[];app.context.friendById=()=>null;app.api.renderNotifications();
  assert.equal(app.$('notificationList').children[0].children[2].textContent,'No longer available');
  app.context.friendById=id=>id===owner?{id}:null;app.api.renderNotifications();
  assert.equal(app.$('notificationList').children[0].children[2].textContent,'View');
  const start=source.indexOf("if(m.type==='rooms'&&Array.isArray(m.rooms))"),end=source.indexOf("if(m.type==='presence'",start);
  assert.ok(start>=0&&end>start);
  app.context.renderRooms=()=>{};app.context.notifiedRooms=new Map();app.context.m={type:'rooms',rooms:[]};
  vm.runInContext(`(()=>{${source.slice(start,end)}})()`,app.context);
  assert.equal(app.$('notificationList').children[0].children[2].textContent,'No longer available');
  app.context.rooms=[];app.api.renderNotifications();
  assert.equal(app.$('notificationList').children[0].children[2].textContent,'No longer available');
});

test('inbox entries are cleared when the local contact identity changes',()=>{
  const app=harness();app.api.notifySocial('friend','one','A request',null,5000);
  assert.equal(app.$('notificationList').children.length,1);
  app.api.clearNotificationSession();
  assert.equal(app.$('notificationList').children.length,0);
  assert.match(source,/previous\.id!==profile\.id\)[^{]*\{\s*clearNotificationSession\(\)/);
});

test('saved preferences apply atomically and Cancel restores the last saved values',()=>{
  const app=harness();
  app.$('notificationFriendVisual').checked=false;
  app.$('notificationFriendSound').checked=false;
  app.api.saveNotificationPreferences();
  assert.equal(app.api.notificationSettings.friend.visual,false);
  assert.equal(app.api.notificationSettings.friend.sound,false);
  assert.equal(JSON.parse(app.storage.get('vumiro-social-notifications-v1')).friend.visual,false);
  app.$('notificationFriendVisual').checked=true;
  app.api.resetNotificationDraft();
  assert.equal(app.$('notificationFriendVisual').checked,false);
});

test('notification controls are accessible and settings have Save and Cancel',()=>{
  assert.match(html,/id="notificationOpen"[^>]*aria-label="Notifications"/);
  assert.match(html,/id="notificationDialog"[^>]*aria-labelledby="notificationTitle"/);
  assert.match(html,/id="notificationList"[^>]*aria-label="Recent notifications"/);
  assert.match(html,/id="notificationSettings"/);
  assert.match(html,/id="saveNotifications"/);
  assert.match(html,/id="cancelNotifications"/);
});

test('notification button always uses only the bell and the full view is a nonmodal panel',()=>{
  assert.match(html,/id="notificationOpen"[^>]*aria-label="Notifications"[^>]*>\s*<svg/);
  assert.doesNotMatch(html,/<span class="notificationLabel">/);
  assert.match(html,/<aside id="notificationDialog"/);
});


test('every visual event displays an in-app popup and only background events add a desktop popup',()=>{
  const app=harness();app.api.setCenter({sync(){},popup:item=>app.popups.push(item)});
  app.api.notifySocial('friend','background','Kai sent you a friend request.',null,5000);
  assert.equal(app.popups.length,1);assert.equal(app.attention.length,1);
  app.context.document.hasFocus=()=>true;
  app.api.notifySocial('friend','foreground','Kai is now your friend.',null,5000);
  assert.equal(app.popups.length,2);assert.equal(app.attention.length,1);
});

function routedItem(app,action){app.api.notifySocial('friend','route-'+app.api.notificationItems.length,'Activity',action,5000);return app.api.notificationItems[0];}
function openDialog(app,id,settings=false){const node=app.$(id);node.open=true;node.settings=settings;app.dialogs.push(node);return node;}

test('notification navigation respects Keep editing and leaves settings drafts open',async()=>{
  const app=harness(),settings=openDialog(app,'profileDialog',true);let decisions=0;
  app.context.VumiroSettingsExit={requestClose:async()=>{decisions++;return false;}};
  assert.equal(await app.api.notificationAction(routedItem(app,{type:'friends'})),false);
  assert.equal(decisions,1);assert.equal(settings.open,true);assert.ok(!app.opened.includes('friendsNav'));
});

test('chat popup waits for settings exit then closes safe dialogs and opens its room chat',async()=>{
  const app=harness(),settings=openDialog(app,'profileDialog',true),card=openDialog(app,'userCardDialog'),posts=[];
  app.context.currentRoom='room-1';app.context.frame={contentWindow:{postMessage:(...args)=>posts.push(args)}};
  let finish;app.context.VumiroSettingsExit={requestClose:()=>new Promise(resolve=>{finish=()=>{settings.close();resolve(true);};})};
  const result=app.api.notificationAction(routedItem(app,{type:'chat',room:'room-1'}));assert.equal(posts.length,0);assert.equal(card.open,true);
  finish();assert.equal(await result,true);assert.equal(card.open,false);assert.ok(app.opened.includes('room'));assert.equal(posts[0][0].type,'vumiro-open-chat');assert.equal(posts[0][1],'https://app.test');
});

test('expired calls and identity changes while saving settings cancel notification navigation',async()=>{
  for(const change of ['call','identity']){
    const app=harness(),settings=openDialog(app,'profileDialog',true);app.context.pending={direction:'incoming',nonce:'call-1',expires:5000,friend:'B'.repeat(43)};
    let finish;app.context.VumiroSettingsExit={requestClose:()=>new Promise(resolve=>{finish=()=>{settings.close();resolve(true);};})};
    const item=routedItem(app,{type:'call',id:'call-1'}),result=app.api.notificationAction(item);
    assert.equal(await app.api.notificationAction(item),false,'a second click cannot start overlapping exit decisions');
    if(change==='call')app.context.pending=null;else app.context.profile={id:'C'.repeat(43)};
    finish();assert.equal(await result,false);assert.ok(!app.opened.includes('friendsNav'));assert.equal(app.$('acceptInvite').focused,undefined);
  }
});

test('notification activation never dismisses destructive or unknown modal dialogs',async()=>{
  for(const id of ['confirmDialog','nicknameDialog','identityRecoveryDialog']){
    const app=harness(),modal=openDialog(app,id);let decisions=0;openDialog(app,'profileDialog',true);
    app.context.VumiroSettingsExit={requestClose:async()=>{decisions++;return true;}};
    assert.equal(await app.api.notificationAction(routedItem(app,{type:'friends'})),false);assert.equal(modal.open,true);assert.equal(decisions,0);assert.ok(!app.opened.includes('friendsNav'));
  }
});

test('call popups take a browsing user to Friends and focus the incoming invitation',async()=>{
  const app=harness();app.context.pending={direction:'incoming',nonce:'call-1',expires:5000,friend:'B'.repeat(43)};
  assert.equal(await app.api.notificationAction(routedItem(app,{type:'call',id:'call-1'})),true);
  assert.ok(app.opened.includes('friendsNav'));assert.equal(app.$('acceptInvite').focused,true);
});

test('request and room activity popups focus their originating row without accepting or joining',async()=>{
  for(const type of ['request','rooms']){
    const app=harness(),owner='B'.repeat(43),id=type==='request'?'request-1':owner+'_'+'a'.repeat(48),button={focus(){this.focused=true;}};
    const row={dataset:type==='request'?{notificationRequestId:id}:{notificationRoomId:id},scrollIntoView(){this.scrolled=true;},querySelector:()=>button};
    app.context.friendById=value=>value===owner?{id:owner}:null;
    app.context.requests=[{id,direction:'incoming',expires:5000,contact:{id:owner}}];app.context.requestNow=()=>1000;
    app.context.rooms=[{room:id,owner}];app.context.renderRooms=()=>{};
    app.$(type==='request'?'requests':'roomsList').children=[row];
    assert.equal(await app.api.notificationAction(routedItem(app,{type,id})),true);
    assert.equal(row.scrolled,true);assert.equal(button.focused,true);
    assert.ok(app.opened.includes(type==='request'?'friendsNav':'roomDialog'));
  }
});
