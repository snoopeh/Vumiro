import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readdir,readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const groups={
  'SHA256SUMS.txt':['Vumiro-win-x64.zip','Vumiro-win-x64-v2.zip'],
  'SHA256SUMS-linux.txt':['Vumiro-linux-x64.AppImage','Vumiro-linux-x64.deb','Vumiro-linux-x64.rpm']
};
const expected=[...Object.keys(groups),...Object.values(groups).flat()];

export async function verifyLocalAssets(directory){
  const files=new Map();
  async function walk(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const file=path.join(folder,entry.name);
      if(entry.isSymbolicLink())throw Error(`Linked release artifact: ${entry.name}`);
      if(entry.isDirectory())await walk(file);
      else if(expected.includes(entry.name)){
        if(files.has(entry.name))throw Error(`Duplicate release artifact ${entry.name}`);
        files.set(entry.name,file);
      }
    }
  }
  await walk(directory);
  const records=[];
  for(const name of expected){
    const file=files.get(name);
    if(!file)throw Error(`Missing release artifact ${name}`);
    const {size}=await stat(file);
    if(!size||(name.startsWith('Vumiro-win-')&&size>16*1024*1024))throw Error(`Invalid size or empty artifact: ${name}`);
    const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
    records.push({name,size,sha256:hash.digest('hex')});
  }
  for(const [manifest,names]of Object.entries(groups)){
    const rows=(await readFile(files.get(manifest),'utf8')).trim().split(/\r?\n/),seen=new Set();
    if(rows.length!==names.length)throw Error(`Invalid checksum row count: ${manifest}`);
    for(const row of rows){
      const match=/^([a-f0-9]{64})  (\S+)$/.exec(row);
      if(!match||!names.includes(match[2])||seen.has(match[2]))throw Error(`Invalid or duplicate checksum row: ${manifest}`);
      seen.add(match[2]);
      if(records.find(item=>item.name===match[2]).sha256!==match[1])throw Error(`Checksum mismatch for ${match[2]}`);
    }
  }
  return records;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const {values}=parseArgs({options:{directory:{type:'string'},output:{type:'string'}}});
    if(!values.directory)throw Error('--directory is required');
    const assets=await verifyLocalAssets(values.directory);
    if(values.output){await mkdir(path.dirname(path.resolve(values.output)),{recursive:true});await writeFile(values.output,JSON.stringify({state:'passed',assets},null,2)+'\n');}
    console.log(`Verified ${assets.length} release artifacts and both checksum manifests.`);
  }catch(error){console.error(error.message);process.exitCode=1;}
}
