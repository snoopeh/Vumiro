/* Portable community appearance contracts. No community content is stored here. */
(() => {
  'use strict';
  const SCHEMA_VERSION=1, ENGINE_VERSION=1, MAX_PACKAGE=2*1024*1024, MAX_ASSET=512*1024;
  const personalSlots={'profile-card':['profile-card','profile-banner','profile-badge'],'avatar-frame':['avatar-frame'],'profile-effect':['profile-effect']};
  const personalKinds=Object.keys(personalSlots),motionPresets=['none','ember','scan','orbit','shimmer','pulse'];
  const kindScopes=kind=>kind==='profile-card'?['profile-card']:kind==='avatar-frame'?['avatar']:kind==='profile-effect'?['profile']:['hub','space','text','voice'];
  const communitySlots=['surface','card','button','input','navigation','call-controls','heading','message','banner','badge'];
  const slots=[...communitySlots,...Object.values(personalSlots).flat()];
  const layouts={home:['compact','banner','split'],room:['standard','compact']};
  const defaults={surface:'#2b2c33',surfaceRaised:'#34363f',text:'#f0eff3',muted:'#aaa9b4',accent:'#ef7b76',accentText:'#251415',border:'#474951',success:'#83d8aa',warning:'#f0ca79',danger:'#ff9b9b',fontBody:'"Segoe UI", sans-serif',fontHeading:'"Segoe UI", sans-serif',fontSize:'14px',spacing:'12px',radius:'12px',shadow:'0 8px 24px #00000033',density:'comfortable'};
  const colorTokens=new Set(['surface','surfaceRaised','text','muted','accent','accentText','border','success','warning','danger']);
  const properties=new Set(['color','backgroundColor','backgroundImage','borderColor','borderWidth','borderStyle','borderRadius','boxShadow','fontFamily','fontSize','fontWeight','letterSpacing','padding','gap']);
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const slug=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value);
  const plain=(value,max=160)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[<>\u0000-\u001f]/.test(value);
  const color=value=>/^#[\da-f]{3,8}$/i.test(value)&&[4,5,7,9].includes(value.length)||/^(?:rgb|hsl)a?\([\d.,% /+-]+\)$/.test(value);
  const length=(value,min,max)=>/^(?:\d+(?:\.\d+)?)px$/.test(value)&&parseFloat(value)>=min&&parseFloat(value)<=max;
  const font=value=>/^(?:(?:"Segoe UI"|"Trebuchet MS"|Georgia|Arial|Verdana|Tahoma|Consolas),\s*)?(?:sans-serif|serif|monospace|system-ui)$/.test(value);
  function safeValue(property,value,assetIds){
    if(typeof value!=='string'||value.length>512||/[;{}<>@\\\u0000-\u001f]/.test(value)||/(?:url|var|expression|attr|image-set)\s*\(/i.test(value))return false;
    if(['color','backgroundColor','borderColor'].includes(property))return color(value);
    if(property==='backgroundImage')return value==='none'||/^asset\(([a-z][a-z0-9-]{0,63})\)$/.test(value)&&assetIds.has(value.slice(6,-1))||/^(?:linear-gradient\((?:\d{1,3}deg,\s*)?|radial-gradient\()#[\da-f]{3,8}(?:\s+\d{1,3}%)?(?:,\s*#[\da-f]{3,8}(?:\s+\d{1,3}%)?){1,4}\)$/i.test(value);
    if(property==='borderWidth')return length(value,0,4)||value==='0';
    if(property==='borderStyle')return ['solid','dashed','double','none'].includes(value);
    if(property==='borderRadius')return length(value,0,32)||value==='0';
    if(property==='fontSize')return length(value,12,36);
    if(property==='fontFamily')return font(value);
    if(property==='fontWeight')return /^(?:400|500|600|700|800|normal|bold)$/.test(value);
    if(property==='letterSpacing')return length(value,0,3)||value==='0';
    if(property==='padding'||property==='gap')return value.split(/\s+/).length<=4&&value.split(/\s+/).every(part=>part==='0'||length(part,0,32));
    if(property==='boxShadow')return value==='none'||/^(?:\d+(?:\.\d+)?(?:px)?\s+){2,3}#[\da-f]{3,8}$/i.test(value)&&value.split(/\s+/).slice(0,-1).every(part=>parseFloat(part)<=48);
    return false;
  }
  function checkTokens(tokens,errors){
    if(!object(tokens)){errors.push('tokens must be an object');return;}
    for(const [key,value] of Object.entries(tokens)){
      let valid=Object.hasOwn(defaults,key)&&typeof value==='string';
      if(valid&&colorTokens.has(key))valid=color(value);
      else if(valid&&['fontBody','fontHeading'].includes(key))valid=font(value);
      else if(valid&&key==='fontSize')valid=length(value,12,24);
      else if(valid&&key==='spacing')valid=length(value,4,24);
      else if(valid&&key==='radius')valid=length(value,0,32);
      else if(valid&&key==='shadow')valid=safeValue('boxShadow',value,new Set());
      else if(valid&&key==='density')valid=['comfortable','compact'].includes(value);
      if(!valid)errors.push(`Unsupported token or value: ${key}`);
    }
  }
  function checkComponents(components,ids,errors){
    if(!object(components)){errors.push('components must be an object');return;}
    for(const [slot,styles] of Object.entries(components)){
      if(!slots.includes(slot)||!object(styles)){errors.push(`Unsupported component slot: ${slot}`);continue;}
      for(const [property,value] of Object.entries(styles))if(!properties.has(property)||!safeValue(property,value,ids))errors.push(`Unsafe component style: ${slot}.${property}`);
    }
  }
  const camel=value=>value.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
  const kebab=value=>value.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
  function parseCss(css,ids,errors){
    if(typeof css!=='string'||css.length>16000||/[@\\<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|\/\*|\*\//.test(css)){errors.push('CSS contains prohibited syntax');return [];}
    const rules=[];let end=0;const pattern=/([^{}]+)\{([^{}]*)\}/g;let match;
    while((match=pattern.exec(css))){
      if(css.slice(end,match.index).trim())errors.push('CSS must contain scoped declaration blocks');end=pattern.lastIndex;
      const selector=match[1].trim(),slotPattern='(?:'+slots.join('|')+')';
      if(!new RegExp('^\\[data-community-slot="'+slotPattern+'"\\](?::(?:hover|focus-visible|disabled))?$').test(selector)){errors.push('CSS selector must target one documented component slot');continue;}
      const declarations=[];
      for(const declaration of match[2].split(';').filter(value=>value.trim())){
        const separator=declaration.indexOf(':');if(separator<0){errors.push('Invalid CSS declaration');continue;}
        const property=camel(declaration.slice(0,separator).trim()),value=declaration.slice(separator+1).trim();
        if(!properties.has(property)||!safeValue(property,value,ids))errors.push(`Unsafe CSS property or value: ${property}`);
        else declarations.push([property,value]);
      }
      rules.push({selector,declarations});
    }
    if(css.slice(end).trim())errors.push('CSS must contain scoped declaration blocks');
    return rules;
  }
  function validate(input){
    const errors=[];let pkg;
    try{
      if(typeof input==='string'){if(input.length>MAX_PACKAGE||input.startsWith('PK'))throw Error('Only bounded JSON .vumirotheme packages are supported; archives are rejected');pkg=JSON.parse(input);}
      else pkg=copy(input);
      if(!object(pkg)||JSON.stringify(pkg).length>MAX_PACKAGE)throw Error('Invalid or oversized theme package');
      const allowed=new Set(['format','schemaVersion','kind','id','name','version','author','description','license','compatibility','tokens','components','layouts','css','assets','previews','motion']);
      for(const key of Object.keys(pkg))if(!allowed.has(key))errors.push(`Unsupported package field: ${key}`);
      if(pkg.format!=='vumirotheme'||pkg.schemaVersion!==SCHEMA_VERSION)errors.push('Unsupported theme format/schemaVersion');
      if(pkg.kind!==undefined&&!['theme','decorative-pack',...personalKinds].includes(pkg.kind))errors.push('Unsupported package kind');
      if((pkg.kind==='decorative-pack'||personalKinds.includes(pkg.kind))&&(Object.keys(pkg.tokens||{}).length||Object.keys(pkg.layouts||{}).length))errors.push('Decorative packages may style documented component slots only; tokens and layouts must be empty');
      if(personalKinds.includes(pkg.kind)&&Object.keys(pkg.components||{}).some(slot=>!personalSlots[pkg.kind].includes(slot)))errors.push('Personal cosmetic contains a component outside its target');
      if(!personalKinds.includes(pkg.kind)&&Object.keys(pkg.components||{}).some(slot=>!communitySlots.includes(slot)))errors.push('Community themes cannot target personal profile slots');
      if(!slug(pkg.id)||!plain(pkg.name)||!plain(pkg.author))errors.push('Package id, name and author are required plain metadata');
      if(typeof pkg.version!=='string'||!/^\d+\.\d+\.\d+$/.test(pkg.version))errors.push('Package version must be major.minor.patch');
      if(!object(pkg.compatibility)||pkg.compatibility.engine!==ENGINE_VERSION||Object.keys(pkg.compatibility).some(key=>key!=='engine'))errors.push('Unsupported engine compatibility');
      for(const key of ['description','license'])if(pkg[key]!==undefined&&!plain(pkg[key],2000))errors.push(`Invalid ${key}`);
      const ids=new Set();
      if(!Array.isArray(pkg.assets)||pkg.assets.length>16)errors.push('assets must be an array of at most 16 raster files');
      else for(const asset of pkg.assets){
        if(!object(asset)||Object.keys(asset).some(key=>!['id','mime','data'].includes(key))||!slug(asset.id)||ids.has(asset.id)||!['image/png','image/jpeg','image/webp','image/gif'].includes(asset.mime)||typeof asset.data!=='string'||asset.data.length>Math.ceil(MAX_ASSET/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(asset.data)||asset.data.length%4){errors.push('Invalid raster asset');continue;}
        try{const bytes=atob(asset.data),signature=asset.mime==='image/png'?bytes.startsWith('\x89PNG\r\n\x1a\n'):asset.mime==='image/jpeg'?bytes.startsWith('\xff\xd8\xff'):asset.mime==='image/gif'?/^GIF8[79]a/.test(bytes):bytes.startsWith('RIFF')&&bytes.slice(8,12)==='WEBP';if(!signature)errors.push(`Invalid image signature: ${asset.id}`);}catch{errors.push(`Invalid asset encoding: ${asset.id}`);}
        ids.add(asset.id);
      }
      if(!Array.isArray(pkg.previews)||pkg.previews.length>4||pkg.previews.some(id=>!ids.has(id)))errors.push('previews must reference existing assets');
      checkTokens(pkg.tokens,errors);checkComponents(pkg.components,ids,errors);
      if(!object(pkg.layouts)||Object.keys(pkg.layouts).some(key=>!Object.hasOwn(layouts,key)))errors.push('Invalid layouts');
      else for(const [kind,values] of Object.entries(pkg.layouts))if(!Array.isArray(values)||!values.length||values.some(value=>!layouts[kind].includes(value)))errors.push(`Unsupported ${kind} layout`);
      if(pkg.motion!==undefined&&!motionPresets.includes(pkg.motion))errors.push('Unsupported motion preset');
      const cssRules=parseCss(pkg.css,ids,errors);
      if(personalKinds.includes(pkg.kind)&&cssRules.some(rule=>!personalSlots[pkg.kind].some(slot=>rule.selector.startsWith(`[data-community-slot="${slot}"]`))))errors.push('Personal cosmetic CSS must target its documented personal slots');
      if(!personalKinds.includes(pkg.kind)&&cssRules.some(rule=>!communitySlots.some(slot=>rule.selector.startsWith(`[data-community-slot="${slot}"]`))))errors.push('Community CSS cannot target personal profile slots');
    }catch(error){errors.push(error.message||'Invalid package');}
    return {valid:errors.length===0,errors,package:errors.length?null:pkg};
  }
  function requirePackage(pkg){const result=validate(pkg);if(!result.valid)throw Error(result.errors.join('; '));return result.package;}
  function showcase(id,name,tokens,components,css='',motion='none'){return {format:'vumirotheme',schemaVersion:1,id,name,version:'1.0.0',author:'Vumiro',description:'Original CSS artwork, local fonts, and app-owned accessible components.',license:'CC0-1.0',compatibility:{engine:1},tokens:{...defaults,...tokens},components,layouts:{home:['compact','banner','split'],room:['standard','compact']},css,assets:[],previews:[],motion};}
  const builtins=[
    showcase('baseline','Vumiro baseline',{},{}),
    showcase('viking','Ember & Oak',{surface:'#191b17',surfaceRaised:'#27291f',text:'#f1ead8',muted:'#c1b99f',accent:'#dfb575',accentText:'#241b10',border:'#62513c',fontHeading:'Georgia, serif',radius:'6px',shadow:'0 8px 24px #00000055'},{card:{borderWidth:'2px',borderStyle:'double',borderColor:'#827055',backgroundImage:'linear-gradient(135deg, #292b20, #1d211b)'},banner:{backgroundImage:'radial-gradient(#695537, #242a20)',borderColor:'#af8e56'},heading:{letterSpacing:'1px'}},'[data-community-slot="badge"] {border-color:#bfa572; border-radius:4px}', 'ember'),
    showcase('cyberpunk','Signal / Neon',{surface:'#111322',surfaceRaised:'#1b1d33',text:'#e4f1ff',muted:'#a7b9d3',accent:'#6ff5e5',accentText:'#082827',border:'#4b4a79',fontHeading:'Consolas, monospace',radius:'2px',shadow:'0 8px 24px #090d2455'},{card:{borderWidth:'1px',borderStyle:'solid',borderColor:'#7460bb',backgroundImage:'linear-gradient(135deg, #25243c, #171e31)'},banner:{backgroundImage:'linear-gradient(135deg, #442751, #163c44)'},heading:{letterSpacing:'2px'}},'[data-community-slot="badge"] {color:#ffb8ef; border-color:#a967cb; border-radius:2px}', 'scan')
  ];
  function personal(id,name,kind,components,motion='none'){return {...showcase(id,name,{},components,'',motion),kind,tokens:{},layouts:{},description:'Original Vumiro cosmetic artwork with app-owned bounded motion and a static reduced-motion presentation.'};}
  const personalBuiltins=[
    personal('celestial-orbit','Celestial Orbit','avatar-frame',{'avatar-frame':{borderColor:'#aa9af7',borderWidth:'3px',borderStyle:'double',boxShadow:'0 0 14px #a99bff99',backgroundImage:'linear-gradient(135deg, #7eddec, #b58ff4, #ecd99b)'}},'orbit'),
    personal('ember-crown','Ember Crown','avatar-frame',{'avatar-frame':{borderColor:'#e3ab65',borderWidth:'3px',borderStyle:'double',boxShadow:'0 0 16px #ce884466',backgroundImage:'linear-gradient(135deg, #e9c28a, #965a3b, #eccb93)'}},'pulse'),
    personal('neon-circuit','Neon Circuit','avatar-frame',{'avatar-frame':{borderColor:'#61e1d3',borderWidth:'2px',borderStyle:'solid',boxShadow:'0 0 12px #39cfbf66',backgroundImage:'linear-gradient(135deg, #64efdc, #7994f8, #e0a6ef)'}},'shimmer'),
    personal('gilded-portrait','Gilded Portrait','profile-card',{'profile-card':{borderColor:'#ceb47d',borderWidth:'3px',borderStyle:'double',boxShadow:'0 0 18px #b7945533'},'profile-banner':{backgroundImage:'linear-gradient(135deg, #32271f, #665335)',borderColor:'#9c8058'},'profile-badge':{color:'#e2cba4',borderColor:'#b99a65'}},'shimmer'),
    personal('prismatic-card','Prismatic Card','profile-card',{'profile-card':{borderColor:'#9982c7',borderWidth:'2px',borderStyle:'solid',boxShadow:'0 0 20px #8266c344'},'profile-banner':{backgroundImage:'linear-gradient(135deg, #352a4c, #1d4149)'}},'none'),
    personal('aurora-drift','Aurora Drift','profile-effect',{'profile-effect':{backgroundImage:'linear-gradient(135deg, #397f83, #6d5191, #2b6c68)',borderColor:'#6bcbbf',boxShadow:'0 0 24px #75c7b933'}},'pulse')
  ];
  function resolve({bindings=[],packages=builtins,preferences={}}={}){
    const warnings=[],available=[...builtins,...packages].reverse();let selected=copy(builtins[0]),tokens={...defaults},components={},css='',assets=[],motion='none',layout={home:'compact',room:'standard'};
    function select(pkg){selected=copy(pkg);tokens={...defaults,...pkg.tokens};components=copy(pkg.components);css=pkg.css;assets=copy(pkg.assets);motion=pkg.motion||'none';layout={home:pkg.layouts.home?.[0]||'compact',room:pkg.layouts.room?.[0]||'standard'};}
    function decorate(pkg){
      const decoration=copy(pkg),ids=new Set(assets.map(asset=>asset.id)),renames=new Map();let index=0;
      for(const asset of decoration.assets){let id=asset.id;if(ids.has(id)){do{id='decoration-'+(++index);}while(ids.has(id));renames.set(asset.id,id);asset.id=id;}ids.add(id);}
      const rewrite=value=>typeof value==='string'?value.replace(/asset\(([a-z][a-z0-9-]{0,63})\)/g,(_,id)=>`asset(${renames.get(id)||id})`):value;
      for(const styles of Object.values(decoration.components))for(const key of Object.keys(styles))styles[key]=rewrite(styles[key]);
      for(const [slot,styles] of Object.entries(decoration.components))components[slot]={...components[slot],...styles};
      css+=' '+rewrite(decoration.css);assets.push(...decoration.assets);if(decoration.motion&&decoration.motion!=='none')motion=decoration.motion;
    }
    for(const binding of bindings.filter(Boolean)){
      if(binding.mode!=='inherit'&&binding.packageId){const pkg=available.find(entry=>entry.id===binding.packageId&&entry.version===(binding.version||'1.0.0'));const result=pkg&&validate(pkg);if(!result?.valid){warnings.push(`Theme unavailable: ${binding.packageId}@${binding.version||'1.0.0'}`);select(builtins[0]);}else if(pkg.kind==='decorative-pack')decorate(result.package);else select(result.package);}
      const overrides=binding.overrides;if(!overrides)continue;
      const errors=[],ids=new Set(assets.map(asset=>asset.id));
      if(!object(overrides)||Object.keys(overrides).some(key=>!['tokens','components','layout'].includes(key))){warnings.push('Unsupported scope override');continue;}
      if(overrides.tokens)checkTokens(overrides.tokens,errors);
      if(overrides.components)checkComponents(overrides.components,ids,errors);
      if(overrides.layout&&(!object(overrides.layout)||Object.entries(overrides.layout).some(([kind,value])=>!selected.layouts[kind]?.includes(value))))errors.push('Unsupported scope layout');
      if(errors.length){warnings.push(...errors);continue;}
      Object.assign(tokens,overrides.tokens);for(const [slot,styles] of Object.entries(overrides.components||{}))components[slot]={...components[slot],...styles};Object.assign(layout,overrides.layout);
    }
    if(preferences.simplified){tokens={...tokens,fontBody:defaults.fontBody,fontHeading:defaults.fontHeading,shadow:'none',radius:defaults.radius};components={};css='';assets=[];motion='none';}
    if(preferences.reducedMotion){motion='none';if(personalKinds.includes(selected.kind)){for(const styles of Object.values(components))if(styles.backgroundImage?.startsWith('asset('))styles.backgroundImage='none';css=css.replace(/asset\([a-z][a-z0-9-]{0,63}\)/g,'none');assets=[];}}
    if(preferences.highContrast){tokens={...tokens,surface:'#080c10',surfaceRaised:'#2b2c33',text:'#ffffff',muted:'#d5e0eb',border:'#b8c9da',accent:'#96f5e8',accentText:'#061a17'};components={};css='';}
    if(preferences.fontScale&&Number.isFinite(preferences.fontScale))tokens.fontSize=Math.max(12,Math.min(28,parseFloat(tokens.fontSize)*Math.max(1,Math.min(1.5,preferences.fontScale))))+'px';
    return {packageId:selected.id,version:selected.version,kind:selected.kind||'theme',tokens,components,css,assets,motion,layout,warnings};
  }
  function createMemoryAdapter(){const records=new Map();return {persistent:false,async put(key,value){records.set(key,copy(value));},async get(key){return records.has(key)?copy(records.get(key)):null;},async remove(key){records.delete(key);}};}
  function createIndexedDBAdapter({indexedDB=window.indexedDB,name='vumiro-community-theme-assets'}={}){
    let opening;
    function database(){if(!indexedDB)return Promise.reject(Error('IndexedDB is unavailable; theme assets cannot be persisted'));if(!opening)opening=new Promise((accept,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('assets'))request.result.createObjectStore('assets');};request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};accept(request.result);};request.onerror=()=>{opening=null;reject(request.error||Error('Could not open theme assets'));};request.onblocked=()=>{opening=null;reject(Error('Theme asset database is blocked by another window'));};});return opening;}
    async function operation(mode,action){const db=await database();return new Promise((accept,reject)=>{const transaction=db.transaction('assets',mode);let result;const request=action(transaction.objectStore('assets'));request.onsuccess=()=>{result=request.result;};transaction.oncomplete=()=>accept(result??null);transaction.onerror=()=>reject(transaction.error||request.error||Error('Theme asset write failed'));transaction.onabort=()=>reject(transaction.error||Error('Theme asset transaction aborted'));});}
    return {persistent:true,put:(key,value)=>operation('readwrite',store=>store.put(value,key)),get:key=>operation('readonly',store=>store.get(key)),remove:key=>operation('readwrite',store=>store.delete(key))};
  }
  function createManager({adapter,metadataStorage,storageKey='vumiro.community.theme-packages.v1'}={}){
    let warning='',records=[];
    if(!adapter){try{adapter=window.indexedDB?createIndexedDBAdapter():createMemoryAdapter();}catch{adapter=createMemoryAdapter();warning='Persistent assets are unavailable; theme imports use session storage.';}}
    try{
      metadataStorage=metadataStorage||window.localStorage;const raw=metadataStorage?.getItem(storageKey);
      if(raw){
        const parsed=JSON.parse(raw);if(!Array.isArray(parsed)||parsed.length>500)throw Error('Invalid stored metadata index');
        const signatures={'image/png':'iVBORw0KGgo=','image/jpeg':'/9j/','image/gif':'R0lGODlh','image/webp':'UklGRgAAAABXRUJQ'};
        for(const item of parsed){if(!object(item)||!Array.isArray(item.assets)||item.assets.some(ref=>!object(ref)||Object.keys(ref).some(key=>!['id','mime'].includes(key))))throw Error('Invalid stored metadata entry');const test={...item,assets:item.assets.map(ref=>({...ref,data:signatures[ref.mime]}))};if(!validate(test).valid)throw Error('Invalid stored metadata entry');records.push(copy(item));}
      }
    }catch{records=[];metadataStorage=null;warning='Stored theme metadata is unavailable or invalid; using session storage. Original stored metadata was preserved.';}
    if(!metadataStorage||adapter.persistent===false)warning=warning||'Persistent storage is unavailable; theme packages use session storage. Export them to keep a copy.';
    let writes=Promise.resolve();
    const sequential=action=>{const result=writes.then(action);writes=result.catch(()=>{});return result;};
    const assetKey=(pkg,id)=>`${pkg.id}@${pkg.version}/${id}`;
    function persist(next){metadataStorage?.setItem(storageKey,JSON.stringify(next));records=next;}
    async function hydrate(pkg){const complete={...copy(pkg),assets:[]};for(const ref of pkg.assets){const asset=await adapter.get(assetKey(pkg,ref.id));if(!asset)throw Error(`Missing asset: ${ref.id}`);complete.assets.push(asset);}return requirePackage(complete);}
    async function find(id,version){const builtin=builtins.find(pkg=>pkg.id===id&&pkg.version===version);if(builtin)return copy(builtin);const pkg=records.find(pkg=>pkg.id===id&&pkg.version===version);if(!pkg)throw Error(`Theme unavailable: ${id}@${version}`);return hydrate(pkg);}
    async function all(bindings){const selected=new Set(bindings.filter(Boolean).map(binding=>binding.packageId+'@'+(binding.version||'1.0.0'))),packages=[...builtins];for(const pkg of records)if(selected.has(pkg.id+'@'+pkg.version))try{packages.push(await hydrate(pkg));}catch{}return packages;}
    return {
      persistent:!!metadataStorage&&adapter.persistent!==false,
      warning,
      validate,
      async saveDraftAsset(key,asset){requirePackage({...copy(builtins[0]),assets:[asset]});await adapter.put(`draft/${encodeURIComponent(key)}/${asset.id}`,copy(asset));},
      getDraftAsset:(key,id)=>adapter.get(`draft/${encodeURIComponent(key)}/${id}`),
      removeDraftAsset:(key,id)=>adapter.remove(`draft/${encodeURIComponent(key)}/${id}`),
      list:async()=>copy(records),
      get:find,
      install:input=>sequential(async()=>{const pkg=requirePackage(input),previous=records.find(entry=>entry.id===pkg.id&&entry.version===pkg.version)||builtins.find(entry=>entry.id===pkg.id&&entry.version===pkg.version);if(previous){const existing=await find(pkg.id,pkg.version);if(JSON.stringify(existing)!==JSON.stringify(pkg))throw Error('This theme version is already installed; increment the version');return copy(pkg);}const written=[];try{for(const asset of pkg.assets){const key=assetKey(pkg,asset.id);await adapter.put(key,asset);written.push(key);}const metadata={...pkg,assets:pkg.assets.map(({id,mime})=>({id,mime}))};persist([...records,metadata]);return copy(pkg);}catch(error){for(const key of written)try{await adapter.remove(key);}catch{}throw error;}}),
      preview:async(binding,{bindings=[],preferences={}}={})=>resolve({bindings:[...bindings,binding],packages:await all([...bindings,binding]),preferences}),
      apply:async(binding,{target,bindings=[],preferences={},root}={})=>{if(binding.mode!=='inherit')await find(binding.packageId,binding.version||'1.0.0');const packages=await all([...bindings,binding]),own=resolve({bindings:[binding],packages});if(own.warnings.length)throw Error(own.warnings.join('; '));const resolved=resolve({bindings:[...bindings,binding],packages,preferences});if(root)applyToRoot(root,resolved);return {...copy(binding),...(target?{target:copy(target)}:{})};},
      export:async(id,version)=>JSON.stringify(await find(id,version),null,2),
      uninstall:(id,version)=>sequential(async()=>{const pkg=records.find(entry=>entry.id===id&&entry.version===version);if(!pkg)return false;persist(records.filter(entry=>entry!==pkg));for(const asset of pkg.assets)await adapter.remove(assetKey(pkg,asset.id));return true;})
    };
  }
  const applications=new WeakMap();let rootCounter=0;
  function applyToRoot(root,resolved){
    if(!root?.ownerDocument||!root.style)throw Error('A community styling root is required');applications.get(root)?.();
    const id='community-theme-'+(++rootCounter),selector=`[data-community-theme-root="${id}"]`,style=root.ownerDocument.createElement('style'),keys=[];
    root.setAttribute('data-community-theme-root',id);root.setAttribute('data-community-motion',resolved.motion||'none');
    for(const [token,value] of Object.entries(resolved.tokens)){const key='--community-'+kebab(token);root.style.setProperty(key,value);keys.push(key);}
    const assetIds=new Set(resolved.assets.map(asset=>asset.id)),assetUrls=new Map();
    const renderedValue=value=>value.replace(/^asset\(([a-z][a-z0-9-]*)\)$/,(_,id)=>{const asset=resolved.assets.find(entry=>entry.id===id);if(!asset)return 'none';if(!assetUrls.has(id)){let url;try{if(typeof URL.createObjectURL==='function'&&typeof Blob==='function'){const data=atob(asset.data),bytes=Uint8Array.from(data,character=>character.charCodeAt(0));url=URL.createObjectURL(new Blob([bytes],{type:asset.mime}));}}catch{}assetUrls.set(id,url||`data:${asset.mime};base64,${asset.data}`);}return `url("${assetUrls.get(id)}")`;});
    const declarations=styles=>Object.entries(styles).filter(([property,value])=>properties.has(property)&&safeValue(property,value,assetIds)).map(([property,value])=>`${kebab(property)}:${renderedValue(value)} !important`).join(';');
    let css=`${selector}{color:var(--community-text);background:var(--community-surface);font-family:var(--community-font-body);font-size:var(--community-font-size)}\n${selector} [data-community-slot="heading"]{font-family:var(--community-font-heading)}\n`;
    const rootSlot=slotSelector=>`${selector}${slotSelector},${selector} ${slotSelector}`;
    // Reset decoration, preserving the app's heading hierarchy, control sizing and layout.
    for(const slot of personalKinds.includes(resolved.kind)?personalSlots[resolved.kind]:communitySlots){
      const base={color:resolved.tokens.text,backgroundColor:slot==='heading'?'#00000000':['surface','message'].includes(slot)?resolved.tokens.surface:resolved.tokens.surfaceRaised,backgroundImage:'none',borderColor:resolved.tokens.border,borderWidth:['surface','heading','navigation','message','call-controls'].includes(slot)?'0':'1px',borderStyle:'solid',borderRadius:resolved.tokens.radius,boxShadow:slot==='card'?resolved.tokens.shadow:'none',fontFamily:slot==='heading'?resolved.tokens.fontHeading:resolved.tokens.fontBody,letterSpacing:'0'};
      css+=`${rootSlot(`[data-community-slot="${slot}"]`)}{${declarations({...base,...resolved.components[slot]})}}\n`;
    }
    for(const rule of parseCss(resolved.css,assetIds,[]))css+=`${rootSlot(rule.selector)}{${declarations(Object.fromEntries(rule.declarations))}}\n`;
    // App-owned action semantics follow package decoration. Selectors cover the root
    // itself as well as descendants, and outrank the permitted slot pseudo-classes.
    const button='[data-community-slot="button"]',neutral=`${button}:not([data-variant="primary"]):not([data-variant="quiet"]):not([data-variant="danger"])`;
    const variantSelectors=[neutral,...['primary','secondary','quiet','danger'].map(variant=>`${button}[data-variant="${variant}"]`)];
    const variantColors=[['surface-raised','text','border'],['accent','accent-text','accent'],['surface-raised','text','border'],[null,'muted',null],[null,'danger','danger']];
    for(let index=0;index<variantSelectors.length;index++){
      const [background,color,border]=variantColors[index];
      css+=`${rootSlot(variantSelectors[index])}{background-color:${background?`var(--community-${background})`:'transparent'} !important;color:var(--community-${color}) !important;border-color:${border?`var(--community-${border})`:'transparent'} !important;background-image:none !important;box-shadow:none !important}\n`;
    }
    for(const state of ['[aria-selected="true"]','[aria-current="page"]','[data-selected="true"]']){
      css+=`${variantSelectors.map(variant=>rootSlot(variant+state)).join(',')}{background-color:var(--community-surface-raised) !important;color:var(--community-text) !important;border-color:var(--community-border) !important;box-shadow:inset 3px 0 0 var(--community-accent) !important}\n`;
    }
    // Motion uses app-owned, bounded color effects. Packages cannot define animations or geometry.
    if(resolved.motion!=='none')css+=`@keyframes ${id}-glow{from{border-color:var(--community-border)}to{border-color:var(--community-accent)}}${selector} [data-community-slot="banner"]{animation:${id}-glow 5s ease-in-out infinite alternate}@media(prefers-reduced-motion:reduce){${selector} *{animation:none!important;transition:none!important}}`;
    css+=`${selector} :focus-visible{outline:2px solid var(--community-accent)!important;outline-offset:3px!important}${selector} [data-community-slot="navigation"],${selector} [data-community-slot="call-controls"]{position:relative;visibility:visible!important;opacity:1!important;pointer-events:auto!important;min-height:32px}`;
    if(resolved.motion==='none')css+=`${selector} *,${selector} *::before,${selector} *::after{animation:none!important;transition:none!important}`;
    style.textContent=css;root.append(style);let active=true;
    const cleanup=()=>{if(!active)return;active=false;style.remove();for(const url of assetUrls.values())if(url.startsWith('blob:'))URL.revokeObjectURL?.(url);for(const key of keys)root.style.removeProperty(key);root.removeAttribute('data-community-theme-root');root.removeAttribute('data-community-motion');applications.delete(root);};applications.set(root,cleanup);return cleanup;
  }
  (typeof window==='undefined'?globalThis:window).VumiroCommunityThemes={SCHEMA_VERSION,ENGINE_VERSION,MAX_PACKAGE,MAX_ASSET,slots:copy(slots),communitySlots:copy(communitySlots),layouts:copy(layouts),tokenDefaults:copy(defaults),builtins,personalBuiltins,personalKinds:copy(personalKinds),personalSlots:copy(personalSlots),motionPresets:copy(motionPresets),kindScopes,validate,resolve,applyToRoot,createMemoryAdapter,createIndexedDBAdapter,createManager};
})();
