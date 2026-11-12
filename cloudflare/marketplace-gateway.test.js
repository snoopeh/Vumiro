import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const file=new URL('./marketplace-gateway.js',import.meta.url);
test('marketplace gateway is opt-in and preserves authenticated requests only through the private service binding',async()=>{
  assert.ok(fs.existsSync(file),'gateway exists');const {marketplaceGateway}=await import(file);
  const request=new Request('https://vumiro.test/api/v1/marketplace/library',{headers:{Authorization:'Bearer test-token'}});
  assert.equal((await marketplaceGateway(request,{})).status,503);
  let forwarded;const env={MARKETPLACE_SERVICE_ENABLED:'true',MARKETPLACE_SERVICE:{fetch:async value=>{forwarded=value;return Response.json({items:[]});}}};
  assert.equal((await marketplaceGateway(request,env)).status,200);assert.equal(forwarded.headers.get('Authorization'),'Bearer test-token');
  assert.equal(await marketplaceGateway(new Request('https://vumiro.test/api/v1/account/data'),env),null);
});
