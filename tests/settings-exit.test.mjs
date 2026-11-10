import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(choice='save'){
  const path=new URL('../Vumiro.Client/WebServer/settings-drafts.js',import.meta.url);
  assert.ok(fs.existsSync(path),'settings draft controller exists');
  const context={window:{}};vm.runInNewContext(fs.readFileSync(path,'utf8'),context);
  const events=[],state={saved:1,draft:1};
  const section={dirty:()=>state.saved!==state.draft,save:async()=>{events.push('save');state.saved=state.draft;return true;},discard:()=>{events.push('discard');state.draft=state.saved;}};
  const controller=context.window.VumiroSettingsDrafts.create({sections:[section],confirm:async()=>{events.push('prompt');return choice;},close:()=>events.push('close'),onError:error=>events.push(error.message)});
  return {controller,events,state,section};
}
test('clean settings close directly, while changed settings save before closing',async()=>{
  const app=setup();assert.equal(await app.controller.requestClose(),true);assert.deepEqual(app.events,['close']);
  app.events.length=0;app.state.draft=2;assert.equal(await app.controller.requestClose(),true);assert.deepEqual(app.events,['prompt','save','close']);assert.equal(app.state.saved,2);
});
test('discard restores saved values and keep editing preserves the draft',async()=>{
  for(const choice of ['discard','stay']){const app=setup(choice);app.state.draft=2;await app.controller.requestClose();assert.equal(app.state.draft,choice==='discard'?1:2);assert.equal(app.events.includes('close'),choice==='discard');}
});
test('save failure keeps settings open with the draft intact',async()=>{
  const app=setup();app.state.draft=2;app.section.save=async()=>false;
  assert.equal(await app.controller.requestClose(),false);assert.equal(app.state.draft,2);assert.equal(app.state.saved,1);assert.equal(app.events.includes('close'),false);assert.match(app.events.at(-1),/save/i);
});
test('partially saved settings retry only remaining dirty sections and prevent overlapping exits',async()=>{
  const app=setup();app.state.draft=2;let release,secondSaved=false,attempts=0;
  app.controller.add({dirty:()=>!secondSaved,save:async()=>{attempts++;await new Promise(resolve=>release=resolve);secondSaved=true;return true;},discard(){}});
  const pending=app.controller.requestClose();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await app.controller.requestClose(),false);release();assert.equal(await pending,true);assert.equal(attempts,1);assert.equal(app.events.filter(x=>x==='save').length,1);
});
