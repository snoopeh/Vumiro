/* Local creator workspace for the portable community theme contract. */
(() => {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));let duplicateNumber=0;
  function create({mount,previewRoot,manager,binding={mode:'inherit'},bindings=[],preferences={},onSave=async()=>{},onPreview=()=>{},draftKey,draftStorage,contextLabel}={}){
    const themes=window.VumiroCommunityThemes;if(!themes)throw Error('Community theme engine must load before Theme Studio');
    if(!mount?.ownerDocument)throw Error('Theme Studio requires a mount element');manager=manager||themes.createManager();
    if(!draftStorage)try{draftStorage=window.localStorage;}catch{}
    const document=mount.ownerDocument,initial={binding:copy(binding),css:null,metadata:null,motion:null,assets:null,previews:null};
    let draft=copy(initial),saved=copy(initial),history=[],future=[],packages=[...themes.builtins],cleanup,disposed=false,saving=false,viewport='desktop',notice=manager.warning||'';const stagedAssetIds=new Set();
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
    const artworkFields=section('Artwork','Add local raster artwork and use its asset name in component backgrounds.');
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
    const componentProperty=select('Component style',[['backgroundColor','Background color'],['borderColor','Border color'],['borderRadius','Corners'],['borderWidth','Border width'],['boxShadow','Shadow'],['backgroundImage','Background artwork or gradient'],['padding','Padding'],['fontSize','Font size'],['fontWeight','Font weight']],componentFields);
    const componentValue=field('Component value',el('input'),componentFields);componentValue.placeholder='#292b20, 12px, or asset(my-artwork)';
    button('Apply component style',()=>setComponent(componentSlot.value,componentProperty.value,componentValue.value),componentActions,'secondary');
    const cssInput=field('Advanced CSS',el('textarea'),advancedFields);cssInput.rows=5;cssInput.placeholder='[data-community-slot="card"] { border-color: #dfb575; }';cssInput.onchange=()=>{try{setCss(cssInput.value);}catch(error){report(error.message);sync();}};
    advancedFields.append(el('p','CSS accepts documented slots and visual properties. External resources, scripts, geometry and overlays are rejected.','community-studio-section-description'));
    const creatorName=field('Export theme name',el('input'),advancedFields),creatorAuthor=field('Export author',el('input'),advancedFields),creatorVersion=field('Export version',el('input'),advancedFields);
    const setMetadata=()=>change(next=>{next.metadata={name:creatorName.value,author:creatorAuthor.value,version:creatorVersion.value};});
    creatorName.onchange=setMetadata;creatorAuthor.onchange=setMetadata;creatorVersion.onchange=setMetadata;
    const previewSelect=select('Preview width',[['desktop','Desktop'],['narrow','Narrow window']],selectionFields);previewSelect.onchange=()=>setViewport(previewSelect.value);
    const assetInput=field('Add local artwork',el('input'),artworkFields);assetInput.type='file';assetInput.accept='image/png,image/jpeg,image/webp,image/gif';assetInput.onchange=async()=>{try{if(assetInput.files?.[0])await addAsset(assetInput.files[0]);}catch(error){report(error.message);}finally{assetInput.value='';}};
    const assetList=el('p','Artwork: none');
    artworkFields.append(assetList);
    const importInput=field('Import .vumirotheme package',el('input'),advancedFields);importInput.type='file';importInput.accept='.vumirotheme,application/json';
    importInput.onchange=async()=>{try{if(importInput.files?.[0]){const file=importInput.files[0];if(file.size>themes.MAX_PACKAGE)throw Error('Theme package is too large');await importPackage(await file.text());}}catch(error){report(error.message);}finally{importInput.value='';}};
    const saveButton=button('Save',save,actions,'primary'),undoButton=button('Undo',undo),redoButton=button('Redo',redo);
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
      for(const [key,node] of tokenControls)node.value=appearance.tokens[key];
      packageSelect.value=draft.binding.mode==='inherit'?'inherit':draft.binding.packageId+'@'+(draft.binding.version||'1.0.0');
      const pkg=source();homeLayout.value=appearance.layout.home;roomLayout.value=appearance.layout.room;motionSelect.value=draft.motion||pkg.motion||'none';cssInput.value=draft.css??pkg.css;
      creatorName.value=draft.metadata?.name||pkg.name+' custom';creatorAuthor.value=draft.metadata?.author||'Local creator';creatorVersion.value=draft.metadata?.version||'1.0.0';
      assetList.textContent='Artwork: '+(draft.assets||pkg.assets).map(asset=>asset.id).join(', ');if(!(draft.assets||pkg.assets).length)assetList.textContent='Artwork: none';
      for(const node of trackedControls)node.disabled=saving;undoButton.disabled=saving||history.length===0;redoButton.disabled=saving||future.length===0;saveButton.disabled=saving;saveButton.textContent=saving?'Saving…':'Save';
      for(const node of tokenControls.values())node.disabled=saving||(pkg.kind||'theme')!=='theme';homeLayout.disabled=roomLayout.disabled=saving||(pkg.kind||'theme')!=='theme';
      const allowed=themes.personalSlots[pkg.kind]||themes.communitySlots,previous=componentSlot.value;componentSlot.replaceChildren();for(const slot of allowed){const option=el('option',slot);option.value=slot;componentSlot.append(option);}componentSlot.value=allowed.includes(previous)?previous:allowed[0];
      status.textContent=notice||(dirty()?'Unsaved local draft.':'Saved appearance.');
    }
    function dirty(){return JSON.stringify(draft)!==JSON.stringify(saved);}
    function change(action){if(disposed)throw Error('Theme Studio is closed');if(saving)throw Error('Wait for the current save to finish');const next=copy(draft);action(next);checked(next);history.push(copy(draft));if(history.length>80)history.shift();future=[];draft=next;notice='';storeDraft();sync();}
    function setToken(key,value){if((source().kind||'theme')!=='theme')throw Error('Decorative packages use component styles instead of global tokens');change(next=>{next.binding.overrides=next.binding.overrides||{};next.binding.overrides.tokens={...next.binding.overrides.tokens,[key]:value};});}
    function setComponent(slot,property,value){change(next=>{const overrides=next.binding.overrides=next.binding.overrides||{};overrides.components=overrides.components||{};overrides.components[slot]={...overrides.components[slot],[property]:value};});}
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
        if(draft.css!==null||draft.metadata!==null||draft.motion!==null||draft.assets!==null){const pkg=flattened(draft,{portable:true});await manager.install(pkg);await refreshPackages();nextBinding={mode:'package',packageId:pkg.id,version:pkg.version,overrides:{}};}
        if(disposed)throw Error('Theme Studio closed before save completed');if(await onSave(copy(nextBinding))===false)throw Error('Appearance was not saved. Your local draft is still available.');
        draft={binding:nextBinding,css:null,metadata:null,motion:null,assets:null,previews:null};saved=copy(draft);history=[];future=[];notice=scopeLabel?`Appearance saved in ${scopeLabel}.`:'Appearance saved locally.';storeDraft();clearDraftArtwork();return copy(nextBinding);
      }finally{saving=false;sync();}
    }
    async function importPackage(input){if(typeof input==='string'&&input.length>themes.MAX_PACKAGE)throw Error('Theme package is too large');const result=themes.validate(input);if(!result.valid)throw Error(result.errors.join('; '));await manager.install(result.package);await refreshPackages();change(next=>{next.binding={mode:'package',packageId:result.package.id,version:result.package.version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});report('Package installed locally. Save to apply it to this scope.');return result.package;}
    async function exportPackage(){const pkg=flattened(draft,{portable:true});const result=themes.validate(pkg);if(!result.valid)throw Error(result.errors.join('; '));return JSON.stringify(result.package,null,2);}
    async function duplicate(){const pkg=JSON.parse(await exportPackage());pkg.id=source().id.slice(0,35)+'-copy-'+Date.now().toString(36)+'-'+(++duplicateNumber);pkg.name=source().name+' copy';await manager.install(pkg);await refreshPackages();change(next=>{next.binding={mode:'package',packageId:pkg.id,version:pkg.version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});return copy(pkg);}
    async function createKind(kind){const starter=themes.personalBuiltins.find(pkg=>pkg.kind===kind);if(!starter)throw Error('Unsupported personal customization kind');const pkg=copy(starter);pkg.id=kind+'-draft-'+Date.now().toString(36)+'-'+(++duplicateNumber);pkg.name='My '+kind.replaceAll('-',' ');pkg.author='Local creator';await manager.install(pkg);await refreshPackages();change(next=>{next.binding={mode:'package',packageId:pkg.id,version:pkg.version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});report('Personal customization draft created. Export it to keep a portable copy.');return copy(pkg);}
    async function addAsset(file){if(file.size>themes.MAX_ASSET)throw Error('Artwork exceeds the 512 KiB limit');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const id=file.name.toLowerCase().replace(/\.[^.]+$/,'').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'artwork';const asset={id:/^[a-z]/.test(id)?id:'art-'+id,mime:file.type,data:btoa(binary)};if(draftKey){await manager.saveDraftAsset(draftKey,asset);stagedAssetIds.add(asset.id);}change(next=>{next.assets=(next.assets||copy(source(next).assets)).filter(item=>item.id!==asset.id);next.assets.push(asset);next.previews=(next.previews||copy(source(next).previews));if(!next.previews.length)next.previews.push(asset.id);});report(`Artwork ${asset.id} added. Use asset(${asset.id}) as a component background.`);return asset.id;}
    function setViewport(value){if(!['desktop','narrow'].includes(value))throw Error('Unsupported preview viewport');viewport=value;previewSelect.value=value;if(previewRoot){previewRoot.setAttribute('data-community-preview-width',value);previewRoot.style.setProperty('max-width',value==='narrow'?'390px':'100%');previewRoot.style.setProperty('width','100%');}return viewport;}
    packageSelect.onchange=()=>{const value=packageSelect.value;change(next=>{const [packageId,version]=value.split('@');next.binding=value==='inherit'?{mode:'inherit'}:{mode:'package',packageId,version,overrides:{}};next.css=null;next.metadata=null;next.motion=null;next.assets=null;next.previews=null;});};
    const ready=refreshPackages().then(async()=>{try{if(draft.assets)for(let index=0;index<draft.assets.length;index++){const ref=draft.assets[index];if(!ref.data){const asset=await manager.getDraftAsset(draftKey,ref.id)||source().assets.find(asset=>asset.id===ref.id);if(!asset)throw Error(`Missing draft artwork: ${ref.id}`);draft.assets[index]=copy(asset);stagedAssetIds.add(ref.id);}}checked(draft);storeDraft();}catch(error){draft=copy(saved);notice='Invalid stored draft was ignored: '+error.message;}sync();return true;}).catch(error=>{report(error.message);sync();return false;});
    return {ready,getDraft:()=>copy(draft.binding),dirty,setToken,setComponent,setLayout,setCss,undo,redo,save,discard,duplicate,createKind,reset,importPackage,exportPackage,addAsset,setViewport,destroy(){disposed=true;cleanup?.();container.remove();if(previewRoot){previewRoot.removeAttribute('data-community-preview-width');previewRoot.style.removeProperty('max-width');previewRoot.style.removeProperty('width');}}};
  }
  window.VumiroCommunityStudio={create};
})();
