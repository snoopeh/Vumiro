import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

function harness(){
  const records=new Map(),listeners=new Map(),media=new Map();let person={id:'A'.repeat(43)},blocked=false,release,assetStarted;
  const document={createElement(tag){return {tagName:tag.toUpperCase(),ownerDocument:document,textContent:'',children:[],attributes:{},style:{values:new Map(),setProperty(k,v){this.values.set(k,v);},removeProperty(k){this.values.delete(k);}},setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]??null;},removeAttribute(k){delete this.attributes[k];},append(node){node.parentNode=this;this.children.push(node);},remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);},querySelectorAll(){return [];}};},querySelectorAll(){return [];}};
  const root=document.createElement('body'),priorities=new Map();root.style.getPropertyValue=k=>root.style.values.get(k)||'';root.style.getPropertyPriority=k=>priorities.get(k)||'';root.style.setProperty=(k,v,priority='')=>{root.style.values.set(k,v);priorities.set(k,priority);};root.style.removeProperty=k=>{root.style.values.delete(k);priorities.delete(k);};const storage={getItem:k=>records.get(k)||null,setItem(k,v){if(blocked)throw Error('quota');records.set(k,v);},removeItem:k=>records.delete(k)};
  const window={crypto:webcrypto,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener(){},dispatchEvent(){},matchMedia:query=>{if(!media.has(query)){const handlers=new Set();media.set(query,{matches:false,handlers,addEventListener:(type,fn)=>handlers.add(fn),removeEventListener:(type,fn)=>handlers.delete(fn)});}return media.get(query);},VumiroLocalProfile:{profile:()=>person}};
  const context=vm.createContext({window,document,console,Map,Set,WeakMap,WeakSet,JSON,Array,Uint8Array,TextEncoder,Blob,URL,atob,btoa,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}});
  vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-themes.js',import.meta.url),'utf8'),context);
  const file=new URL('../Vumiro.Client/WebServer/local-appearance.js',import.meta.url);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);
  const engine=window.VumiroCommunityThemes,managers=new Map();
  const managerFor=id=>{if(!managers.has(id)){const adapter=engine.createMemoryAdapter(),put=adapter.put;adapter.put=async(...args)=>{if(release)await new Promise(resolve=>{release=resolve;assetStarted?.();});return put(...args);};managers.set(id,engine.createManager({adapter,metadataStorage:storage,storageKey:'packages.'+id}));}return managers.get(id);};
  const create=()=>{assert.equal(typeof window.VumiroLocalAppearance?.create,'function');return window.VumiroLocalAppearance.create({root,document,engine,storage,getProfile:()=>person,managerFor});};
  return {create,engine,root,storage,records,window,media,setPerson:value=>person=value,setBlocked:value=>blocked=value,blockAssets(){release=()=>{};},waitForBlockedAsset:()=>new Promise(resolve=>{assetStarted=resolve;}),releaseAssets(){const fn=release;release=null;fn?.();},setMedia(query,matches){const item=window.matchMedia(query);item.matches=matches;for(const handler of item.handlers)handler({matches});}};
}

test('reset cancels a blocked apply and all applies already queued before the reset',async()=>{
  const h=harness(),api=h.create(),pkg=structuredClone(h.engine.builtins[1]);pkg.id='pending-picture';pkg.assets=[{id:'art',mime:'image/png',data:'iVBORw0KGgo='}];pkg.components.surface={backgroundImage:'asset(art)'};h.blockAssets();const started=h.waitForBlockedAsset(),pending=api.applyPackage(pkg),queued=api.applyPackage(h.engine.builtins[2]);const pendingResult=assert.rejects(pending,/cancel|reset|superseded/i),queuedResult=assert.rejects(queued,/cancel|reset|superseded/i);await started;await api.reset();assert.equal(api.snapshot().binding,null);h.releaseAssets();await Promise.all([pendingResult,queuedResult]);assert.equal(api.snapshot().binding,null);assert.equal(h.root.style.values.has('--community-accent'),false);assert.equal(h.records.has('vumiro.local-appearance.binding.'+'A'.repeat(43)),false);await api.applyPackage(h.engine.builtins[2]);assert.equal(h.root.style.values.get('--community-accent'),h.engine.builtins[2].tokens.accent);
});

