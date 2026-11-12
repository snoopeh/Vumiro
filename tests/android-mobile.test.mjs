import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness({page='friends',oauth=false}={}){
 const calls=[],events=new Map(),style=new Map();let allowed=true,confirm=true;
 class Event {constructor(type,options={}){Object.assign(this,options);this.type=type;this.defaultPrevented=false;}preventDefault(){this.defaultPrevented=true;}stopPropagation(){}}
 class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.hidden=false;this.open=false;this.textContent='';this.handlers=new Map();this.classes=new Set();this.classList={add:(...names)=>names.forEach(n=>this.classes.add(n)),remove:(...names)=>names.forEach(n=>this.classes.delete(n)),contains:n=>this.classes.has(n),toggle:(n,value)=>{const next=value??!this.classes.has(n);next?this.classes.add(n):this.classes.delete(n);return next;}};this.style={setProperty:(key,value)=>style.set(key,value),removeProperty:key=>style.delete(key)};}
  set className(value){this.classes=new Set(value.split(/\s+/).filter(Boolean));}get className(){return [...this.classes].join(' ');}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}appendChild(node){this.append(node);return node;}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='id')this.id=value;}getAttribute(name){return this.attributes[name]??null;}removeAttribute(name){delete this.attributes[name];}
  addEventListener(type,fn){const values=this.handlers.get(type)||[];values.push(fn);this.handlers.set(type,values);}removeEventListener(type,fn){this.handlers.set(type,(this.handlers.get(type)||[]).filter(n=>n!==fn));}
  dispatchEvent(event){event.target??=this;for(const fn of this.handlers.get(event.type)||[])fn(event);return !event.defaultPrevented;}
  click(){this.onclick?.();this.dispatchEvent(new Event('click'));}focus(){document.activeElement=this;}scrollIntoView(){}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
  contains(node){return this===node||this.children.some(n=>n.contains(node));}
  querySelectorAll(selector){return all(this).slice(1).filter(node=>selector.split(',').some(part=>matches(node,part.trim())));}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 }
 const all=node=>[node,...node.children.flatMap(all)];
 function matches(node,selector){if(selector==='dialog[open]')return node.tagName==='DIALOG'&&node.open;if(selector==='iframe')return node.tagName==='IFRAME';if(selector.startsWith('#'))return node.id===selector.slice(1);if(selector.startsWith('.'))return node.classes.has(selector.slice(1));const action=/\[data-action="([^"]+)"\]/.exec(selector);return action?node.dataset.action===action[1]:false;}
 const html=new Element('html'),body=new Element('body');html.append(body);body.dataset.page=page;
 const document={documentElement:html,body,readyState:'loading',activeElement:body,createElement:tag=>new Element(tag),getElementById:id=>all(html).find(n=>n.id===id)||null,querySelectorAll:selector=>html.querySelectorAll(selector),querySelector:selector=>html.querySelector(selector),addEventListener:(...args)=>html.addEventListener(...args),removeEventListener:(...args)=>html.removeEventListener(...args)};
 const add=(id,tag='button')=>{const node=new Element(tag);node.id=id;body.append(node);return node;};
 if(page==='friends'){add('friendsContent','main');for(const id of ['friendsNav','messagesNav','serversNav','settingsNav','profileNav','accountNav','notificationOpen','marketplaceNav','supportNav','roomNav','discoverRooms','reconnectService','returnToRoom','leaveCall','directChatBack']){const node=add(id);node.onclick=()=>calls.push(id);}add('callFrameSlot','section');}
 if(page==='call'){add('leave').onclick=()=>calls.push('leave');add('share');const connection=add('roomConnection','section');connection.hidden=true;const cancel=add('connectionCancel');cancel.onclick=()=>calls.push('connectionCancel');connection.append(cancel);}
 if(page==='auth'){add('accountSocial','section');add('accountBack').hidden=true;}
 const viewport=new Element();viewport.height=800;viewport.offsetTop=0;
 const window={document,location:{pathname:'/'+page+'.html'},innerHeight:800,innerWidth:390,visualViewport:viewport,vumiroDesktop:{platform:'android',capabilities:{oauth,screenCapture:false,gaming:false}},confirm:()=>confirm,VumiroI18n:{t:key=>key},addEventListener:(name,fn)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);},removeEventListener:(name,fn)=>events.set(name,(events.get(name)||[]).filter(x=>x!==fn)),VumiroWorkspace:{showFriends:async()=>{calls.push('friends');return allowed;},showConversations:async()=>{calls.push('conversations');return allowed;},showServers:async()=>{calls.push('servers');return allowed;}}};window.top=window;window.parent=window;
 const file=new URL('../Vumiro.Android/Web/mobile-client.js',import.meta.url);if(fs.existsSync(file))vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,document,Event,CustomEvent:Event,KeyboardEvent:Event,console});
 return {window,document,calls,style,events,add,viewport,Event,start(){document.readyState='complete';html.dispatchEvent(new Event('DOMContentLoaded'));},find:id=>document.getElementById(id),allow:value=>allowed=value,confirm:value=>confirm=value,emit:(name,options={})=>{for(const fn of events.get(name)||[])fn(new Event(name,options));}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('Android bottom destinations use existing guarded workspace navigation',async()=>{
 const h=harness();assert.equal(h.find('mobileNavigation'),null);h.start();assert.ok(h.find('mobileNavigation'));
 for(const [id,route]of [['mobileTabFriends','friends'],['mobileTabMessages','conversations'],['mobileTabCommunities','servers']]){h.find(id).click();await settle();assert.equal(h.calls.at(-1),route);assert.equal(h.find(id).getAttribute('aria-current'),'page');}
 h.allow(false);h.find('mobileTabFriends').click();await settle();assert.equal(h.find('mobileTabCommunities').getAttribute('aria-current'),'page','declined settings exit preserves the selected destination');
});

test('More routes to real existing controls and reports unavailable gaming honestly',()=>{
 const h=harness();h.start();h.find('mobileTabMore').click();assert.equal(h.find('mobileMore').open,true);assert.match(h.find('mobileGamingNotice').textContent,/unavailable/i);h.find('mobileMoreSettings').click();assert.equal(h.calls.at(-1),'settingsNav');assert.equal(h.find('mobileMore').open,false);
});

test('More opens the actual room browser in landscape and honors unavailable source actions',()=>{
 const h=harness();h.start();h.find('mobileTabMore').click();h.find('mobileMoreRooms').click();assert.equal(h.calls.at(-1),'discoverRooms','roomNav only toggles the hidden desktop submenu in landscape');
 h.find('settingsNav').disabled=true;h.find('mobileMoreSettings').click();assert.equal(h.calls.includes('settingsNav'),false);h.find('profileNav').hidden=true;h.find('mobileMoreProfile').click();assert.equal(h.calls.includes('profileNav'),false);
});

test('native Back is synchronous and respects the shared settings exit guard',async()=>{
 const h=harness();h.start();const dialog=h.add('profileDialog','dialog');dialog.classList.add('settingsScreen');dialog.showModal();let requests=0;h.window.VumiroSettingsExit={requestClose:async()=>{requests++;return false;}};
 const handled=h.window.VumiroMobile.back();assert.equal(handled,true);assert.equal(typeof handled,'boolean');await settle();assert.equal(requests,1);assert.equal(dialog.open,true);
});

test('Back closes More, returns to the conversation list, then returns to Friends',async()=>{
 const h=harness();h.start();h.find('mobileTabMore').click();assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.find('mobileMore').open,false);
 h.window.VumiroDirectChatController={active:'friend'};h.find('directChatBack').onclick=()=>{h.calls.push('directChatBack');h.window.VumiroDirectChatController.active='';};assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.at(-1),'directChatBack');
 h.emit('vumiro-workspace-change',{detail:{view:'servers'}});assert.equal(h.window.VumiroMobile.back(),true);await settle();assert.equal(h.calls.at(-1),'friends');assert.equal(h.window.VumiroMobile.back(),false);
});

