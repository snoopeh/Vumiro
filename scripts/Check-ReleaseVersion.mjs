import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

export function readReleaseVersions(root,tag){
  const xmlVersion=file=>{
    const matches=[...readFileSync(path.join(root,file),'utf8').matchAll(/<Version>([^<]+)<\/Version>/g)];
    if(matches.length!==1)throw Error(`Expected exactly one Version in ${file}`);
    return matches[0][1];
  };
  const json=file=>JSON.parse(readFileSync(path.join(root,file),'utf8'));
  const linux=json('Vumiro.Linux/package.json'),lock=json('Vumiro.Linux/package-lock.json');
  const versions=[xmlVersion('Vumiro.Client/Vumiro.Client.csproj'),xmlVersion('Vumiro.Client.Updater/Vumiro.Client.Updater.csproj'),linux.version,lock.version,lock.packages?.['']?.version];
  for(const version of versions)if(typeof version!=='string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)||version.split('.').some(value=>Number(value)>65534))throw Error(`Invalid buildable release version: ${version}`);
  if(new Set(versions).size!==1)throw Error('Windows, updater, Linux and lockfile versions differ.');
  const expected='client-v'+versions[0];
  if(tag&&tag!==expected)throw Error(`Release tag ${tag} does not match ${expected}.`);
  return {version:versions[0],tag:expected,fields:versions.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const {values}=parseArgs({options:{tag:{type:'string'}}});
    console.log(JSON.stringify(readReleaseVersions(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),values.tag)));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
