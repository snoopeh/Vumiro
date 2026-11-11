// Opt-in real-DOM regression. Never connects to an installed production app.
// $env:VUMIRO_BUTTON_QA_CDP='http://127.0.0.1:9232'; node --test tests/button-labels.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const endpoint=process.env.VUMIRO_BUTTON_QA_CDP;
async function checkLabels() {
  if(window.__VUMIRO_LOCAL_QA__!==true)throw Error('This regression requires the isolated LOCAL QA desktop app.');
  const originalLocale=window.VumiroI18n?.locale;
  const fixture=document.createElement('iframe');fixture.title='Temporary button localization regression';fixture.style.cssText='position:fixed;left:-10000px;top:0;width:600px;height:200px';document.body.append(fixture);
  const realm=fixture.contentWindow,phases=[];
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const settle=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setTimeout(resolve,0));};
  const load=filename=>new Promise((resolve,reject)=>{const script=realm.document.createElement('script');script.src=new URL(filename,location.href).href;script.onload=resolve;script.onerror=()=>reject(Error('Could not load production '+filename));realm.document.head.append(script);});
  try {
    const section=realm.document.createElement('section');section.className='gamingWorkspace';
    const button=realm.document.createElement('button');button.id='gamingSaveProfile';button.type='button';button.className='primary';button.textContent='Save profile';section.append(button);realm.document.body.append(section);
    let clicks=0;const handler=()=>clicks++;button.onclick=handler;
    await load('ui-controls.js');await load('i18n.js');await settle();
    function inspect(key,phase) {
      const expected=realm.VumiroI18n.t(key),label=button.textContent;
      assert(label===expected,phase+': expected one label '+JSON.stringify(expected)+'; got '+JSON.stringify(label));
      assert(button.querySelectorAll('svg.uiIcon').length===1,phase+': expected exactly one decorative icon');
      assert(realm.document.getElementById('gamingSaveProfile')===button,phase+': the button node was replaced');
      assert(button.onclick===handler,phase+': its click handler was replaced');
      const before=clicks;button.click();assert(clicks===before+1,phase+': one click must invoke exactly one handler');
      phases.push({phase,locale:realm.VumiroI18n.locale,label,icons:button.querySelectorAll('svg.uiIcon').length,handlerPreserved:true});
    }
    for(const locale of ['en','pt-BR','ja','en']) {
      realm.VumiroI18n.setLocale(locale,{persist:false,broadcast:false});await settle();inspect('Save profile','locale '+locale);
      button.textContent='Sign in';await settle();inspect('Sign in','dynamic replacement '+locale);
      realm.VumiroControls.enhance(section);realm.VumiroControls.enhance(section);realm.VumiroI18n.refresh(section);realm.VumiroI18n.refresh(section);await settle();inspect('Sign in','repeated enhancement '+locale);
      button.textContent='Save profile';await settle();inspect('Save profile','reset '+locale);
    }
    assert(window.VumiroI18n?.locale===originalLocale,'The isolated test changed the application locale');
    return {passed:true,scope:'Ephemeral button DOM fixture in the actual LOCAL QA WebView2; not a whole-app button audit',phases,clicks,parentLocaleUnchanged:true};
  }finally{fixture.remove();if(window.VumiroI18n?.locale!==originalLocale)window.VumiroI18n?.setLocale(originalLocale,{persist:false,broadcast:false});}
}

test('real WebView button keeps one label, one icon, and its handler across localization and rerendering',{skip:!endpoint&&'Set VUMIRO_BUTTON_QA_CDP to an isolated LOCAL QA debugging endpoint.',timeout:45000},async()=>{
  const tabs=await fetch(endpoint+'/json/list').then(response=>response.json()),target=tabs.find(tab=>tab.type==='page'&&tab.url.startsWith('https://screentask.local/'));
  assert.ok(target?.webSocketDebuggerUrl,'The isolated LOCAL QA page is not open.');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let timeout;
  try {
    const response=await new Promise((resolve,reject)=>{
      timeout=setTimeout(()=>reject(Error('Button-label browser check timed out.')),40000);
      ws.addEventListener('message',event=>{const value=JSON.parse(event.data);if(value.id===1){clearTimeout(timeout);resolve(value);}});
      ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:'('+checkLabels.toString()+')()',awaitPromise:true,returnByValue:true}}));
    });
    if(response.error)throw Error(response.error.message);
    if(response.result.exceptionDetails)throw Error(response.result.exceptionDetails.exception?.description||response.result.exceptionDetails.text);
    const result=response.result.result.value;assert.equal(result.passed,true);assert.equal(result.phases.length,16);assert.equal(result.clicks,16);
    let launch=null;try{launch=JSON.parse(await readFile(new URL('../dist/local-qa/launch.json',import.meta.url),'utf8'));}catch{}
    const output=path.resolve('dist/button-label-validation');await mkdir(output,{recursive:true});await writeFile(path.join(output,'result.json'),JSON.stringify({checkedAt:new Date().toISOString(),target:target.url,launch,...result},null,2));
  }finally{clearTimeout(timeout);ws.close();}
});
