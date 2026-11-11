import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = new URL('../Vumiro.Client/WebServer/server-workspace.js', import.meta.url);
function api(extras={}) {
  const context = {window:{}, console, structuredClone,...extras}; vm.createContext(context);
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file,'utf8'),context);
  assert.ok(context.window.VumiroServers, 'server sandbox public API exists');
  return context.window.VumiroServers;
}
function memoryStorage() {
  const records = new Map();
  return {records, async load(id){return records.get(id) ?? null;}, async save(id,state){records.set(id,structuredClone(state));}};
}
const identity = 'A'.repeat(43);
async function store(storage=memoryStorage(),id=identity) { return api().createStore({identity:id,storage}); }

test('seeded server is local demo data and each identity owns independent state', async()=>{
  const storage=memoryStorage(), a=await store(storage);
  assert.equal(a.snapshot().mode,'local-demo');
  assert.ok(a.snapshot().members.every(m=>m.demo===true));
  await a.updateServer({name:'My <space>',description:'Private draft'});
  const b=await store(storage,'B'.repeat(43)); assert.notEqual(b.snapshot().name,'My <space>');
  const again=await store(storage); assert.equal(again.snapshot().name,'My <space>');
  await assert.rejects(()=>store(storage,''),/identity/i);
});

test('message validation rejects blanks, unknown and voice channels and bounds history', async()=>{
  const s=await store(), state=s.snapshot(), text=state.channels.find(c=>c.kind==='text'), voice=state.channels.find(c=>c.kind==='voice');
  await assert.rejects(()=>s.postMessage(text.id,'  ','Me'),/message/i);
  await assert.rejects(()=>s.postMessage('missing','hello','Me'),/channel/i);
  await assert.rejects(()=>s.postMessage(voice.id,'hello','Me'),/text/i);
  await assert.rejects(()=>s.postMessage(text.id,'a'.repeat(1001),'Me'),/1000/);
  for(let i=0;i<44;i++) await s.postMessage(text.id,'message '+i,'Me');
  assert.equal(s.snapshot().messages[text.id].length,40);
  assert.equal(s.snapshot().messages[text.id].at(-1).text,'message 43');
  assert.equal(s.snapshot().messages[text.id].at(-1).authorId,identity);
});

test('channel drafts survive switching and reload, posting clears only its own draft', async()=>{
  const storage=memoryStorage(), s=await store(storage), [a,b]=s.snapshot().channels.filter(c=>c.kind==='text');
  await s.setDraft(a.id,'first draft'); await s.setDraft(b.id,'second draft');
  await s.selectChannel(a.id); await s.postMessage(a.id,'sent','Me');
  const reload=await store(storage); assert.equal(reload.snapshot().drafts[a.id],''); assert.equal(reload.snapshot().drafts[b.id],'second draft');
  assert.equal(reload.snapshot().selectedChannel,a.id);
});

test('management validates fields, prevents duplicate names and stores role previews', async()=>{
  const s=await store(); await assert.rejects(()=>s.updateServer({name:' '}),/name/i);
  const c=await s.addChannel({name:'build notes',description:'Plan together',kind:'text',category:'Workshop'});
  await s.updateChannel(c.id,{name:'renamed',description:'<script>safe text</script>'});
  assert.equal(s.snapshot().channels.find(x=>x.id===c.id).description,'<script>safe text</script>');
  await assert.rejects(()=>s.addChannel({name:'renamed',kind:'text',category:'Workshop'}),/exists/i);
  const member=s.snapshot().members[0]; await s.setRole(member.id,'Moderator');
  assert.equal(s.snapshot().members[0].role,'Moderator'); await assert.rejects(()=>s.setRole(member.id,'Administrator'),/role/i);
  const snap=s.snapshot(); snap.name='mutated'; assert.notEqual(s.snapshot().name,'mutated');
});

