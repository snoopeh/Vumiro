import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,rm,access,readFile,mkdir,writeFile,cp,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';

async function assertRelay(t,root=resolve('cloudflare'),entry=resolve('scripts/GamingQaRelay.mjs')){
  try{await access(join(root,'node_modules/miniflare/package.json'));}catch{t.skip('Builder dependencies absent; npm ci in cloudflare enables the runtime smoke check.');return;}
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const state=await mkdtemp(join(tmpdir(),'vumiro-qa-relay-'));
  const child=spawn(process.execPath,[entry,'--root',root,'--host','127.0.0.1','--port',String(port),'--state',state],{stdio:['pipe','pipe','pipe'],cwd:root});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const exit=once(child,'exit');
  try{
    for(let i=0;i<150&&!output.includes('LOCAL QA relay ready:');i++){assert.equal(child.exitCode,null,output);await new Promise(r=>setTimeout(r,50));}
    assert.match(output,/LOCAL QA relay ready:/);
    const base='http://127.0.0.1:'+port;
    assert.equal((await fetch(base+'/call-signaling')).status,400,'real Worker validates required identity/room');
    assert.equal((await fetch(base+'/cdn-cgi/local/explorer/api/local/workers')).status,404,'no dev administration endpoint');
    assert.equal((await fetch(base+'/api/link-preview')).status,422,'dynamic Worker imports retain input validation without an outbound request');
    const socket=new WebSocket('ws://127.0.0.1:'+port+'/friends-signaling?id='+'a'.repeat(43)+'&name=QA');
    const challenge=await new Promise((res,rej)=>{const timer=setTimeout(()=>rej(new Error('No identity challenge')),4000);socket.onmessage=event=>{clearTimeout(timer);res(JSON.parse(event.data));};socket.onerror=()=>{clearTimeout(timer);rej(new Error('WebSocket failed'));};});
    assert.equal(challenge.type,'challenge');assert.match(challenge.nonce,/^[A-Za-z0-9_-]{32,}$/);socket.close();
  }finally{child.stdin.write('stop\n');let timer;try{await Promise.race([exit,new Promise((_,reject)=>timer=setTimeout(()=>{child.kill();reject(new Error(output));},7000))]);}finally{clearTimeout(timer);}assert.ok(state.startsWith(join(tmpdir(),'vumiro-qa-relay-')));await rm(state,{recursive:true,force:true});}
}

test('private relay runs current Worker challenges without exposing local administration', {timeout:30000},assertRelay);

test('portable relay kit preserves shared validator imports outside the Worker directory',{timeout:30000},async t=>{
  if(process.platform!=='win32'){t.skip('PowerShell packaging helper is Windows only.');return;}
  const fixture=await mkdtemp(join(tmpdir(),'vumiro-qa-relay-kit-'));
  try{
    const worker=join(fixture,'cloudflare'),kit=join(fixture,'kit'),scripts=join(fixture,'scripts');
    await mkdir(worker,{recursive:true});await mkdir(scripts);
    for(const name of await readdir('cloudflare'))if((name.endsWith('.js')&&!name.endsWith('.test.js'))||name==='package.json')await cp(join('cloudflare',name),join(worker,name));
    for(const folder of ['node_modules','public','migrations'])await mkdir(join(worker,folder));
    await mkdir(join(fixture,'Vumiro.Client'));
    await cp('Vumiro.Client/WebServer',join(fixture,'Vumiro.Client/WebServer'),{recursive:true});
    await cp('scripts/GamingQaRelay.mjs',join(scripts,'GamingQaRelay.mjs'));
    const build=await readFile('scripts/New-GamingQaKit.ps1','utf8'),lines=build.split(/\r?\n/);
    const start=lines.findIndex(line=>line.includes("$relay = Join-Path $kit 'relay'")),end=lines.findIndex(line=>line.includes("'GamingQaRelay.mjs') -Destination"));
    assert.ok(start>=0&&end>start,'run the actual portable relay staging block');
    const staging=join(scripts,'Stage-Relay.ps1'),quote=value=>"'"+value.replaceAll("'","''")+"'";
    await writeFile(staging,`$ErrorActionPreference='Stop'\n$repository=${quote(fixture)}\n$worker=${quote(worker)}\n$kit=${quote(kit)}\nNew-Item -ItemType Directory -Path $kit | Out-Null\n`+lines.slice(start,end+1).join('\n'));
    const staged=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',staging],{encoding:'utf8'});
    assert.equal(staged.status,0,staged.stdout+staged.stderr);
    for(const name of ['community-themes.js','profile-cosmetics.js','profile-style-samples.js','profile-style-studio.js']){
      const target=join(kit,'Vumiro.Client/WebServer',name);
      await assert.doesNotReject(access(target),name+' retains its relative import path');
      assert.equal(await readFile(target,'utf8'),await readFile(join(fixture,'Vumiro.Client/WebServer',name),'utf8'));
    }
    const relay=join(kit,'relay');await rm(join(relay,'node_modules'),{recursive:true,force:true});
    try{await access(resolve('cloudflare/node_modules/miniflare/package.json'));}catch{t.skip('Builder dependencies absent; npm ci in cloudflare enables the runtime smoke check.');return;}
    await symlink(resolve('cloudflare/node_modules'),join(relay,'node_modules'),'junction');
    await assertRelay(t,relay,join(relay,'GamingQaRelay.mjs'));
  }finally{assert.ok(fixture.startsWith(join(tmpdir(),'vumiro-qa-relay-kit-')));await rm(fixture,{recursive:true,force:true});}
});

