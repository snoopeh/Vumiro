import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const base=new URL('../Vumiro.Client/WebServer/',import.meta.url);
function harness({reduced=false,open=async()=>true,asyncClose=false}={}){
  let document;
  const closeEvents=[];
  class Events{
    listeners=new Map();
    addEventListener(type,fn){const list=this.listeners.get(type)||[];list.push(fn);this.listeners.set(type,list);}
    removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(value=>value!==fn));}
    dispatchEvent(event){event.target??=this;event.preventDefault??=()=>event.defaultPrevented=true;for(const fn of [...this.listeners.get(event.type)||[]])fn(event);return !event.defaultPrevented;}
  }
  class Element extends Events{
    constructor(tag){super();this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.attributes={};this.values=new Map();this.style={setProperty:(key,value)=>this.values.set(key,value),removeProperty:key=>this.values.delete(key),getPropertyValue:key=>this.values.get(key)||'',position:''};this._text='';this.parentNode=null;this.classes=new Set();this.classList={add:(...values)=>values.forEach(value=>this.classes.add(value)),remove:(...values)=>values.forEach(value=>this.classes.delete(value)),contains:value=>this.classes.has(value)};}
    append(...nodes){for(const node of nodes){node.parentNode=this;this.children.push(node);}}
    replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this._text='';this.append(...nodes);}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(node=>node!==this);this.parentNode=null;}
    setAttribute(key,value){this.attributes[key]=String(value);if(key==='id')this.id=String(value);}
    getAttribute(key){return this.attributes[key]??null;}
    removeAttribute(key){delete this.attributes[key];}
    get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
    set textContent(value){this.replaceChildren();this._text=String(value);}
    get isConnected(){return this===document.body||this===document.head||!!this.parentNode?.isConnected;}
    set innerHTML(_){throw Error('HTML injection is prohibited');}
    focus(){document.activeElement=this;}
    showModal(){this.open=true;}
    close(){if(!this.open)return;this.open=false;const dispatch=()=>this.dispatchEvent({type:'close'});if(asyncClose)closeEvents.push(dispatch);else dispatch();}
    async click(){if(this.disabled)return;if(this.tagName==='A')downloads.push({href:this.href,download:this.download});for(const fn of this.listeners.get('click')||[])await fn({type:'click',target:this,currentTarget:this});await this.onclick?.({target:this});}
  }
  document=new Events();document.createElement=tag=>new Element(tag);document.head=new Element('head');document.body=new Element('body');document.readyState='complete';
  const all=(root=document.body)=>root.children.flatMap(node=>[node,...all(node)]);
  document.getElementById=id=>all().find(node=>node.id===id)||null;
  const find=(attr,value)=>all().find(node=>node.getAttribute(attr)!==null&&(value===undefined||node.getAttribute(attr)===value));
  const opener=new Element('button');opener.id='profileStyleOpen';document.body.append(opener);opener.focus();
  let profile={id:'A'.repeat(43),key:'owner-key',name:'<Current & profile>',bio:'My real biography',avatar:'data:image/png;base64,cG9ydHJhaXQ=',banner:'data:image/png;base64,Y292ZXI='},account={accountId:'account-a',signedIn:true};
  const media=new Events();media.matches=reduced;
  const window=new Events();Object.assign(window,{document,matchMedia:query=>query.includes('reduced-motion')?media:{matches:false,addEventListener(){},removeEventListener(){}},getComputedStyle:()=>({position:'static'}),VumiroLocalProfile:{profile:()=>profile},VumiroAccount:{getState:()=>account},VumiroMarketplaceEntry:{open}});
  const urls=[],revoked=[],downloads=[],blobs=[];
  const context={window,document,console,Blob,Uint8Array,Date,URL:{createObjectURL:blob=>{const url='blob:studio-'+urls.length;urls.push(url);blobs.push(blob);return url;},revokeObjectURL:url=>revoked.push(url)},atob:value=>Buffer.from(value,'base64').toString('binary'),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},setTimeout,clearTimeout};vm.createContext(context);
  for(const name of ['community-themes.js','profile-cosmetics.js'])vm.runInContext(fs.readFileSync(new URL(name,base),'utf8'),context);
  const samples=window.VumiroCommunityThemes.personalBuiltins.filter(pkg=>pkg.kind!=='profile-effect').map((pkg,index)=>{const value=JSON.parse(JSON.stringify(pkg));value.id='sample-art-'+index;value.name='Sample '+index;value.assets=[{id:'art',mime:'image/png',data:Buffer.from('\x89PNG\r\n\x1a\n','binary').toString('base64')}];value.components[value.kind].backgroundImage='asset(art)';return value;});
  window.VumiroProfileStyleSamples={packages:()=>samples};
  const path=new URL('profile-style-studio.js',base);if(fs.existsSync(path))vm.runInContext(fs.readFileSync(path,'utf8'),context);
  assert.ok(window.VumiroProfileStyleStudio,'Profile style studio API must exist');
  const layer=node=>node.children.find(child=>child.getAttribute('data-vumiro-personal-layer'));
  return {api:window.VumiroProfileStyleStudio,window,document,find,all,opener,samples,urls,revoked,downloads,blobs,layer,flushClose:()=>closeEvents.splice(0).forEach(dispatch=>dispatch()),profile:value=>profile=value,account:value=>account=value,event:type=>window.dispatchEvent({type}),reduce:value=>{media.matches=value;media.dispatchEvent({type:'change'});}};
}

