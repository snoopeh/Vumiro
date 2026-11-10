import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  class Element {
    constructor(tag='div'){this.tagName=tag;this.children=[];this.attributes={};this.handlers={};this.dataset={};this.hidden=false;this.textContent='';this.className='';this.classList={toggle:()=>{}};}
    append(...nodes){this.children.push(...nodes);nodes.forEach(n=>n.parentNode=this);}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    setAttribute(k,v){this.attributes[k]=String(v);}
    addEventListener(k,v){(this.handlers[k]??=[]).push(v);}
    removeEventListener(k,v){this.handlers[k]=(this.handlers[k]||[]).filter(x=>x!==v);}
    dispatch(k,e={}){for(const fn of this.handlers[k]||[])fn({target:this,...e});}
    contains(target){return this===target||this.children.some(n=>n.contains(target));}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);}
    focus(){document.activeElement=this;this.dispatch('focusin');}
  }
  const document=new Element('document');document.createElement=tag=>new Element(tag);document.body=new Element('body');document.activeElement=null;
  const timers=new Map();let timerId=0;
  const context={window:{},document,setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(context);
  const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/notification-center.js',import.meta.url),'utf8');
  vm.runInContext(source,context);
  const bell=new Element('button'),panel=new Element('aside'),list=new Element('ol'),empty=new Element('p'),count=new Element('span'),opened=[],dismissed=[];
  const center=context.window.VumiroNotificationCenter.create({bell,panel,list,empty,count,onOpen:id=>opened.push(id),onDismiss:id=>dismissed.push(id)});
  return {center,bell,panel,list,empty,count,opened,dismissed,document,timers,api:context.window.VumiroNotificationCenter};
}
const item=n=>({id:'event-'+n,category:'call',senderName:'<Alice>',text:'<img onerror=bad()>',avatar:'https://bad.example/avatar.png',available:true});

test('notification identity is text, external avatars are rejected, and the inbox is bounded',()=>{
  const h=harness();h.center.sync(Array.from({length:70},(_,i)=>item(i)));
  assert.equal(h.list.children.length,64);
  const row=h.list.children[0],body=row.children[1];
  assert.equal(body.children[0].textContent,'<Alice>');
  assert.equal(body.children[1].textContent,'<img onerror=bad()>');
  assert.equal(row.children[0].tagName,'span');
  assert.equal(h.count.textContent,'64');
  body.dispatch('click');assert.deepEqual(h.opened,['event-0']);
});
test('bell supports hover, pinned click, Escape and focus restoration',()=>{
  const h=harness();h.bell.dispatch('pointerenter');assert.equal(h.panel.attributes['aria-hidden'],'false');
  h.bell.dispatch('click');h.document.dispatch('keydown',{key:'Escape',preventDefault(){}});
  assert.equal(h.panel.attributes['aria-hidden'],'true');assert.equal(h.document.activeElement,h.bell);
  h.bell.dispatch('keydown',{key:'ArrowDown',preventDefault(){}});assert.equal(h.panel.attributes['aria-hidden'],'false');
});
test('popups deduplicate and bound visible events; dismiss and clear release timers',()=>{
  const h=harness();assert.equal(h.center.popup(item(1)),true);assert.equal(h.center.popup(item(1)),false);
  for(let n=2;n<9;n++)h.center.popup(item(n));
  const stack=h.document.body.children[0];assert.equal(stack.children.length,3);
  stack.children[0].children[2].dispatch('click',{stopPropagation(){}});assert.equal(stack.children.length,2);
  assert.equal(h.dismissed.length,1);h.center.clear();assert.equal(stack.children.length,0);assert.equal(h.timers.size,0);
});
test('payload accepts only bounded data images and safe opaque action IDs',()=>{
  const h=harness();assert.equal(h.api.normalize({...item(1),id:'javascript:alert(1)'}),null);
  assert.equal(h.api.normalize({...item(1),category:'unknown'}),null);
  assert.equal(h.api.normalize({...item(1),avatar:'data:image/svg+xml;base64,AA=='}).avatar,'');
  assert.equal(h.api.normalize({...item(1),avatar:'data:image/png;base64,AA=='}).avatar,'data:image/png;base64,AA==');
});
