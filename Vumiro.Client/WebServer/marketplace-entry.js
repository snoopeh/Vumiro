(() => {
  'use strict';
  function init(){
    const nav=document.getElementById('marketplaceNav'),mount=document.getElementById('marketplaceWorkspace');
    if(!nav||!mount||!window.VumiroMarketplace)return;
    let controller,opening=0;
    const account=()=>window.VumiroAccount?.getState()||{signedIn:false,accountId:''};
    async function open(){
      const serial=++opening;
      if(!await window.VumiroWorkspace?.prepareExternal('marketplace')||serial!==opening)return;
      if(!controller){
        // Live hub bindings are supplied by the Community Hub's authority adapter.
        // Without that adapter the marketplace remains an explicit local demo.
        const hubAdapter=window.VumiroCommunityMarketplace;
        controller=window.VumiroMarketplace.init({mount,getAccount:account,mode:account().marketplaceEnabled?'remote':'local-demo',request:(path,options)=>window.VumiroAccount.marketplaceRequest(path.replace(/^\/api\/v1\/marketplace(?=\/)/,''),options),openExternal:url=>window.VumiroMarketplaceExternal.openExternal(url),openThemeStudio:()=>window.VumiroMarketplaceStudio.open(),personalApply:async()=>{if(account().marketplaceEnabled)await window.VumiroProfileCosmetics?.refreshOwn();},...(hubAdapter?{getTargets:()=>hubAdapter.targets(),applyBinding:(target,binding)=>hubAdapter.apply(target,binding)}:{})})||window.VumiroMarketplace;
      }
      mount.hidden=false;nav.classList.toggle('active',true);nav.setAttribute('aria-current','page');
      document.getElementById('workspaceHeading').textContent='Marketplace';
      document.getElementById('workspaceSubtitle').textContent='Community designs, decorative packs, avatar frames and profile cosmetics.';
      await controller.show();
    }
    nav.addEventListener('click',()=>open().catch(error=>{mount.hidden=false;mount.textContent=error.message||'Marketplace unavailable.';}));
    addEventListener('vumiro-workspace-change',event=>{if(event.detail?.view==='marketplace')return;++opening;controller?.hide();mount.hidden=true;nav.classList.toggle('active',false);nav.setAttribute('aria-current','false');});
    addEventListener('vumiro-account-state-changed',()=>{++opening;controller?.destroy?.();controller=null;mount.hidden=true;});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
