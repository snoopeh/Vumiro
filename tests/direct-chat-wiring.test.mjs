import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('directory socket delivers a full bounded DM history page to the transport',async()=>{
  const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8'),start=source.indexOf('function connect(){'),received=[];
  const app={lobbyInitialized:true,window:{VumiroDirectTransport:{disconnected(){}}},lookupGeneration:0,$:()=>({replaceChildren(){}}),clearTimeout(){},setTimeout:()=>1,reconnectTimer:0,stopped:false,profile:{id:'A'.repeat(43)},generation:0,ready:false,online:new Map(),rooms:[],peerProfiles:null,serviceState(){},rejectLookups(){},rejectRoomAliases(){},rejectSocialAcks(){},clearLegacyRequests(){},socket:null,renderFriends(){},URL,serviceUrl:'ws://127.0.0.1:8787/call-signaling',WebSocket:class{},Promise,JSON,status(){},receive:async message=>received.push(message)};
  vm.createContext(app);vm.runInContext(source.slice(start,source.indexOf('\n',start)),app);app.connect();
  const page={type:'dm-history-result',nonce:'n'.repeat(32),messages:Array.from({length:100},(_,i)=>({id:String(i),text:'a'.repeat(4096)})),before:null};
  assert.ok(JSON.stringify(page).length>65536);app.socket.onmessage({data:JSON.stringify(page)});await app.messages;assert.equal(received.length,1);assert.equal(received[0].messages.length,100);
  app.socket.onmessage({data:'x'.repeat(1048577)});await app.messages;assert.equal(received.length,1,'oversized frames remain rejected before JSON parsing');
});
