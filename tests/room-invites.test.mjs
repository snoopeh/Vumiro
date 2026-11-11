import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const ownId='A'.repeat(43),friendId='B'.repeat(43),otherId='C'.repeat(43),room=ownId+'_'+'a'.repeat(48),otherRoom=friendId+'_'+'b'.repeat(48);
const token='Abc_456-xy12';
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,`Missing ${start}`);return source.slice(a,b);}
function harness(){
  const sent=[],posts=[],opened=[],statuses=[],elements=new Map(),timers=new Map(),listeners=new Map();let nonce=0,timer=0;
  const friends=[{id:friendId,name:'Friend',nickname:'My friend',key:'key'},{id:otherId,name:'Offline',nickname:'Offline'}];
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false,open:false,value:'',style:{},setAttribute(){},reset(){this.resetCalled=true;}});return elements.get(id);};
  const frame={contentWindow:{postMessage:(value,origin)=>posts.push({value,origin})},remove(){this.removed=true;}};
  const socket={readyState:1,close(){}};
  const context={URL,URLSearchParams,Map,Set,Error,Date,console,
    profile:{id:ownId,name:'Owner',key:'owner-key'},friends,blocked:[],online:new Set([friendId]),socket,generation:1,ready:true,stopped:false,retry:0,
    pending:null,incomingCall:null,frame,currentRoom:room,currentAccess:{mode:'private'},joined:true,sharing:false,serviceUrl:'wss://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling',
    location:{origin:'https://vumiro.local',href:'https://vumiro.local/friends.html'},query:new URLSearchParams(),WebSocket:{OPEN:1},ringTimer:0,migrateRoomHost:url=>url,
    $:element,friendById:id=>context.friends.find(friend=>friend.id===id),send:message=>sent.push(message),runtimeNow:()=>Date.now(),newRoom:()=>ownId+'_'+'c'.repeat(48),
    crypto:{randomUUID:()=>`room_invite_nonce_${++nonce}`},local:{sign:async()=> 'signed',verify:async()=>true,listFriends:async()=>context.friends},
    renderFriends(){},renderRooms(){},renderRequests(){},renderNotifications(){},notifySocial(){},notificationSettings:{call:{sound:true},roomInvite:{sound:true}},status:value=>statuses.push(value),playUiCue(){},serviceState(){},rememberDirectoryProfile(){},announce(){},watch(){},publishRoom(){},directoryFriendTag:()=>'',stopStreamAudioHost(){},setRoomView(){},leaveTimer:0,
    showRooms(){context.roomsShown=true;},openRoom:(...args)=>opened.push(args),canCall:()=>false,
    window:{VumiroServerClock:{sync(){},isSynced:()=>true}},namedFriendTagsAvailable:false,socialV2Available:true,usernameCollision:false,
    requests:[],rooms:[],lookups:new Map(),notifiedRooms:new Map(),host:null,peerProfiles:null,settleSocialAck(){},rejectSocialAcks(){},
    setTimeout(callback){const id=++timer;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),setInterval:()=>++timer,clearInterval(){},
    addEventListener:(name,callback)=>listeners.set(name,callback),
  };
  vm.runInNewContext(section('function normalizeService(', 'function serviceState(')+section('// Room invitation bridge.', 'function renderSettings(')+section('function showInvitation(', 'function settleSocialAck(')+section('async function receive(m,current,version)', 'async function hydrateRequests(')+section('function finishRoom(', 'function leaveRoom(')+section("addEventListener('message',event=>{\n  if(!frame",'function renderRooms(')+
    ';globalThis.inviteTest={requestRoomAlias,settleRoomAlias,rejectRoomAliases,parseRoomInvitation,handleRoomInvite,inviteToCurrentRoom,showInvitation,receive,clearPending,finishRoom,aliasCount:()=>roomAliasTasks.size,setCapabilities:value=>{roomAliasesAvailable=value;}};',context);
  context.inviteTest.setCapabilities(true);
  return {context,sent,posts,opened,statuses,timers,element,frame,socket,api:context.inviteTest,receive:value=>context.inviteTest.receive(value,socket,1),message:({data,origin=context.location.origin,source=frame.contentWindow})=>listeners.get('message')({data,origin,source})};
}
const alias=(app,request=app.sent.at(-1))=>({type:'room-alias-result',nonce:request.nonce,room,token,code:'ABCD-EFGH',expires:Date.now()+86400000});
const resolved=(app,request=app.sent.at(-1),extra={})=>({type:'room-resolve-result',nonce:request.nonce,room:otherRoom,owner:friendId,mode:'private',name:'Friend',...extra});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('alias requests correlate to authenticated socket and produce compact secret-free service links',async()=>{
  const app=harness(),waiting=app.api.requestRoomAlias('room-alias',{room});
  assert.deepEqual(JSON.parse(JSON.stringify(app.sent[0])),{type:'room-alias',room,nonce:'room_invite_nonce_1'});
  await app.receive({...alias(app),nonce:'wrong_nonce_123456'});assert.equal(app.api.aliasCount(),1);
  await app.receive(alias(app));const result=await waiting;assert.equal(result.token,token);assert.equal(app.api.aliasCount(),0);assert.equal(app.timers.size,0);
  const state=app.api.handleRoomInvite({type:'vumiro-room-invite',action:'state',room});await app.receive(alias(app));await state;
  const reply=app.posts.at(-1);assert.equal(reply.value.link,'https://vumiro-rooms.vumiro-signaling.workers.dev/r/'+token);assert.equal(reply.value.code,'ABCD-EFGH');
  assert.equal(reply.origin,'https://vumiro.local');assert.deepEqual(JSON.parse(JSON.stringify(reply.value.friends)),[{id:friendId,name:'My friend'}]);
  assert.equal(new URL(reply.value.link).search,'');assert.equal(new URL(reply.value.link).hash,'');
});

