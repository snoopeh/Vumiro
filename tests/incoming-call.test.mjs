import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const path=new URL('../Vumiro.Client/WebServer/incoming-call.js',import.meta.url);
const friends=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');

function harness(options={}){
  assert.ok(fs.existsSync(path),'the dedicated incoming call component exists');
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.dataset={};this.handlers={};this.style={};this.hidden=false;this.className='';this.textContent='';}
    append(...nodes){for(const node of nodes){node.remove();this.children.push(node);node.parentNode=this;}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    replaceChild(next,old){const index=this.children.indexOf(old);this.children[index]=next;next.parentNode=this;old.parentNode=null;}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
    setAttribute(key,value){this.attributes[key]=String(value);}
    removeAttribute(key){delete this.attributes[key];}
    addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
    removeEventListener(type,fn){this.handlers[type]=(this.handlers[type]||[]).filter(value=>value!==fn);}
    dispatch(type,event={}){for(const fn of this.handlers[type]||[])fn({target:this,...event});}
    showPopover(){this.popoverOpen=true;}
    hidePopover(){this.popoverOpen=false;}
    matches(selector){return selector===':popover-open'?!!this.popoverOpen:false;}
    focus(){this.focused=true;}
  }
  const document=new Element('document'),window=new Element('window'),dialogs=[],observers=[],timers=new Map(),rings=[],accepted=[],rejected=[],errors=[];
  document.body=new Element('body');document.head=new Element('head');document.createElement=tag=>new Element(tag);document.querySelector=()=>null;document.querySelectorAll=()=>dialogs.filter(node=>node.open);
  let now=1000,timerId=0,allowed=true,current='call-1';
  const context={document,window,Promise,MutationObserver:class{constructor(fn){this.callback=fn;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}},setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path,'utf8'),context);
  const component=window.VumiroIncomingCall.create({now:()=>now,isCurrent:id=>id===current,canRing:()=>allowed,ring:()=>{const entry={stopped:false};rings.push(entry);return ()=>{entry.stopped=true;};},onAccept:id=>{accepted.push(id);return options.onAccept?.(id);},onReject:id=>{rejected.push(id);return options.onReject?.(id);},onError:error=>errors.push(error)});
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  return {component,document,window,Element,dialogs,observers,timers,rings,accepted,rejected,errors,context,
    show:(overrides={})=>component.show({id:'call-1',senderName:'<Kai>',avatar:'https://unsafe.example/avatar.png',expires:61000,...overrides}),
    card:()=>descendants(document.body).find(node=>node.className==='incomingCallCard'),find:cls=>descendants(document.body).find(node=>node.className===cls),
    advance:value=>{now=value;},allow:value=>{allowed=value;},current:value=>{current=value;},mutate:()=>observers.filter(o=>!o.disconnected).forEach(o=>o.callback([])),
    runTimer:delay=>{const [id,entry]=[...timers].find(([,value])=>value.delay===delay)||[];assert.ok(entry,'timer exists: '+delay);timers.delete(id);entry.fn();}};
}

test('incoming calls have persistent explicit actions, safe identity text and a fallback avatar',()=>{
  const h=harness();h.show();assert.ok(h.card());
  assert.equal(h.find('incomingCallName').textContent,'<Kai>');assert.equal(h.find('incomingCallName').attributes.translate,'no');
  assert.equal(h.find('incomingCallAvatar').tagName,'span');assert.equal(h.find('incomingCallAccept').children[1].textContent,'Accept');assert.equal(h.find('incomingCallReject').children[1].textContent,'Reject');
  assert.equal(h.rings.length,1,'ring immediately while waiting');
  assert.ok([...h.timers.values()].every(timer=>timer.delay===2600||timer.delay===60000),'no ordinary notification auto-dismiss');
});

