import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

const script=new URL('../scripts/Prepare-AndroidAssets.mjs',import.meta.url);
async function fixture(run){
 const dir=await mkdtemp(path.join(tmpdir(),'vumiro-android-package-'));
 try{
  const repoRoot=path.join(dir,'repo'),outputDir=path.join(dir,'output');
  for(const rel of ['Vumiro.Client/WebServer','Vumiro.Android/Web','docs','Vumiro.Client/Brand'])await mkdir(path.join(repoRoot,rel),{recursive:true});
  for(const page of ['auth','friends','call'])await writeFile(path.join(repoRoot,'Vumiro.Client/WebServer',page+'.html'),'<!doctype html><html><head><style>body{color:red}</style></head><body><script src="/shared.js"></script></body></html>');
  await writeFile(path.join(repoRoot,'Vumiro.Client/WebServer/shared.js'),'window.shared=true;');
  await writeFile(path.join(repoRoot,'Vumiro.Client/WebServer/private.json'),'DO NOT SHIP');
  for(const name of ['android-host.js','mobile-client.js','mobile.css'])await writeFile(path.join(repoRoot,'Vumiro.Android/Web',name),'/* '+name+' */');
  for(const [name,contents]of [['COPYING','GPLv3'],['THIRD-PARTY.md','Third party notices'],['docs/PRIVACY.md','Privacy notice'],['Vumiro.Client/Brand/Sora-OFL.txt','Font license']])await writeFile(path.join(repoRoot,name),contents);
  await run({repoRoot,outputDir});
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('Android asset preparation has a reusable isolated build entrypoint',async()=>{
 const api=await import(script.href).catch(()=>null);assert.equal(typeof api?.prepareAndroidAssets,'function','Android packaging is not implemented');
});

test('bundles shared screens unchanged except Android bootstrap ordering and mobile styling',async()=>{
 const {prepareAndroidAssets}=await import(script.href);
 await fixture(async options=>{await prepareAndroidAssets(options);for(const page of ['auth','friends','call']){const html=await readFile(path.join(options.outputDir,page+'.html'),'utf8');assert.ok(html.indexOf('/android-host.js')<html.indexOf('/mobile-client.js'));assert.ok(html.indexOf('/mobile-client.js')<html.indexOf('/shared.js'));assert.ok(html.indexOf('/mobile.css')>html.indexOf('</style>'));assert.match(html,/body\{color:red\}/);}assert.equal(await readFile(path.join(options.outputDir,'shared.js'),'utf8'),'window.shared=true;');assert.ok(!(await readdir(options.outputDir)).includes('private.json'));});
});

test('manifest is deterministic, covers every packaged resource and includes legal notices',async()=>{
 const {prepareAndroidAssets}=await import(script.href);
 await fixture(async options=>{await prepareAndroidAssets(options);const first=await readFile(path.join(options.outputDir,'asset-manifest.json'),'utf8'),manifest=JSON.parse(first);assert.equal(manifest.origin,'https://vumiro.local');assert.ok(manifest.files.some(f=>f.path==='/COPYING'));assert.ok(manifest.files.some(f=>f.path==='/THIRD-PARTY.md'));assert.ok(manifest.files.some(f=>f.path==='/PRIVACY.md'));assert.ok(manifest.files.some(f=>f.path==='/Sora-OFL.txt'));assert.ok(manifest.files.some(f=>f.path==='/SOURCE-NOTICE.txt'));for(const entry of manifest.files){assert.match(entry.sha256,/^[0-9a-f]{64}$/);assert.equal(createHash('sha256').update(await readFile(path.join(options.outputDir,entry.path.slice(1)))).digest('hex'),entry.sha256);}await prepareAndroidAssets(options);assert.equal(await readFile(path.join(options.outputDir,'asset-manifest.json'),'utf8'),first);});
});

test('rejects missing bridge rather than emitting a broken Android package',async()=>{
 const {prepareAndroidAssets}=await import(script.href);
 await fixture(async options=>{await rm(path.join(options.repoRoot,'Vumiro.Android/Web/android-host.js'));await assert.rejects(prepareAndroidAssets(options),/android-host/);});
});

test('refuses unlisted output files rather than silently shipping stale or private data',async()=>{
 const {prepareAndroidAssets}=await import(script.href);
 await fixture(async options=>{await mkdir(options.outputDir,{recursive:true});await writeFile(path.join(options.outputDir,'private.json'),'DO NOT SHIP');await assert.rejects(prepareAndroidAssets(options),/Unexpected generated Android asset/);});
});