test('corrupt storage recovers visibly and storage failures retain usable unsaved state', async()=>{
  const broken={async load(){return {version:1,channels:'bad'};},async save(){throw Error('quota');}};
  const s=await store(broken); assert.equal(s.status().recovered,true);
  await s.updateServer({name:'Still usable'}); assert.equal(s.snapshot().name,'Still usable'); assert.equal(s.status().saved,false);
  assert.equal(s.status().error,'save');
});

test('async writes serialize so slower saves cannot replace newer edits', async()=>{
  let release, writes=0; const storage={async load(){return null;},async save(){writes++;if(writes===1)await new Promise(r=>release=r);}};
  const s=await store(storage); const first=s.updateServer({name:'First'}), second=s.updateServer({name:'Second'});
  await new Promise(r=>setImmediate(r)); assert.equal(writes,1); release(); await Promise.all([first,second]);
  assert.equal(writes,2); assert.equal(s.snapshot().name,'Second');
});

test('local adapter rejects oversized and malformed persisted snapshots without leaking other keys', async()=>{
  const values=new Map(), touched=[]; const local={getItem:k=>values.get(k)??null,setItem:(k,v)=>{touched.push(k);values.set(k,v);}};
  const adapter=api().createLocalStorageAdapter(local); const s=await store(adapter); await s.updateServer({name:'Saved'});
  assert.equal(touched.length,1); assert.ok(touched[0].endsWith(identity));
  values.set(touched[0],'x'.repeat(1500001)); await assert.rejects(()=>adapter.load(identity),/large/i);
  await assert.rejects(()=>adapter.load('../bad'),/identity/i);
});

function domHarness(storage=memoryStorage()) {
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.attributes={};this.handlers={};this.dataset={};this.value='';this.hidden=false;this.className='';this.textContent='';this.style={};}
    append(...children){children.forEach(child=>{this.children.push(child);child.parentNode=this;});}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(k,v){this.attributes[k]=String(v);}
    addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}
    removeEventListener(k,fn){this.handlers[k]=(this.handlers[k]||[]).filter(x=>x!==fn);}
    focus(){document.activeElement=this;}
    async dispatch(type,extra={}){for(const fn of this.handlers[type]||[])await fn({target:this,preventDefault(){},...extra});}
    get innerHTML(){throw Error('Unsafe HTML access');} set innerHTML(_){throw Error('Unsafe HTML write');}
  }
  const document={createElement:tag=>new Element(tag),activeElement:null};const mount=new Element('section');
  let profile={id:identity,name:'<Me>'};const publicApi=api({document});
  assert.equal(typeof publicApi.create,'function','workspace view factory exists');
  const view=publicApi.create({mount,getProfile:()=>profile,storage});
  const all=(node=mount)=>[node,...node.children.flatMap(c=>all(c))];
  const find=action=>all().find(n=>n.dataset.action===action);
  return {view,mount,all,find,document,profile:next=>profile=next};
}

test('workspace navigates with safe text and preserves separate channel drafts', async()=>{
  const h=domHarness(); assert.equal(await h.view.open(),true);
  assert.ok(h.all().some(n=>n.textContent==='Local sandbox'));
  await h.find('channel-welcome').dispatch('click');const draft=h.find('message');draft.value='<img onerror=bad()>';await draft.dispatch('input');
  await h.find('index-workbench').dispatch('click');assert.equal(h.find('message').value,'');
  await h.find('index-welcome').dispatch('click');assert.equal(h.find('message').value,'<img onerror=bad()>');
  await h.find('message-form').dispatch('submit');assert.ok(h.all().some(n=>n.textContent==='<img onerror=bad()>'));
  assert.equal(h.find('message').value,'');assert.ok(h.all().some(n=>n.attributes['data-i18n-skip']===''));
  await h.find('index-listening-room').dispatch('click');assert.equal(h.find('message'),undefined);
  assert.ok(h.all().some(n=>n.textContent==='Voice is not connected'));
});

