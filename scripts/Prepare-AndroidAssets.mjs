import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoDefault=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pages=new Set(['auth.html','friends.html','call.html']);
const bootstrap='<script src="/android-host.js"></script><script src="/mobile-client.js"></script>';

export async function prepareAndroidAssets({repoRoot=repoDefault,outputDir=path.join(repoRoot,'Vumiro.Android/Assets/Web')}={}){
 const source=path.join(repoRoot,'Vumiro.Client/WebServer'),mobile=path.join(repoRoot,'Vumiro.Android/Web'),files=new Map();
 for(const entry of (await readdir(source,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(!entry.isFile()||!(/^[a-z0-9-]+\.js$/.test(entry.name)||pages.has(entry.name)))continue;
  let content=await readFile(path.join(source,entry.name));
  if(pages.has(entry.name)){
   const html=content.toString('utf8');if(!html.includes('</head>'))throw Error('Missing head in '+entry.name);
   content=Buffer.from(html.replace(/<head([^>]*)>/i,'<head$1>'+bootstrap).replace('</head>','<link rel="stylesheet" href="/mobile.css"></head>'));
  }
  files.set(entry.name,content);
 }
 for(const page of pages)if(!files.has(page))throw Error('Required Android screen missing: '+page);
 for(const name of ['android-host.js','mobile-client.js','mobile.css'])files.set(name,await readFile(path.join(mobile,name)));
 for(const [target,sourceName]of [['COPYING','COPYING'],['THIRD-PARTY.md','THIRD-PARTY.md'],['PRIVACY.md','docs/PRIVACY.md'],['Sora-OFL.txt','Vumiro.Client/Brand/Sora-OFL.txt']])files.set(target,await readFile(path.join(repoRoot,sourceName)));
 files.set('SOURCE-NOTICE.txt',Buffer.from('Vumiro Android QA uses the Vumiro shared client.\nSource: https://github.com/snoopeh/Vumiro\nLicense: GNU General Public License v3; see COPYING and THIRD-PARTY.md.\nThis development build may contain unmerged source; distribute its matching source checkout alongside the APK.\n'));
 const manifest={origin:'https://vumiro.local',files:[...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,content])=>({path:'/'+name,sha256:createHash('sha256').update(content).digest('hex')}))};
 // Do not recursively clear a caller-supplied directory. The manifest defines
 // package inputs; the build uses only these known resources.
 await mkdir(outputDir,{recursive:true});
 for(const entry of await readdir(outputDir,{withFileTypes:true}))if(!entry.isFile()||!files.has(entry.name)&&entry.name!=='asset-manifest.json')throw Error('Unexpected generated Android asset: '+entry.name+'. Use an empty generated output directory.');
 for(const [name,content]of files)await writeFile(path.join(outputDir,name),content);
 await writeFile(path.join(outputDir,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const manifest=await prepareAndroidAssets();console.log(`Prepared ${manifest.files.length} shared Android assets and notices.`);
}
