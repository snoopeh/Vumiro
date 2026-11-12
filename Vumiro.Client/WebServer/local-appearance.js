/* Private, signing-identity-scoped app appearance. This never publishes a package. */
(() => {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const PEER=/^[A-Za-z0-9_-]{43}$/;
  function create({root,document=root?.ownerDocument,engine=window.VumiroCommunityThemes,getProfile=()=>window.VumiroLocalProfile?.profile?.(),storage,managerFor}={}){
    if(!root||!document||!engine)throw Error('Private appearance requires an app root and the theme engine.');
    if(!storage)try{storage=window.localStorage;}catch{}
    const managers=new Map(),annotations=new Map(),inlineAliases=new Map(),listeners=[],aliases={
      '--bg':'surface','--surface':'surface','--raised':'surface-raised','--line':'border','--text':'text','--muted':'muted','--accent':'accent','--green':'success','--red':'danger'
    };
    const preferenceMedia={reducedMotion:window.matchMedia?.('(prefers-reduced-motion: reduce)'),highContrast:window.matchMedia?.('(forced-colors: active)')};
    let owner='',binding=null,packages=[],cleanup,chrome,observer,disposed=false,generation=0,applyEpoch=0,queue=Promise.resolve(),warning='';
    const identity=()=>getProfile()?.id||'',selectionKey=id=>'vumiro.local-appearance.binding.'+id;
    const validIdentity=id=>{if(!PEER.test(id))throw Error('Create a local profile before applying a private theme.');return id;};
    function manager(id){
      if(managerFor)return managerFor(id);
      if(!managers.has(id))managers.set(id,engine.createManager({
        ...(window.indexedDB?{adapter:engine.createIndexedDBAdapter({name:'vumiro-private-appearance-assets.'+id})}:{}),
        metadataStorage:storage,storageKey:'vumiro.local-appearance.packages.'+id
      }));
      return managers.get(id);
    }
    function annotate(node,name,value){if(!node?.setAttribute)return;let previous=annotations.get(node);if(!previous){previous=new Map();annotations.set(node,previous);}if(!previous.has(name))previous.set(name,node.getAttribute?.(name)??null);if(node.getAttribute?.(name)!==value)node.setAttribute(name,value);}
    function scan(){
      if(!binding||disposed)return;
      annotate(root,'data-app-appearance-slot','surface');
      const groups={
        navigation:'.sidebar,.nav,.topbar,.titlebar,.callBar,.call-dock,.room-header,.room-sidebar',
        card:'.friend,.profilePane,.self,.request,.notice,dialog,.roomRow,.tile,.chat-pane,.settingsSection',
        banner:'.profileCover,.profile-banner,.profile-card-cover',heading:'h1,h2,h3,h4',
        message:'.message,.dm-message,.chat-message,.room-message',button:'button',input:'input,textarea,select'
      };
      for(const [slot,selector]of Object.entries(groups))for(const node of document.querySelectorAll?.(selector)||[]){
        if(node.closest?.('.marketplace-studio,.marketplace-studio-preview,[data-private-editor],#bootScreen'))continue;
        annotate(node,'data-app-appearance-slot',slot);
        if(slot==='button'){const variant=node.classList?.contains('primary')?'primary':node.classList?.contains('danger')?'danger':node.classList?.contains('quiet')?'quiet':'secondary';annotate(node,'data-variant',node.getAttribute?.('data-variant')||variant);}
      }
    }
    function clear(){
      observer?.disconnect();observer=null;cleanup?.();cleanup=null;chrome?.remove();chrome=null;
      for(const [key,{value,priority}]of inlineAliases){if(value)root.style.setProperty(key,value,priority);else root.style.removeProperty(key);}inlineAliases.clear();
      root.removeAttribute('data-private-app-theme');
      for(const [node,attributes]of annotations)for(const [name,value]of attributes){if(value===null)node.removeAttribute(name);else node.setAttribute(name,value);}annotations.clear();
    }
    function preferences(){return {reducedMotion:preferenceMedia.reducedMotion?.matches===true,highContrast:preferenceMedia.highContrast?.matches===true};}
    function paint(){
      clear();if(!binding||disposed)return;
      const resolved=engine.resolve({bindings:[binding],packages,preferences:preferences()});if(resolved.warnings.length)throw Error(resolved.warnings.join('; '));
      root.setAttribute('data-private-app-theme','true');scan();
      cleanup=engine.applyToRoot(root,resolved,{slotAttribute:'data-app-appearance-slot'});
      for(const [key,token]of Object.entries(aliases)){inlineAliases.set(key,{value:root.style.getPropertyValue?.(key)||'',priority:root.style.getPropertyPriority?.(key)||''});root.style.setProperty(key,`var(--community-${token})`);}
      chrome=document.createElement('style');chrome.textContent=`
body[data-private-app-theme]{font-family:var(--community-font-body)!important;font-size:var(--community-font-size)!important}
[data-private-app-theme] .app,[data-private-app-theme] .workspace,[data-private-app-theme] .workspaceBody,[data-private-app-theme] .listPane,[data-private-app-theme] .callArea,[data-private-app-theme] .stage,[data-private-app-theme] .room-grid{background:transparent!important;color:var(--community-text)!important}
[data-private-app-theme] .sidebar,[data-private-app-theme] .profilePane,[data-private-app-theme] .topbar,[data-private-app-theme] .footer{color:var(--community-text)!important;border-color:var(--community-border)!important}
[data-private-app-theme] .muted,[data-private-app-theme] .help,[data-private-app-theme] .friendState,[data-private-app-theme] .topbar p{color:var(--community-muted)!important}
[data-private-app-theme] .friend,[data-private-app-theme] .request,[data-private-app-theme] .self,[data-private-app-theme] dialog{border-radius:var(--community-radius)!important}
[data-private-app-theme] .friend,[data-private-app-theme] .roomRow{gap:var(--community-spacing)!important}
[data-private-app-theme] .friendName,[data-private-app-theme] .message p,[data-private-app-theme] .chat-message p{font-size:var(--community-font-size)!important}
[data-private-app-theme] .nav button.active{color:var(--community-text)!important;box-shadow:inset 3px 0 var(--community-accent)!important}
`;
      root.append(chrome);
      if(typeof window.MutationObserver==='function'){observer=new window.MutationObserver(scan);observer.observe(root,{childList:true,subtree:true});}
    }
    function announce(){window.dispatchEvent?.(new CustomEvent('vumiro-local-appearance-changed',{detail:{identity:owner,applied:!!binding,warning}}));}
    async function refresh(){
      const token=++generation,id=identity();if(disposed)return false;
      if(owner!==id){++applyEpoch;clear();binding=null;packages=[];owner=id;}warning='';
      if(!PEER.test(id))return false;
      try{const raw=storage?.getItem(selectionKey(id));if(!raw){binding=null;packages=[];clear();announce();return true;}
        if(raw.length>32000)throw Error('Private appearance selection is too large.');
        const selected=JSON.parse(raw);if(selected?.mode!=='package'||typeof selected.packageId!=='string'||typeof selected.version!=='string')throw Error('Invalid private appearance selection.');
        const pkg=await manager(id).get(selected.packageId,selected.version);
        if(disposed||identity()!==id||generation!==token)return false;
        const checked=engine.validate(pkg);if(!checked.valid||(checked.package.kind||'theme')!=='theme')throw Error('Private app appearance is unavailable.');
        binding=selected;packages=[checked.package];paint();announce();return true;
      }catch(error){if(identity()===id&&generation===token){binding=null;packages=[];clear();warning=error.message;announce();}return false;}
    }
    function applyPackage(input){
      const id=identity(),epoch=applyEpoch;const action=async()=>{
        validIdentity(id);const assertCurrent=()=>{if(disposed||identity()!==id)throw Error('The local profile identity changed. Apply the theme again.');if(epoch!==applyEpoch)throw Error('Private theme application was cancelled by reset or a newer appearance session.');};assertCurrent();
        const result=engine.validate(input);if(!result.valid)throw Error('Invalid private theme: '+result.errors.join('; '));
        let pkg=result.package;if(!['theme','decorative-pack'].includes(pkg.kind||'theme'))throw Error('Use the profile appearance action for personal cosmetics.');
        if(pkg.kind==='decorative-pack'){
          const resolved=engine.resolve({bindings:[...(owner===id&&binding?[binding]:[]),{mode:'package',packageId:pkg.id,version:pkg.version}],packages:[...packages,pkg]});
          pkg={...copy(engine.builtins[0]),name:pkg.name,author:pkg.author,kind:'theme',tokens:resolved.tokens,components:resolved.components,css:resolved.css,assets:resolved.assets,motion:resolved.motion,layouts:{home:[resolved.layout.home,...engine.layouts.home.filter(v=>v!==resolved.layout.home)],room:[resolved.layout.room,...engine.layouts.room.filter(v=>v!==resolved.layout.room)]}};
          const combined=engine.validate(pkg);if(!combined.valid)throw Error(combined.errors.join('; '));pkg=combined.package;
        }
        if(!window.crypto?.subtle)throw Error('Private theme integrity checks are unavailable.');
        const digest=await window.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(pkg)));assertCurrent();
        pkg={...pkg,id:'local-'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,40)};
        await manager(id).install(pkg);assertCurrent();
        if(!storage?.setItem)throw Error('Private appearance storage is unavailable.');
        const selected={mode:'package',packageId:pkg.id,version:pkg.version};storage.setItem(selectionKey(id),JSON.stringify(selected));assertCurrent();
        ++generation;owner=id;binding=selected;packages=[pkg];warning='';paint();announce();return copy(selected);
      };
      const work=queue.then(action);queue=work.catch(()=>{});return work;
    }
    async function reset(){validIdentity(identity());++generation;++applyEpoch;storage?.removeItem(selectionKey(identity()));owner=identity();binding=null;packages=[];warning='';clear();announce();return true;}
    const snapshot=()=>({identity:owner,binding:binding?copy(binding):null,packages:copy(packages),warning});
    const refreshQuietly=()=>{void refresh();};
    for(const type of ['vumiro-profile-changed','storage','vumiro-account-state-changed']){window.addEventListener?.(type,refreshQuietly);listeners.push(()=>window.removeEventListener?.(type,refreshQuietly));}
    const preferencesChanged=()=>{if(!binding||disposed)return;try{paint();warning='';}catch(error){warning=error.message;}announce();};
    for(const media of Object.values(preferenceMedia)){if(media?.addEventListener){media.addEventListener('change',preferencesChanged);listeners.push(()=>media.removeEventListener('change',preferencesChanged));}else if(media?.addListener){media.addListener(preferencesChanged);listeners.push(()=>media.removeListener(preferencesChanged));}}
    return {applyPackage,refresh,reset,snapshot,destroy(){disposed=true;++generation;++applyEpoch;clear();for(const off of listeners)off();}};
  }
  let active;
  const instance=()=>active||=create({root:window.document?.body||document.body});
  window.VumiroLocalAppearance=Object.freeze({create,applyPackage:pkg=>instance().applyPackage(pkg),refresh:()=>instance().refresh(),reset:()=>instance().reset(),snapshot:()=>active?.snapshot()||{identity:'',binding:null,packages:[],warning:''}});
  function bindControls(){const document=window.document;if(!document)return;document.getElementById('localThemeStudioOpen')?.addEventListener('click',()=>{void window.VumiroMarketplaceStudio?.open().catch(error=>{const status=document.getElementById('localThemeStatus');if(status)status.textContent=error.message;});});document.getElementById('localThemeReset')?.addEventListener('click',()=>{void instance().reset().catch(error=>{const status=document.getElementById('localThemeStatus');if(status)status.textContent=error.message;});});window.addEventListener?.('vumiro-local-appearance-changed',event=>{const status=document.getElementById('localThemeStatus');if(status)status.textContent=event.detail?.warning|| (window.VumiroI18n?.t?.(event.detail?.applied?'Private theme applied on this device.':'Default app appearance.')||(event.detail?.applied?'Private theme applied on this device.':'Default app appearance.'));});}
  if(window.document?.readyState==='loading')window.document.addEventListener('DOMContentLoaded',bindControls,{once:true});else bindControls();
})();