test('only bounded local raster avatars are displayed and failed images fall back to initials',()=>{
  for(const avatar of ['data:image/svg+xml;base64,AA==','javascript:bad()','data:image/png;base64,'+'A'.repeat(33000)]){
    const h=harness();h.show({avatar});assert.equal(h.find('incomingCallAvatar').tagName,'span');
  }
  const h=harness();h.show({senderName:'Kai Rowan',avatar:'data:image/png;base64,AA=='});
  const image=h.find('incomingCallAvatar');assert.equal(image.tagName,'img');image.dispatch('error');assert.equal(h.find('incomingCallAvatar').textContent,'KR');
});

test('ring repeats only while pending and preferences can mute and unmute it',()=>{
  const h=harness();h.allow(false);h.show();assert.equal(h.rings.length,0);h.allow(true);h.component.refresh();assert.equal(h.rings.length,1);
  h.runTimer(2600);assert.equal(h.rings.length,2);assert.equal(h.rings[0].stopped,true);
  h.allow(false);h.component.refresh();assert.equal(h.rings[1].stopped,true);assert.equal([...h.timers.values()].filter(timer=>timer.delay===2600).length,0);
  h.allow(true);h.component.refresh();assert.equal(h.rings.length,3);
  h.component.clear();assert.equal(h.rings[2].stopped,true);assert.equal(h.timers.size,0);assert.equal(h.card(),undefined);
});

test('accept stops ringing immediately, prevents duplicate actions and waits for the real result',async()=>{
  let finish;const h=harness({onAccept:()=>new Promise(resolve=>{finish=resolve;})});h.show();
  const accept=h.find('incomingCallAccept'),reject=h.find('incomingCallReject');accept.dispatch('click');reject.dispatch('click');accept.dispatch('click');
  assert.deepEqual(h.accepted,['call-1']);assert.deepEqual(h.rejected,[]);assert.equal(h.rings[0].stopped,true);assert.equal(accept.disabled,true);assert.equal(reject.disabled,true);
  assert.equal(h.card().parentNode.attributes['aria-hidden'],'true','settings exit confirmation can take focus during acceptance');
  let trapped=false;h.document.dispatch('keydown',{key:'Tab',preventDefault(){trapped=true;}});assert.equal(trapped,false);
  finish(false);await new Promise(resolve=>setImmediate(resolve));assert.equal(accept.disabled,false);assert.equal(h.rings.length,2,'failed or cancelled action remains retryable');
  assert.equal(h.card().parentNode.attributes['aria-hidden'],'false');
  h.current(null);h.component.refresh();assert.equal(h.card(),undefined);assert.equal(h.timers.size,0);
});

test('reject sends its current ID once and stale controls cannot answer a replacement call',async()=>{
  const h=harness();h.show();const stale=h.find('incomingCallAccept');h.find('incomingCallReject').dispatch('click');assert.deepEqual(h.rejected,['call-1']);assert.equal(h.rings[0].stopped,true);
  h.current('call-2');h.show({id:'call-2'});stale.dispatch('click');assert.deepEqual(h.accepted,[]);assert.equal(h.card().dataset.callId,'call-2');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.card().dataset.callId,'call-2','old async completion cannot clear its replacement');
});

test('expiry and page teardown stop ringing and remove every timer',()=>{
  for(const teardown of ['expiry','pagehide','destroy']){
    const h=harness();h.show();if(teardown==='expiry'){h.advance(61000);h.runTimer(60000);}else if(teardown==='pagehide')h.window.dispatch('pagehide');else h.component.destroy();
    assert.equal(h.card(),undefined,teardown);assert.equal(h.rings[0].stopped,true,teardown);assert.equal(h.timers.size,0,teardown);
    if(teardown==='destroy')assert.ok(h.observers.every(observer=>observer.disconnected));
  }
});

test('ring autoplay rejection and action rejection do not escape and remain recoverable',async()=>{
  const h=harness({onReject:()=>Promise.reject(Error('offline'))});h.show();h.find('incomingCallReject').dispatch('click');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.errors.length,1);assert.equal(h.find('incomingCallReject').disabled,false);
  const other=harness();other.context.window.VumiroIncomingCall.create({now:()=>1000,isCurrent:()=>true,ring:()=>Promise.reject(Error('autoplay denied'))}).show({id:'other',senderName:'Caller',expires:2000});
  await new Promise(resolve=>setImmediate(resolve));
});

