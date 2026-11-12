import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=new URL('../Vumiro.Client/WebServer/marketplace-external.js',import.meta.url);
function harness(){const listeners=new Map(),sent=[],window={chrome:{webview:{addEventListener:(type,callback)=>listeners.set(type,callback),postMessage:value=>sent.push(value)}}};const context={window,URL,crypto,setTimeout,clearTimeout};if(fs.existsSync(source))vm.runInNewContext(fs.readFileSync(source,'utf8'),context);assert.ok(window.VumiroMarketplaceExternal,'external marketplace bridge exists');return {api:window.VumiroMarketplaceExternal,sent,reply:data=>listeners.get('message')?.({data})};}
test('checkout and onboarding open only hosted payment origins without embedded navigation',async()=>{
  const h=harness();
  for(const url of ['javascript:alert(1)','https://checkout.stripe.com.evil.test/c/pay/a','https://user@connect.stripe.com/setup/s/a','http://checkout.stripe.com/c/pay/a','https://checkout.stripe.com:444/c/pay/a','https://connect.stripe.com/redirect'])assert.equal(h.api.validUrl(url),false,url);
  assert.equal(h.api.validUrl('https://checkout.stripe.com/c/pay/cs_test_123#secret'),true);
  const pending=h.api.openExternal('https://connect.stripe.com/setup/s/example');const request=h.sent[0];
  assert.equal(request.type,'marketplace');assert.equal(request.action,'open-external');
  h.reply({type:'marketplace-external-result',requestId:request.requestId,ok:true});
  assert.equal(await pending,true);
});
test('rejected host handoff fails visibly and never treats browser return as ownership',async()=>{
  const h=harness();const pending=h.api.openExternal('https://checkout.stripe.com/c/pay/cs_test_123');
  h.reply({type:'marketplace-external-result',requestId:h.sent[0].requestId,error:'Browser unavailable'});
  await assert.rejects(pending,/Browser unavailable/);
  await assert.rejects(()=>h.api.openExternal('https://evil.test'),/hosted payment/i);
});
