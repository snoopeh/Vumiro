// Windows release check: launch an isolated, checksum-verified published 1.21.2
// client with WEBVIEW2_USER_DATA_FOLDER and --remote-debugging-port=9374. This
// installs the current public release into that test copy twice (legacy bridge,
// then complete v2). Never point it at a normal user installation.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const expected=process.env.VUMIRO_TEST_RELEASE||'1.21.4';
const latest=await fetch('https://api.github.com/repos/snoopeh/Vumiro/releases/latest').then(response=>response.json());
assert.equal(latest.tag_name,'client-v'+expected,'Publish the intended release before running this check');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
let connection;
async function connect(){
  for(let attempt=0;attempt<60;attempt++){
    try{
      connection=await chromium.connectOverCDP('http://127.0.0.1:9374',{timeout:2000});
      const context=connection.contexts()[0],page=context.pages()[0]||await context.waitForEvent('page',{timeout:5000});
      await page.waitForURL(url=>url.hostname==='screentask.local',{timeout:15000});
      await page.waitForFunction(()=>!!window.VumiroLocalProfile,null,{timeout:10000});
      await page.evaluate(()=>VumiroLocalProfile.initialize());
      return page;
    }catch{await connection?.close().catch(()=>{});await delay(1000);}
  }
  throw Error('The isolated updated app did not restart');
}
async function install(page,label){
  const states=[];
  await page.exposeFunction('__recordUpdate',state=>{states.push(state);});
  await page.evaluate(()=>chrome.webview.addEventListener('message',event=>{if(event.data?.type==='updates')window.__recordUpdate(event.data);}));
  await page.evaluate(()=>chrome.webview.postMessage({type:'updates',action:'check'}));
  for(let attempt=0;attempt<30&&!states.some(state=>!state.busy&&state.available);attempt++)await delay(1000);
  const ready=states.findLast(state=>!state.busy);assert.equal(ready?.available,true,`${label}: ${ready?.message}`);
  const disconnected=new Promise(resolve=>connection.once('disconnected',resolve));
  await page.evaluate(()=>chrome.webview.postMessage({type:'updates',action:'install'}));
  let timer;
  try{await Promise.race([disconnected,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} did not restart: ${states.at(-1)?.message}`)),90000);})]);}finally{clearTimeout(timer);}
  return states.map(({current,message,progress})=>({current,message,progress}));
}
try{
  let page=await connect();
  const populated=await page.evaluate(async()=>{await VumiroLocalProfile.initialize();return !!VumiroLocalProfile.profile();});
  assert.equal(populated,false,'Release updater check needs an empty isolated WebView profile');
  const identity=await page.evaluate(async()=>{return (await VumiroLocalProfile.createProfile('Updater validation')).id;});
  await page.reload();await page.waitForFunction(()=>!!VumiroLocalProfile.profile());
  const bridge=await install(page,'Legacy updater');page=await connect();
  assert.equal(await page.evaluate(()=>VumiroLocalProfile.profile()?.id),identity,'Bridge must preserve the local identity');
  assert.equal(await page.evaluate(()=>!!window.VumiroAccount),false,'First update must use the frozen legacy bridge');
  const complete=await install(page,'Complete updater');page=await connect();
  await page.waitForFunction(()=>!!VumiroLocalProfile.profile());
  assert.equal(await page.evaluate(()=>VumiroLocalProfile.profile().id),identity,'Complete update must preserve the local identity');
  assert.equal(await page.evaluate(()=>!!window.VumiroAccount),true,'Second update must install account assets');
  const result={expectedVersion:expected,legacyBridge:bridge,completePackage:complete,localIdentityPreserved:true};
  await mkdir('dist/updater-validation',{recursive:true});await writeFile('dist/updater-validation/result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({expectedVersion:expected,localIdentityPreserved:true,completedStages:[bridge.at(-1),complete.at(-1)]},null,2));
}finally{await connection?.close().catch(()=>{});}
