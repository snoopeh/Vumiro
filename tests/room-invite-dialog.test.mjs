import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
function harness(){
  const elements=new Map(),sent=[],copied=[];
  class Element{constructor(){this.children=[];this.dataset={};this.value='';this.open=true;}replaceChildren(...children){this.children=children;}append(...children){this.children.push(...children);}focus(){}select(){this.selected=true;}}
  const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};$('room').value='current-room';
  const context={$,joined:true,embedded:true,roomMode:'private',roomValue:value=>value,invitation:()=>{throw Error('Embedded rooms must use aliases.');},signalUrl:()=>new URL('wss://rooms.example/call-signaling'),URL,Set,document:{createElement:()=>new Element()},parentMessage:message=>sent.push(message),navigator:{clipboard:{writeText:async value=>copied.push(value)}}};
  const start=source.indexOf('  let invitationState='),end=source.indexOf('  function updateControls()',start);assert.ok(start>=0&&end>start,'room invitation UI module exists');
  vm.runInNewContext(source.slice(start,end),context);return {context,$,sent,copied};
}
test('embedded invite starts empty until an opaque service alias arrives, then copies only its short URL',async()=>{
  const app=harness();app.context.renderInvitation();assert.equal(app.$('inviteLink').value,'');assert.equal(app.$('inviteCopy').disabled,true);
  app.context.receiveRoomInvitation({action:'state',room:'current-room',link:'https://rooms.example/r/AbCdEf123456',code:'LUCD-2345',friends:[]});
  await app.context.copyInvitation();assert.deepEqual(app.copied,['https://rooms.example/r/AbCdEf123456']);assert.equal(app.$('inviteCode').value,'LUCD-2345');assert.match(app.$('inviteHint').textContent,/password separately/);
});
test('invitation response cannot replace another room or insert a data-bearing URL',()=>{
  const app=harness();app.context.receiveRoomInvitation({action:'state',room:'another-room',link:'https://rooms.example/r/AbCdEf123456',friends:[]});assert.equal(app.$('inviteLink').value,'');
  for(const link of ['https://attacker.example/r/AbCdEf123456','https://rooms.example/r/AbCdEf123456?password=secret','https://user:secret@rooms.example/r/AbCdEf123456']){app.context.receiveRoomInvitation({action:'state',room:'current-room',link,friends:[]});assert.equal(app.$('inviteLink').value,'');}
});
test('friend invitation uses literal names and targets the current room without copying a link',()=>{
  const app=harness(),id='a'.repeat(43);app.context.receiveRoomInvitation({action:'state',room:'current-room',friends:[{id,name:'<img onerror=bad>'}]});
  const row=app.$('inviteFriends').children[0];assert.equal(row.children[0].textContent,'<img onerror=bad>');row.children[1].onclick();
  assert.equal(app.sent[0].type,'vumiro-room-invite');assert.equal(app.sent[0].action,'invite');assert.equal(app.sent[0].room,'current-room');assert.equal(app.sent[0].to,id);assert.equal(app.copied.length,0);
  app.context.receiveRoomInvitation({action:'result',room:'current-room',to:id,ok:true,message:'Invitation sent. Waiting for your friend.'});assert.match(app.$('inviteFriendsStatus').textContent,/Invitation sent/);
});