test('opens native accessible dialog using the current profile and preserves the editor draft',async()=>{
  const h=harness(),draft=h.document.createElement('input');draft.value='Unsaved editor draft';h.document.body.append(draft);
  await h.opener.click();const dialog=h.find('data-profile-style-dialog');assert.equal(dialog.tagName,'DIALOG');assert.equal(dialog.open,true);assert.ok(dialog.getAttribute('aria-labelledby'));assert.ok(dialog.getAttribute('aria-describedby'));
  assert.equal(h.find('data-style-name').textContent,'<Current & profile>');assert.equal(h.find('data-style-bio').textContent,'My real biography');assert.equal(h.find('data-style-portrait').src,'data:image/png;base64,cG9ydHJhaXQ=');assert.equal(h.find('data-style-banner').src,'data:image/png;base64,Y292ZXI=');assert.match(dialog.textContent,/Preview only/);assert.equal(draft.value,'Unsaved editor draft');
  h.api.close();assert.equal(dialog.open,false);assert.equal(h.document.activeElement,h.opener);assert.equal(draft.value,'Unsaved editor draft');
});

test('avatar and card selections coexist and replacing a slot releases its prior artwork',async()=>{
  const h=harness();h.api.open();const avatar=h.find('data-style-avatar'),card=h.find('data-style-card'),portrait=h.find('data-style-portrait');
  await h.find('data-style-package',h.samples[0].id).click();assert.equal(h.layer(avatar).getAttribute('data-vumiro-personal-layer'),'avatar-frame');
  await h.find('data-style-package',h.samples[3].id).click();assert.ok(h.layer(avatar));assert.equal(h.layer(card).getAttribute('data-vumiro-personal-layer'),'profile-card');assert.equal(h.find('data-style-portrait'),portrait);
  const oldUrls=[...h.urls];await h.find('data-style-package',h.samples[1].id).click();assert.ok(oldUrls.every(url=>h.revoked.includes(url)));assert.ok(h.layer(avatar));assert.ok(h.layer(card));
  assert.equal(h.find('data-style-package',h.samples[0].id).getAttribute('aria-pressed'),'false');assert.equal(h.find('data-style-package',h.samples[1].id).getAttribute('aria-pressed'),'true');assert.equal(h.find('data-style-package',h.samples[3].id).getAttribute('aria-pressed'),'true');
  h.api.close();assert.ok(h.urls.every(url=>h.revoked.includes(url)));
});

test('reset, native cancellation and disposal clear previews without saving or equipping',async()=>{
  const h=harness();h.api.open();await h.find('data-style-package',h.samples[0].id).click();await h.find('data-style-reset').click();assert.equal(h.layer(h.find('data-style-avatar')),undefined);assert.equal(h.find('data-style-marketplace').disabled,true);assert.ok(h.urls.every(url=>h.revoked.includes(url)));
  await h.find('data-style-package',h.samples[3].id).click();h.find('data-profile-style-dialog').dispatchEvent({type:'cancel'});assert.equal(h.find('data-profile-style-dialog').open,false);assert.ok(h.urls.every(url=>h.revoked.includes(url)));
  h.api.open();await h.find('data-style-package',h.samples[0].id).click();h.api.dispose();assert.equal(h.find('data-profile-style-dialog'),undefined);assert.ok(h.urls.every(url=>h.revoked.includes(url)));await h.opener.click();assert.equal(h.find('data-profile-style-dialog'),undefined);
});

test('motion checkbox respects OS preference and changing it releases raster assets',async()=>{
  const h=harness({reduced:true});h.api.open();const motion=h.find('data-style-motion');assert.equal(motion.checked,false);assert.equal(motion.disabled,true);await h.find('data-style-package',h.samples[0].id).click();assert.equal(h.urls.length,0);assert.equal(h.layer(h.find('data-style-avatar')).getAttribute('data-personal-motion'),'none');
  h.reduce(false);assert.equal(motion.disabled,false);motion.checked=true;motion.dispatchEvent({type:'change'});assert.ok(h.urls.length>0);h.reduce(true);assert.equal(motion.checked,false);assert.ok(h.urls.every(url=>h.revoked.includes(url)));h.api.close();
});

