import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{output:{type:'string',default:'dist/checks'},tag:{type:'string'},'skip-backend':{type:'boolean',default:false}}});
const output=path.resolve(root,values.output);
await mkdir(output,{recursive:true});
const checks=[];
async function run(name,command,args,cwd=root){
  const started=Date.now(),result=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:16*1024*1024,timeout:5*60*1000,shell:process.platform==='win32'&&command==='npm.cmd'});
  const log=(result.stdout||'')+(result.stderr||'')+(result.error?.message||'');
  await writeFile(path.join(output,name+'.log'),log);
  const record={name,state:result.status===0&&!result.error?'passed':'failed',durationMs:Date.now()-started};
  if(name==='client-tests')for(const metric of ['tests','pass','fail','skipped']){const match=new RegExp('^# '+metric+' (\\d+)','m').exec(log);if(match)record[metric]=Number(match[1]);}
  checks.push(record);
  console.log(`${name}: ${record.state}${record.tests!==undefined?` (${record.pass}/${record.tests})`:''}`);
  if(record.state==='failed'){console.error(log.split(/\r?\n/).slice(-40).join('\n'));throw Error(`${name} failed; see ${path.join(output,name+'.log')}`);}
}
let failure;
try{
  await run('versions',process.execPath,['scripts/Check-ReleaseVersion.mjs',...(values.tag?['--tag',values.tag]:[])]);
  await run('syntax',process.execPath,['scripts/Check-Syntax.mjs']);
  await run('client-tests',process.execPath,['--test','--test-reporter=tap','tests/*.test.mjs']);
  if(!values['skip-backend'])await run('backend-tests',process.platform==='win32'?'npm.cmd':'npm',['test'],path.join(root,'cloudflare'));
}catch(error){failure=error.message;console.error(failure);process.exitCode=1;}
const report={state:failure?'failed':'passed',source:process.env.GITHUB_SHA||null,checks,...(failure?{error:failure}:{})};
const markdown=`## Fast client checks: ${report.state}\n\n| Check | Result | Seconds |\n|---|---|---|\n${checks.map(check=>`| ${check.name} | ${check.state} | ${(check.durationMs/1000).toFixed(1)} |`).join('\n')}\n${failure?'\n'+failure+'\n':''}`;
await writeFile(path.join(output,'checks-report.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(output,'checks-report.md'),markdown);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown);
