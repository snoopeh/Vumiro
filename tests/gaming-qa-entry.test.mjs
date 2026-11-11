import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../Vumiro.Client/WebServer/account-client.js',import.meta.url),'utf8');
function harness({qa=false,override='',authPage=true,profile=null}={}){
 const nodes=[],created=[],navigations=[],ready=[];let initializes=0;
 const node=()=>({children:[],append(...values){this.children.push(...values);},setAttribute(){},hidden:false,value:'',textContent:''});const card=node();card.children=[node(),node()];
 const context={window:{__VUMIRO_LOCAL_QA__:qa,__VUMIRO_LOCAL_QA_SIGNALING__:override,VumiroLocalProfile:{initialize:async()=>{initializes++;},profile:()=>profile,createProfile:async name=>{created.push(name);profile={id:'isolated',name};}}},document:{querySelector:()=>card,createElement:()=>{const value=node();nodes.push(value);return value;}},authPage,resolveStartup:value=>ready.push(value),navigate:page=>navigations.push(page)};
 const start=source.indexOf('/* Private LOCAL QA profile entry. */'),end=source.indexOf('/* End private LOCAL QA profile entry. */',start);assert.ok(start>=0&&end>start,'QA entry implementation missing');vm.runInNewContext(source.slice(start,end),context);
 return{context,nodes,created,navigations,ready,initializes:()=>initializes};
}
test('normal account entry has no private profile bypass or profile mutation',async()=>{
 for(const options of [{},{qa:true},{override:'ws://127.0.0.1:8787/call-signaling'}]){const h=harness(options);assert.equal(await h.context.preparePrivateQaEntry(),false);assert.equal(h.initializes(),0);assert.equal(h.nodes.length,0);}
});
test('explicit private LOCAL QA creates an isolated profile only after its button is clicked',async()=>{
 const h=harness({qa:true,override:'ws://127.0.0.1:8787/call-signaling'});assert.equal(await h.context.preparePrivateQaEntry(),true);assert.equal(h.created.length,0);
 const input=h.nodes.find(n=>n.id==='gamingQaName'),button=h.nodes.find(n=>n.id==='gamingQaEnter');input.value='Guest tester';await button.onclick();assert.deepEqual(h.created,['Guest tester']);assert.deepEqual(h.navigations,['friends.html']);
});
test('private QA lobby readiness uses an existing local identity without a production sign-in',async()=>{
 const h=harness({qa:true,override:'ws://192.168.1.8:8787/call-signaling',authPage:false,profile:{id:'existing',name:'Host'}});assert.equal(await h.context.preparePrivateQaEntry(),true);assert.deepEqual(h.ready,[true]);assert.equal(h.created.length,0);
});
