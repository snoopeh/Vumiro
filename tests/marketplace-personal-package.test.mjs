import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function engine(){const scope={window:{},atob,console};vm.runInNewContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/community-themes.js',import.meta.url),'utf8'),scope);return scope.window.VumiroCommunityThemes;}
test('personal cosmetic packages use the shared validator with exact decorative slots and safe animation presets',()=>{
  const api=engine();assert.ok(Array.isArray(api.personalBuiltins),'personal showcase packages exist');assert.ok(api.personalBuiltins.length>=5);
  for(const pkg of api.personalBuiltins){const checked=api.validate(pkg);assert.equal(checked.valid,true,checked.errors.join('; '));assert.equal(Object.keys(pkg.tokens).length,0);assert.equal(Object.keys(pkg.layouts).length,0);assert.ok(api.personalKinds.includes(pkg.kind));}
  assert.deepEqual(Array.from(api.kindScopes('avatar-frame')),['avatar']);assert.deepEqual(Array.from(api.kindScopes('profile-card')),['profile-card']);assert.deepEqual(Array.from(api.kindScopes('theme')),['hub','space','text','voice']);
  const frame=api.personalBuiltins.find(pkg=>pkg.kind==='avatar-frame');
  for(const patch of [{tokens:{text:'#000000'}},{layouts:{home:['compact']}},{components:{card:{borderColor:'#ff0000'}}},{css:'[data-community-slot="navigation"]{color:#ff0000}'},{motion:'arbitrary-script'},{kind:'javascript'}])assert.equal(api.validate({...frame,...patch}).valid,false,JSON.stringify(patch));
});
test('personal packages retain legacy theme compatibility but cannot target unrelated component slots',()=>{
  const api=engine();for(const pkg of api.builtins)assert.equal(api.validate(pkg).valid,true);
  const card=api.personalBuiltins.find(pkg=>pkg.kind==='profile-card');assert.equal(api.validate({...card,components:{'avatar-frame':{borderColor:'#ff0000'}}}).valid,false);
  assert.ok(api.personalBuiltins.some(pkg=>pkg.motion==='orbit'));assert.ok(api.personalBuiltins.some(pkg=>pkg.motion==='shimmer'));assert.ok(api.personalBuiltins.some(pkg=>pkg.motion==='pulse'));
});
test('community themes cannot restyle personal profile slots and resolved packages identify their kind',()=>{
  const api=engine();assert.equal(api.validate({...api.builtins[1],components:{'avatar-frame':{borderColor:'#ff0000'}}}).valid,false);
  const pkg=api.personalBuiltins[0];assert.equal(api.resolve({packages:[pkg],bindings:[{packageId:pkg.id,version:pkg.version}]}).kind,'avatar-frame');
});


test('reduced motion removes embedded personal raster art including animated GIF APNG and WebP with a static border fallback',()=>{
  const api=engine(),starter=api.personalBuiltins[0];
  for(const [mime,bytes] of [['image/gif','GIF89a'],['image/png','\x89PNG\r\n\x1a\nacTL'],['image/webp','RIFF1234WEBPANIM']]){
    const pkg={...starter,assets:[{id:'moving',mime,data:Buffer.from(bytes,'binary').toString('base64')}],components:{'avatar-frame':{borderColor:'#abcdef',backgroundImage:'asset(moving)'}},css:'[data-community-slot="avatar-frame"]{background-image:asset(moving)}'};
    assert.equal(api.validate(pkg).valid,true);
    const resolve=preferences=>api.resolve({packages:[pkg],bindings:[{packageId:pkg.id,version:pkg.version}],preferences});
    assert.equal(resolve({}).components['avatar-frame'].backgroundImage,'asset(moving)');
    const reduced=resolve({reducedMotion:true});assert.equal(reduced.motion,'none');assert.equal(reduced.components['avatar-frame'].backgroundImage,'none');assert.equal(reduced.components['avatar-frame'].borderColor,'#abcdef');assert.doesNotMatch(reduced.css,/asset\(/);assert.equal(reduced.assets.length,0);
  }
});
