import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
function harness(){
  const events=[],elements=new Map();let opened;
  class Socket{constructor(){opened=this;}close(){}}
  const app={VumiroRoomConnection:{set:(...args)=>events.push(args)},generation:1,roomNonce:'',roomFriendsRevision:0,joining:false,joined:false,retry:0,disconnected:false,identity:{id:'self'},WebSocket:Socket,signalUrl:()=>new URL('wss://example.test/room'),updateControls(){},diagnostic(){},status(){},chatLine(){},clearPeers(){},policyAck:null,serverPolicy:{mode:'friends'},passwordResolve:null,setTimeout:()=>1,clock:null,ownsRoom:()=>false,$:id=>{if(!elements.has(id))elements.set(id,{value:'Me',hidden:true,textContent:''});return elements.get(id);},localTile:{},ownProfile:()=>null,peers:new Map(),updateRoomFriends:async()=>{},setChatRoom(){},clearTimeout(){}};
  vm.createContext(app);vm.runInContext(section('  function openSocket() {','  async function leave() {'),app);
  return {app,events,elements,socket:()=>opened};
}
test('socket connection screen clears on the real welcome message',async()=>{
  const {app,events,socket}=harness();app.openSocket();assert.equal(events.at(-1)?.[0],'joining');
  await socket().onmessage({data:JSON.stringify({type:'welcome',id:'self',peers:[]})});assert.equal(events.at(-1)?.[0],'connected');
});
test('socket failures show the real rejection and automatic retry state',async()=>{
  const {app,events,socket}=harness();app.openSocket();await socket().onmessage({data:JSON.stringify({type:'error',message:'Room full'})});assert.deepEqual(events.at(-1),['error','Room full']);
  socket().onclose({code:4008,reason:'Room full'});assert.deepEqual(events.at(-1),['error','Room full']);
  app.openSocket();socket().onclose({code:1006,reason:''});assert.equal(events.at(-1)?.[0],'reconnecting');
});
test('stale socket callbacks cannot reopen a completed or cancelled connection screen',async()=>{
  const {app,events,socket}=harness();app.openSocket();const old=socket();app.generation++;events.length=0;
  old.onerror();old.onclose({code:1006});await old.onmessage({data:JSON.stringify({type:'welcome',id:'self'})});assert.equal(events.length,0);
});
test('submitting a room password restores connection feedback while authentication finishes',()=>{
  const {app,events,elements}=harness();let supplied='';app.passwordResolve=value=>{supplied=value;};app.reconnect=()=>assert.fail('existing challenge should continue');
  vm.runInContext(section("  $('passwordForm').onsubmit=",'  function policyFields()'),app);
  app.$('guestPassword').value='secret password';app.$('passwordForm').onsubmit({preventDefault(){}});
  assert.equal(supplied,'secret password');assert.equal(elements.get('passwordPrompt').hidden,true);assert.equal(events.at(-1)?.[0],'joining');
});