test('aliases reject on timeout, disconnect, service errors and unavailable service capability',async()=>{
  const app=harness(),first=app.api.requestRoomAlias('room-alias',{room});const rejected=assert.rejects(first,/disconnected/i);
  app.api.rejectRoomAliases();await rejected;assert.equal(app.api.aliasCount(),0);assert.equal(app.timers.size,0);
  const second=app.api.requestRoomAlias('room-alias',{room});const timedOut=assert.rejects(second,/timed out/i);[...app.timers.values()][0]();await timedOut;assert.equal(app.api.aliasCount(),0);
  const third=app.api.requestRoomAlias('room-alias',{room});const denied=assert.rejects(third,/not available/i);await app.receive({type:'social-error',nonce:app.sent.at(-1).nonce,code:'room-unavailable',message:'Room not available'});await denied;
  app.api.setCapabilities(false);await assert.rejects(app.api.requestRoomAlias('room-alias',{room}),/updated.*service/i);
});

test('short links, redirected links and human codes resolve before normal private-room admission',async()=>{
  for(const input of ['ABCD-EFGH','abcdefgh',`https://vumiro-rooms.vumiro-signaling.workers.dev/r/${token}`,`https://vumiro-rooms.vumiro-signaling.workers.dev/friends.html?roomInvite=${token}`]){
    const app=harness(),waiting=app.api.parseRoomInvitation(input);assert.equal(app.sent.at(-1).type,'room-resolve');await app.receive(resolved(app));
    const result=await waiting;assert.equal(result.room,otherRoom);assert.equal(result.mode,'private');assert.equal(app.opened.length,0);
  }
  const app=harness();await assert.rejects(app.api.parseRoomInvitation(`https://untrusted.example/r/${token}`),/different service/i);assert.equal(app.sent.length,0);
  const waiting=app.api.parseRoomInvitation('ABCD-EFGH');await app.receive(resolved(app,undefined,{room:null}));await assert.rejects(waiting,/unavailable|expired/i);
});

test('legacy room invitations stay readable and an own-room alias cannot join itself',async()=>{
  const app=harness(),legacy=await app.api.parseRoomInvitation('https://vumiro-rooms.vumiro-signaling.workers.dev/call.html?room='+otherRoom+'&mode=friends');
  assert.equal(legacy.room,otherRoom);assert.equal(legacy.mode,'friends');assert.equal(app.sent.length,0);
  const waiting=app.api.parseRoomInvitation('ABCD-EFGH');await app.receive(resolved(app,undefined,{room,owner:ownId}));await assert.rejects(waiting,/own invitation/i);
  app.context.query.set('roomInvite',token);app.api.showInvitation();assert.equal(app.context.roomsShown,true);assert.match(app.element('roomInvitation').value,/roomInvite=/);
});

test('only the current room iframe and matching origin can request invitation state',async()=>{
  const app=harness(),data={type:'vumiro-room-invite',action:'state',room};
  app.message({data,origin:'https://evil.example'});app.message({data,source:{}});app.message({data:{...data,room:otherRoom}});assert.equal(app.sent.length,0);
  app.message({data});assert.equal(app.sent.length,1);await app.receive(alias(app));await flush();assert.equal(app.posts.at(-1).value.action,'state');
});

