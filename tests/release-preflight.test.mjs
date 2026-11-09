import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readReleaseVersions} from '../scripts/Check-ReleaseVersion.mjs';

function fixture(t){
  const root=mkdtempSync(path.join(os.tmpdir(),'vumiro-version-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const folder of ['Vumiro.Client','Vumiro.Client.Updater','Vumiro.Linux'])mkdirSync(path.join(root,folder));
  for(const file of ['Vumiro.Client/Vumiro.Client.csproj','Vumiro.Client.Updater/Vumiro.Client.Updater.csproj'])writeFileSync(path.join(root,file),'<Project><PropertyGroup><Version>1.22.1</Version></PropertyGroup></Project>');
  writeFileSync(path.join(root,'Vumiro.Linux/package.json'),JSON.stringify({version:'1.22.1'}));
  writeFileSync(path.join(root,'Vumiro.Linux/package-lock.json'),JSON.stringify({version:'1.22.1',packages:{'':{version:'1.22.1'}}}));
  return root;
}
test('version preflight accepts five aligned fields and matching client tag',t=>{
  assert.equal(readReleaseVersions(fixture(t),'client-v1.22.1').version,'1.22.1');
});
test('version preflight rejects lockfile drift before building',t=>{
  const root=fixture(t),file=path.join(root,'Vumiro.Linux/package-lock.json'),lock=JSON.parse(readFileSync(file));
  lock.packages[''].version='1.22.0';writeFileSync(file,JSON.stringify(lock));
  assert.throws(()=>readReleaseVersions(root),/version.*differ|mismatch/i);
});
test('version preflight rejects a tag that differs from source',t=>{
  assert.throws(()=>readReleaseVersions(fixture(t),'client-v1.22.2'),/tag/i);
});
test('version preflight rejects noncanonical or unbuildable version fields',t=>{
  const root=fixture(t),file=path.join(root,'Vumiro.Client/Vumiro.Client.csproj');
  for(const version of ['01.22.1','1.2.3-beta','1.2.65536']){
    writeFileSync(file,`<Project><Version>${version}</Version></Project>`);
    assert.throws(()=>readReleaseVersions(root),/version/i);
  }
});
