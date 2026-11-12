import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file=new URL('../Vumiro.Client/WebServer/community-themes.js',import.meta.url);
function engine(){const context={window:{},atob,console};vm.createContext(context);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);assert.ok(context.window.VumiroCommunityThemes,'shared Community Hub theme engine exists');return context.window.VumiroCommunityThemes;}
test('marketplace kinds use the same portable validator and reject unbounded decorative scope',()=>{
  const api=engine(),theme=JSON.parse(JSON.stringify(api.builtins[1]));
  theme.kind='theme';assert.equal(api.validate(theme).valid,true);
  const pack={...theme,id:'oak-frames',kind:'decorative-pack',tokens:{},layouts:{},css:'',motion:'none'};
  assert.equal(api.validate(pack).valid,true);
  assert.equal(api.validate({...pack,kind:'profile-cosmetic'}).valid,false);
  assert.equal(api.validate({...pack,tokens:{text:'#000000'}}).valid,false);
  assert.equal(api.validate({...pack,components:{arbitrary:{color:'#000000'}}}).valid,false);
});
test('decorations merge only documented component styling without replacing base theme or layout',()=>{
  const api=engine(),pack={...JSON.parse(JSON.stringify(api.builtins[0])),id:'gold-frames',kind:'decorative-pack',tokens:{},layouts:{},components:{card:{borderColor:'#d4af37',borderWidth:'2px'}},css:'',motion:'none'};
  const resolved=api.resolve({bindings:[{packageId:'cyberpunk',version:'1.0.0'},{packageId:pack.id,version:pack.version}],packages:[pack]});
  assert.equal(resolved.tokens.accent,api.builtins[2].tokens.accent);
  assert.equal(resolved.components.card.borderColor,'#d4af37');
  assert.equal(resolved.components.card.backgroundImage,api.builtins[2].components.card.backgroundImage);
});
test('decorative assets cannot collide with the base theme asset identifiers',()=>{
  const api=engine(),base=JSON.parse(JSON.stringify(api.builtins[1]));
  base.id='custom-base';base.assets=[{id:'art',mime:'image/gif',data:btoa('GIF89a'+'base')}];base.components.card.backgroundImage='asset(art)';
  const pack={...JSON.parse(JSON.stringify(api.builtins[0])),id:'pack-art',kind:'decorative-pack',tokens:{},layouts:{},assets:[{id:'art',mime:'image/gif',data:btoa('GIF89a'+'pack')}],components:{banner:{backgroundImage:'asset(art)'}},css:'',motion:'none'};
  const result=api.resolve({bindings:[{packageId:base.id,version:base.version},{packageId:pack.id,version:pack.version}],packages:[base,pack]});
  assert.equal(new Set(result.assets.map(asset=>asset.id)).size,2);
  const bannerId=result.components.banner.backgroundImage.slice(6,-1),cardId=result.components.card.backgroundImage.slice(6,-1);
  assert.notEqual(bannerId,cardId);assert.equal(result.assets.find(asset=>asset.id===bannerId).data,pack.assets[0].data);
});
test('decorative CSS renders alongside the inherited theme CSS',()=>{
  const api=engine(),pack={...JSON.parse(JSON.stringify(api.builtins[0])),id:'css-decoration',kind:'decorative-pack',tokens:{},layouts:{},components:{},css:'[data-community-slot="banner"] { border-color:#123456 }',motion:'none'};
  const resolved=api.resolve({bindings:[{packageId:'cyberpunk',version:'1.0.0'},{packageId:pack.id,version:pack.version}],packages:[pack]});
  let rendered='';const root={ownerDocument:{createElement:()=>({set textContent(value){rendered=value;},remove(){}})},style:{setProperty(){},removeProperty(){}},setAttribute(){},removeAttribute(){},append(){}};
  api.applyToRoot(root,resolved);assert.match(rendered,/color:#ffb8ef/);assert.match(rendered,/border-color:#123456/);
});
test('backend package bridge reuses the shared validator and deterministic immutable digest',async()=>{
  const bridgeFile=new URL('../cloudflare/marketplace-package.js',import.meta.url);
  assert.ok(fs.existsSync(bridgeFile),'shared validator backend bridge exists');
  const {validateMarketplacePackage,digestPackage}=await import(bridgeFile);
  const pkg=JSON.parse(JSON.stringify(engine().builtins[1]));
  assert.equal(validateMarketplacePackage(pkg).valid,true);
  assert.match(await digestPackage(pkg),/^[a-f0-9]{64}$/);
  assert.equal(await digestPackage(pkg),await digestPackage(JSON.parse(JSON.stringify(pkg))));
  assert.equal(validateMarketplacePackage({...pkg,css:'body { display:none }'}).valid,false);
});
test('backend validates customization overrides with the same engine component and asset rules',async()=>{
  const bridge=await import('../cloudflare/marketplace-package.js');
  assert.equal(typeof bridge.validateMarketplaceOverrides,'function');const pkg=JSON.parse(JSON.stringify(engine().builtins[1]));
  assert.equal(bridge.validateMarketplaceOverrides(pkg,{tokens:{accent:'#ddaa11'},layout:{home:'split'}}).valid,true);
  for(const overrides of [{css:'body{display:none}'},{components:{card:{position:'fixed'}}},{tokens:{secret:'invalid'}},{layout:{home:'arbitrary'}}])assert.equal(bridge.validateMarketplaceOverrides(pkg,overrides).valid,false);
});
