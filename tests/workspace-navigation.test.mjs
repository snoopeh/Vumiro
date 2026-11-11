import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function harness() {
  const source=readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js',import.meta.url),'utf8');
  const start=source.indexOf('/* Workspace destinations. */'),end=source.indexOf('/* End workspace destinations. */',start);
  assert.ok(start>=0&&end>start,'The owning workspace controller must be present.');
  const nodes=new Map();
  function node(id) {
    if(nodes.has(id))return nodes.get(id);
    const attributes=new Map(),classes=new Set();
    const value={id,hidden:false,textContent:'',classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},remove:name=>classes.delete(name),contains:name=>classes.has(name)},
      setAttribute:(name,value)=>attributes.set(name,String(value)),getAttribute:name=>attributes.get(name)??null,removeAttribute:name=>attributes.delete(name),focus(){},attributes};
    nodes.set(id,value);return value;
  }
  const gamingTabs=['gamingLanNav','gamingTogetherNav','gamingMappingNav'].map(node);
  gamingTabs[2].setAttribute('aria-current','page');
  const document={body:node('body'),querySelectorAll:selector=>selector==='dialog[open]'?[]:selector==='#gamingSubnav [aria-current]'?gamingTabs.filter(tab=>tab.getAttribute('aria-current')!==null):[]};
  const context={document,$:node,window:{VumiroGaming:{close(){}},VumiroServers:{create:()=>({hide(){},open:async()=>{}})}},profile:{id:'local'},frame:null,browseRoom(){},setRoomView(){},renderFriends(){},dispatchEvent(){},CustomEvent:class{constructor(type,value){this.type=type;this.detail=value.detail;}}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {context,node,gamingTabs};
}
test('leaving Gaming clears stale subpage selection while preserving the expanded menu',async()=>{
  for(const view of ['friends','conversations','servers']) {
    const h=harness();h.node('gamingSubnav').hidden=false;h.node('gamingNav').setAttribute('aria-expanded','true');
    h.context.activateWorkspace(view);
    assert.ok(h.gamingTabs.every(tab=>tab.getAttribute('aria-current')!=='page'),view+' must not leave a Gaming route marked as the current page');
    assert.equal(h.node('gamingSubnav').hidden,false);assert.equal(h.node('gamingNav').getAttribute('aria-expanded'),'true');
    const expected={friends:'friendsNav',conversations:'messagesNav',servers:'serversNav'}[view];assert.equal(h.node(expected).getAttribute('aria-current'),'page');
  }
});
test('entering Gaming keeps its selected subpage and marks its workspace current',()=>{
  const h=harness();h.context.activateWorkspace('gaming');assert.equal(h.node('gamingMappingNav').getAttribute('aria-current'),'page');assert.equal(h.node('gamingNav').getAttribute('aria-current'),'page');
});
