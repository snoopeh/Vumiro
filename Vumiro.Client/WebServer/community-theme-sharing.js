/* Authenticated distribution of validated, portable community theme packages. */
(() => {
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const hashId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
  const imageTypes=new Set(['image/png','image/jpeg','image/webp']);
  const signatures={'image/png':'iVBORw0KGgo=','image/jpeg':'/9j/','image/webp':'UklGRgAAAABXRUJQ'};
  const exactKeys=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
  function create({manager,live}={}){
    const themes=window.VumiroCommunityThemes;
    if(!themes||!manager?.get||!manager?.install||!live?.assetUpload||!live?.assetRead)throw Error('Theme sharing requires the shared theme engine, manager, and authenticated community transport.');
    const builtin=binding=>themes.builtins.some(pkg=>pkg.id===binding?.packageId&&pkg.version===(binding.version||'1.0.0'));
    function checked(pkg){const result=themes.validate(pkg);if(!result.valid)throw Error('Invalid shared theme: '+result.errors.join('; '));return result.package;}
    function checkBinding(binding,pkg){if(!object(binding)||binding.packageId!==pkg.id||(binding.version||'1.0.0')!==pkg.version)throw Error('Shared theme manifest does not match its binding.');const resolved=themes.resolve({bindings:[binding],packages:[pkg]});if(resolved.warnings.length)throw Error('Invalid shared theme binding: '+resolved.warnings.join('; '));}
    function sharedType(mime){if(!imageTypes.has(mime))throw Error('Shared theme format is unsupported. GIF artwork remains local-only; use PNG, JPEG, or WebP for shared communities.');}
    function encode(bytes){let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
    async function digest(bytes){const cryptoApi=window.crypto||(typeof crypto!=='undefined'?crypto:null);if(!cryptoApi?.subtle)throw Error('Secure theme asset verification is unavailable.');return encode(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
    function inspect(binding){
      const shared=binding.sharedPackage;
      if(!exactKeys(shared,['manifest','assets'])||JSON.stringify(shared).length>themes.MAX_PACKAGE)throw Error('Invalid or oversized shared theme manifest.');
      const manifest=copy(shared.manifest);
      if(!object(manifest)||!Array.isArray(manifest.assets)||manifest.assets.length>16||!Array.isArray(shared.assets)||shared.assets.length!==manifest.assets.length)throw Error('Shared theme asset references are missing or invalid.');
      const ids=new Set(),refs=new Map();
      for(const ref of shared.assets){if(!exactKeys(ref,['id','assetId'])||typeof ref.id!=='string'||ids.has(ref.id)||!hashId(ref.assetId))throw Error('Invalid shared asset ID/reference.');ids.add(ref.id);refs.set(ref.id,ref.assetId);}
      const descriptors=[];
      for(const asset of manifest.assets){if(!exactKeys(asset,['id','mime'])||!refs.has(asset.id))throw Error('Invalid shared asset descriptor. Raster data must remain outside the shared manifest.');sharedType(asset.mime);descriptors.push({...asset});}
      // The same validator checks metadata, slots, CSS and references before any asset read.
      const skeleton=checked({...manifest,assets:descriptors.map(asset=>({...asset,data:signatures[asset.mime]}))});checkBinding(binding,skeleton);
      return {manifest,descriptors,refs,key:manifest.id+'@'+manifest.version,signature:JSON.stringify(shared)};
    }
    async function publishBinding(scopeId,binding){
      if(!binding||binding.mode==='inherit'||builtin(binding))return copy(binding||{mode:'inherit'});
      const pkg=checked(await manager.get(binding.packageId,binding.version||'1.0.0'));checkBinding(binding,pkg);
      for(const asset of pkg.assets)sharedType(asset.mime);
      const refs=[];
      for(const asset of pkg.assets){const bytes=Uint8Array.from(atob(asset.data),character=>character.charCodeAt(0)),blob=new Blob([bytes],{type:asset.mime}),expected=await digest(bytes),result=await live.assetUpload(scopeId,blob);if(!hashId(result?.assetId)||result.assetId!==expected)throw Error('Invalid shared asset ID/reference returned by the community service.');refs.push({id:asset.id,assetId:result.assetId});}
      const manifest={...pkg,assets:pkg.assets.map(({id,mime})=>({id,mime}))};
      return {...copy(binding),sharedPackage:{manifest,assets:refs}};
    }
    async function hydrate(bindings){
      if(!Array.isArray(bindings)||bindings.length>2048)throw Error('Invalid or oversized shared theme binding list.');
      const jobs=new Map();
      // Validate the entire set first, including conflicting versions, before downloading.
      for(const binding of bindings){if(!binding||binding.mode==='inherit'||builtin(binding))continue;if(!object(binding))throw Error('Invalid shared theme binding.');const job=inspect(binding),existing=jobs.get(job.key);if(existing&&existing.signature!==job.signature)throw Error('Conflicting shared theme manifests for '+job.key);jobs.set(job.key,job);}
      const packages=[],downloaded=new Map();
      for(const job of jobs.values()){
        const pkg={...job.manifest,assets:[]};let encodedLength=JSON.stringify(pkg).length;
        for(const descriptor of job.descriptors){
          const id=job.refs.get(descriptor.id),cacheKey=id+'/'+descriptor.mime;let data=downloaded.get(cacheKey);
          if(!data){
            // Always authorize reads for each hydration, even when an installed copy exists.
            const blob=await live.assetRead(id);
            if(!blob||blob.type!==descriptor.mime||!Number.isInteger(blob.size)||blob.size<=0||blob.size>themes.MAX_ASSET||typeof blob.arrayBuffer!=='function')throw Error('Shared theme raster asset has an invalid content type or size.');
            const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.byteLength!==blob.size||bytes.byteLength>themes.MAX_ASSET)throw Error('Shared theme raster asset exceeds its declared size.');
            if(await digest(bytes)!==id)throw Error('Shared theme asset hash does not match its authenticated reference.');data=encode(bytes);downloaded.set(cacheKey,data);
          }
          encodedLength+=data.length;if(encodedLength>themes.MAX_PACKAGE)throw Error('Reconstructed shared theme package is too large.');pkg.assets.push({...descriptor,data});
        }
        packages.push(checked(pkg));
      }
      for(const pkg of packages)await manager.install(pkg);
      return copy(packages);
    }
    return Object.freeze({publishBinding,hydrate});
  }
  window.VumiroCommunityThemeSharing=Object.freeze({create});
})();
