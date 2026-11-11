import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function fixture(){
  const api=require('../scripts/linux-smoke.cjs');
  const values={roomView:true},profile={id:'disposable-smoke-identity'};
  const childElements={
    '#mic':{disabled:true,hidden:false},'#share':{disabled:true,hidden:false},'#mute':{hidden:true},'#stopShare':{hidden:true},'#replyPreview':{hidden:true},
    '#roomConnection':{hidden:false,dataset:{state:'reconnecting'}},'#connectionCancel':{hidden:false,disabled:false},'main':{inert:true},'.call-dock':{inert:true}
  };
  const child={readyState:'complete',querySelector:selector=>childElements[selector]||null};
  const frame={inert:false,style:{visibility:''},contentDocument:child,contentWindow:{VumiroRoomConnection:{set(){}},VumiroLocalProfile:{profile:()=>profile}}};
  const elements={
    '#callFrameSlot iframe':frame,'#callArea':{hidden:false},'#friendsBody':{hidden:true},'.roomLaunchSurface':{hidden:true},
    '#friendsList .friendNameButton':{textContent:'Renamed Smoke'},'#selfName':{textContent:'Linux Smoke'}
  };
  const document={body:{classList:{contains:()=>values.roomView}},querySelector:selector=>elements[selector]||null};
  const window={VumiroLocalProfile:{profile:()=>profile},VumiroAccount:{getState:()=>({signedIn:true})}};
  const context={document,window,getComputedStyle:()=>({visibility:frame.style.visibility||'visible'})};
  const evaluate=fn=>{assert.equal(typeof fn,'function','smoke UI readiness helper is available');return vm.runInNewContext('('+fn.toString()+')',context);};
  return {api,values,frame,elements,child,childElements,evaluate};
}
test('offline room readiness requires completed real client initialization and parent handshake',()=>{
  const f=fixture(),ready=f.evaluate(f.api.smokeRoomReady);
  assert.equal(ready(),true,'an initialized offline reconnect screen is expected');
  f.elements['.roomLaunchSurface'].hidden=false;assert.equal(ready(),false,'parent launch overlay still covers frame');f.elements['.roomLaunchSurface'].hidden=true;
  f.frame.inert=true;assert.equal(ready(),false);f.frame.inert=false;
  f.frame.style.visibility='hidden';assert.equal(ready(),false);f.frame.style.visibility='';
  f.child.readyState='loading';assert.equal(ready(),false);f.child.readyState='complete';
  delete f.childElements['#replyPreview'];assert.equal(ready(),false,'static room HTML is insufficient');
});
test('offline room readiness requires matching loaded identity, blocked capture and usable cancellation',()=>{
  const f=fixture(),ready=f.evaluate(f.api.smokeRoomReady);
  f.frame.contentWindow.VumiroLocalProfile.profile=()=>({id:'different'});assert.equal(ready(),false);
  f.frame.contentWindow.VumiroLocalProfile.profile=()=>({id:'disposable-smoke-identity'});assert.equal(ready(),true);
  f.childElements['#mic'].disabled=false;assert.equal(ready(),false);f.childElements['#mic'].disabled=true;
  f.childElements['#connectionCancel'].hidden=true;assert.equal(ready(),false);f.childElements['#connectionCancel'].hidden=false;
  f.childElements['main'].inert=false;assert.equal(ready(),false);
});
test('room cleanup requires iframe removal and restored authenticated lobby with saved nickname',()=>{
  const f=fixture(),ready=f.evaluate(f.api.smokeRoomCleanupReady);
  assert.equal(ready('Renamed Smoke'),false);
  delete f.elements['#callFrameSlot iframe'];f.elements['#callArea'].hidden=true;f.elements['#friendsBody'].hidden=false;f.values.roomView=false;
  assert.equal(ready('Renamed Smoke'),true);
  f.elements['#friendsList .friendNameButton'].textContent='Smoke Friend';assert.equal(ready('Renamed Smoke'),false);
});


test('friends overview smoke readiness excludes a conversation-only welcome view',()=>{
  const api=require('../scripts/linux-smoke.cjs'),nodes={'#friendsBody':{hidden:false},'#directChatPane':{hidden:true},'#friendsList .messageAction':{},'#workspaceHeading':{textContent:'Friends'}};
  const document={body:{classList:{contains:()=>false}},querySelector:selector=>nodes[selector]||null};
  assert.equal(typeof api.smokeFriendsOverviewReady,'function');const ready=vm.runInNewContext('('+api.smokeFriendsOverviewReady.toString()+')',{document});
  assert.equal(ready(),true);nodes['#directChatPane'].hidden=false;assert.equal(ready(),false);nodes['#directChatPane'].hidden=true;delete nodes['#friendsList .messageAction'];assert.equal(ready(),false);
});