test('marketplace navigation uses selected listing and exposes errors without destroying previews',async()=>{
  const calls=[];let fail=true;const h=harness({open:async value=>{calls.push(value);if(fail)throw Error('This sample is not published yet.');return true;}});h.api.open();await h.find('data-style-package',h.samples[3].id).click();await h.find('data-style-marketplace').click();assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{itemId:'sample-'+h.samples[3].id,kind:'profile-card'});assert.match(h.find('data-style-status').textContent,/not published/);assert.equal(h.find('data-profile-style-dialog').open,true);assert.equal(h.find('data-style-marketplace').disabled,false);
  fail=false;await h.find('data-style-marketplace').click();assert.equal(h.find('data-profile-style-dialog').open,false);assert.ok(h.urls.every(url=>h.revoked.includes(url)));
});

test('account and profile identity changes close previews and discard late marketplace responses',async()=>{
  let reject;const h=harness({open:()=>new Promise((_,no)=>reject=no)});h.api.open();await h.find('data-style-package',h.samples[0].id).click();const work=h.find('data-style-marketplace').click();h.account({accountId:'account-b',signedIn:true});h.event('vumiro-account-state-changed');assert.equal(h.find('data-profile-style-dialog').open,false);assert.ok(h.urls.every(url=>h.revoked.includes(url)));
  h.api.open();reject(Error('Old account result'));await work;assert.doesNotMatch(h.find('data-style-status').textContent,/Old account/);assert.equal(h.find('data-profile-style-dialog').open,true);
  h.profile({id:'B'.repeat(43),key:'new-key',name:'Replacement'});h.event('vumiro-profile-changed');assert.equal(h.find('data-profile-style-dialog').open,false);
});

test('untrusted portrait and banner URLs cannot cause remote image requests',()=>{
  const h=harness();h.profile({id:'a',name:'<script>literal</script>',avatar:'https://bad.example/image',banner:'javascript:bad',bio:'Text'});h.api.open();assert.equal(h.find('data-style-name').textContent,'<script>literal</script>');assert.equal(h.find('data-style-portrait'),undefined);assert.equal(h.find('data-style-banner').src,undefined);h.api.close();
});

test('original GIF samples lead the gallery and a matched avatar/card set opens by default',()=>{
  const h=harness();h.api.open();const packages=h.all().filter(node=>node.getAttribute('data-style-package'));assert.equal(packages[0].getAttribute('data-style-package'),h.samples[0].id);assert.equal(h.find('data-style-package',h.samples[0].id).getAttribute('aria-pressed'),'true');assert.equal(h.find('data-style-package',h.samples[3].id).getAttribute('aria-pressed'),'true');assert.ok(h.layer(h.find('data-style-avatar')));assert.ok(h.layer(h.find('data-style-card')));h.api.close();
});

test('exports selected validated package for creator upload and releases its download URL',async()=>{
  const h=harness();h.api.open();await h.find('data-style-package',h.samples[3].id).click();await h.find('data-style-export').click();assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].download,h.samples[3].id+'.vumirotheme');assert.ok(h.revoked.includes(h.downloads[0].href));const blob=h.blobs[h.urls.indexOf(h.downloads[0].href)],pkg=JSON.parse(await blob.text());assert.equal(pkg.id,h.samples[3].id);assert.equal(h.window.VumiroCommunityThemes.validate(pkg).valid,true);h.api.close();
});

test('native queued close events cannot erase a rapidly reopened preview',()=>{
  const h=harness({asyncClose:true});h.api.open();const prior=[...h.urls];h.api.close();assert.ok(prior.every(url=>h.revoked.includes(url)),'close releases artwork synchronously');assert.equal(h.document.activeElement,h.opener);h.api.open();h.flushClose();assert.equal(h.find('data-profile-style-dialog').open,true);assert.ok(h.layer(h.find('data-style-avatar')));assert.ok(h.layer(h.find('data-style-card')));assert.notEqual(h.find('data-style-marketplace').disabled,true);h.api.dispose();
});

test('translation observer skips opaque profile text and original package titles',()=>{
  const h=harness();h.profile({id:'a',name:'Friends',bio:'Marketplace'});h.samples[0].name='Settings';h.api.open();assert.notEqual(h.find('data-profile-style-dialog').getAttribute('data-i18n-skip'),null);assert.equal(h.find('data-style-name').textContent,'Friends');assert.equal(h.find('data-style-bio').textContent,'Marketplace');assert.match(h.find('data-style-package',h.samples[0].id).textContent,/Settings/);h.api.dispose();
});
