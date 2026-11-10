import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function fixture(){
  const path=new URL('../Vumiro.Client/WebServer/friend-nudges.js',import.meta.url);assert.ok(fs.existsSync(path),'friend nudge controls exist');
  const effects=[],toasts=[],statuses=[],friend={id:'friend',nickname:'Kai'};let allow=true,silent=false,online=true,resolve;
  const window={VumiroNudge:{effect:value=>effects.push(value),cancel(){}}};vm.runInNewContext(fs.readFileSync(path,'utf8'),{window,document:{},setTimeout,clearTimeout});
  const api=window.VumiroFriendNudges.create({getFriend:id=>id==='friend'?friend:null,isOnline:()=>online,isReady:()=>true,transport:()=>new Promise(done=>resolve=done),preferences:{get value(){return{allow,silent};}},status:value=>statuses.push(value),toast:value=>toasts.push(value)});
  return{api,effects,toasts,statuses,setAllow:value=>allow=value,setSilent:value=>silent=value,setOnline:value=>online=value,ack:()=>resolve({delivered:true})};
}
test('recipient preferences and current friendship control shake or silent glow',()=>{
  const f=fixture();f.setAllow(false);assert.equal(f.api.receive('friend'),false);assert.equal(f.effects.length,0);
  f.setAllow(true);f.setSilent(true);assert.equal(f.api.receive('friend'),true);assert.equal(f.effects[0].silent,true);
  f.setOnline(false);assert.equal(f.api.receive('friend'),false);assert.equal(f.api.receive('stranger'),false);
});
test('nudge UI reports delivery only after transport acknowledgment',async()=>{
  const f=fixture(),sent=f.api.send('friend');assert.equal(f.toasts.length,0);f.ack();assert.equal(await sent,true);assert.equal(f.toasts[0],'Nudge delivered.');
});
test('offline friends cannot trigger a transport attempt or delivery notice',async()=>{
  const f=fixture();f.setOnline(false);assert.equal(await f.api.send('friend'),false);assert.equal(f.toasts.includes('Nudge delivered.'),false);
});
