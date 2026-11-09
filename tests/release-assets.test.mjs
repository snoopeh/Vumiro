import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {verifyLocalAssets} from '../scripts/Check-ReleaseAssets.mjs';

async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'vumiro-assets-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const platform of ['windows','linux']){
    await mkdir(path.join(root,platform));
    const names=platform==='windows'?['Vumiro-win-x64.zip','Vumiro-win-x64-v2.zip']:['Vumiro-linux-x64.AppImage','Vumiro-linux-x64.deb','Vumiro-linux-x64.rpm'];
    const rows=[];
    for(const name of names){await writeFile(path.join(root,platform,name),name);rows.push(createHash('sha256').update(name).digest('hex')+'  '+name);}
    await writeFile(path.join(root,platform,platform==='windows'?'SHA256SUMS.txt':'SHA256SUMS-linux.txt'),rows.join('\n')+'\n');
  }
  return root;
}
test('prepublication check hashes all seven artifacts and validates both manifests',async t=>{
  assert.equal((await verifyLocalAssets(await fixture(t))).length,7);
});
test('prepublication check rejects a changed package',async t=>{
  const root=await fixture(t);await writeFile(path.join(root,'linux/Vumiro-linux-x64.deb'),'corrupted');
  await assert.rejects(verifyLocalAssets(root),/checksum|digest/i);
});
test('prepublication check rejects ambiguous duplicate asset names',async t=>{
  const root=await fixture(t);await writeFile(path.join(root,'Vumiro-win-x64-v2.zip'),'duplicate');
  await assert.rejects(verifyLocalAssets(root),/duplicate/i);
});
test('prepublication check rejects missing or empty packages',async t=>{
  const root=await fixture(t);await writeFile(path.join(root,'windows/Vumiro-win-x64.zip'),'');
  await assert.rejects(verifyLocalAssets(root),/empty|size/i);
});
