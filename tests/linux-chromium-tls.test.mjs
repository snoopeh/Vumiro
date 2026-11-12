import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let probe;
try { ({ probe } = require('./fixtures/chromium-tls-probe.cjs')); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('Chromium TLS probe verifies fetch outcomes against native webRequest certificate classifications', async () => {
  assert.equal(typeof probe, 'function', 'real Electron probe has a testable orchestration entry point');
  let listener;
  const cases = [{ name: 'trusted', url: 'https://localhost:1' }, { name: 'unknown', url: 'https://localhost:2' }, { name: 'expired', url: 'https://localhost:3' }, { name: 'hostname', url: 'https://localhost:4' }];
  const errors = ['net::ERR_CERT_AUTHORITY_INVALID', 'net::ERR_CERT_DATE_INVALID', 'net::ERR_CERT_COMMON_NAME_INVALID'];
  const session = { webRequest: { onErrorOccurred(_filter, callback) { listener = callback; } }, async fetch(url) {
    const index = cases.findIndex(item => item.url === url);
    if (!index) return { ok: true, text: async () => 'tls-fixture' };
    listener({ url, error: errors[index - 1] }); throw Error(errors[index - 1]);
  } };
  const result = await probe(session, cases);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(item => item.code), ['', 'NETWORK_CERTIFICATE', 'NETWORK_CERTIFICATE', 'NETWORK_CERTIFICATE']);
  session.fetch = async () => ({ ok: true, text: async () => 'tls-fixture' });
  await assert.rejects(probe(session, cases), /unknown.*accepted/);
  session.fetch = async () => { throw Error('unobserved transport failure'); };
  await assert.rejects(probe(session, cases), /trusted/);
});

function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(Error(`${executable} exited ${code}: ${output.slice(-6000)}`)); });
  });
}

const enabled = process.platform === 'linux' && process.env.VUMIRO_RUN_CHROMIUM_TLS === '1';
test('real Linux Chromium trusts only the disposable test CA and rejects unknown, expired and mismatched certificates', {
  skip: enabled ? false : 'Opt in on Linux with VUMIRO_RUN_CHROMIUM_TLS=1; requires Electron, openssl, NSS certutil and DISPLAY.', timeout: 180000
}, async t => {
  await command('openssl', ['version']);
  assert.ok(process.env.DISPLAY, 'DISPLAY required; use xvfb-run -a for headless Linux');
  const electron = process.env.VUMIRO_ELECTRON_PATH || require('../Vumiro.Linux/node_modules/electron');
  const root = await mkdtemp(path.join(os.tmpdir(), 'vumiro-chromium-tls-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, HOME: root, XDG_CONFIG_HOME: path.join(root, '.config'), XDG_DATA_HOME: path.join(root, '.local/share'), XDG_CACHE_HOME: path.join(root, '.cache'), XDG_STATE_HOME: path.join(root, '.local/state'), XDG_RUNTIME_DIR: path.join(root, 'runtime') };
  await mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 });
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete env[key];
  const openssl = args => command('openssl', args, { cwd: root, env });
  for (const name of ['known', 'unknown']) await openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=Vumiro disposable ${name} CA`, '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', name + '-ca.key', '-out', name + '-ca.crt']);
  await writeFile(path.join(root, 'index'), '');
  await writeFile(path.join(root, 'serial'), '1000\n');
  await writeFile(path.join(root, 'ca.conf'), '[ca]\ndefault_ca=local\n[local]\ndatabase=index\nserial=serial\nnew_certs_dir=.\ncertificate=known-ca.crt\nprivate_key=known-ca.key\ndefault_md=sha256\npolicy=policy\n[policy]\ncommonName=supplied\n');
  const cases = [];
  for (const name of ['trusted', 'unknown', 'expired', 'hostname']) {
    await writeFile(path.join(root, 'leaf.ext'), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${name === 'hostname' ? 'DNS:wrong.invalid' : 'DNS:localhost,IP:127.0.0.1'}\n`);
    await openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', name + '.key', '-out', name + '.csr']);
    if (name === 'expired') await openssl(['ca', '-batch', '-notext', '-config', 'ca.conf', '-startdate', '20200101000000Z', '-enddate', '20200102000000Z', '-extfile', 'leaf.ext', '-in', name + '.csr', '-out', name + '.crt']);
    else {
      const ca = name === 'unknown' ? 'unknown' : 'known';
      await openssl(['x509', '-req', '-days', '2', '-in', name + '.csr', '-CA', ca + '-ca.crt', '-CAkey', ca + '-ca.key', '-CAcreateserial', '-extfile', 'leaf.ext', '-out', name + '.crt']);
    }
    const server = https.createServer({ key: await readFile(path.join(root, name + '.key')), cert: await readFile(path.join(root, name + '.crt')) }, (_request, response) => response.end('tls-fixture'));
    server.on('tlsClientError', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    cases.push({ name, url: `https://127.0.0.1:${server.address().port}/` });
  }
  // Chromium M146 moved the shared DB; both locations remain entirely disposable.
  for (const relative of ['.pki/nssdb', '.local/share/pki/nssdb']) {
    const db = path.join(root, relative);
    await mkdir(db, { recursive: true });
    await command('certutil', ['-N', '-d', 'sql:' + db, '--empty-password'], { env });
    await command('certutil', ['-A', '-d', 'sql:' + db, '-n', 'Vumiro disposable known CA', '-t', 'C,,', '-i', path.join(root, 'known-ca.crt')], { env });
  }
  env.VUMIRO_TLS_CASES = JSON.stringify(cases);
  env.VUMIRO_TLS_PROFILE = path.join(root, 'electron');
  const output = await command(electron, [fileURLToPath(new URL('./fixtures/chromium-tls-probe.cjs', import.meta.url))], { env });
  const report = output.split('\n').find(line => line.startsWith('VUMIRO_TLS_RESULT='));
  assert.ok(report, output.slice(-6000));
  assert.deepEqual(JSON.parse(report.slice('VUMIRO_TLS_RESULT='.length)).map(item => item.name), cases.map(item => item.name));
});
