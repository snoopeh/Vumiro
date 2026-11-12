#!/usr/bin/env node
// Uses the exact browser validator; packages never execute code or require dependencies.
import {readFile,writeFile,stat} from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';

const context={window:{},atob,btoa,URL,Blob};
vm.runInNewContext(await readFile(new URL('../Vumiro.Client/WebServer/community-themes.js',import.meta.url),'utf8'),context,{filename:'community-themes.js'});
const themes=context.window.VumiroCommunityThemes;
const help='Vumiro Theme Creator Kit\n\n  node scripts/theme-kit.mjs validate input.vumirotheme\n  node scripts/theme-kit.mjs package input.json output.vumirotheme\n  node scripts/theme-kit.mjs starter baseline|viking|cyberpunk output.vumirotheme\n\nPackages are versioned JSON. ZIP and other archives are rejected. Existing output files are preserved.';
async function validatedFile(file){const info=await stat(file);if(!info.isFile()||info.size>themes.MAX_PACKAGE)throw Error('Input must be a JSON theme package of at most 2 MiB');const result=themes.validate(await readFile(file,'utf8'));if(!result.valid)throw Error(result.errors.join('\n'));return result.package;}
async function writePackage(output,pkg){if(path.extname(output).toLowerCase()!=='.vumirotheme')throw Error('Output must have the .vumirotheme extension');const result=themes.validate(pkg);if(!result.valid)throw Error(result.errors.join('\n'));await writeFile(output,JSON.stringify(result.package,null,2)+'\n',{encoding:'utf8',flag:'wx'});console.log(`Packaged ${pkg.id}@${pkg.version}: ${output}`);}
try{
  const [command,input,output,...extra]=process.argv.slice(2);if(!command||['--help','-h','help'].includes(command)){console.log(help);}
  else if(command==='validate'&&input&&!output&&!extra.length){const pkg=await validatedFile(input);console.log(`Valid: ${pkg.id}@${pkg.version}; schema ${pkg.schemaVersion}, engine ${pkg.compatibility.engine}; ${pkg.assets.length} assets`);}
  else if(command==='package'&&input&&output&&!extra.length){await writePackage(output,await validatedFile(input));}
  else if(command==='starter'&&input&&output&&!extra.length){const pkg=themes.builtins.find(pkg=>pkg.id===input);if(!pkg)throw Error('Unknown starter. Choose baseline, viking, or cyberpunk.');await writePackage(output,pkg);}
  else throw Error(help);
}catch(error){console.error(error.message);process.exitCode=1;}
