import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/local-profile.js',import.meta.url),'utf8');
const start=source.indexOf('/* Local diagnostics'),end=source.indexOf('/* Local voice preferences');
function harness({native=false,saved=[],now=Date.now(),embedded=false}={}){
  let time=now,value=JSON.stringify(saved);const messages=[],events=new Map(),downloads=[];
  class Clock extends Date {static now(){return time;}}
  const parent={postMessage(message,origin){messages.push({message,origin});}};
  const sandbox={Date:Clock,URL:{createObjectURL:()=> 'blob:logs',revokeObjectURL(){}},Blob,location:new URL('https://screentask.local/'+(embedded?'call.html':'friends.html')),localStorage:{getItem:()=>value,setItem:(key,next)=>{value=next;}},document:{createElement:()=>({click(){downloads.push(this.download);},remove(){}}),body:{append(){}}},crypto:{randomUUID:()=> 'test-session'},console,
    addEventListener(name,callback){events.set(name,callback);},setTimeout:callback=>{callback();return 1;},clearTimeout(){}};
  if(native)sandbox.chrome={webview:{postMessage:message=>messages.push({message}),addEventListener(){}}};
  sandbox.window=sandbox;sandbox.parent=embedded?parent:sandbox;vm.createContext(sandbox);
  assert.ok(start>=0,'diagnostics module exists');vm.runInContext(source.slice(start,end),sandbox);
  return {api:sandbox.VumiroDiagnostics,messages,events,downloads,sandbox,advance:ms=>{time+=ms;},stored:()=>JSON.parse(value)};
}
test('diagnostics persist technical fields while dropping private text, identifiers and unknown events',()=>{
  const app=harness();app.api.record('capture-error',{name:'NotReadableError',audio:true,room:'private room',message:'token=secret',deviceId:'secret-device',ip:'1.2.3.4'});
  app.api.record('chat-message',{message:'secret chat'});
  const text=JSON.stringify(app.api.snapshot());assert.match(text,/NotReadableError/);assert.doesNotMatch(text,/secret|private room|1\.2\.3\.4|chat-message/);
  assert.ok(app.stored().some(row=>row.event==='capture-error'),'write survives immediate process termination');
});
test('diagnostics discard events older than 24 hours and bound stored history',()=>{
  const now=Date.now(),app=harness({now,saved:[{time:now-86400001,event:'capture-ended',details:{}}]});
  assert.equal(app.api.snapshot().some(row=>row.event==='capture-ended'),false);
  for(let i=0;i<400;i++){app.advance(61000);app.api.record('stream-health',{frames:i});}
  assert.ok(app.stored().length<=256);assert.equal(app.stored().at(-1).details.frames,399);
});
test('trusted desktop diagnostics use the native durable log and native export dialog',()=>{
  const app=harness({native:true});app.api.record('peer-state',{connectionState:'failed',sdp:'secret'});app.api.exportLogs();
  const record=app.messages.find(row=>row.message.event==='peer-state').message;
  assert.equal(record.type,'diagnostics');assert.equal(record.action,'record');assert.equal(record.details.connectionState,'failed');assert.equal(record.details.sdp,undefined);
  assert.equal(app.messages.at(-1).message.action,'export');assert.equal(app.downloads.length,0);
});
test('embedded call diagnostics route to the app parent and renderer errors exclude exception text',()=>{
  const app=harness({embedded:true});app.events.get('error')({error:{name:'NotSupportedError',message:'secret credential'},message:'secret credential'});
  const row=app.messages.find(row=>row.message.event==='page-error');assert.ok(row);assert.equal(row.origin,'https://screentask.local');assert.equal(row.message.type,'vumiro-diagnostics');
  assert.doesNotMatch(JSON.stringify(row),/secret/);
});
test('diagnostic floods are bounded and storage errors never interrupt capture',()=>{
  const app=harness();for(let i=0;i<1000;i++)app.api.record('stream-health',{frames:i});assert.ok(app.stored().length<=32);
  app.sandbox.localStorage.setItem=()=>{throw Error('Disk full');};app.advance(61000);assert.doesNotThrow(()=>app.api.record('capture-error',{name:'NotReadableError'}));
});
test('browser and Linux users can export the bounded diagnostic history',()=>{
  const app=harness();app.api.exportLogs();assert.equal(app.downloads.length,1);assert.match(app.downloads[0],/^Vumiro-diagnostics-.*\.json$/);
});
