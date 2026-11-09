import {mkdir,readFile,writeFile,appendFile} from 'node:fs/promises';
import path from 'node:path';

const jobs=JSON.parse(process.env.RELEASE_JOB_RESULTS||'{}');
const outcomes=Object.entries(jobs).map(([name,value])=>({name,result:value.result}));
let verification=null;
try{verification=JSON.parse(await readFile('dist/verification/release-report.json','utf8'));}catch{}
const verified=verification?.status==='passed'&&Array.isArray(verification.checks)&&verification.checks.length>0&&verification.checks.every(check=>check.status==='passed');
const passed=outcomes.length>0&&outcomes.every(job=>job.result==='success')&&verified;
const report={status:passed?'passed':'failed',tag:process.env.GITHUB_REF_NAME,source:process.env.GITHUB_SHA,
  workflow:`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  release:`https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${process.env.GITHUB_REF_NAME}`,
  jobs:outcomes,verification};
const markdown=`# Release pipeline: ${report.status}\n\nTag: ${report.tag}\n\nSource: \`${report.source}\`\n\n| Stage | Result |\n|---|---|\n${outcomes.map(job=>`| ${job.name} | ${job.result} |`).join('\n')}\n\n[Workflow and logs](${report.workflow}) · [Release page](${report.release})\n\n${passed?'Publication and updater-feed verification passed.':'A stage failed, was cancelled or skipped, or the passing verification report is missing. Inspect the workflow logs.'}\n${Array.isArray(verification?.checks)?'\n## Package verification\n\n'+verification.checks.map(check=>`- ${check.name}: ${check.status}`).join('\n')+'\n':''}`;
await mkdir('dist/pipeline-report',{recursive:true});
await writeFile('dist/pipeline-report/pipeline-report.json',JSON.stringify(report,null,2)+'\n');
await writeFile('dist/pipeline-report/pipeline-report.md',markdown);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown);
console.log(`Release pipeline ${report.status}. Report: ${path.resolve('dist/pipeline-report/pipeline-report.md')}`);
if(!passed)process.exitCode=1;
