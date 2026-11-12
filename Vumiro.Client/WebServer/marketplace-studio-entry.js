// Reuse Community Hub Theme Studio; marketplace enrollment and purchases are optional.
(() => {
  'use strict';
  let active;
  function close(){active?.releasePreview?.();active?.studio.destroy();active?.dialog.close();active?.dialog.remove();active=null;}
  const ownerId=()=>window.VumiroLocalProfile?.profile?.()?.id||(window.VumiroAccount?.getState()?.signedIn?window.VumiroAccount.getState().accountId:'');
  async function open({scopeId='',scopeLabel='',manager:scopeManager,binding:scopeBinding,onApplyLocal}={}){
    const owner=ownerId();
    if(!owner)throw Error('Create a local profile or sign in before opening Theme Studio.');
    if(!window.VumiroCommunityStudio||!window.VumiroCommunityThemes)throw Error('Theme Studio is unavailable. Reload Vumiro.');
    close();const namespace=encodeURIComponent(owner)+(scopeId?'.'+encodeURIComponent(scopeId):''),document=window.document;
    const element=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
    const dialog=element('dialog'),heading=element('h2',scopeLabel?'Theme Studio · '+scopeLabel:'Theme Studio'),notice=element('p','Create your own backgrounds, fonts and styles. Apply locally for your private view. To use your creation in a shared community, export and submit it for marketplace review first.');
    dialog.setAttribute('data-private-editor','true');
    dialog.setAttribute('aria-label','Theme Studio');dialog.style.cssText='width:min(1100px,94vw);max-height:90vh;overflow:auto;padding:24px;background:#181c22;color:#f0ece5;border:1px solid #56616e;border-radius:12px';
    const style=element('style');style.textContent='.marketplace-studio .community-studio-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.marketplace-studio label{display:flex;flex-direction:column;gap:5px}.marketplace-studio .community-studio-actions{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.marketplace-studio input,.marketplace-studio select,.marketplace-studio textarea{max-width:100%}.marketplace-studio-preview{padding:20px;margin:20px 0;border:1px solid var(--community-border);background:var(--community-surface)}';
    const controls=element('section'),preview=element('section');controls.className='marketplace-studio';preview.className='marketplace-studio-preview';preview.setAttribute('aria-label','Theme Studio sample preview');
    const communitySample=element('div'),personalSample=element('article'),sampleAvatar=element('div','VM'),sampleName=element('h3','Your profile'),sampleBio=element('p','A sample user card. Your avatar and profile content stay visible.');sampleAvatar.style.cssText='width:80px;height:80px;border-radius:50%;background:#28364a;display:grid;place-items:center;font-size:24px;margin:20px';personalSample.style.cssText='position:relative;max-width:400px;padding:20px;border-radius:18px;background:#202832';personalSample.append(sampleAvatar,sampleName,sampleBio);personalSample.hidden=true;preview.append(communitySample,personalSample);let releasePreview;
    for(const [slot,tag,text] of [['heading','h3','Your community'],['banner','p','Welcome to the workshop.'],['card','article','A preview using sample content.'],['button','button','Join a conversation'],['call-controls','button','Voice controls']]){const node=element(tag,text);node.setAttribute('data-community-slot',slot);communitySample.append(node);}
    const dismiss=element('button','Close Studio');dismiss.type='button';dismiss.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.append(style,heading,notice,dismiss,preview,controls);document.body.append(dialog);
    const themes=window.VumiroCommunityThemes,storage=window.localStorage,key='vumiro.marketplace.studio-binding.'+namespace;
    let binding=scopeBinding||{mode:'inherit'};if(!scopeBinding)try{binding=JSON.parse(storage.getItem(key))||binding;}catch{}
    const manager=scopeManager||themes.createManager({adapter:typeof themes.createMemoryAdapter==='function'&&!window.indexedDB?themes.createMemoryAdapter():themes.createIndexedDBAdapter({name:'vumiro-marketplace-studio-assets-'+namespace}),metadataStorage:storage,storageKey:'vumiro.marketplace.studio-packages.'+namespace});
    const studio=window.VumiroCommunityStudio.create({mount:controls,previewRoot:preview,manager,binding,draftKey:'vumiro.marketplace.studio-draft.'+namespace,draftStorage:storage,onPreview:(_appearance,_binding,pkg)=>{releasePreview?.();releasePreview=null;const personal=['avatar-frame','profile-card','profile-effect'].includes(pkg.kind);communitySample.hidden=personal;personalSample.hidden=!personal;if(personal){const renderer=window.VumiroProfileCosmetics;releasePreview=pkg.kind==='avatar-frame'?renderer?.previewAvatar(sampleAvatar,pkg):renderer?.previewCard(personalSample,pkg);}},onApplyLocal:async pkg=>{if(ownerId()!==owner)throw Error('The active identity changed. Reopen Theme Studio.');if(onApplyLocal)return onApplyLocal(pkg);if(['avatar-frame','profile-card','profile-effect'].includes(pkg.kind)){if(!window.VumiroProfileCosmetics?.applyLocal)throw Error('Local profile appearance is unavailable.');return window.VumiroProfileCosmetics.applyLocal(pkg.kind,pkg);}if(!window.VumiroLocalAppearance?.applyPackage)throw Error('Local app appearance is unavailable.');return window.VumiroLocalAppearance.applyPackage(pkg);},onSave:async next=>{if(ownerId()!==owner)throw Error('The active identity changed. Reopen Theme Studio.');storage.setItem(key,JSON.stringify(next));return true;}});
    active={owner,dialog,studio,releasePreview:()=>releasePreview?.()};dialog.showModal();await studio.ready;return studio;
  }
  window.addEventListener?.('vumiro-account-state-changed',close);
  window.addEventListener?.('vumiro-profile-changed',()=>{if(active&&active.owner!==ownerId())close();});
  window.addEventListener?.('vumiro-theme-studio-open',()=>{void open().catch(error=>console.error(error.message));});
  window.VumiroMarketplaceStudio=Object.freeze({open,close});
})();
