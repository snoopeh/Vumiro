'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { classifyNetworkError } = require('../../Vumiro.Linux/network-diagnostics.cjs');

async function probe(session, cases) {
  const errors = new Map(), waiters = new Map(), result = [];
  session.webRequest.onErrorOccurred({ urls: cases.map(item => item.url) }, details => {
    errors.set(details.url, details.error);
    waiters.get(details.url)?.(details.error);
  });
  const expected = { unknown: 'ERR_CERT_AUTHORITY_INVALID', expired: 'ERR_CERT_DATE_INVALID', hostname: 'ERR_CERT_COMMON_NAME_INVALID' };
  for (const item of cases) {
    let response;
    try { response = await session.fetch(item.url, { cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
    catch { /* Assert the Chromium event separately; fetch exception text varies. */ }
    if (item.name === 'trusted') {
      assert.ok(response?.ok, 'trusted CA was rejected by Chromium');
      assert.equal(await response.text(), 'tls-fixture');
      result.push({ name: item.name, code: '' });
      continue;
    }
    assert.equal(response, undefined, `${item.name} certificate was accepted by Chromium`);
    let error = errors.get(item.url);
    if (!error) error = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiters.delete(item.url); reject(Error(`${item.name}: no Chromium TLS error observed`)); }, 5000);
      waiters.set(item.url, value => { clearTimeout(timer); waiters.delete(item.url); resolve(value); });
    });
    assert.equal(error.replace(/^net::/, ''), expected[item.name], item.name);
    const code = classifyNetworkError(error);
    assert.equal(code, 'NETWORK_CERTIFICATE', item.name);
    result.push({ name: item.name, code });
  }
  return result;
}

module.exports = { probe };

if (require.main === module) {
  const { app, session } = require('electron');
  app.setPath('userData', process.env.VUMIRO_TLS_PROFILE);
  app.setPath('sessionData', path.join(process.env.VUMIRO_TLS_PROFILE, 'session'));
  app.whenReady().then(async () => {
    // No certificate-error handler, verification overrides, or ignore switches.
    const result = await probe(session.defaultSession, JSON.parse(process.env.VUMIRO_TLS_CASES));
    process.stdout.write('VUMIRO_TLS_RESULT=' + JSON.stringify(result) + '\n', () => app.exit(0));
  }).catch(error => { console.error(error); app.exit(1); });
}
