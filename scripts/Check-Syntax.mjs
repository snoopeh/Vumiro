import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let count=0;
async function check(folder){
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name),relative=path.relative(root,file).split(path.sep).join('/');
    if(entry.isDirectory()){
      if(['node_modules','bin','obj','dist','.git'].includes(entry.name)||entry.name.startsWith('.wrangler')||relative==='Vumiro.Linux/webserver')continue;
      await check(file);
    }else if(/\.(js|mjs|cjs)$/.test(entry.name)){
      const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
      if(result.error||result.status!==0)throw Error(`Syntax failed: ${relative}\n${result.error?.message||result.stderr}`);
      count++;
    }
  }
}
try{
  for(const folder of ['Vumiro.Client/WebServer','Vumiro.Linux','cloudflare','storage','scripts','tests'])await check(path.join(root,folder));
  console.log(`JavaScript syntax passed: ${count} files.`);
}catch(error){console.error(error.message);process.exitCode=1;}
