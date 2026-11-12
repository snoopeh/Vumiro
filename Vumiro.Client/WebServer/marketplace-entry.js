(() => {
  'use strict';
  function init(){
    const nav=document.getElementById('marketplaceNav'),mount=document.getElementById('marketplaceWorkspace');
    if(!nav||!mount||!window.VumiroMarketplace)return;
    let controller,opening=0;
    const account=()=>window.VumiroAccount?.getState()||{signedIn:false,accountId:''};
    async function open({itemId,kind}={}){
      const serial=++opening;
      if(!await window.VumiroWorkspace?.prepareExternal('marketplace')||serial!==opening)return false;
      if(!controller){
        // Live hub bindings are supplied by the Community Hub's authority adapter.
        // Without that adapter the marketplace remains an explicit local demo.
        const hubAdapter=window.VumiroCommunityMarketplace;
        controller=window.VumiroMarketplace.init({mount,getAccount:account,mode:account().marketplaceEnabled?'remote':'local-demo',request:(path,options)=>window.VumiroAccount.marketplaceRequest(path.replace(/^\/api\/v1\/marketplace(?=\/)/,''),options),openExternal:url=>window.VumiroMarketplaceExternal.openExternal(url),openThemeStudio:()=>window.VumiroMarketplaceStudio.open(),personalApply:async(target,binding)=>{const renderer=window.VumiroProfileCosmetics;if(account().marketplaceEnabled){if(!renderer?.refreshOwn)throw Error('The profile appearance adapter is unavailable');return renderer.refreshOwn();}if(!renderer?.applyLocal)throw Error('The local profile appearance adapter is unavailable');if(binding.mode!=='inherit'&&!binding.package)throw Error('The installed personal package is unavailable');return renderer.applyLocal(target.kind,binding.mode==='inherit'?null:binding.package);},personalCommitted:async()=>{if(!window.VumiroProfileCosmetics)throw Error('Profile styles could not be displayed. Reload the app and try again.');if(await window.VumiroProfileCosmetics.refreshOwn()===false)throw Error('Your profile changed. Reopen the marketplace to apply this style.');},getTargets:()=>account().marketplaceEnabled?[]:hubAdapter?.targets()||[],applyBinding:(target,binding,provenance)=>{if(!hubAdapter)throw Error('Open a local Community Hub before applying appearance.');return hubAdapter.apply(target,binding,provenance);}})||window.VumiroMarketplace;
      }
      mount.hidden=false;nav.classList.toggle('active',true);nav.setAttribute('aria-current','page');
      document.getElementById('workspaceHeading').textContent='Marketplace';
      document.getElementById('workspaceSubtitle').textContent='Community designs, decorative packs, avatar frames and profile cosmetics.';
      const shown=itemId?await controller.openItem(itemId,{kind}):await controller.show();
      return serial===opening&&shown!==false;
    }
    window.VumiroMarketplaceEntry=Object.freeze({open});
    nav.addEventListener('click',()=>open().catch(error=>{mount.hidden=false;mount.textContent=error.message||'Marketplace unavailable.';}));
    addEventListener('vumiro-workspace-change',event=>{if(event.detail?.view==='marketplace')return;++opening;controller?.hide();mount.hidden=true;nav.classList.toggle('active',false);nav.setAttribute('aria-current','false');});
    addEventListener('vumiro-account-state-changed',()=>{++opening;controller?.destroy?.();controller=null;mount.hidden=true;});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
