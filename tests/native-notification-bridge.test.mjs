import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const payload={id:'event-1',category:'call',senderName:'Alice',body:'Incoming call',avatar:''};
test('Linux preload forwards only allowlisted bounded notification display fields',()=>{
  let bridge;const sent=[];
  const source=fs.readFileSync(new URL('../Vumiro.Linux/preload.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{on(){},send:(_channel,value)=>sent.push(value)}})});
  bridge.postMessage({type:'window',action:'notify',notification:payload});assert.equal(sent.length,1);assert.equal(sent[0].notification.senderName,'Alice');
  for(const notification of [{...payload,avatar:'https://example.test/a.png'},{...payload,id:'../../x'},{...payload,body:'x'.repeat(321)},{...payload,url:'https://evil.example'}]) bridge.postMessage({type:'window',action:'notify',notification});
  assert.equal(sent.length,1);
  bridge.postMessage({type:'window',action:'notify-clear'});assert.equal(sent.length,2);
});
test('Linux desktop popup preserves sender, deduplicates, and activates by ID only',()=>{
  const source=fs.readFileSync(new URL('../Vumiro.Linux/main.cjs',import.meta.url),'utf8');
  const start=source.indexOf('function parseNotification('),end=source.indexOf('function clearDesktopNotifications(',start);
  assert.ok(start>=0&&end>start,'bounded native popup bridge exists');
  const notices=[],events=[],restored=[];
  class Notification {static isSupported(){return true;}constructor(options){this.options=options;this.events={};notices.push(this);}on(name,fn){this.events[name]=fn;}show(){}close(){this.closed=true;/* OS close events may arrive asynchronously. */}}
  const context={Notification,nativeImage:{createFromDataURL:()=>({isEmpty:()=>false})},desktopNotifications:new Map(),desktopNotificationSeen:new Set(),setTimeout:()=>({unref(){}}),clearTimeout(){},restoreWindow:()=>restored.push(true),validMainFrame:()=>true,mainWindow:{isDestroyed:()=>false,webContents:{send:(_channel,event)=>events.push(event)}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+';globalThis.show=showDesktopNotification;',context);
  context.show(payload);context.show(payload);assert.equal(notices.length,1);assert.equal(notices[0].options.title,'Alice');assert.equal(notices[0].options.body,'Incoming call');assert.equal(notices[0].options.silent,true);
  notices[0].events.click();assert.equal(restored.length,1);assert.equal(events[0].type,'notification-activate');assert.equal(events[0].id,'event-1');assert.equal(Object.keys(events[0]).length,2);
  for(let n=2;n<8;n++) context.show({...payload,id:'event-'+n});
  assert.equal(context.desktopNotifications.size,3);assert.equal(notices[0].closed,true);
});
