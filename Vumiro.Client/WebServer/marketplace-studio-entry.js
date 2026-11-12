// Reuse Community Hub Theme Studio; marketplace enrollment and purchases are optional.
(() => {
  'use strict';
  let active;
  function close(){active?.releasePreview?.();active?.studio.destroy();active?.dialog.close();active?.dialog.remove();active=null;}
  async function open(){
    const account=window.VumiroAccount?.getState();
    if(!account?.signedIn||!account.accountId)throw Error('Sign in to keep Theme Studio drafts in your account workspace.');
    if(!window.VumiroCommunityStudio||!window.VumiroCommunityThemes)throw Error('Theme Studio is unavailable. Reload Vumiro.');
    close();const owner=account.accountId,namespace=encodeURIComponent(owner),document=window.document;
    const element=(tag,text)=>{const node=document.createElement(tag);if(text)node.textContent=text;return node;};
    const dialog=element('dialog'),heading=element('h2','Theme Studio'),notice=element('p','Create, customize, import and export packages for free. Drafts stay on this device. Marketplace publication is a separate reviewed step.');
    dialog.setAttribute('aria-label','Theme Studio');dialog.style.cssText='width:min(1100px,94vw);max-height:90vh;overflow:auto;padding:24px;background:#181c22;color:#f0ece5;border:1px solid #56616e;border-radius:12px';
    const style=element('style');style.textContent='.marketplace-studio .community-studio-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.marketplace-studio label{display:flex;flex-direction:column;gap:5px}.marketplace-studio .community-studio-actions{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.marketplace-studio input,.marketplace-studio select,.marketplace-studio textarea{max-width:100%}.marketplace-studio-preview{padding:20px;margin:20px 0;border:1px solid var(--community-border);background:var(--community-surface)}';
    const controls=element('section'),preview=element('section');controls.className='marketplace-studio';preview.className='marketplace-studio-preview';preview.setAttribute('aria-label','Theme Studio sample preview');
    const communitySample=element('div'),personalSample=element('article'),sampleAvatar=element('div','VM'),sampleName=element('h3','Your profile'),sampleBio=element('p','A sample user card. Your avatar and profile content stay visible.');sampleAvatar.style.cssText='width:80px;height:80px;border-radius:50%;background:#28364a;display:grid;place-items:center;font-size:24px;margin:20px';personalSample.style.cssText='position:relative;max-width:400px;padding:20px;border-radius:18px;background:#202832';personalSample.append(sampleAvatar,sampleName,sampleBio);personalSample.hidden=true;preview.append(communitySample,personalSample);let releasePreview;
    for(const [slot,tag,text] of [['heading','h3','Your community'],['banner','p','Welcome to the workshop.'],['card','article','A preview using sample content.'],['button','button','Join a conversation'],['call-controls','button','Voice controls']]){const node=element(tag,text);node.setAttribute('data-community-slot',slot);communitySample.append(node);}
    const dismiss=element('button','Close Studio');dismiss.type='button';dismiss.addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.append(style,heading,notice,dismiss,preview,controls);document.body.append(dialog);
    const themes=window.VumiroCommunityThemes,storage=window.localStorage,key='vumiro.marketplace.studio-binding.'+namespace;
    let binding={mode:'inherit'};try{binding=JSON.parse(storage.getItem(key))||binding;}catch{}
    const manager=themes.createManager({adapter:themes.createIndexedDBAdapter({name:'vumiro-marketplace-studio-assets-'+namespace}),metadataStorage:storage,storageKey:'vumiro.marketplace.studio-packages.'+namespace});
    const studio=window.VumiroCommunityStudio.create({mount:controls,previewRoot:preview,manager,binding,draftKey:'vumiro.marketplace.studio-draft.'+namespace,draftStorage:storage,onPreview:(_appearance,_binding,pkg)=>{releasePreview?.();releasePreview=null;const personal=['avatar-frame','profile-card','profile-effect'].includes(pkg.kind);communitySample.hidden=personal;personalSample.hidden=!personal;if(personal){const renderer=window.VumiroProfileCosmetics;releasePreview=pkg.kind==='avatar-frame'?renderer?.previewAvatar(sampleAvatar,pkg):renderer?.previewCard(personalSample,pkg);}},onSave:async next=>{if(window.VumiroAccount?.getState().accountId!==owner)throw Error('The active account changed. Reopen Theme Studio.');storage.setItem(key,JSON.stringify(next));return true;}});
    active={dialog,studio,releasePreview:()=>releasePreview?.()};dialog.showModal();await studio.ready;return studio;
  }
  window.addEventListener?.('vumiro-account-state-changed',close);
  window.addEventListener?.('vumiro-theme-studio-open',()=>{void open().catch(error=>console.error(error.message));});
  window.VumiroMarketplaceStudio=Object.freeze({open,close});
})();