test('private theme reset and destroy restore prior inline aliases including important priority',async()=>{
  const h=harness();h.root.style.setProperty('--accent','#123456','important');h.root.style.setProperty('--bg','linear-gradient(#112233,#334455)');const api=h.create();await api.reset();assert.equal(h.root.style.getPropertyValue('--accent'),'#123456','reset before first apply leaves unowned properties intact');await api.applyPackage(h.engine.builtins[1]);assert.equal(h.root.style.getPropertyValue('--accent'),'var(--community-accent)');await api.applyPackage(h.engine.builtins[2]);await api.reset();assert.equal(h.root.style.getPropertyValue('--accent'),'#123456');assert.equal(h.root.style.getPropertyPriority('--accent'),'important');assert.equal(h.root.style.getPropertyValue('--bg'),'linear-gradient(#112233,#334455)');assert.equal(h.root.style.values.has('--raised'),false);await api.applyPackage(h.engine.builtins[1]);api.destroy();assert.equal(h.root.style.getPropertyValue('--accent'),'#123456');assert.equal(h.root.style.getPropertyPriority('--accent'),'important');
});

test('private appearance follows live accessibility preferences and removes media listeners on destroy',async()=>{
  const h=harness(),api=h.create();await api.applyPackage(h.engine.builtins[1]);assert.equal(h.root.attributes['data-community-motion'],'ember');h.setMedia('(prefers-reduced-motion: reduce)',true);assert.equal(h.root.attributes['data-community-motion'],'none');h.setMedia('(forced-colors: active)',true);assert.equal(h.root.style.values.get('--community-text'),'#ffffff');assert.equal(h.root.style.values.get('--community-font-heading'),h.engine.tokenDefaults.fontHeading);h.setMedia('(forced-colors: active)',false);assert.equal(h.root.style.values.get('--community-text'),h.engine.builtins[1].tokens.text);api.destroy();for(const item of h.media.values())assert.equal(item.handlers.size,0);h.setMedia('(forced-colors: active)',true);assert.equal(h.root.style.values.has('--community-text'),false);
});

test('private app themes apply actual tokens without marketplace approval and restore after reload',async()=>{
  const h=harness(),api=h.create(),pkg=structuredClone(h.engine.builtins[1]);pkg.id='my-private-theme';pkg.tokens.accent='#abcdef';
  await api.applyPackage(pkg);assert.equal(h.root.style.values.get('--community-accent'),'#abcdef');assert.match(api.snapshot().binding.packageId,/^local-/);assert.equal(h.root.attributes['data-app-appearance-slot'],'surface');
  api.destroy();const reopened=h.create();await reopened.refresh();assert.equal(h.root.style.values.get('--community-accent'),'#abcdef');await reopened.reset();assert.equal(h.root.style.values.has('--community-accent'),false);
});

test('private theme selection is identity-scoped and clears on identity replacement',async()=>{
  const h=harness(),api=h.create();await api.applyPackage(h.engine.builtins[2]);h.setPerson({id:'B'.repeat(43)});await api.refresh();assert.equal(h.root.style.values.has('--community-accent'),false);assert.equal(api.snapshot().binding,null);
  h.setPerson({id:'A'.repeat(43)});await api.refresh();assert.equal(h.root.style.values.get('--community-accent'),h.engine.builtins[2].tokens.accent);
});

test('private apply rejects unsafe packages and does not report storage failures as saved',async()=>{
  const h=harness(),api=h.create(),pkg=structuredClone(h.engine.builtins[0]);pkg.css='body {position:fixed}';await assert.rejects(api.applyPackage(pkg),/selector|Unsafe|invalid/i);assert.equal(api.snapshot().binding,null);
  h.setBlocked(true);await assert.rejects(api.applyPackage(h.engine.builtins[1]),/quota|save|storage/i);assert.equal(api.snapshot().binding,null);
});

test('stale private theme imports cannot apply to a replacement identity',async()=>{
  const h=harness(),api=h.create(),pkg=structuredClone(h.engine.builtins[0]);pkg.id='private-picture';pkg.assets=[{id:'art',mime:'image/png',data:'iVBORw0KGgo='}];h.blockAssets();const started=h.waitForBlockedAsset(),pending=api.applyPackage(pkg);await started;h.setPerson({id:'B'.repeat(43)});await api.refresh();h.releaseAssets();await assert.rejects(pending,/identity|profile|changed/i);assert.equal(api.snapshot().binding,null);assert.equal(h.root.style.values.has('--community-accent'),false);
});

test('private app theme routes are included in development and release pages',()=>{
  const friends=fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends.html',import.meta.url),'utf8'),call=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call.html',import.meta.url),'utf8');
  assert.match(friends,/src="\/local-appearance\.js"/);assert.match(call,/src="\/local-appearance\.js"/);assert.match(friends,/id="localThemeStudioOpen"/);
});
