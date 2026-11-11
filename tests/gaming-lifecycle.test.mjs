import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const engine=createRequire(import.meta.url)('../Vumiro.Client/WebServer/controller-mapping.js');
function harness(){
  const nodes=new Map(),sent=[],timers=[],events=new Map();let receive;
  const keyboard={value:'keyboard'},physical={value:'physical'};
  function element(){return {dataset:{},value:'',hidden:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(){},replaceChildren(){},insertBefore(){},addEventListener(){},querySelectorAll(selector){return selector==='[name=gamingInputMode]'?[keyboard,physical]:[];},focus(){},click(){}};}
  const doc={readyState:'complete',body:element(),head:element(),getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element,querySelector:element,querySelectorAll(){return [];},addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);}};
  const win={document:doc,chrome:{webview:{postMessage:m=>sent.push(m),addEventListener(type,fn){receive=fn;},removeEventListener(){}}},localStorage:{getItem(){return null;}},VumiroControllerMapping:engine,addEventListener(){}};
  vm.runInNewContext(readFileSync(new URL('../Vumiro.Client/WebServer/gaming-client.js',import.meta.url),'utf8'),{window:win,document:doc,setTimeout,clearTimeout,setInterval(fn,ms){timers.push({fn,ms});return timers.length;},clearInterval(){}});
  const reply=(request,result)=>receive({data:{type:'gaming-result',requestId:request.requestId,ok:true,result}});
  const settle=()=>new Promise(r=>setImmediate(r));
  return {nodes,sent,physical,win,reply,settle,beat:()=>timers.find(t=>t.ms===1000).fn(),key(event){for(const fn of events.get('keydown')||[])fn(event);},async open(){win.VumiroGaming.open('mapping');reply(sent[0],{status:{lan:{networks:[]},streaming:{host:{},client:{}}},controller:{active:false}});await settle();},drain(){for(const request of sent)reply(request,{controller:{active:false}});}};
}
test('close during pending mapper startup stops immediately and ignores late activation',async()=>{
  const h=harness();await h.open();const start=h.nodes.get('gamingMapperStart').onclick();h.win.VumiroGaming.close();assert.equal(h.sent.at(-1).action,'mapper-stop');h.reply(h.sent[1],{controller:{active:true}});await start;assert.equal(h.sent.at(-1).action,'mapper-stop');h.beat();assert.equal(h.sent.filter(m=>m.action==='mapper-heartbeat').length,0);h.drain();await h.settle();
});
test('physical controller mode preserves normal mapped keyboard input',async()=>{
  const h=harness();await h.open();h.physical.onchange();let converted=false;h.key({code:'KeyW',target:{closest(){return null;}},preventDefault(){converted=true;}});assert.equal(converted,false);assert.equal(h.nodes.get('gamingKeyboardEditor').hidden,true);assert.equal(h.sent.filter(m=>m.action==='mapper-start').length,0);h.drain();
});
test('mapping preview preserves Tab navigation and Enter activation on ordinary controls',async()=>{
  const h=harness();await h.open();
  for(const code of ['Tab','Enter']){
    let prevented=false;
    h.key({code,target:{tagName:'BUTTON',closest(){return null;}},preventDefault(){prevented=true;}});
    assert.equal(prevented,false,code+' keeps its native browser action');
  }
  h.drain();
});
test('late heartbeat reply cannot resume mapping after navigation',async()=>{
  const h=harness();await h.open();const start=h.nodes.get('gamingMapperStart').onclick();h.reply(h.sent[1],{controller:{active:true}});await start;h.beat();const prior=h.sent[2];h.win.VumiroGaming.close();h.reply(h.sent[3],{controller:{active:false}});await h.settle();h.reply(prior,{controller:{active:true}});await h.settle();const count=h.sent.length;h.beat();assert.equal(h.sent.length,count);h.drain();
});
