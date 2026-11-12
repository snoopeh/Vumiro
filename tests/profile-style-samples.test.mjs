import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../Vumiro.Client/WebServer/',import.meta.url);
function load(){const context={window:{},atob,console};vm.createContext(context);for(const name of ['community-themes.js','profile-style-samples.js','marketplace-model.js']){const path=new URL(name,root);if(fs.existsSync(path))vm.runInContext(fs.readFileSync(path,'utf8'),context);}return context.window;}
// Walk the real GIF blocks, including every image's LZW data and terminator.
function gifFrames(bytes){assert.equal(bytes.subarray(0,6).toString(),'GIF89a');let i=13,frames=0;const skipTable=packed=>packed&128?3*(2**((packed&7)+1)):0;i+=skipTable(bytes[10]);const blocks=()=>{while(true){assert.ok(i<bytes.length,'terminated GIF data');const size=bytes[i++];if(!size)return;i+=size;assert.ok(i<=bytes.length);}};while(i<bytes.length){const marker=bytes[i++];if(marker===0x3b){assert.equal(i,bytes.length);return frames;}if(marker===0x21){i++;blocks();}else if(marker===0x2c){assert.ok(i+9<bytes.length);const packed=bytes[i+8];i+=9+skipTable(packed);i++;blocks();frames++;}else assert.fail('Invalid GIF block '+marker);}assert.fail('Missing GIF trailer');}
test('three original collections contain matching avatar and user-card packages with real looping GIF animation',()=>{
  const w=load();assert.ok(w.VumiroProfileStyleSamples,'original GIF sample collection exists');const packages=w.VumiroProfileStyleSamples.packages();assert.equal(packages.length,6);
  for(const collection of ['astral-tide','sakura-glass','ember-forge'])for(const kind of ['avatar-frame','profile-card']){const pkg=packages.find(p=>p.id===collection+'-'+kind);assert.ok(pkg);const valid=w.VumiroCommunityThemes.validate(pkg);assert.equal(valid.valid,true,valid.errors.join('; '));assert.equal(pkg.license,'CC0-1.0');assert.equal(pkg.assets.length,1);const asset=pkg.assets[0],bytes=Buffer.from(asset.data,'base64');assert.equal(asset.mime,'image/gif');assert.ok(bytes.length<512*1024);assert.ok(gifFrames(bytes)>=16);assert.ok(bytes.includes(Buffer.from('NETSCAPE2.0')),'GIF loops');assert.equal(pkg.components[kind].backgroundImage,'asset('+asset.id+')');assert.ok(pkg.components[kind].backgroundColor);assert.equal(pkg.motion,'none','GIF owns animation, no extra CSS pulsing');}
});
test('GIF collections join the existing demo marketplace as free personal samples without modifying builtins',()=>{
  const w=load();assert.ok(w.VumiroProfileStyleSamples,'sample API');const catalog=w.VumiroMarketplaceModel.sampleCatalog(w.VumiroCommunityThemes);
  for(const pkg of w.VumiroProfileStyleSamples.packages()){const item=catalog.find(i=>i.id==='sample-'+pkg.id);assert.ok(item,'sample listing for '+pkg.id);assert.equal(item.priceCents,0);assert.equal(item.sample,true);assert.equal(item.kind,pkg.kind);assert.match(item.description,/animated GIF/);assert.equal(item.package.assets[0].data,pkg.assets[0].data);}
  const first=w.VumiroProfileStyleSamples.packages();first[0].assets[0].data='mutated';assert.notEqual(w.VumiroProfileStyleSamples.packages()[0].assets[0].data,'mutated');
});
test('reduced motion releases GIF payloads and retains visible static colors for both frame shapes',()=>{
  const w=load();assert.ok(w.VumiroProfileStyleSamples,'sample API');for(const pkg of w.VumiroProfileStyleSamples.packages()){const appearance=w.VumiroCommunityThemes.resolve({packages:[pkg],bindings:[{packageId:pkg.id,version:pkg.version}],preferences:{reducedMotion:true}});assert.equal(appearance.assets.length,0);assert.equal(appearance.components[pkg.kind].backgroundImage,'none');assert.equal(appearance.components[pkg.kind].backgroundColor,pkg.components[pkg.kind].backgroundColor);}
});
