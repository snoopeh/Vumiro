/* Local try-on only. Marketplace authority owns acquisition and equipment. */
(() => {
  'use strict';
  const kinds=['avatar-frame','profile-card'];
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let dialog,style,opener,trigger,ui,disposed=false,serial=0,busy=false,wantsMotion=true;
  let selected={},active=null,mainCleanup=[],galleryCleanup=[],tiles=[];
  const profile=()=>window.VumiroLocalProfile?.profile?.()||{};
  const stamp=()=>{const person=profile(),account=window.VumiroAccount?.getState?.()||{};return JSON.stringify([account.accountId||'',!!account.signedIn,person.id||'',person.key||'']);};
  const node=(tag,className,text,attribute)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;if(attribute)element.setAttribute(attribute,'');return element;};
  function button(text,attribute,action){const element=node('button','',text,attribute);element.type='button';element.addEventListener('click',action);return element;}
  function release(list){for(const cleanup of list.splice(0).reverse())cleanup();}
  function imageSource(value,max){return typeof value==='string'&&value.length<=max&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)?value:'';}
  function portrait(person,large=false){
    const host=node('span','vm-style-avatar'+(large?' vm-style-avatar-large':''));
    const source=imageSource(person.avatar,32768);
    if(source){const image=node('img','','',large?'data-style-portrait':null);image.src=source;image.alt='';host.append(image);}
    else host.textContent=(person.name||'You').trim().slice(0,2).toUpperCase();
    if(large)host.setAttribute('data-style-avatar','');else host.setAttribute('aria-hidden','true');return host;
  }
  function status(text){if(ui)ui.status.textContent=text;}
  function actions(){
    if(!ui)return;
    for(const tile of tiles)tile.button.setAttribute('aria-pressed',String(selected[tile.pkg.kind]?.id===tile.pkg.id));
    for(const kind of kinds)ui.defaults[kind].setAttribute('aria-pressed',String(!selected[kind]));
    ui.marketplace.disabled=busy||!active;
    ui.export.disabled=!active;
    ui.marketplace.textContent=busy?'Opening Marketplace…':active?'View '+active.name+' in Marketplace':'Choose a style to explore';
    ui.summary.textContent=kinds.map(kind=>selected[kind]?.name||(kind==='avatar-frame'?'Original avatar':'Original card')).join(' · ');
  }
  function renderPreview(){
    release(mainCleanup);if(!dialog?.open)return;
    const renderer=window.VumiroProfileCosmetics,preferences={reducedMotion:!wantsMotion||!!media?.matches};
    try{
      if(selected['avatar-frame'])mainCleanup.push(renderer.previewAvatar(ui.avatar,selected['avatar-frame'],{preferences}));
      if(selected['profile-card'])mainCleanup.push(renderer.previewCard(ui.card,selected['profile-card'],{preferences}));
    }catch{release(mainCleanup);status('This style could not be previewed. Choose another style.');}
  }
  function choose(kind,pkg){
    ++serial;busy=false;selected[kind]=pkg;active=pkg||selected[kinds.find(value=>value!==kind)]||null;
    status('Preview only. Your profile stays unchanged.');renderPreview();actions();
  }
  function reset(){++serial;busy=false;selected={};active=null;release(mainCleanup);status('Preview reset. Your original profile is shown.');actions();}
  function motionChanged(){if(!ui)return;ui.motion.disabled=!!media?.matches;ui.motion.checked=wantsMotion&&!media?.matches;ui.motionHelp.textContent=media?.matches?'Motion is off because your device prefers reduced motion.':'Turn off motion for static frames. Gallery swatches are always still.';renderPreview();}
  async function marketplace(){
    if(!active||busy)return;
    const pkg=active,version=++serial,captured=stamp();busy=true;actions();status('Opening this style in Marketplace…');
    const current=()=>version===serial&&dialog?.open&&captured===stamp();
    try{
      if(typeof window.VumiroMarketplaceEntry?.open!=='function')throw Error('Marketplace is unavailable. Try again after reloading the app.');
      const result=await window.VumiroMarketplaceEntry.open({itemId:'sample-'+pkg.id,kind:pkg.kind});
      if(!current())return;
      if(result===false){status('Marketplace did not open. You can keep trying styles here.');return;}
      close();
    }catch(error){if(current())status(error?.message||'Marketplace could not open. Please try again.');}
    finally{if(current()){busy=false;actions();}}
  }
  function exportSelected(){
    if(!active)return;
    let url,link;
    try{
      const result=window.VumiroCommunityThemes?.validate(active);
      if(!result?.valid)throw Error('This style cannot be exported.');
      url=URL.createObjectURL(new Blob([JSON.stringify(result.package,null,2)],{type:'application/json'}));
      link=node('a');link.href=url;link.download=result.package.id+'.vumirotheme';link.hidden=true;document.body.append(link);link.click();
      status('Package exported. You can upload it through the Marketplace creator tools.');
    }catch(error){status(error?.message||'The package could not be exported.');}
    finally{link?.remove();if(url)URL.revokeObjectURL(url);}
  }
  function ensure(){
    if(dialog)return;
    style=node('style');style.textContent=`
.vm-style-dialog{width:min(1050px,calc(100vw - 32px));max-height:90vh;padding:0;border:1px solid var(--line,#ffffff13);border-radius:18px;background:var(--bg,#121212);color:var(--text,#f6f0eb);box-shadow:0 28px 100px #000a;font:14px/1.5 Sora,"Segoe UI",sans-serif;overflow:auto}
.vm-style-dialog::backdrop{background:#060606b8;backdrop-filter:blur(3px)}
.vm-style-dialog *{box-sizing:border-box}.vm-style-dialog p{margin:0;color:var(--muted,#b0a6a4);line-height:1.7;font-size:12px}.vm-style-dialog h2{margin:4px 0 8px;font:600 30px/1.2 Outfit,Sora,sans-serif;letter-spacing:-.8px}.vm-style-dialog h3{margin:0;font:550 18px/1.4 Outfit,Sora,sans-serif}.vm-style-dialog button{font:inherit;color:inherit;cursor:pointer;padding:10px 14px}.vm-style-dialog button:disabled{opacity:.55;cursor:default}.vm-style-dialog :focus-visible{outline:2px solid var(--accent,#e31c29);outline-offset:2px}
.vm-style-head{display:flex;justify-content:space-between;align-items:start;gap:20px;padding:26px 28px 20px;border-bottom:1px solid var(--line,#ffffff13)}.vm-style-eyebrow{font-size:11px;color:var(--muted,#b0a6a4)}.vm-style-dialog .vm-style-close{display:grid;place-items:center;flex:none;width:34px;height:34px;padding:0;border:1px solid var(--line,#ffffff13);border-radius:50%;background:transparent;color:var(--muted,#b0a6a4);font-size:23px;line-height:1}.vm-style-dialog .vm-style-close:hover{background:#ffffff0a;color:var(--text,#f6f0eb)}.vm-style-body{display:grid;grid-template-columns:minmax(270px,340px) minmax(0,1fr);gap:26px;padding:26px 28px}.vm-style-preview{min-width:0}.vm-style-preview-label{display:flex;justify-content:space-between;align-items:center;margin:0 0 14px;font-size:12px}.vm-style-badge{color:var(--muted,#b0a6a4);border:1px solid var(--line,#ffffff13);background:var(--surface,#181818);border-radius:8px;padding:4px 9px;font-size:10px}
.vm-style-card{position:relative;isolation:isolate;min-height:340px;border:1px solid var(--line,#ffffff13);border-radius:17px;background:var(--surface,#181818);overflow:visible}.vm-style-banner{display:block;width:100%;height:112px;object-fit:cover;border-radius:16px 16px 0 0;background:var(--raised,#232323)}.vm-style-card-content{position:relative;padding:0 23px 26px}.vm-style-avatar{position:relative;display:grid;place-items:center;width:48px;height:48px;flex:0 0 auto;border-radius:50%;background:var(--raised,#232323);color:var(--text,#f6f0eb);font-size:15px;font-weight:600}.vm-style-avatar img{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}.vm-style-avatar-large{width:92px;height:92px;font-size:32px;margin-top:-35px;margin-bottom:18px;border:5px solid var(--surface,#181818)}.vm-style-dialog .vm-style-name{font:600 27px/1.25 Outfit,Sora,sans-serif;letter-spacing:-.5px;overflow-wrap:anywhere}.vm-style-dialog .vm-style-bio{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 22px;min-height:44px}.vm-style-card-label{font-size:11px;color:var(--muted,#b0a6a4);border-top:1px solid var(--line,#ffffff13);padding-top:15px}.vm-style-dialog .vm-style-summary{margin:17px 0 22px;font-size:11px;overflow-wrap:anywhere}.vm-style-dialog .vm-style-motion{display:flex;gap:9px;align-items:center;margin:0 0 7px;font-size:12px;color:var(--text,#f6f0eb)}.vm-style-dialog .vm-style-motion input{width:16px;height:16px;margin:0;accent-color:var(--accent,#e31c29)}.vm-style-dialog .vm-style-motion-help{font-size:11px;max-width:310px}
.vm-style-catalog{display:grid;gap:25px;align-content:start;min-width:0}.vm-style-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}.vm-style-dialog .vm-style-default{padding:5px 9px;font-size:11px;background:transparent;color:var(--muted,#b0a6a4)}.vm-style-default[aria-pressed=true]{border-color:var(--accent,#e31c29);color:var(--text,#f6f0eb)}.vm-style-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.vm-style-dialog .vm-style-tile{display:flex;flex-direction:column;align-items:stretch;gap:11px;min-width:0;padding:12px 9px 10px;text-align:center;border-color:var(--line,#ffffff13);background:var(--surface,#181818)}.vm-style-dialog .vm-style-tile:hover{background:var(--raised,#232323)}.vm-style-dialog .vm-style-tile[aria-pressed=true]{border-color:var(--accent,#e31c29);background:var(--raised,#232323);box-shadow:inset 0 -2px var(--accent,#e31c29)}.vm-style-swatch{height:66px;display:grid;place-items:center;pointer-events:none}.vm-style-card-swatch{position:relative;width:100%;max-width:114px;height:60px;display:flex;align-items:center;gap:9px;padding:10px;border:1px solid var(--line,#ffffff13);border-radius:8px;background:var(--surface,#181818)}.vm-style-card-swatch .vm-style-avatar{width:27px;height:27px;font-size:9px}.vm-style-lines{display:grid;gap:5px;flex:1}.vm-style-lines span{height:4px;background:var(--muted,#b0a6a4);opacity:.4;border-radius:4px}.vm-style-lines span:last-child{width:65%}.vm-style-tile-name{font-size:11px;line-height:1.5;overflow-wrap:anywhere}.vm-style-dialog .vm-style-empty{padding:20px;border:1px dashed var(--line,#ffffff13);border-radius:10px}
.vm-style-footer{display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:18px 28px 22px;border-top:1px solid var(--line,#ffffff13);background:var(--surface,#181818)}.vm-style-dialog .vm-style-status{flex:1 1 250px;min-height:20px;font-size:11px;color:var(--muted,#b0a6a4)}.vm-style-footer-actions{display:flex;flex-wrap:wrap;gap:9px}.vm-style-dialog .vm-style-primary,.vm-style-dialog .vm-style-reset{font-size:12px}
@media(max-width:850px){.vm-style-body{grid-template-columns:minmax(230px,.85fr) minmax(0,1fr);gap:20px}.vm-style-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.vm-style-dialog{width:calc(100vw - 20px);max-height:94vh}.vm-style-head{padding:20px}.vm-style-body{grid-template-columns:1fr;padding:20px}.vm-style-preview{max-width:380px;width:100%;margin:auto}.vm-style-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.vm-style-footer{padding:18px 20px}.vm-style-footer-actions{width:100%}.vm-style-primary{flex:1}.vm-style-dialog h2{font-size:24px}}@media(forced-colors:active){.vm-style-dialog,.vm-style-card,.vm-style-dialog button{border:1px solid CanvasText}.vm-style-dialog button[aria-pressed=true]{outline:2px solid Highlight}.vm-style-badge{color:CanvasText}}
`;document.head.append(style);
    dialog=node('dialog','vm-style-dialog',undefined,'data-profile-style-dialog');dialog.setAttribute('data-i18n-skip','');dialog.setAttribute('aria-labelledby','vm-style-title');dialog.setAttribute('aria-describedby','vm-style-description');
    const header=node('header','vm-style-head'),heading=node('div');heading.append(node('div','vm-style-eyebrow','Make it yours'));
    const title=node('h2','','Profile styles');title.id='vm-style-title';heading.append(title);
    const description=node('p','','Try frames together on your current profile. Your editor draft stays open underneath.');description.id='vm-style-description';heading.append(description);
    const dismiss=button('×','data-style-close',close);dismiss.className='vm-style-close';dismiss.setAttribute('aria-label','Close profile styles');header.append(heading,dismiss);
    const body=node('div','vm-style-body'),preview=node('section','vm-style-preview');preview.setAttribute('aria-label','Your profile preview');
    const previewLabel=node('div','vm-style-preview-label');previewLabel.append(node('strong','','Your profile'),node('span','vm-style-badge','Preview only'));
    const card=node('article','vm-style-card',undefined,'data-style-card'),banner=node('img','vm-style-banner',undefined,'data-style-banner');banner.alt='';
    const content=node('div','vm-style-card-content'),name=node('h3','vm-style-name',undefined,'data-style-name'),bio=node('p','vm-style-bio',undefined,'data-style-bio');card.append(banner,content);
    const summary=node('p','vm-style-summary',undefined,'data-style-summary'),motionLabel=node('label','vm-style-motion'),motion=node('input','',undefined,'data-style-motion');motion.type='checkbox';motionLabel.append(motion,node('span','','Animate my preview'));
    const motionHelp=node('p','vm-style-motion-help');motionHelp.id='vm-style-motion-help';motion.setAttribute('aria-describedby',motionHelp.id);preview.append(previewLabel,card,summary,motionLabel,motionHelp);
    const catalog=node('div','vm-style-catalog'),grids={},defaults={};
    for(const kind of kinds){const section=node('section'),head=node('div','vm-style-section-head'),label=kind==='avatar-frame'?'Avatar frames':'Profile cards';section.setAttribute('aria-label',label);const original=button('Original',undefined,()=>choose(kind,null));original.className='vm-style-default';original.setAttribute('aria-label','Use original '+(kind==='avatar-frame'?'avatar':'profile card'));defaults[kind]=original;head.append(node('h3','',label),original);grids[kind]=node('div','vm-style-grid');section.append(head,grids[kind]);catalog.append(section);}
    body.append(preview,catalog);
    const footer=node('footer','vm-style-footer'),message=node('p','vm-style-status',undefined,'data-style-status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
    const footerActions=node('div','vm-style-footer-actions'),resetButton=button('Reset preview','data-style-reset',reset),exportButton=button('Export package','data-style-export',exportSelected),market=button('Choose a style to explore','data-style-marketplace',marketplace);resetButton.className='vm-style-reset';exportButton.className='vm-style-reset';market.className='vm-style-primary primary';footerActions.append(resetButton,exportButton,market);footer.append(message,footerActions);dialog.append(header,body,footer);document.body.append(dialog);
    ui={card,banner,content,name,bio,summary,motion,motionHelp,grids,defaults,marketplace:market,export:exportButton,status:message,dismiss};
    motion.addEventListener('change',()=>{wantsMotion=motion.checked;motionChanged();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(dialog&&!dialog.open)finished();});
  }
  function catalog(person){
    release(galleryCleanup);tiles=[];for(const grid of Object.values(ui.grids))grid.replaceChildren();
    const engine=window.VumiroCommunityThemes,seen=new Set(),packages=[...(window.VumiroProfileStyleSamples?.packages?.()||[]),...(engine?.personalBuiltins||[])];
    for(const candidate of packages){
      if(!kinds.includes(candidate?.kind)||seen.has(candidate.id))continue;
      const result=engine?.validate(candidate);if(!result?.valid)continue;const pkg=result.package;seen.add(pkg.id);
      const tile=button('',undefined,()=>choose(pkg.kind,pkg));tile.className='vm-style-tile';tile.setAttribute('data-style-package',pkg.id);tile.setAttribute('aria-label','Preview '+pkg.name);tile.setAttribute('aria-pressed','false');
      const swatch=node('span','vm-style-swatch');swatch.setAttribute('aria-hidden','true');let target;
      if(pkg.kind==='avatar-frame')target=portrait(person);
      else{target=node('span','vm-style-card-swatch');const lines=node('span','vm-style-lines');lines.append(node('span'),node('span'));target.append(portrait(person),lines);}
      swatch.append(target);tile.append(swatch,node('span','vm-style-tile-name',pkg.name));
      try{galleryCleanup.push(window.VumiroProfileCosmetics[pkg.kind==='avatar-frame'?'previewAvatar':'previewCard'](target,pkg,{preferences:{reducedMotion:true}}));}
      catch{continue;}
      ui.grids[pkg.kind].append(tile);tiles.push({button:tile,pkg});
    }
    for(const [kind,grid]of Object.entries(ui.grids))if(!tiles.some(tile=>tile.pkg.kind===kind))grid.append(node('p','vm-style-empty','Styles are unavailable. Try again after reloading.'));
  }
  function finished(){++serial;busy=false;release(mainCleanup);release(galleryCleanup);selected={};active=null;opener?.focus?.();}
  function close(){if(dialog?.open)dialog.close();finished();}
  function open(){
    if(disposed)return false;if(dialog?.open){ui.dismiss.focus();return true;}
    ensure();opener=document.activeElement;const person=profile();selected={};active=null;busy=false;++serial;
    ui.name.textContent=person.name||'Your profile';ui.bio.textContent=person.bio||'Your story starts here.';
    ui.avatar=portrait(person,true);ui.content.replaceChildren(ui.avatar,ui.name,ui.bio,node('div','vm-style-card-label','Your personal profile'));
    const banner=imageSource(person.banner,16384);if(banner)ui.banner.src=banner;else ui.banner.removeAttribute('src');
    catalog(person);
    for(const kind of kinds)selected[kind]=(tiles.find(tile=>tile.pkg.id==='astral-tide-'+kind)||tiles.find(tile=>tile.pkg.kind===kind))?.pkg||null;
    active=selected['avatar-frame']||selected['profile-card'];motionChanged();actions();status('Preview only. Nothing is saved or equipped.');dialog.showModal();renderPreview();ui.dismiss.focus();return true;
  }
  function changed(){if(dialog?.open)close();}
  function bind(){if(disposed||trigger)return;trigger=document.getElementById('profileStyleOpen');trigger?.addEventListener('click',open);}
  function dispose(){
    if(disposed)return;close();disposed=true;trigger?.removeEventListener('click',open);document.removeEventListener('DOMContentLoaded',bind);media?.removeEventListener?.('change',motionChanged);
    for(const event of ['vumiro-account-state-changed','vumiro-profile-changed','beforeunload'])window.removeEventListener(event,event==='beforeunload'?dispose:changed);
    dialog?.remove();style?.remove();dialog=null;style=null;ui=null;tiles=[];
  }
  window.VumiroProfileStyleStudio=Object.freeze({open,close,dispose});
  for(const event of ['vumiro-account-state-changed','vumiro-profile-changed'])window.addEventListener(event,changed);
  window.addEventListener('beforeunload',dispose);media?.addEventListener?.('change',motionChanged);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