test('Back never silently leaves a room and only invokes the existing leave flow after confirmation',()=>{
 const h=harness();h.start();h.find('callFrameSlot').append(h.add('activeCall','iframe'));h.confirm(false);assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.includes('leaveCall'),false);h.confirm(true);assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.at(-1),'leaveCall');
});

test('Back delegates embedded call overlays to the same-origin mobile call controller first',()=>{
 const h=harness();h.start();const frame=h.add('activeCall','iframe');h.find('callFrameSlot').append(frame);let handled=true,requests=0;frame.contentWindow={VumiroMobile:{back(){requests++;return handled;}}};
 assert.equal(h.window.VumiroMobile.back(),true);assert.equal(requests,1);assert.equal(h.calls.includes('leaveCall'),false,'an inner audio dialog consumes Back without leaving the room');handled=false;h.confirm(true);assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.at(-1),'leaveCall');
});

test('standalone call Back cancels connecting UI or yields to native when leaving is unavailable',()=>{
 const h=harness({page:'call'});h.start();h.find('leave').disabled=true;assert.equal(h.window.VumiroMobile.back(),false,'a failed or inactive standalone call must not trap native Back');
 h.find('roomConnection').hidden=false;assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.at(-1),'connectionCancel');
 h.find('roomConnection').hidden=true;h.find('leave').disabled=false;h.confirm(false);assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.includes('leave'),false);h.confirm(true);assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.at(-1),'leave');
});

