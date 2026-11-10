import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
function harness(saved=[]){
  class Element {
    constructor(){this.children=[];this.attributes={};this.listeners={};this.style={};this.value='';this.dataset={};this.disabled=false;this.open=false;this.selectionStart=0;this.selectionEnd=0;this.maxLength=2000;}
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}
    setAttribute(name,value){this.attributes[name]=value;}addEventListener(name,fn){this.listeners[name]=fn;}
    focus(){this.focused=true;}dispatchEvent(){}querySelector(){return this.summary;}
    showPopover(){this.visible=true;}hidePopover(){this.visible=false;}getBoundingClientRect(){return {left:100,top:500,bottom:532,width:320,height:340};}
    setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=this.selectionEnd=start+text.length;}
  }
  const elements=new Map(),writes=[],listeners={};const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};$('emojiPicker').summary=new Element();
  const context={$,innerWidth:1000,innerHeight:800,document:{createElement:()=>new Element(),addEventListener(name,fn){listeners[name]=fn;}},localStorage:{getItem:()=>JSON.stringify(saved),setItem:(key,value)=>writes.push({key,value:JSON.parse(value)})},Event:class{},status:message=>{$('chatStatus').textContent=message;}};
  const start=source.indexOf('  function setupEmojiPicker()'),end=source.indexOf('  /* End emoji picker */',start);assert.ok(start>=0&&end>start,'searchable emoji module exists');
  vm.runInNewContext(source.slice(start,end)+';setupEmojiPicker();',context);
  return {$,writes,listeners};
}
test('emoji picker offers broad offline categories with named accessible buttons',()=>{
  const app=harness(),grid=app.$('emojiGrid');assert.ok(grid.children.length>=150);assert.ok(app.$('emojiCategories').children.length>=8);
  assert.ok(grid.children.every(button=>button.attributes['aria-label']&&button.title));
});
test('compact category controls announce their full names and preserve selection while browsing',()=>{
  const app=harness(),buttons=app.$('emojiCategories').children;
  assert.ok(buttons.every(button=>button.attributes['aria-label']===button.dataset.category&&button.title===button.dataset.category));
  const hearts=buttons.find(button=>button.dataset.category==='Hearts');hearts.onclick();
  assert.equal(hearts.attributes['aria-pressed'],'true');assert.ok(app.$('emojiGrid').children.some(button=>button.textContent==='❤️'));
  assert.equal(buttons.find(button=>button.dataset.category==='Smileys').attributes['aria-pressed'],'false');
});
test('emoji search accepts common names and colon aliases',()=>{
  const app=harness();app.$('emojiSearch').value=':thumbsup:';app.$('emojiSearch').oninput();assert.ok(app.$('emojiGrid').children.some(button=>button.textContent==='👍'));
  app.$('emojiSearch').value='no_such_emoji_999';app.$('emojiSearch').oninput();assert.equal(app.$('emojiGrid').children.length,0);assert.equal(app.$('emojiEmpty').hidden,false);
});
test('choosing emoji replaces the current selection, closes the picker and remembers only approved recent emoji',()=>{
  const app=harness(['not an emoji','👍']),box=app.$('chatText');box.value='Hello world';box.selectionStart=6;box.selectionEnd=11;app.$('emojiPicker').open=true;
  const button=app.$('emojiGrid').children.find(button=>button.textContent==='🎮');button.onclick();assert.equal(box.value,'Hello 🎮');assert.equal(box.focused,true);assert.equal(app.$('emojiPicker').open,false);
  assert.equal(app.writes.at(-1).value[0],'🎮');assert.equal(app.writes.at(-1).value.includes('not an emoji'),false);assert.ok(app.writes.at(-1).value.length<=12);
});
test('emoji input preserves the room text limit and Escape returns focus to its control',()=>{
  const app=harness(),box=app.$('chatText');box.value='x'.repeat(2000);box.selectionStart=box.selectionEnd=2000;app.$('emojiGrid').children[0].onclick();assert.equal(box.value.length,2000);
  const picker=app.$('emojiPicker');picker.open=true;picker.listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});assert.equal(picker.open,false);assert.equal(picker.summary.focused,true);
});
test('emoji popup opens above clipped room panes and closes its top-layer panel',()=>{
  const app=harness(),picker=app.$('emojiPicker'),panel=app.$('emojiPanel');picker.open=true;picker.listeners.toggle();assert.equal(panel.visible,true);assert.equal(app.$('emojiSearch').focused,true);assert.ok(parseInt(panel.style.left)>=12);assert.ok(parseInt(panel.style.top)>=12);
  picker.open=false;picker.listeners.toggle();assert.equal(panel.visible,false);
});
