import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {bundleClientWeb} from '../scripts/bundle-client-web.mjs';

const verifier=fileURLToPath(new URL('../scripts/Test-ClientPackages.ps1',import.meta.url));
const shell=process.platform==='win32'?'powershell.exe':'pwsh';
const available=!spawnSync(shell,['-NoProfile','-Command','exit 0'],{stdio:'ignore'}).error;

test('Windows package verifier compares every shipped web entry with bundled source and rejects drift',{skip:!available},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'vumiro-package-comparison-'));
  try{
    const expected=path.join(root,'expected'),packaged=path.join(root,'packaged');
    await cp(new URL('../Vumiro.Client/WebServer/',import.meta.url),expected,{recursive:true});
    await bundleClientWeb(expected);
    await mkdir(packaged);
    const manifest=(await readFile(new URL('../scripts/windows-package-v2.txt',import.meta.url),'utf8')).split(/\r?\n/).filter(line=>line.startsWith('WebServer/'));
    for(const entry of manifest)await cp(path.join(expected,entry.slice(10)),path.join(packaged,entry.slice(10)));
    const options=path.join(root,'options.json'),driver=path.join(root,'test.ps1');
    await writeFile(options,JSON.stringify({verifier,expected,packaged,manifest}));
    await writeFile(driver,`param([string]$Options)
$ErrorActionPreference='Stop'
$settings=Get-Content -Raw -LiteralPath $Options | ConvertFrom-Json
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($settings.verifier,[ref]$tokens,[ref]$parseErrors)
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-PackagedWebAssets'},$true)
if(!$definition){throw 'Missing bundled-source package comparison helper.'}
Invoke-Expression $definition.Extent.Text
Assert-PackagedWebAssets $settings.packaged $settings.expected $settings.manifest
foreach($entry in $settings.manifest){
  $file=Join-Path $settings.packaged $entry.Substring(10)
  $original=[IO.File]::ReadAllText($file)
  try{
    [IO.File]::WriteAllText($file,$original.Replace("\x60r\x60n","\x60n").Replace("\x60n","\x60r\x60n"))
    Assert-PackagedWebAssets $settings.packaged $settings.expected $settings.manifest
    [IO.File]::WriteAllText($file,$original+'/* unexpected package drift */')
    $rejected=$false
    try{Assert-PackagedWebAssets $settings.packaged $settings.expected $settings.manifest}catch{if($_.Exception.Message -notmatch 'Packaged UI does not match source'){throw};$rejected=$true}
    if(!$rejected){throw "Changed shipped asset accepted: $entry"}
    Remove-Item -LiteralPath $file
    $rejected=$false
    try{Assert-PackagedWebAssets $settings.packaged $settings.expected $settings.manifest}catch{if($_.Exception.Message -notmatch 'Packaged UI does not match source'){throw};$rejected=$true}
    if(!$rejected){throw "Missing shipped asset accepted: $entry"}
  }finally{[IO.File]::WriteAllText($file,$original)}
}
Write-Output 'All shipped web assets verified; unshipped helper modules are covered by their bundle.'
`);
    const result=spawnSync(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',driver,options],{encoding:'utf8',timeout:45000});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    assert.match(result.stdout,/All shipped web assets verified/);
  }finally{await rm(root,{recursive:true,force:true});}
});