test('private launcher never enables QA overrides for an installed release process',async()=>{
 const launch=await readFile('scripts/Start-GamingQa.ps1','utf8');
 assert.match(launch,/VUMIRO_DEV_WEB_ROOT/);assert.match(launch,/VUMIRO_DEV_DATA_ROOT/);assert.match(launch,/VUMIRO_DEV_SIGNALING_URL/);assert.match(launch,/WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS/);
 const build=await readFile('scripts/New-GamingQaKit.ps1','utf8');assert.match(build,/-c Debug/);assert.doesNotMatch(build,/wrangler deploy|git push|git tag/);assert.match(build,/NODE-LICENSE/);
});

test('private kit carries the actual payload and art notices without duplicating embedded binaries',async t=>{
 if(process.platform!=='win32'){t.skip('PowerShell packaging helper is Windows only.');return;}
 const fixture=await mkdtemp(join(tmpdir(),'vumiro-qa-notices-'));const source=join(fixture,'source'),app=join(fixture,'kit','app');
 const files=['THIRD-PARTY.md','vendor/windows/WINTUN-LICENSE.txt','vendor/windows/VIGEMBUS-LICENSE.txt','vendor/windows/payloads.json','vendor/controller-art/LICENSE-CC0.txt','vendor/controller-art/PROVENANCE.md'];
 try{
  for(const file of files){const target=join(source,file);await mkdir(resolve(target,'..'),{recursive:true});await writeFile(target,'Original notice: '+file);}
  await writeFile(join(source,'vendor/windows/wintun.dll'),'not a redistributed sidecar');
  const copied=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/Copy-GamingQaNotices.ps1'),'-SourceRoot',source,'-ApplicationDirectory',app],{encoding:'utf8'});
  assert.equal(copied.status,0,copied.stderr);
  for(const file of files){const target=file==='THIRD-PARTY.md'?file:file.replace('vendor/','notices/');assert.equal(await readFile(join(app,target),'utf8'),'Original notice: '+file);}
  await assert.rejects(access(join(app,'notices/windows/wintun.dll')));
  await rm(join(source,'vendor/windows/WINTUN-LICENSE.txt'));
  const missing=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/Copy-GamingQaNotices.ps1'),'-SourceRoot',source,'-ApplicationDirectory',app],{encoding:'utf8'});
  assert.notEqual(missing.status,0,'a missing required license must fail the kit build');
 }finally{assert.ok(fixture.startsWith(join(tmpdir(),'vumiro-qa-notices-')));await rm(fixture,{recursive:true,force:true});}
});