test('workspace hides and destroys safely and resets on identity changes', async()=>{
  const h=domHarness();await h.view.open();await h.find('channel-welcome').dispatch('click');
  const draft=h.find('message');draft.value='private draft';await draft.dispatch('input');
  h.view.hide();assert.equal(h.mount.hidden,true);await h.view.open();assert.equal(h.find('message').value,'private draft');
  h.profile({id:'B'.repeat(43),name:'Other'});await h.view.open();await h.find('channel-welcome').dispatch('click');assert.equal(h.find('message').value,'');
  const old=h.find('message');h.view.destroy();old.value='late event';await old.dispatch('input');assert.equal(h.mount.children.length,0);assert.equal(await h.view.open(),false);
});

test('missing profile and blocked storage present honest explanations', async()=>{
  const h=domHarness();h.profile(null);await h.view.open();assert.equal(h.find('message'),undefined);assert.ok(h.all().some(n=>n.textContent==='Create or restore a profile to use this local sandbox.'));
  const failed=domHarness({async load(){throw Error('blocked');},async save(){throw Error('blocked');}});await failed.view.open();
  assert.ok(failed.all().some(n=>n.textContent==='Local data could not be loaded. A fresh demo is shown.'));
});

test('late loading cannot reopen a hidden or destroyed workspace', async()=>{
  let release;const h=domHarness({async load(){await new Promise(r=>release=r);return null;},async save(){}});
  const opening=h.view.open();h.view.hide();release();assert.equal(await opening,false);assert.equal(h.mount.hidden,true);
});

test('posting after reload keeps message identifiers unique even when the clock repeats', async()=>{
  const storage=memoryStorage(), a=await api().createStore({identity,storage,now:()=>42});
  const first=await a.postMessage('welcome','first','Me');
  const b=await api().createStore({identity,storage,now:()=>42}), second=await b.postMessage('welcome','second','Me');
  assert.notEqual(first.id,second.id);
});

test('state validator rejects foreign authors, invalid dates, duplicate channels and oversized lists', async()=>{
  const sandbox=api(),s=await store();
  for(const mutate of [state=>state.channels.push({...state.channels[0]}),state=>state.messages.welcome[0].authorId='someone-else',state=>state.messages.welcome[0].at=9e20,state=>state.channels=Array.from({length:21},(_,i)=>({...state.channels[0],id:'id'+i,name:'n'+i}))]){
    const state=s.snapshot();mutate(state);assert.throws(()=>sandbox.validateState(state,identity));
  }
});

test('management view saves details and creates navigable channels without touching profile', async()=>{
  const h=domHarness();await h.view.open();await h.find('page-manage').dispatch('click');
  const forms=h.all().filter(n=>n.tagName==='form'),details=forms[0],create=forms[1];
  const fields=node=>h.all(node).filter(n=>['input','textarea'].includes(n.tagName));
  fields(details)[0].value='Our <space>';await details.dispatch('submit');assert.ok(h.all().some(n=>n.textContent==='Our <space>'));
  const currentCreate=h.all().filter(n=>n.tagName==='form')[1];fields(currentCreate)[0].value='new-channel';await currentCreate.dispatch('submit');
  await h.find('page-overview').dispatch('click');assert.ok(h.all().some(n=>n.textContent==='new-channel'));
});

test('identity changes while open cannot post the prior identity draft', async()=>{
  const storage=memoryStorage(),h=domHarness(storage);await h.view.open();await h.find('channel-welcome').dispatch('click');
  const input=h.find('message');input.value='private';await input.dispatch('input');h.profile({id:'B'.repeat(43),name:'Other'});
  await h.find('message-form').dispatch('submit');const original=await store(storage);assert.equal(original.snapshot().messages.welcome.length,1);
});

test('fresh deterministic demo does not claim its seed was already persisted', async()=>{
  const s=await store();assert.equal(s.status().fresh,true);await s.updateServer({name:'Edited'});assert.equal(s.status().fresh,false);
});

