/* Local creator workspace for the portable community theme contract. */
(() => {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));let duplicateNumber=0;
  function create({mount,previewRoot,manager,binding={mode:'inherit'},bindings=[],preferences={},onSave=async()=>{},onPreview=()=>{},onApplyLocal,draftKey,draftStorage,contextLabel}={}){
    const themes=window.VumiroCommunityThemes;if(!themes)throw Error('Community theme engine must load before Theme Studio');
    if(!mount?.ownerDocument)throw Error('Theme Studio requires a mount element');manager=manager||themes.createManager();
    if(!draftStorage)try{draftStorage=window.localStorage;}catch{}
    const document=mount.ownerDocument,initial={binding:copy(binding),css:null,metadata:null,motion:null,assets:null,previews:null};
    let draft=copy(initial),saved=copy(initial),history=[],future=[],packages=[...themes.builtins],cleanup,disposed=false,saving=false,applying=false,viewport='desktop',notice=manager.warning||'';const stagedAssetIds=new Set();
    if(draftKey&&draftStorage){try{const stored=draftStorage.getItem(draftKey);if(stored){const parsed=JSON.parse(stored);if(parsed?.binding)draft=parsed;}}catch{notice='Stored draft could not be read. Your saved theme is intact.';}}
    const el=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
    const container=el('section',null,'community-theme-studio');container.setAttribute('aria-label','Theme Studio');
    const scopeLabel=typeof contextLabel==='string'?contextLabel.trim():'';
    const heading=el('h2','Theme Studio'),description=el('p',(scopeLabel?`Editing appearance for ${scopeLabel}. `:'Editing a local appearance. ')+(manager.persistent?'Personal theme packages and artwork are stored on this device.':'Session-only package storage. Export packages to keep a copy.'),'community-studio-description');
    const status=el('p',null,'community-studio-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const controls=el('div',null,'community-studio-controls'),actions=el('div',null,'community-studio-actions'),tokenControls=new Map();
    const trackedControls=[];
    function section(title,description,open=false){const node=el('details',null,'community-studio-section');node.open=open;const summary=el('summary',title,'community-studio-section-title'),fields=el('div',null,'community-studio-fields');node.append(summary,el('p',description,'community-studio-section-description'),fields);controls.append(node);return fields;}
    const selectionFields=section('Theme selection','Choose a starting point. Inherit follows the parent appearance; selecting a package starts a fresh visual baseline.',true);
    const colorFields=section('Colors','Set the surfaces, text and accent used throughout this scope.',true);
    const layoutFields=section('Typography & layout','Adjust local fonts, spacing and the available home and room layouts.');
    const componentFields=section('Components','Fine-tune a component’s decoration. Action hierarchy and selected states remain app-owned.');
    const artworkFields=section('Artwork','Upload local background images and WOFF2 fonts. Local application is immediate; community publishing requires marketplace review.');
    const advancedFields=section('Advanced & export','Edit validated slot CSS, import a package or export a portable copy.');
    function sectionActions(){return el('div',null,'community-studio-section-actions');}
    const selectionActions=sectionActions(selectionFields),componentActions=sectionActions(componentFields),advancedActions=sectionActions(advancedFields);
    function field(label,node,target=layoutFields){node.setAttribute('aria-label',label);node.setAttribute('data-community-slot','input');const wrapper=el('label',label);wrapper.append(node);target.append(wrapper);trackedControls.push(node);return node;}
    function select(label,values,target){const node=el('select');for(const [value,text] of values){const option=el('option',text);option.value=value;node.append(option);}return field(label,node,target);}
    function button(label,action,target=actions,variant='quiet'){const node=el('button',label);node.type='button';node.dataset.variant=variant;node.setAttribute('data-community-slot','button');node.onclick=()=>{try{const result=action();if(result?.catch)result.catch(error=>report(error.message));}catch(error){report(error.message);}};target.append(node);trackedControls.push(node);return node;}
    const packageSelect=select('Theme package',[],selectionFields);
    for(const [key,value] of Object.entries(themes.tokenDefaults)){
      let node;
      if(key==='density')node=select('Density',[['comfortable','Comfortable'],['compact','Compact']]);
      else if(['fontBody','fontHeading'].includes(key))node=select(key==='fontBody'?'Body font':'Heading font',[[value,'System UI'],['Georgia, serif','Georgia'],['Consolas, monospace','Consolas'],['Arial, sans-serif','Arial']]);
      else{node=el('input');node.type=/^#[\da-f]{6}$/i.test(value)?'color':'text';field(key.replace(/[A-Z]/g,letter=>' '+letter.toLowerCase()),node,['surface','surfaceRaised','text','muted','accent','accentText','border','success','warning','danger'].includes(key)?colorFields:layoutFields);}
      node.onchange=()=>{try{setToken(key,node.value);}catch(error){report(error.message);sync();}};tokenControls.set(key,node);
    }
    const homeLayout=select('Home layout',[['compact','Compact overview'],['banner','Banner-led home'],['split','Split introduction and activity']]);
    const roomLayout=select('Room layout',[['standard','Standard room'],['compact','Compact room']]);
    homeLayout.onchange=()=>setLayout('home',homeLayout.value);roomLayout.onchange=()=>setLayout('room',roomLayout.value);
    const motionSelect=select('Bounded motion',themes.motionPresets.map(value=>[value,value[0].toUpperCase()+value.slice(1)]));motionSelect.onchange=()=>change(next=>{next.motion=motionSelect.value;});
    const componentSlot=select('Component slot',themes.slots.map(slot=>[slot,slot]),componentFields);
    const componentProperty=select('Component style',[['backgroundColor','Background color'],['color','Text color'],['borderColor','Border color'],['borderRadius','Corners'],['borderWidth','Border width'],['borderStyle','Border style'],['boxShadow','Shadow'],['backgroundImage','Background artwork or gradient'],['backgroundSize','Background fit'],['backgroundPosition','Background position'],['backgroundRepeat','Background repeat'],['backgroundBlendMode','Background blend'],['padding','Padding'],['gap','Gap'],['fontFamily','Font family or font(asset-id)'],['fontSize','Font size'],['fontWeight','Font weight'],['fontStyle','Font style'],['lineHeight','Line height'],['letterSpacing','Letter spacing'],['textAlign','Text alignment'],['textTransform','Text case']],componentFields);
    const componentValue=field('Component value',el('input'),componentFields);componentValue.placeholder='#292b20, 12px, or asset(my-artwork)';
    button('Apply component style',()=>setComponent(componentSlot.value,componentProperty.value,componentValue.value),componentActions,'secondary');
    const cssInput=field('Advanced CSS',el('textarea'),advancedFields);cssInput.rows=5;cssInput.placeholder='[data-community-slot="card"] { border-color: #dfb575; }';cssInput.onchange=()=>{try{setCss(cssInput.value);}catch(error){report(error.message);sync();}};
    advancedFields.append(el('p','CSS accepts documented slots and visual properties. External resources, scripts, geometry and overlays are rejected.','community-studio-section-description'));
    const creatorName=field('Export theme name',el('input'),advancedFields),creatorAuthor=field('Export author',el('input'),advancedFields),creatorVersion=field('Export version',el('input'),advancedFields);
    const setMetadata=()=>change(next=>{next.metadata={name:creatorName.value,author:creatorAuthor.value,version:creatorVersion.value};});
    creatorName.onchange=setMetadata;creatorAuthor.onchange=setMetadata;creatorVersion.onchange=setMetadata;
    const previewSelect=select('Preview width',[['desktop','Desktop'],['narrow','Narrow window']],selectionFields);previewSelect.onchange=()=>setViewport(previewSelect.value);
    const backgroundSlot=select('Background target',themes.communitySlots.map(slot=>[slot,slot]),artworkFields),backgroundAsset=select('Background artwork',[['','No uploaded artwork']],artworkFields),backgroundSize=select('Background fit',[['cover','Cover'],['contain','Contain'],['auto','Original size']],artworkFields),backgroundPosition=select('Background position',['center','top','bottom','left','right','left top','center top','right top','left center','right center','left bottom','center bottom','right bottom'].map(value=>[value,value]),artworkFields),backgroundRepeat=select('Background repeat',['no-repeat','repeat','repeat-x','repeat-y'].map(value=>[value,value]),artworkFields);
    backgroundSlot.onchange=()=>sync();const applyBackgroundControls=()=>{try{setBackground(backgroundSlot.value,backgroundAsset.value,{size:backgroundSize.value,position:backgroundPosition.value,repeat:backgroundRepeat.value});}catch(error){report(error.message);sync();}};for(const control of [backgroundAsset,backgroundSize,backgroundPosition,backgroundRepeat])control.onchange=applyBackgroundControls;
    const assetInput=field('Add local artwork',el('input'),artworkFields);assetInput.type='file';assetInput.accept='image/png,image/jpeg,image/webp,image/gif';assetInput.onchange=async()=>{try{if(assetInput.files?.[0])await addBackground(assetInput.files[0],backgroundSlot.value);}catch(error){report(error.message);}finally{assetInput.value='';}};
    const fontInput=field('Add local WOFF2 font',el('input'),artworkFields);fontInput.type='file';fontInput.accept='.woff2,font/woff2';fontInput.onchange=async()=>{try{if(fontInput.files?.[0]){const id=await addFont(fontInput.files[0]);report(`Font ${id} added. Choose it under Body font, Heading font or a component font family.`);}}catch(error){report(error.message);}finally{fontInput.value='';}};
    const assetList=el('p','Artwork: none');
    artworkFields.append(assetList);
    const importInput=field('Import .vumirotheme package',el('input'),advancedFields);importInput.type='file';importInput.accept='.vumirotheme,application/json';
    importInput.onchange=async()=>{try{if(importInput.files?.[0]){const file=importInput.files[0];if(file.size>themes.MAX_PACKAGE)throw Error('Theme package is too large');await importPackage(await file.text());}}catch(error){report(error.message);}finally{importInput.value='';}};
    const saveButton=button('Save',save,actions,'primary'),applyLocalButton=typeof onApplyLocal==='function'?button('Apply locally',applyLocal,actions,'secondary'):null,undoButton=button('Undo',undo),redoButton=button('Redo',redo);
    button('New avatar frame',()=>createKind('avatar-frame'),selectionActions);button('New user-card frame',()=>createKind('profile-card'),selectionActions);button('New profile effect',()=>createKind('profile-effect'),selectionActions);
    button('Discard',discard);button('Duplicate',duplicate,selectionActions);button('Reset',reset,selectionActions);button('Import',()=>importInput.click(),advancedActions);
    button('Export',async()=>{const content=await exportPackage(),blob=new Blob([content],{type:'application/json'}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download=JSON.parse(content).id+'.vumirotheme';container.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);report('Portable theme exported.');},advancedActions);
    button('Uninstall selected version',async()=>{const selected=draft.binding;if(selected.mode==='inherit'||themes.builtins.some(pkg=>pkg.id===selected.packageId&&pkg.version===selected.version))throw Error('Select an installed creator theme to uninstall.');await manager.uninstall(selected.packageId,selected.version);await refreshPackages();change(next=>{next.binding={mode:'inherit'};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});report('Version uninstalled locally. Saved bindings to it fall back to the baseline.');},advancedActions,'danger');
    selectionFields.append(selectionActions);componentFields.append(componentActions);advancedFields.append(advancedActions);
    container.append(heading,description,controls,actions,status);mount.append(container);
    function report(message){notice=message;status.textContent=message;}
    function source(state=draft){if(state.binding.mode!=='inherit'&&state.binding.packageId)return packages.find(pkg=>pkg.id===state.binding.packageId&&pkg.version===(state.binding.version||'1.0.0'))||themes.builtins[0];const inherited=themes.resolve({bindings,packages,preferences});return packages.find(pkg=>pkg.id===inherited.packageId&&pkg.version===inherited.version)||themes.builtins[0];}
    function flattened(state=draft,{portable=false}={}){
      let base=copy(source(state));const override=state.binding.overrides||{};
      if(state.binding.mode==='inherit'){const inherited=themes.resolve({bindings,packages});base={...base,tokens:inherited.tokens,components:inherited.components,css:inherited.css,assets:inherited.assets,motion:inherited.motion};for(const [kind,value] of Object.entries(inherited.layout))base.layouts[kind]=[value,...base.layouts[kind].filter(layout=>layout!==value)];}
      const pkg={...base,tokens:{...base.tokens,...override.tokens},components:copy(base.components)};
      for(const [slot,styles] of Object.entries(override.components||{}))pkg.components[slot]={...pkg.components[slot],...styles};
      if(override.layout)for(const [kind,value] of Object.entries(override.layout))pkg.layouts[kind]=[value,...pkg.layouts[kind].filter(layout=>layout!==value)];
      if(state.css!==null)pkg.css=state.css;if(state.motion!==null)pkg.motion=state.motion;
      if(state.assets!==null)pkg.assets=copy(state.assets);if(state.previews!==null)pkg.previews=copy(state.previews);
      if(portable){pkg.id=base.id.slice(0,48)+'-custom';pkg.name=state.metadata?.name||base.name+' custom';pkg.author=state.metadata?.author||'Local creator';pkg.version=state.metadata?.version||'1.0.0';}
      return pkg;
    }
    function checked(state){const result=themes.validate(flattened(state,{portable:!!state.metadata}));if(!result.valid)throw Error(result.errors.join('; '));return result.package;}
    function storeDraft(){if(!draftKey||!draftStorage)return;try{if(JSON.stringify(draft)===JSON.stringify(saved))draftStorage.removeItem(draftKey);else{const metadata=copy(draft);if(metadata.assets)metadata.assets=metadata.assets.map(({id,mime})=>({id,mime}));draftStorage.setItem(draftKey,JSON.stringify(metadata));}}catch{notice='Draft remains open, but could not be saved to local storage. Export it to keep a copy.';}}
    function clearDraftArtwork(){if(!draftKey)return;for(const id of stagedAssetIds)void manager.removeDraftAsset(draftKey,id).catch(()=>{});stagedAssetIds.clear();}
    function resolved(){const pkg=flattened(),localBinding=copy(draft.binding),localPackages=packages.filter(entry=>entry.id!==pkg.id||entry.version!==pkg.version);localPackages.push(pkg);if(draft.css!==null||draft.motion!==null||draft.assets!==null){localBinding.mode='package';localBinding.packageId=pkg.id;localBinding.version=pkg.version;}return themes.resolve({bindings:[...bindings,localBinding],packages:localPackages,preferences});}
    function sync(){
      if(disposed)return;const appearance=resolved();
      cleanup?.();if(previewRoot)cleanup=themes.applyToRoot(previewRoot,appearance);onPreview(appearance,copy(draft.binding),flattened());
      const current=flattened(),fontValues=[...new Set(['"Segoe UI", sans-serif','"Trebuchet MS", sans-serif','Georgia, serif','Consolas, monospace','Arial, sans-serif','Verdana, sans-serif','Tahoma, sans-serif','sans-serif','serif','monospace','system-ui',current.tokens.fontBody,current.tokens.fontHeading,...themes.builtins.flatMap(pkg=>[pkg.tokens.fontBody,pkg.tokens.fontHeading]),...current.assets.filter(asset=>asset.mime==='font/woff2').map(asset=>`font(${asset.id})`)].filter(Boolean))];
      for(const [key,node] of tokenControls){if(['fontBody','fontHeading'].includes(key)){node.replaceChildren();for(const value of fontValues){const option=el('option',value.startsWith('font(')?'Uploaded: '+value.slice(5,-1):value);option.value=value;node.append(option);}node.value=current.tokens[key]||themes.tokenDefaults[key];}else node.value=appearance.tokens[key];}
      packageSelect.value=draft.binding.mode==='inherit'?'inherit':draft.binding.packageId+'@'+(draft.binding.version||'1.0.0');
      const pkg=source();homeLayout.value=appearance.layout.home;roomLayout.value=appearance.layout.room;motionSelect.value=draft.motion||pkg.motion||'none';cssInput.value=draft.css??pkg.css;
      creatorName.value=draft.metadata?.name||pkg.name+' custom';creatorAuthor.value=draft.metadata?.author||'Local creator';creatorVersion.value=draft.metadata?.version||'1.0.0';
      const rasters=current.assets.filter(asset=>asset.mime.startsWith('image/')),fonts=current.assets.filter(asset=>asset.mime==='font/woff2');assetList.textContent='Artwork: '+(rasters.map(asset=>asset.id).join(', ')||'none')+'. Fonts: '+(fonts.map(asset=>asset.id).join(', ')||'none');
      for(const node of trackedControls)node.disabled=saving;undoButton.disabled=saving||history.length===0;redoButton.disabled=saving||future.length===0;saveButton.disabled=saving;saveButton.textContent=saving&&!applying?'Saving…':'Save';if(applyLocalButton)applyLocalButton.textContent=applying?'Applying locally…':'Apply locally';
      for(const node of tokenControls.values())node.disabled=saving||(pkg.kind||'theme')!=='theme';homeLayout.disabled=roomLayout.disabled=saving||(pkg.kind||'theme')!=='theme';
      const allowed=themes.personalSlots[pkg.kind]||themes.communitySlots,previous=componentSlot.value;componentSlot.replaceChildren();for(const slot of allowed){const option=el('option',slot);option.value=slot;componentSlot.append(option);}componentSlot.value=allowed.includes(previous)?previous:allowed[0];
      const previousBackground=backgroundSlot.value;backgroundSlot.replaceChildren();for(const slot of allowed){const option=el('option',slot);option.value=slot;backgroundSlot.append(option);}backgroundSlot.value=allowed.includes(previousBackground)?previousBackground:allowed[0];const background=current.components[backgroundSlot.value]||{};backgroundAsset.replaceChildren();for(const [id,label] of [['','No uploaded artwork'],...rasters.map(asset=>[asset.id,asset.id])]){const option=el('option',label);option.value=id;backgroundAsset.append(option);}backgroundAsset.value=/^asset\([a-z][a-z0-9-]*\)$/.test(background.backgroundImage||'')?background.backgroundImage.slice(6,-1):'';backgroundSize.value=background.backgroundSize||'cover';backgroundPosition.value=background.backgroundPosition||'center';backgroundRepeat.value=background.backgroundRepeat||'no-repeat';
      status.textContent=notice||(dirty()?'Unsaved local draft.':'Saved appearance.');
    }
    function dirty(){return JSON.stringify(draft)!==JSON.stringify(saved);}
    function change(action){if(disposed)throw Error('Theme Studio is closed');if(saving)throw Error('Wait for the current save to finish');const next=copy(draft);action(next);checked(next);history.push(copy(draft));if(history.length>80)history.shift();future=[];draft=next;notice='';storeDraft();sync();}
    function setToken(key,value){if((source().kind||'theme')!=='theme')throw Error('Decorative packages use component styles instead of global tokens');change(next=>{next.binding.overrides=next.binding.overrides||{};next.binding.overrides.tokens={...next.binding.overrides.tokens,[key]:value};});}
    function setComponent(slot,property,value){change(next=>{const overrides=next.binding.overrides=next.binding.overrides||{};overrides.components=overrides.components||{};overrides.components[slot]={...overrides.components[slot],[property]:value};});}
    function setBackground(slot,assetId,{size='cover',position='center',repeat='no-repeat'}={}){if(assetId&&assetId!=='none'&&!flattened().assets.some(asset=>asset.id===assetId&&asset.mime.startsWith('image/')))throw Error('Choose an existing raster image for the background');change(next=>{const overrides=next.binding.overrides=next.binding.overrides||{};overrides.components=overrides.components||{};overrides.components[slot]={...overrides.components[slot],backgroundImage:assetId&&assetId!=='none'?`asset(${assetId})`:'none',backgroundSize:size,backgroundPosition:position,backgroundRepeat:repeat};});}
    function setLayout(kind,value){if(!source().layouts[kind])throw Error('This package has no community layout controls');change(next=>{next.binding.overrides=next.binding.overrides||{};next.binding.overrides.layout={...next.binding.overrides.layout,[kind]:value};});}
    function setCss(value){change(next=>{next.css=value;});}
    function undo(){if(saving||!history.length)return;future.push(copy(draft));draft=history.pop();notice='';storeDraft();sync();}
    function redo(){if(saving||!future.length)return;history.push(copy(draft));draft=future.pop();notice='';storeDraft();sync();}
    function reset(){change(next=>{next.binding.overrides={tokens:{},components:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});}
    function discard(){if(saving)return;draft=copy(saved);history=[];future=[];notice='Draft discarded.';storeDraft();clearDraftArtwork();sync();}
    async function refreshPackages(){const list=await manager.list(),next=[...themes.builtins];for(const item of list){try{next.push(await manager.get(item.id,item.version));}catch(error){notice=error.message;}}packages=next;if(disposed)return;packageSelect.replaceChildren();const inherit=el('option','Inherit parent appearance');inherit.value='inherit';packageSelect.append(inherit);for(const pkg of packages){const option=el('option',`${pkg.name} · ${pkg.version}`);option.value=pkg.id+'@'+pkg.version;packageSelect.append(option);}}
    async function save(){
      if(saving)throw Error('A theme save is already in progress');checked(draft);saving=true;sync();
      try{let nextBinding=copy(draft.binding);
        if(draft.css!==null||draft.metadata!==null||draft.motion!==null||draft.assets!==null){const pkg=flattened(draft,{portable:true}),existing=packages.find(entry=>entry.id===pkg.id&&entry.version===pkg.version);if(existing&&JSON.stringify(existing)!==JSON.stringify(pkg))pkg.id=source().id.slice(0,35)+'-custom-'+Date.now().toString(36)+'-'+(++duplicateNumber);await manager.install(pkg);await refreshPackages();nextBinding={mode:'package',packageId:pkg.id,version:pkg.version,overrides:{}};}
        if(disposed)throw Error('Theme Studio closed before save completed');if(await onSave(copy(nextBinding))===false)throw Error('Appearance was not saved. Your local draft is still available.');
        draft={binding:nextBinding,css:null,metadata:null,motion:null,assets:null,previews:null};saved=copy(draft);history=[];future=[];notice=scopeLabel?`Appearance saved in ${scopeLabel}.`:'Appearance saved locally.';storeDraft();clearDraftArtwork();return copy(nextBinding);
      }finally{saving=false;sync();}
    }
    async function importPackage(input){if(typeof input==='string'&&input.length>themes.MAX_PACKAGE)throw Error('Theme package is too large');const result=themes.validate(input);if(!result.valid)throw Error(result.errors.join('; '));await manager.install(result.package);await refreshPackages();change(next=>{next.binding={mode:'package',packageId:result.package.id,version:result.package.version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});report('Package installed locally. Save to apply it to this scope.');return result.package;}
    async function exportPackage(){const pkg=flattened(draft,{portable:true});const result=themes.validate(pkg);if(!result.valid)throw Error(result.errors.join('; '));return JSON.stringify(result.package,null,2);}
    async function applyLocal(){if(disposed)throw Error('Theme Studio is closed');if(saving)throw Error('A theme operation is already in progress');if(typeof onApplyLocal!=='function')throw Error('Local application is unavailable in this editor');checked(draft);saving=applying=true;sync();try{const pkg=JSON.parse(await exportPackage());if(disposed)throw Error('Theme Studio closed before local application');if(await onApplyLocal(copy(pkg))===false)throw Error('Appearance was not applied locally. Your draft is still available.');if(disposed)throw Error('Theme Studio closed before local application completed');notice='Appearance applied locally. Community publishing requires marketplace review.';return copy(pkg);}catch(error){notice=error.message;throw error;}finally{saving=applying=false;sync();}}
    async function duplicate(){const pkg=JSON.parse(await exportPackage());pkg.id=source().id.slice(0,35)+'-copy-'+Date.now().toString(36)+'-'+(++duplicateNumber);pkg.name=source().name+' copy';await manager.install(pkg);await refreshPackages();change(next=>{next.binding={mode:'package',packageId:pkg.id,version:pkg.version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});return copy(pkg);}
    async function createKind(kind){const starter=themes.personalBuiltins.find(pkg=>pkg.kind===kind);if(!starter)throw Error('Unsupported personal customization kind');const pkg=copy(starter);pkg.id=kind+'-draft-'+Date.now().toString(36)+'-'+(++duplicateNumber);pkg.name='My '+kind.replaceAll('-',' ');pkg.author='Local creator';await manager.install(pkg);await refreshPackages();change(next=>{next.binding={mode:'package',packageId:pkg.id,version:pkg.version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});report('Personal customization draft created. Export it to keep a portable copy.');return copy(pkg);}
    async function uploadAsset(file,{font=false,slot,background={}}={}){if(disposed)throw Error('Theme Studio is closed');if(saving)throw Error('Wait for the current operation to finish');if(file.size>themes.MAX_ASSET)throw Error('Image or font exceeds the 512 KiB limit');if(font&&file.type&&!['font/woff2','application/font-woff2','application/octet-stream'].includes(file.type))throw Error('Choose a WOFF2 font');if(!font&&!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw Error('Choose a supported raster image');const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length>themes.MAX_ASSET)throw Error('Image or font exceeds the 512 KiB limit');let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const id=file.name.toLowerCase().replace(/\.[^.]+$/,'').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||(font?'typeface':'artwork'),asset={id:/^[a-z]/.test(id)?id:'asset-'+id,mime:font?'font/woff2':file.type,data:btoa(binary)};
      const update=next=>{const base=flattened(next);next.assets=(next.assets||copy(base.assets)).filter(item=>item.id!==asset.id);next.assets.push(asset);next.previews=next.previews||copy(base.previews);if(!font&&!next.previews.length)next.previews.push(asset.id);if(slot){const overrides=next.binding.overrides=next.binding.overrides||{};overrides.components=overrides.components||{};overrides.components[slot]={...overrides.components[slot],backgroundImage:`asset(${asset.id})`,backgroundSize:background.size||'cover',backgroundPosition:background.position||'center',backgroundRepeat:background.repeat||'no-repeat'};}};const candidate=copy(draft);update(candidate);checked(candidate);if(saving||disposed)throw Error('Wait for the current operation to finish');if(draftKey){await manager.saveDraftAsset(draftKey,asset);stagedAssetIds.add(asset.id);}change(update);report(`${font?'Font':'Artwork'} ${asset.id} added.${font?' Choose it in typography settings.':slot?' Background applied to '+slot+'.':` Use asset(${asset.id}) as a component background.`}`);return asset.id;}
    async function addAsset(file){return uploadAsset(file);}
    async function addFont(file){return uploadAsset(file,{font:true});}
    async function addBackground(file,slot='surface',background={}){return uploadAsset(file,{slot,background});}
    function setViewport(value){if(!['desktop','narrow'].includes(value))throw Error('Unsupported preview viewport');viewport=value;previewSelect.value=value;if(previewRoot){previewRoot.setAttribute('data-community-preview-width',value);previewRoot.style.setProperty('max-width',value==='narrow'?'390px':'100%');previewRoot.style.setProperty('width','100%');}return viewport;}
    packageSelect.onchange=()=>{const value=packageSelect.value;change(next=>{const [packageId,version]=value.split('@');next.binding=value==='inherit'?{mode:'inherit'}:{mode:'package',packageId,version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});};
    const ready=refreshPackages().then(async()=>{try{if(draft.assets)for(let index=0;index<draft.assets.length;index++){const ref=draft.assets[index];if(!ref.data){const asset=await manager.getDraftAsset(draftKey,ref.id)||source().assets.find(asset=>asset.id===ref.id);if(!asset)throw Error(`Missing draft artwork: ${ref.id}`);draft.assets[index]=copy(asset);stagedAssetIds.add(ref.id);}}checked(draft);storeDraft();}catch(error){draft=copy(saved);notice='Invalid stored draft was ignored: '+error.message;}sync();return true;}).catch(error=>{report(error.message);sync();return false;});
    return {ready,getDraft:()=>copy(draft.binding),dirty,setToken,setComponent,setBackground,setLayout,setCss,undo,redo,save,applyLocal,discard,duplicate,createKind,reset,importPackage,exportPackage,addAsset,addFont,addBackground,setViewport,destroy(){disposed=true;cleanup?.();container.remove();if(previewRoot){previewRoot.removeAttribute('data-community-preview-width');previewRoot.style.removeProperty('max-width');previewRoot.style.removeProperty('width');}}};
  }
  // Consumer controls deliberately have no creator installer, CSS parser or upload path.
  function createCustomizer({mount,previewRoot,binding={mode:'inherit'},bindings=[],packages=[],preferences={},contextLabel='',onSave=async()=>{},onPreview=()=>{},onBrowse=()=>{},draftKey,draftStorage}={}){
    const themes=window.VumiroCommunityThemes,document=mount?.ownerDocument;
    if(!document||!themes)throw Error('Space appearance requires a mount and the community theme engine');
    const available=[...themes.builtins];
    // The host supplies only packages obtained through its marketplace adapter.
    for(const pkg of packages){const result=themes.validate(pkg);if(result.valid&&['theme','decorative-pack'].includes(pkg.kind||'theme')&&!available.some(p=>p.id===pkg.id&&p.version===pkg.version))available.push(result.package);}
    const find=(id,version='1.0.0')=>available.find(pkg=>pkg.id===id&&pkg.version===version);
    const presets=themes.customizations||{},history=[],future=[],controls=[],cards=[],presetControls=new Map(),tokenControls=new Map();
    let disposed=false,saving=false,cleanup,notice='',viewport='desktop';
    if(!draftStorage)try{draftStorage=window.localStorage;}catch{}
    function checked(value){
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid appearance binding');
      const next=value.mode==='inherit'?{mode:'inherit'}:{mode:'package',packageId:value.packageId,version:value.version||'1.0.0'};
      if(next.mode!=='inherit'&&!find(next.packageId,next.version))throw Error('Choose an available curated theme');
      if(value.overrides)next.overrides=copy(value.overrides);
      if(typeof value.itemId==='string'&&value.itemId.length<=160)next.itemId=value.itemId;
      const result=themes.resolve({bindings:[...bindings,next],packages:available});
      if(result.warnings.length)throw Error(result.warnings.join('; '));
      return next;
    }
    let saved;try{saved=checked(binding);}catch{saved={mode:'package',packageId:'baseline',version:'1.0.0'};notice='This appearance is unavailable in the curated collection. The Vumiro baseline is shown.';}
    let draft=copy(saved);
    if(draftKey&&draftStorage)try{const raw=draftStorage.getItem(draftKey);if(raw){if(raw.length>32000)throw Error('Draft too large');draft=checked(JSON.parse(raw));}}catch{notice='An unavailable appearance draft was ignored. Your saved appearance is intact.';}
    const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
    const container=el('section',undefined,'community-space-customizer');container.setAttribute('aria-label','Space appearance');
    const header=el('header',undefined,'community-appearance-header'),intro=el('div');intro.append(el('p','MAKE IT YOURS','community-appearance-eyebrow'),el('h2',contextLabel?'Appearance · '+contextLabel:'Space appearance'),el('p','Build your atmosphere from curated themes and details. Preview here, then save to this Space.','community-studio-description'));
    header.append(intro);container.append(header);
    function action(label,fn,parent,variant='quiet'){
      const node=el('button',label);node.type='button';node.dataset.variant=variant;node.setAttribute('data-community-slot','button');
      node.onclick=()=>{try{const result=fn();if(result?.catch)result.catch(error=>report(error.message));}catch(error){report(error.message);}};
      controls.push(node);parent.append(node);return node;
    }
    action('Browse marketplace',onBrowse,header,'secondary');
    const collection=el('section',undefined,'community-appearance-collection');collection.append(el('h3','Choose an atmosphere'),el('p','Curated collection · Mix the details below to make it your own.','community-studio-section-description'));
    const gallery=el('div',undefined,'community-theme-gallery');gallery.setAttribute('aria-label','Curated theme collection');collection.append(gallery);container.append(collection);
    const inherit=action('Follow parent appearance',()=>selectBinding({mode:'inherit'}),gallery,'secondary');cards.push({node:inherit,inherit:true});
    for(const pkg of available){
      const card=action('',()=>chooseTheme(pkg.id,pkg.version),gallery,'secondary');card.className='community-theme-choice';card.setAttribute('aria-label',pkg.name);
      card.style.setProperty('--choice-surface',pkg.tokens.surface);card.style.setProperty('--choice-raised',pkg.tokens.surfaceRaised);card.style.setProperty('--choice-accent',pkg.tokens.accent);card.style.setProperty('--choice-text',pkg.tokens.text);
      const art=el('span',undefined,'community-theme-art');art.setAttribute('aria-hidden','true');art.append(el('span',undefined,'community-theme-mini-sidebar'),el('span',undefined,'community-theme-mini-banner'),el('span',undefined,'community-theme-mini-card'));
      card.append(art,el('strong',pkg.name),el('small',pkg.id==='baseline'?'Vumiro original':pkg.author+' · '+pkg.version));cards.push({node:card,pkg});
    }
    const details=el('section',undefined,'community-appearance-details');details.append(el('h3','Make it your own'),el('p','Curated details, combined your way. Colors and layout apply only within this scope.','community-studio-section-description'));
    const fields=el('div',undefined,'community-appearance-fields');details.append(fields);container.append(details);
    function field(label,node){node.setAttribute('aria-label',label);node.setAttribute('data-community-slot','input');const wrapper=el('label',label);wrapper.append(node);fields.append(wrapper);controls.push(node);return node;}
    function select(label,values,fn){const node=el('select');for(const [id,name] of values){const option=el('option',name);option.value=id;node.append(option);}field(label,node);node.onchange=()=>{try{fn(node.value);}catch(error){report(error.message);sync();}};return node;}
    for(const [group,entries] of Object.entries(presets)){
      const labels={surfaces:'Surface finish',messages:'Message style',corners:'Corners',spacing:'Spacing'};
      const node=select(labels[group]||group,[['','Theme default'],...entries.map(p=>[p.id,p.name])],id=>setPreset(group,id));presetControls.set(group,node);
    }
    for(const [key,label] of [['accent','Accent color'],['surface','Background color'],['surfaceRaised','Card color']]){
      const node=field(label,el('input'));node.type='color';node.onchange=()=>{try{setToken(key,node.value);}catch(error){report(error.message);sync();}};tokenControls.set(key,node);
    }
    const fonts=[['"Segoe UI", sans-serif','System UI'],['Georgia, serif','Editorial serif'],['Consolas, monospace','Monospace'],['Arial, sans-serif','Classic sans'],['"Trebuchet MS", sans-serif','Humanist sans'],['Tahoma, sans-serif','Compact sans'],['Verdana, sans-serif','Wide sans']];
    tokenControls.set('fontBody',select('Body typography',fonts,value=>setToken('fontBody',value)));
    tokenControls.set('fontHeading',select('Heading typography',fonts,value=>setToken('fontHeading',value)));
    tokenControls.set('fontSize',select('Text size',[['12px','Small · 12'],['14px','Default · 14'],['16px','Large · 16'],['18px','Extra large · 18']],value=>setToken('fontSize',value)));
    const home=select('Home layout',[['compact','Compact overview'],['banner','Banner welcome'],['split','Split overview']],value=>setLayout('home',value));
    const room=select('Conversation layout',[['standard','Comfortable conversation'],['compact','Compact conversation']],value=>setLayout('room',value));
    select('Preview width',[['desktop','Desktop'],['narrow','Narrow window']],setViewport);
    const actions=el('footer',undefined,'community-studio-actions');
    const saveButton=action('Save appearance',save,actions,'primary'),undoButton=action('Undo',undo,actions),redoButton=action('Redo',redo,actions);
    action('Discard',discard,actions);action('Reset details',reset,actions);
    const status=el('p',undefined,'community-studio-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');container.append(actions,status);mount.append(container);
    function report(message){notice=message;status.textContent=message;}
    const dirty=()=>JSON.stringify(draft)!==JSON.stringify(saved);
    const resolved=()=>themes.resolve({bindings:[...bindings,draft],packages:available,preferences});
    function remember(){if(!draftKey||!draftStorage)return;try{if(dirty())draftStorage.setItem(draftKey,JSON.stringify(draft));else draftStorage.removeItem(draftKey);}catch{notice='Your draft is open, but could not be kept on this device.';}}
    function sync(){
      if(disposed)return;const appearance=resolved();cleanup?.();if(previewRoot)cleanup=themes.applyToRoot(previewRoot,appearance);onPreview(appearance,copy(draft));
      for(const node of controls)node.disabled=saving;undoButton.disabled=saving||!history.length;redoButton.disabled=saving||!future.length;saveButton.textContent=saving?'Saving…':'Save appearance';
      for(const entry of cards)entry.node.setAttribute('aria-pressed',String(entry.inherit?draft.mode==='inherit':draft.mode!=='inherit'&&draft.packageId===entry.pkg.id&&draft.version===entry.pkg.version));
      for(const [key,node]of tokenControls){const value=appearance.tokens[key];if(node.tagName.toLowerCase()==='select'&&!Array.from(node.children).some(option=>option.value===value)){const option=el('option',value);option.value=value;node.append(option);}node.value=value;}home.value=appearance.layout.home;room.value=appearance.layout.room;
      for(const [group,node]of presetControls){const own=draft.overrides||{};const match=presets[group].find(p=>Object.entries(p.tokens||{}).every(([key,value])=>own.tokens?.[key]===value)&&Object.entries(p.components||{}).every(([slot,styles])=>Object.entries(styles).every(([key,value])=>own.components?.[slot]?.[key]===value)));node.value=match?.id||'';}
      status.textContent=notice||(dirty()?'Unsaved appearance · Preview only':'Saved appearance');
    }
    function change(fn){if(disposed)throw Error('Space appearance is closed');if(saving)throw Error('Wait for the current save');const next=copy(draft);fn(next);const valid=checked(next);history.push(copy(draft));if(history.length>80)history.shift();future.length=0;draft=valid;notice='';remember();sync();}
    function selectBinding(value){change(next=>{for(const key of Object.keys(next))delete next[key];Object.assign(next,value);});}
    function chooseTheme(id,version='1.0.0'){if(!find(id,version))throw Error('Choose an available curated theme');selectBinding({mode:'package',packageId:id,version,overrides:{}});}
    function setToken(key,value){if(!['accent','surface','surfaceRaised','fontBody','fontHeading','fontSize'].includes(key))throw Error('Unsupported consumer token');change(next=>{next.overrides??={};next.overrides.tokens={...next.overrides.tokens,[key]:value};const slots=key==='surface'?['surface']:key==='surfaceRaised'?['card','banner']:[];if(slots.length){next.overrides.components??={};for(const slot of slots)next.overrides.components[slot]={...next.overrides.components[slot],backgroundImage:'none'};}});}
    function setLayout(kind,value){change(next=>{next.overrides??={};next.overrides.layout={...next.overrides.layout,[kind]:value};});}
    function setPreset(group,id){const entries=presets[group];if(!entries||id&&!entries.some(p=>p.id===id))throw Error('Unknown curated preset');change(next=>{const overrides=next.overrides??={};overrides.tokens??={};overrides.components??={};for(const preset of entries){for(const key of Object.keys(preset.tokens||{}))delete overrides.tokens[key];for(const [slot,styles]of Object.entries(preset.components||{}))for(const key of Object.keys(styles))if(overrides.components[slot])delete overrides.components[slot][key];}const selected=entries.find(p=>p.id===id);Object.assign(overrides.tokens,selected?.tokens);for(const [slot,styles]of Object.entries(selected?.components||{}))overrides.components[slot]={...overrides.components[slot],...styles};});}
    function undo(){if(saving||!history.length||disposed)return;future.push(copy(draft));draft=history.pop();notice='';remember();sync();}
    function redo(){if(saving||!future.length||disposed)return;history.push(copy(draft));draft=future.pop();notice='';remember();sync();}
    function discard(){if(saving||disposed)return;draft=copy(saved);history.length=future.length=0;notice='Draft discarded';remember();sync();}
    function reset(){change(next=>{next.overrides={};});}
    async function save(){if(disposed||saving)throw Error('Space appearance cannot save now');const value=checked(draft);saving=true;notice='';sync();try{if(await onSave(copy(value))===false)throw Error('Appearance was not saved. Your draft is still available.');saved=copy(value);draft=copy(value);history.length=future.length=0;notice=contextLabel?'Appearance saved in '+contextLabel+'.':'Appearance saved locally.';remember();return copy(value);}catch(error){notice=error.message;throw error;}finally{saving=false;sync();}}
    function setViewport(value){if(!['desktop','narrow'].includes(value))throw Error('Unsupported preview viewport');viewport=value;if(previewRoot){previewRoot.setAttribute('data-community-preview-width',value);previewRoot.style.setProperty('max-width',value==='narrow'?'390px':'100%');previewRoot.style.setProperty('width','100%');}return viewport;}
    sync();
    return {ready:Promise.resolve(true),getDraft:()=>copy(draft),dirty,chooseTheme,setToken,setLayout,setPreset,undo,redo,save,discard,reset,setViewport,destroy(){disposed=true;cleanup?.();container.remove();if(previewRoot){previewRoot.removeAttribute('data-community-preview-width');previewRoot.style.removeProperty('max-width');previewRoot.style.removeProperty('width');}}};
  }
  window.VumiroCommunityStudio={create,createCustomizer};
})();
