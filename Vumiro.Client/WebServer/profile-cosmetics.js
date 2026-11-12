/* Personal cosmetics are decorative overlays. Public service responses authorize live
   appearance; saved local simulation decorates only the active user's own device. */
(() => {
  'use strict';
  const TTL=30000,MAX_CACHE=128,MAX_TARGETS=256,PEER=/^[A-Za-z0-9_-]{43}$/;
  const personalKinds=['profile-card','avatar-frame','profile-effect'];
  const previews=new WeakMap(),targets=new Map(),cache=new Map(),pending=new Map(),documents=new WeakSet();
  let preferences=()=>({}),generation=0,identityStamp='',linked='',linking=null,timer=0,refreshing=null;
  const state=()=>window.VumiroAccount?.getState?.()||{};
  const identity=()=>window.VumiroLocalProfile?.profile?.()||{};
  const stamp=()=>{const account=state(),person=identity();return JSON.stringify([account.accountId||'',!!account.signedIn,account.marketplaceEnabled===true,person.id||'',person.key||'']);};
  const enabled=()=>state().marketplaceEnabled===true&&typeof window.VumiroAccount?.publicMarketplaceRequest==='function';
  function appPreferences(options={}){
    let value={};try{value=preferences()||{};}catch{}
    return {...value,...options.preferences,reducedMotion:!!(value.reducedMotion||options.preferences?.reducedMotion||window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),highContrast:!!(value.highContrast||options.preferences?.highContrast||window.matchMedia?.('(forced-colors: active)')?.matches)};
  }
  function styles(document){
    if(documents.has(document))return;documents.add(document);
    const style=document.createElement('style');style.textContent=`
.vm-personal-avatar-host{overflow:visible!important}.vm-personal-avatar-host>img{border-radius:inherit}
.vm-personal-layer,.vm-personal-layer *{pointer-events:none!important;user-select:none!important}
.vm-personal-layer{position:absolute!important;display:block!important;overflow:hidden!important;isolation:isolate;box-sizing:border-box!important;background:transparent!important;z-index:1;max-width:none!important;max-height:none!important}
.vm-personal-layer[data-personal-surface=avatar]{inset:-3px!important;border-radius:50%!important;mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 0);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 0)}
.vm-personal-layer[data-personal-surface=card]{inset:0!important;border-radius:inherit;padding:3px!important;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor}
.vm-personal-layer>.vm-personal-paint{position:absolute!important;inset:0!important;box-sizing:border-box!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;border-radius:inherit!important;overflow:hidden!important}
.vm-personal-layer>.vm-personal-paint[data-community-slot=profile-banner]{bottom:65%!important}
.vm-personal-layer>.vm-personal-paint[data-community-slot=profile-badge]{top:85%!important;left:70%!important}
.vm-personal-layer[data-personal-raster=true]>.vm-personal-paint{background-size:100% 100%!important;background-position:center!important;background-repeat:no-repeat!important}
@keyframes vm-personal-orbit{50%{filter:brightness(1.22)}to{filter:brightness(1)}}
@keyframes vm-personal-shimmer{50%{background-position:100% 50%}to{background-position:0 50%}}
@keyframes vm-personal-pulse{50%{opacity:.65}to{opacity:1}}
.vm-personal-layer[data-personal-motion=orbit]>.vm-personal-paint{animation:vm-personal-orbit 14s ease-in-out infinite;background-size:180% 180%}
.vm-personal-layer[data-personal-motion=shimmer]>.vm-personal-paint,.vm-personal-layer[data-personal-motion=scan]>.vm-personal-paint{animation:vm-personal-shimmer 16s ease-in-out infinite;background-size:180% 180%}
.vm-personal-layer[data-personal-motion=pulse]>.vm-personal-paint,.vm-personal-layer[data-personal-motion=ember]>.vm-personal-paint{animation:vm-personal-pulse 9s ease-in-out infinite}
@media(prefers-reduced-motion:reduce),(forced-colors:active){.vm-personal-layer,.vm-personal-layer *{animation:none!important;transition:none!important;filter:none!important}}
@media(forced-colors:active){.vm-personal-layer{display:none!important}}
`;document.head.append(style);
  }
  function validate(pkg,surface){
    const engine=window.VumiroCommunityThemes,result=engine?.validate(pkg);
    if(!result?.valid)throw Error(result?.errors?.join('; ')||'Personal cosmetic validation is unavailable');
    const allowed=surface==='avatar'?['avatar-frame']:['profile-card','profile-effect'];
    if(!allowed.includes(result.package.kind))throw Error('This cosmetic does not apply to this profile surface');
    return result.package;
  }
  function paint(element,pkg,surface,options={}){
    const engine=window.VumiroCommunityThemes,settings=appPreferences(options);
    if(settings.simplified||settings.highContrast)return ()=>{};
    styles(element.ownerDocument);
    const root=element.ownerDocument.createElement('span');root.classList.add('vm-personal-layer');root.setAttribute('data-vumiro-personal-layer',pkg.kind);root.setAttribute('data-personal-surface',surface);root.setAttribute('aria-hidden','true');root.style.setProperty('pointer-events','none','important');
    const slots=surface==='avatar'?['avatar-frame']:pkg.kind==='profile-effect'?['profile-effect']:['profile-card','profile-banner','profile-badge'];
    for(const slot of slots){const part=element.ownerDocument.createElement('span');part.classList.add('vm-personal-paint');part.setAttribute('data-community-slot',slot);root.append(part);}
    const resolved=engine.resolve({bindings:[{mode:'package',packageId:pkg.id,version:pkg.version}],packages:[pkg],preferences:settings});
    if(resolved.assets.length)root.setAttribute('data-personal-raster','true');
    const motion=settings.reducedMotion?'none':resolved.motion||'none';root.setAttribute('data-personal-motion',motion);
    const originalPosition=element.style.position,position=window.getComputedStyle?.(element)?.position||originalPosition;
    const changedPosition=!position||position==='static';if(changedPosition)element.style.position='relative';
    const hadClass=element.classList.contains('vm-personal-avatar-host');if(surface==='avatar')element.classList.add('vm-personal-avatar-host');
    let release;try{release=engine.applyToRoot(root,resolved);element.append(root);}catch(error){root.remove();if(changedPosition)element.style.position=originalPosition;if(surface==='avatar'&&!hadClass)element.classList.remove('vm-personal-avatar-host');throw error;}
    let active=true;return ()=>{if(!active)return;active=false;release();root.remove();if(changedPosition&&element.style.position==='relative')element.style.position=originalPosition;if(surface==='avatar'&&!hadClass)element.classList.remove('vm-personal-avatar-host');};
  }
  function preview(element,pkg,surface,options){
    const clean=validate(pkg,surface);previews.get(element)?.();
    const cleanup=paint(element,clean,surface,options);previews.set(element,cleanup);
    return ()=>{cleanup();if(previews.get(element)===cleanup)previews.delete(element);};
  }
  function clearRecord(record){record.cleanup?.();record.cleanup=null;}
  function clearAll(){for(const record of targets.values())clearRecord(record);}
  function prune(){for(const [element,record]of targets)if(element.isConnected===false){clearRecord(record);targets.delete(element);}while(targets.size>MAX_TARGETS){const [element,record]=targets.entries().next().value;clearRecord(record);targets.delete(element);}}
  function arm(){if(timer||!targets.size)return;timer=setTimeout(()=>{timer=0;void refreshOwn();},TTL);}
  function invalidate(){generation++;cache.clear();pending.clear();clearAll();if(timer){clearTimeout(timer);timer=0;}}
  function syncIdentity(){const next=stamp();if(next!==identityStamp){identityStamp=next;linked='';linking=null;invalidate();}return next;}
  function localAppearance(id){
    const account=state(),model=window.VumiroMarketplaceModel,engine=window.VumiroCommunityThemes;
    if(!account.signedIn||!account.accountId||id!==identity().id||!model?.createStore)return null;
    try{
      // Reuse the marketplace's persisted account store, including selections saved
      // before local profile rendering was connected. Never read another peer's cache.
      const store=model.createStore({accountId:account.accountId,mode:'local-demo',storage:window.localStorage,engine});
      if(!store.status().saved)return null;
      const saved=store.snapshot(),appearance={};
      for(const kind of personalKinds){
        const binding=saved.bindings[kind],record=saved.library.find(item=>item.itemId===binding?.itemId&&item.installed&&item.status!=='revoked');
        if(binding?.mode!=='package'||!record)continue;
        const result=engine.validate(binding.package);
        if(!result.valid||result.package.kind!==kind||result.package.id!==binding.packageId||result.package.version!==binding.version||record.version!==binding.version)continue;
        appearance[kind]={kind,itemId:binding.itemId,package:result.package};
      }
      return appearance;
    }catch{return null;}
  }
  async function appearance(id){
    if(!PEER.test(id))return null;
    if(!enabled())return state().marketplaceEnabled===true?null:localAppearance(id);
    const saved=cache.get(id);if(saved&&saved.expires>Date.now())return saved.value;
    if(pending.has(id))return pending.get(id);
    const version=generation;
    const work=(async()=>{
      let value=null;try{const result=await window.VumiroAccount.publicMarketplaceRequest(`/profiles/${id}/appearance`);if(result?.appearance&&typeof result.appearance==='object')value=result.appearance;}catch{}
      if(version===generation){cache.delete(id);cache.set(id,{value,expires:Date.now()+(value?TTL:5000)});while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);}
      return version===generation?value:null;
    })();pending.set(id,work);try{return await work;}finally{if(pending.get(id)===work)pending.delete(id);}
  }
  async function applyRecord(record,version=generation){
    const value=await appearance(record.id);
    if(version!==generation||targets.get(record.element)!==record)return;
    const kinds=record.surface==='avatar'?['avatar-frame']:['profile-card','profile-effect'],releases=[];
    try{for(const kind of kinds){const entry=value?.[kind];if(entry?.kind!==kind||entry.package?.kind!==kind)continue;const pkg=validate(entry.package,record.surface);releases.push(paint(record.element,pkg,record.surface));}}
    catch{for(const release of releases)release();return;}
    record.cleanup=()=>{for(const release of releases.reverse())release();};arm();
  }
  async function decorate(element,person,surface){
    syncIdentity();previews.get(element)?.();previews.delete(element);const previous=targets.get(element);if(previous)clearRecord(previous);
    // Row avatars are commonly decorated before the new row is appended.
    // Prune older detached targets before registering the new target.
    prune();const record={element,id:person?.id||'',surface,cleanup:null};targets.set(element,record);
    await applyRecord(record);return ()=>{clearRecord(record);if(targets.get(element)===record)targets.delete(element);};
  }
  async function linkOwn(captured,version){
    if(linked===captured)return true;if(linking?.stamp===captured)return linking.promise;
    const person=identity(),current=()=>version===generation&&stamp()===captured;
    const promise=(async()=>{
      try{
        const challenge=await window.VumiroAccount.marketplaceRequest('/profile/identity/challenge',{method:'POST',body:{peerId:person.id,key:person.key}});
        if(!current()||typeof challenge?.challengeId!=='string'||typeof challenge?.text!=='string'||!challenge.text||challenge.text.length>4096)return false;
        const signature=await window.VumiroLocalProfile.sign(challenge.text);if(!current())return false;
        await window.VumiroAccount.marketplaceRequest('/profile/identity/verify',{method:'POST',body:{challengeId:challenge.challengeId,signature}});
        if(!current())return false;linked=captured;return true;
      }catch{return false;}
    })();linking={stamp:captured,promise};try{return await promise;}finally{if(linking?.promise===promise)linking=null;}
  }
  async function refreshOwn(){
    const captured=syncIdentity();if(refreshing?.stamp===captured)return refreshing.promise;
    const promise=(async()=>{
      invalidate();const version=generation,account=state(),person=identity();prune();
      const current=()=>version===generation&&stamp()===captured;
      if(enabled()&&account.signedIn&&account.accountId&&PEER.test(person.id||'')&&person.key){
        // A private proof failure must not prevent authoritative public reads
        // for this identity or unrelated peers, or stop their expiry timer.
        await linkOwn(captured,version);if(!current())return false;
        await appearance(person.id);if(!current())return false;
      }
      if(!current())return false;
      await Promise.all([...targets.values()].map(record=>applyRecord(record,version)));if(!current())return false;
      window.dispatchEvent(new CustomEvent('vumiro-profile-cosmetics-updated',{detail:{peerId:person.id||''}}));arm();return true;
    })();refreshing={stamp:captured,promise};try{return await promise;}finally{if(refreshing?.promise===promise)refreshing=null;}
  }
  function configure(options={}){if(typeof options.preferences==='function')preferences=options.preferences;return refreshOwn();}
  function dispose(){invalidate();for(const record of targets.values())clearRecord(record);targets.clear();linked='';}
  window.VumiroProfileCosmetics=Object.freeze({previewAvatar:(element,pkg,options)=>preview(element,pkg,'avatar',options),previewCard:(element,pkg,options)=>preview(element,pkg,'card',options),decorateAvatar:(element,person)=>decorate(element,person,'avatar'),decorateCard:(element,person)=>decorate(element,person,'card'),refreshOwn,configure,dispose});
  for(const event of ['vumiro-account-state-changed','vumiro-personal-appearance-changed','focus','online'])window.addEventListener(event,()=>{void refreshOwn();});
  window.addEventListener('vumiro-profile-changed',()=>{if(stamp()!==identityStamp)void refreshOwn();});
  for(const query of ['(prefers-reduced-motion: reduce)','(forced-colors: active)'])window.matchMedia?.(query)?.addEventListener?.('change',()=>{void refreshOwn();});
  window.addEventListener('beforeunload',dispose);
})();