test('message validation permits at most 20 channels and keeps refused edits atomic', async()=>{
  const s=await store();const original=s.snapshot();await assert.rejects(()=>s.updateServer({name:'Would change',description:'x'.repeat(281)}));assert.equal(s.snapshot().name,original.name);
  for(let i=0;i<17;i++)await s.addChannel({name:'extra-'+i,category:'More',kind:'text'});
  await assert.rejects(()=>s.addChannel({name:'overflow',category:'More',kind:'text'}),/20/);assert.equal(s.snapshot().channels.length,20);
});

test('an earlier successful save cannot mark a newer queued snapshot as saved', async()=>{
  const releases=[];let writes=0;
  const storage={async load(){return null;},async save(){writes++;await new Promise(resolve=>releases.push(resolve));}};
  const s=await store(storage),first=s.updateServer({name:'First'}),second=s.updateServer({name:'Second'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);releases[0]();await first;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,2);assert.equal(s.snapshot().name,'Second');
  assert.equal(s.status().saved,false,'latest state remains unsaved while its own write is pending');
  releases[1]();await second;assert.equal(s.status().saved,true);
});

test('locale refresh clears the previous identity content before rendering again', async()=>{
  const h=domHarness();await h.view.open();await h.find('channel-welcome').dispatch('click');
  h.find('message').value='private-A-message';await h.find('message-form').dispatch('submit');
  const draft=h.find('message');draft.value='private-A-draft';await draft.dispatch('input');
  h.profile({id:'B'.repeat(43),name:'Person B'});h.view.refreshLabels();
  assert.ok(!h.all().some(n=>n.value==='private-A-draft'),'old draft is no longer in the visible DOM');
  assert.ok(!h.all().some(n=>n.textContent==='private-A-message'),'old message is no longer in the visible DOM');
  assert.equal(h.find('message'),undefined,'locale refresh cannot expose the previous identity channel');
  await h.view.open();await h.find('channel-welcome').dispatch('click');assert.equal(h.find('message').value,'');
});

test('a delayed channel action cannot navigate a reopened workspace away from Manage', async()=>{
  let release,hold=false;const storage={async load(){return null;},async save(){if(hold){hold=false;await new Promise(resolve=>release=resolve);}}};
  const h=domHarness(storage);await h.view.open();hold=true;const pending=h.find('channel-workbench').dispatch('click');
  await new Promise(resolve=>setImmediate(resolve));h.view.hide();await h.view.open();await h.find('page-manage').dispatch('click');
  release();await pending;assert.equal(h.find('page-manage').attributes['aria-current'],'page');assert.equal(h.find('message'),undefined);
});

test('a later navigation supersedes a delayed channel action in the same session', async()=>{
  let release,hold=false;const storage={async load(){return null;},async save(){if(hold){hold=false;await new Promise(resolve=>release=resolve);}}};
  const h=domHarness(storage);await h.view.open();hold=true;const pending=h.find('channel-workbench').dispatch('click');
  await new Promise(resolve=>setImmediate(resolve));await h.find('page-manage').dispatch('click');release();await pending;
  assert.equal(h.find('page-manage').attributes['aria-current'],'page');
});

test('reserved persisted channel identifiers are rejected and recover visibly', async()=>{
  for(const id of ['__proto__','constructor','prototype']){
    const s=await store(),state=s.snapshot();state.channels[0].id=id;state.selectedChannel=id;
    state.messages=JSON.parse('{"'+id+'":[]}');state.drafts=JSON.parse('{"'+id+'":""}');
    assert.throws(()=>api().validateState(state,identity),/channel/i);
    const h=domHarness({async load(){return state;},async save(){}});await h.view.open();
    assert.ok(h.all().some(n=>n.textContent==='Local data could not be loaded. A fresh demo is shown.'));
    await h.find('channel-welcome').dispatch('click');assert.ok(h.find('message'));
  }
});
