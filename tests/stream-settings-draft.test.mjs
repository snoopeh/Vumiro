import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
function harness({fail=false}={}){
  const fields=new Map(),applied=[],toasts=[];const $=id=>{if(!fields.has(id))fields.set(id,{value:'',checked:false,disabled:false,textContent:''});return fields.get(id);};
  const saved={fps:60,mbps:20,resolution:'native',contentHint:'detail',audio:true,excludeDiscord:true};
  const context={$,streamSettings:{...saved},nativeAudioSupported:false,screen:null,validateSettings:value=>value.fps>=1&&value.fps<=120&&value.mbps>=1&&value.mbps<=100?value:null,async applySettings(value){if(fail)return false;applied.push(value);context.streamSettings=value;return true;},roomToast:(message,kind)=>toasts.push({message,kind}),status(){},syncSettingsControls(){for(const [id,key]of[['settingFps','fps'],['settingMbps','mbps'],['settingResolution','resolution'],['settingContent','contentHint']])$(id).value=context.streamSettings[key];$('settingAudio').checked=context.streamSettings.audio;$('settingExcludeDiscord').checked=context.streamSettings.excludeDiscord;}};
  const start=source.indexOf('  function setupStreamSettings()'),end=source.indexOf('  /* End stream settings */',start);assert.ok(start>=0&&end>start,'stream settings draft setup exists');vm.runInNewContext(source.slice(start,end)+';setupStreamSettings();',context);context.syncSettingsControls();return {$,context,applied,toasts};
}
test('stream quality edits remain drafts until an explicit successful Save',async()=>{
  const app=harness();app.$('settingFps').value='90';app.$('settingFps').onchange();assert.equal(app.applied.length,0);assert.equal(app.context.streamSettings.fps,60);
  await app.$('saveStreamSettings').onclick();assert.equal(app.applied.length,1);assert.equal(app.applied[0].fps,90);assert.equal(app.toasts.at(-1).kind,'success');assert.equal(app.$('saveStreamSettings').disabled,false);
});
test('failed saves preserve the stream quality draft and never report success',async()=>{
  const app=harness({fail:true});app.$('settingFps').value='90';await app.$('saveStreamSettings').onclick();assert.equal(app.context.streamSettings.fps,60);assert.equal(app.$('settingFps').value,'90');assert.equal(app.toasts.at(-1).kind,'error');
});
test('invalid stream settings never apply or persist',async()=>{
  const app=harness();app.$('settingFps').value='900';await app.$('saveStreamSettings').onclick();assert.equal(app.applied.length,0);assert.equal(app.toasts.at(-1).kind,'error');
});