test('call access popovers close through their existing control before a leave confirmation',()=>{
 const h=harness({page:'call'});h.start();const policy=h.add('roomPolicyDialog','section'),close=h.add('roomPolicyClose');close.onclick=()=>{h.calls.push('roomPolicyClose');policy.hidden=true;};assert.equal(h.window.VumiroMobile.back(),true);assert.equal(h.calls.at(-1),'roomPolicyClose');assert.equal(h.calls.includes('leave'),false);
});

test('visual viewport shrinks the app for the keyboard and disposal removes listeners',()=>{
 const h=harness();h.start();const input=h.add('composer','textarea');input.focus();h.viewport.height=490;h.viewport.dispatchEvent(new h.Event('resize'));assert.equal(h.style.get('--mobile-vh'),'490px');assert.equal(h.document.documentElement.dataset.mobileKeyboard,'true');
 h.window.VumiroMobile.dispose();assert.equal(h.find('mobileNavigation'),null);assert.equal((h.events.get('resize')||[]).length,0);assert.equal((h.viewport.handlers.get('resize')||[]).length,0);
});

test('Android background leaves community voice using its existing cleanup action',()=>{
 const h=harness();h.start();const mount=h.add('serverWorkspace','section'),shadow=h.add('communityBoundary','section'),leave=h.add('communityLeave');leave.dataset.action='voice-leave';leave.onclick=()=>h.calls.push('communityVoiceLeave');shadow.append(leave);mount.shadowRoot=shadow;
 h.emit('vumiro:androidbackground');assert.equal(h.calls.at(-1),'communityVoiceLeave');h.window.VumiroMobile.dispose();h.emit('vumiro:androidbackground');assert.equal(h.calls.filter(x=>x==='communityVoiceLeave').length,1,'page disposal removes the lifecycle hook');
});

test('Android microphone permission pauses preserve the pending community join',()=>{
 const h=harness();h.start();const mount=h.add('serverWorkspace','section'),shadow=h.add('communityBoundary','section'),leave=h.add('communityLeave');leave.dataset.action='voice-leave';leave.onclick=()=>h.calls.push('communityVoiceLeave');shadow.append(leave);mount.shadowRoot=shadow;
 h.emit('vumiro:androidbackground',{detail:{preservePendingCapture:true}});assert.equal(h.calls.length,0,'Android own microphone grant dialog must not disconnect the join');h.emit('vumiro:androidbackground',{detail:{preservePendingCapture:false}});assert.equal(h.calls.at(-1),'communityVoiceLeave');
});

test('Android auth hides unsupported provider sign-in without removing email and recovery',()=>{
 const h=harness({page:'auth'});h.start();assert.equal(h.find('mobileNavigation'),null);assert.equal(h.find('accountSocial').hidden,true);assert.match(h.find('mobileAuthNotice').textContent,/email/i);assert.equal(h.window.VumiroMobile.back(),false);
});