test('caller card remains actionable when settings or another modal is open',()=>{
  const h=harness(),settings=new h.Element('dialog'),confirm=new h.Element('dialog');h.document.body.append(settings,confirm);h.dialogs.push(settings,confirm);settings.open=true;h.show();
  const container=h.card().parentNode;assert.equal(container.parentNode,settings);assert.equal(container.popoverOpen,true);
  confirm.open=true;h.mutate();assert.equal(container.parentNode,confirm);confirm.open=false;settings.open=false;h.mutate();assert.equal(container.parentNode,h.document.body);
});

test('foreground calls are centered accessible dialogs and background calls use the compact presentation',()=>{
  const h=harness();let focused=true;h.document.hasFocus=()=>focused;h.document.visibilityState='visible';h.show();
  const surface=h.card().parentNode;
  assert.equal(surface.dataset.presentation,'center');assert.equal(h.card().attributes.role,'dialog');assert.equal(h.card().attributes['aria-modal'],'true');
  assert.equal(h.find('incomingCallAccept').focused,true);
  focused=false;h.window.dispatch('blur');assert.equal(surface.dataset.presentation,'compact');assert.equal(h.card().attributes['aria-modal'],'false');
  focused=true;h.window.dispatch('focus');assert.equal(surface.dataset.presentation,'center');
  h.component.setWindowState({minimized:true});assert.equal(surface.dataset.presentation,'compact');
  h.component.setWindowState({minimized:false,fullscreen:true,maximized:true});assert.equal(surface.dataset.presentation,'center');
});