test('direct invites use the existing host room and acceptance keeps the active stream frame',async()=>{
  const app=harness();await app.api.handleRoomInvite({type:'vumiro-room-invite',action:'invite',room,to:friendId});
  const invite=app.sent.find(message=>message.type==='invite');assert.ok(invite);assert.equal(invite.room,room);assert.equal(invite.to,friendId);assert.ok(invite.grant.signature);
  assert.equal(app.context.pending.existingRoom,true);assert.equal(app.posts.at(-1).value.ok,true);assert.match(app.posts.at(-1).value.message,/sent|accept/i);
  await app.receive({type:'answer',from:friendId,to:ownId,room,nonce:invite.nonce,expires:invite.expires,accepted:true,signature:'signed'});
  assert.equal(app.context.frame,app.frame);assert.equal(app.context.currentRoom,room);assert.equal(app.context.pending,null);assert.equal(app.opened.length,0);assert.match(app.posts.at(-1).value.message,/accepted/i);
});

test('signed direct-invite purpose is available before the room directory update',async()=>{
  const app=harness();await app.api.inviteToCurrentRoom(app.context.friends[0]);
  const invite=app.sent.find(message=>message.type==='invite');
  assert.match(invite.nonce,/^room_/);
  const start=source.indexOf('const notificationCategory='),end=source.indexOf(';const value=',start);
  assert.ok(start>=0&&end>start);
  const choose=nonce=>vm.runInNewContext(`(()=>{const rooms=[];const m={room:'${room}',nonce:'${nonce}'};${source.slice(start,end)};return notificationCategory;})()`);
  assert.equal(choose(invite.nonce),'roomInvite');
  assert.equal(choose('call_1234567890abcdef'),'call');
  assert.equal(choose('plain-legacy-nonce'),'roomInvite');
  assert.match(source,/nonce:'call_'\+crypto\.randomUUID\(\)/);
  assert.doesNotMatch(source.slice(start,end),/rooms\.some/);
  assert.match(source,/legacyInvite=!m\.nonce\.startsWith\('call_'\)&&!m\.nonce\.startsWith\('room_'\)/);
  assert.match(source,/legacyInvite\?' sent a room invitation\.'/);
});

test('declined, unavailable and expired current-room invites report failure without leaving the room',async()=>{
  for(const outcome of ['declined','unavailable','expired']){
    const app=harness();await app.api.inviteToCurrentRoom(app.context.friends[0]);const invite=app.sent.at(-1);
    if(outcome==='declined')await app.receive({type:'answer',from:friendId,to:ownId,room,nonce:invite.nonce,expires:invite.expires,accepted:false,signature:'signed'});
    else if(outcome==='unavailable')await app.receive({type:'unavailable',to:friendId,nonce:invite.nonce});
    else app.api.clearPending('The call invitation expired.');
    assert.equal(app.posts.at(-1).value.ok,false);assert.match(app.posts.at(-1).value.message,new RegExp(outcome==='expired'?'expired':outcome,'i'));assert.equal(app.context.frame,app.frame);assert.equal(app.opened.length,0);
  }
});

test('removed friends, guests, blocked users and a room ending during signing cannot send invites',async()=>{
  for(const change of [app=>{app.context.currentRoom=otherRoom;},app=>{app.context.blocked.push(friendId);},app=>{app.context.friends=[];}]){
    const app=harness();change(app);await assert.rejects(app.api.inviteToCurrentRoom({id:friendId,nickname:'Friend'}));assert.equal(app.sent.length,0);
  }
  const app=harness();let resume,signs=0;app.context.local.sign=()=>++signs===1?new Promise(resolve=>{resume=resolve;}):Promise.resolve('signed');
  const waiting=app.api.inviteToCurrentRoom(app.context.friends[0]);await flush();app.context.frame=null;resume('signed');await assert.rejects(waiting,/room|invitation/i);assert.equal(app.sent.length,0);
});

test('closing a room cancels its pending direct invitation and clears the waiting controls',async()=>{
  const app=harness();await app.api.inviteToCurrentRoom(app.context.friends[0]);app.api.finishRoom();
  assert.equal(app.context.pending,null);assert.equal(app.context.frame,null);assert.equal(app.context.currentRoom,'');assert.equal(app.frame.removed,true);
  assert.equal(app.posts.at(-1).value.ok,false);assert.match(app.posts.at(-1).value.message,/room.*closed|cancelled/i);
});
