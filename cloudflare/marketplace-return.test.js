import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('hosted browser return remains neutral and cannot establish ownership from URL parameters',async()=>{
  const file=new URL('./marketplace-return.js',import.meta.url);assert.ok(fs.existsSync(file),'neutral browser return exists');
  const {marketplaceReturn}=await import(file);const response=marketplaceReturn(new Request('https://vumiro.test/api/v1/marketplace/return?paid=true&session=private-test'));
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const html=await response.text();
  assert.match(html,/Return to Vumiro/);assert.match(html,/verified by the payment service/);assert.doesNotMatch(html,/private-test|<script|entitlementId/);
  assert.equal(marketplaceReturn(new Request('https://vumiro.test/api/v1/marketplace/return',{method:'POST'})).status,405);
});