test('foreground call keyboard focus cycles between explicit actions',()=>{
  const h=harness();h.show();const accept=h.find('incomingCallAccept'),reject=h.find('incomingCallReject');
  h.document.activeElement=accept;let prevented=false;
  h.document.dispatch('keydown',{key:'Tab',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(reject.focused,true);
});

test('native minimized and restored window events reach the current call presentation',()=>{
  const h=harness();h.show();Object.assign(h.context,{incomingCall:h.component,incomingCallWindowState:null,linuxHost:false});
  h.document.documentElement={classList:{toggle(){}}};
  const start=friends.indexOf("if(state?.type==='window-state'){"),end=friends.indexOf("if(state?.type==='stream-audio'",start);assert.ok(start>=0&&end>start);
  const receive=vm.runInContext(`state=>{${friends.slice(start,end)}}`,h.context);
  receive({type:'window-state',minimized:true});assert.equal(h.card().parentNode.dataset.presentation,'compact');
  receive({type:'window-state',minimized:false,fullscreen:true});assert.equal(h.card().parentNode.dataset.presentation,'center');
  assert.equal(h.context.incomingCallWindowState.minimized,false);
});

test('friends keeps direct call card independent of visual notifications and tears it down with pending',()=>{
  assert.ok(/incomingCall=window\.VumiroIncomingCall\?\.create/.test(friends));
  assert.ok(/incomingCall\?\.show\(/.test(friends));assert.ok(/incomingCall\?\.clear\(\)/.test(friends));
  assert.ok(/canRing:\(\)=>appSounds&&appSoundVolume>0&&notificationSettings\.call\.sound/.test(friends));
});

test('real pending lifecycle shows a muted visual-off direct call and clears it on cancellation or expiry',()=>{
  for(const ending of ['cancel','expire']){
    const h=harness(),elements=new Map();h.allow(false);
    Object.assign(h.context,{pending:null,incomingCall:h.component,ringTimer:0,notificationSettings:{call:{visual:false,sound:false}},friendById:()=>({nickname:'Caller',avatar:''}),runtimeNow:()=>h.context.clockNow??1000,renderFriends(){},renderNotifications(){},roomInviteResult(){},status(){},playUiCue(){},setInterval:()=>999,clearInterval(){},$:id=>{if(!elements.has(id))elements.set(id,new h.Element());return elements.get(id);}});
    const start=friends.indexOf('function clearPending('),end=friends.indexOf('const inviteText=',start);vm.runInContext(friends.slice(start,end),h.context);
    h.context.setPending({direction:'incoming',friend:'friend',nonce:'call-1',notificationCategory:'call',expires:61000});
    assert.ok(h.card(),'call controls remain available when desktop visual alerts are off');assert.equal(h.context.$('invitation').hidden,true);assert.equal(h.rings.length,0);
    if(ending==='cancel')h.context.clearPending();else{h.advance(61000);h.context.clockNow=61000;h.runTimer(1000);}
    assert.equal(h.card(),undefined);assert.equal(h.context.pending,null);assert.equal(h.timers.size,0);
  }
});

test('app ringtone returns a stop handle and catches delayed autoplay failures',async()=>{
  let ctx,stops=0,closes=0;
  class AudioContext{
    constructor(){ctx=this;this.currentTime=0;this.state='suspended';this.destination={};}
    createOscillator(){return {frequency:{setValueAtTime(){}},connect(){},start(){},stop(){stops++;}};}
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
    resume(){return Promise.reject(Error('autoplay denied'));}
    close(){closes++;return Promise.resolve();}
  }
  const context={window:{AudioContext},appSounds:true,appSoundVolume:100};vm.createContext(context);
  const start=friends.indexOf('function soundVolume('),end=friends.indexOf('const notificationCategories=',start);vm.runInContext(friends.slice(start,end),context);
  const stop=context.playUiCue('ring');assert.equal(typeof stop,'function');stop();await new Promise(resolve=>setImmediate(resolve));assert.ok(stops>=2);assert.ok(closes>=1);assert.ok(ctx);
});

function inviteActions(){
  const elements=new Map(),answered=[],opened=[],errors=[];let finishGrant;
  const value={direction:'incoming',friend:'friend',nonce:'call-1',room:'room',expires:60000};
  const context={pending:value,$:id=>{if(!elements.has(id))elements.set(id,{close(){}});return elements.get(id);},runtimeNow:()=>1000,validGrant:()=>new Promise(resolve=>{finishGrant=resolve;}),friendById:()=>({nickname:'Kai'}),profile:{id:'self'},renderPending:()=>{},clearPending:()=>{context.pending=null;},answer:async(v,accepted)=>answered.push({v,accepted}),openRoom:(...args)=>opened.push(args),status:text=>errors.push(text),serviceUrl:'wss://test',document:{querySelectorAll:()=>[]}};
  context.window=context;
  vm.createContext(context);const start=friends.indexOf("$('acceptInvite').onclick=async"),end=friends.indexOf("$('declineInvite').onclick=dismissInvite",start);assert.ok(start>=0&&end>start);vm.runInContext(friends.slice(start,end),context);
  return {context,value,answered,opened,errors,finishGrant:value=>finishGrant(value)};
}

test('Accept blocks overlapping Reject and never answers or joins after invitation replacement',async()=>{
  const h=inviteActions(),accept=h.context.$('acceptInvite').onclick();await h.context.dismissInvite();assert.equal(h.answered.length,0);
  h.context.pending={...h.value,nonce:'call-2'};h.finishGrant(true);assert.equal(await accept,false);assert.equal(h.answered.length,0);assert.equal(h.opened.length,0);
});

test('a failed Accept remains available and shows its real error without opening a room',async()=>{
  const h=inviteActions(),accept=h.context.$('acceptInvite').onclick();h.finishGrant(false);assert.equal(await accept,false);assert.equal(h.context.pending,h.value);assert.equal(h.value.responding,false);assert.equal(h.opened.length,0);assert.equal(h.errors.length,1);
});

test('a room launch error leaves Accept retryable and reports the launch failure',async()=>{
  const h=inviteActions();h.context.openRoom=()=>{throw Error('room launch failed');};
  const accept=h.context.acceptIncomingCall('call-1');h.finishGrant(true);
  assert.equal(await accept,false);assert.equal(h.context.pending,h.value);assert.equal(h.value.responding,false);assert.match(h.errors.at(-1),/room launch failed/);
});

test('inline invitation Accept also honors an unsaved settings draft',async()=>{
  const h=inviteActions();h.context.document.querySelectorAll=()=>[{classList:{contains:name=>name==='settingsScreen'}}];
  h.context.VumiroSettingsExit={requestClose:async()=>false};
  assert.equal(await h.context.$('acceptInvite').onclick(),false);assert.equal(h.answered.length,0);assert.equal(h.context.pending,h.value);assert.equal(h.value.responding,false);
});

test('card Accept respects Keep editing and invitation replacement while exiting settings',async()=>{
  for(const outcome of ['keep','replace','accept']){
    const h=inviteActions();let finishExit,calls=0;
    h.context.document.querySelectorAll=()=>[{classList:{contains:name=>name==='settingsScreen'}}];h.context.VumiroSettingsExit={requestClose:()=>new Promise(resolve=>{finishExit=resolve;})};h.context.$('acceptInvite').onclick=()=>{calls++;return true;};
    assert.equal(typeof h.context.acceptIncomingCall,'function');const result=h.context.acceptIncomingCall('call-1');assert.equal(calls,0);
    if(outcome==='replace')h.context.pending={...h.value,nonce:'call-2'};
    finishExit(outcome!=='keep');assert.equal(await result,outcome==='accept');assert.equal(calls,outcome==='accept'?1:0);
  }
});

test('card Accept closes covering safe dialogs and opens and focuses the caller room iframe',async()=>{
  const h=inviteActions(),dom=harness(),nodes=new Map(),dialogs=[];
  const element=id=>{if(!nodes.has(id))nodes.set(id,new dom.Element());return nodes.get(id);};
  element('acceptInvite').onclick=h.context.$('acceptInvite').onclick;
  for(const id of ['userCardDialog','roomDialog','addDialog']){const node=element(id);node.id=id;node.open=true;node.classList={contains:()=>false};node.close=()=>{node.open=false;};dialogs.push(node);}
  const notification=element('notificationDialog');notification.close=()=>{notification.closed=true;};
  Object.assign(h.context,{$:element,lobbyInitialized:true,frame:null,rooms:[],settings:{audio:false},linuxHost:false,profile:{id:'A'.repeat(43),name:'Self'},location:{href:'https://app.test/friends.html',origin:'https://app.test'},URL,crypto:{randomUUID:()=> 'launch-1'},roomLaunch:null,hideDirectMessages(){h.context.directMessagesHidden=true;},normalizeService:value=>value,renderFriends(){},setRoomView(value){h.context.roomVisible=value;},returnToRoom(){h.context.roomVisible=true;},document:{querySelectorAll:()=>dialogs.filter(node=>node.open),createElement:()=>{const node=new dom.Element('iframe');node.contentWindow={postMessage(){}};return node;}}});
  h.value.room='B'.repeat(43)+'_'+'c'.repeat(48);h.value.grant={nonce:'signed-grant'};
  const start=friends.indexOf('function openRoom('),end=friends.indexOf('function setRoomView(',start);vm.runInContext(friends.slice(start,end),h.context);
  const result=h.context.acceptIncomingCall('call-1');await Promise.resolve();h.finishGrant(true);assert.equal(await result,true);
  assert.equal(h.answered.length,1);assert.equal(h.answered[0].accepted,true);
  assert.ok(dialogs.every(node=>!node.open),'caller card and room browser no longer cover the joined room');
  assert.equal(notification.closed,true);assert.equal(h.context.directMessagesHidden,true);assert.equal(h.context.roomVisible,true);assert.equal(h.context.frame.focused,true);
  const url=new URL(h.context.frame.src);assert.equal(url.searchParams.get('room'),h.value.room);assert.equal(url.searchParams.get('autojoin'),'1');assert.deepEqual(JSON.parse(url.searchParams.get('grant')),h.value.grant);
  assert.equal(element('callArea').attributes['aria-hidden'],'false');assert.equal(element('friendsBody').hidden,true);
});
