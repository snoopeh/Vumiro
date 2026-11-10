import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const friends=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
const call=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
function lobby(){let resolve,initialized=0,connected=0;const current={id:'identity-after-account-restore'},account=new Promise(done=>resolve=done),elements=new Map();
  const app={window:{VumiroAccount:{ready:()=>account,onProfileReady:async()=>{}}},read:()=>null,save(){},normalizeService:v=>v,query:{get:()=>null},location:{origin:'https://app.test'},local:{initialize:async()=>{initialized++;return current;},listBlocked:async()=>[]},seedLocalQaFriends:async()=>{},renderProfile(){},hydrateRequests:async()=>{},reloadFriends:async()=>{},connect(){connected++;},showInvitation(){},serviceState(){},status(){},dialog(){},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
  const start=friends.lastIndexOf('(async()=>{try{const savedService=');assert.ok(start>=0);const pending=vm.runInNewContext(friends.slice(start,friends.indexOf('\n',start)),app);
  return{resolve,pending,app,initialized:()=>initialized,connected:()=>connected};
}
test('lobby cannot initialize contacts or connect before account readiness or after a denied entry',async()=>{
  const h=lobby();assert.equal(h.initialized(),0);h.resolve(false);await h.pending;assert.equal(h.initialized(),0);assert.equal(h.connected(),0);
});
test('successful account restoration initializes the current identity before connecting the lobby',async()=>{
  const h=lobby();h.resolve(true);await h.pending;assert.equal(h.initialized(),1);assert.equal(h.app.profile.id,'identity-after-account-restore');assert.equal(h.connected(),1);
});
function roomEntry({signedIn=false,standalone=false,crossOrigin=false}={}){
  const redirects=[],parentLocation={origin:crossOrigin?'https://other.test':'https://app.test',pathname:'/friends.html',replace:url=>redirects.push(url)};
  const app={URL,location:{href:'https://app.test/call.html?room=room-code&autojoin=1&embedded=1#invite',origin:'https://app.test',replace:url=>redirects.push(url)},parent:{location:parentLocation,VumiroAccount:{getState:()=>({signedIn})}}};app.window=app;if(standalone)app.parent=app;
  const from=call.indexOf('  function roomAccountAllowed()'),to=call.indexOf('  if(!roomAccountAllowed())return;',from);assert.ok(from>=0&&to>from,'room entry guard exists');vm.runInNewContext(call.slice(from,to),app);return{allowed:app.roomAccountAllowed(),redirects};
}
test('standalone room links return through account-gated lobby while preserving invitation data',()=>{
  const h=roomEntry({standalone:true}),url=new URL(h.redirects.at(-1));assert.equal(h.allowed,false);assert.equal(url.pathname,'/friends.html');assert.equal(url.searchParams.get('room'),'room-code');assert.equal(url.hash,'#invite');assert.equal(url.searchParams.has('embedded'),false);assert.equal(url.searchParams.has('autojoin'),false);
});
test('only the authenticated same-origin lobby can initialize an embedded room',()=>{
  assert.equal(roomEntry({signedIn:true}).allowed,true);assert.equal(roomEntry().allowed,false);assert.equal(roomEntry({signedIn:true,crossOrigin:true}).allowed,false);
});
