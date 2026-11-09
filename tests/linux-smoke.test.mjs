import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildLaunch, validatePackage, validateReport } from '../scripts/Test-LinuxSmoke.mjs';

const require = createRequire(import.meta.url);

test('smoke launch uses packaged executable, isolated data and explicit opt in without disabling sandbox', () => {
  const launch = buildLaunch('/release/linux-unpacked/vumiro', '/tmp/vumiro-smoke-unique', {
    ELECTRON_RUN_AS_NODE: '1', VUMIRO_SMOKE_DRIVER: '/untrusted', DISPLAY: ':99'
  });
  assert.equal(launch.executable, '/release/linux-unpacked/vumiro');
  assert.deepEqual(launch.args, ['--vumiro-smoke']);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launch.env.VUMIRO_SMOKE_DIR, '/tmp/vumiro-smoke-unique');
  assert.ok(launch.env.VUMIRO_SMOKE_DRIVER.endsWith(`${path.sep}scripts${path.sep}linux-smoke.cjs`));
  assert.equal(launch.env.DISPLAY, ':99');
});

test('package validation requires Linux and the built executable with its app resources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vumiro-smoke-test-'));
  try {
    const executable = path.join(root, 'vumiro');
    await assert.rejects(validatePackage(executable, 'win32'), /Linux/);
    await assert.rejects(validatePackage(executable, 'linux'), /Build.*Linux|executable/i);
    await writeFile(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46]), { mode: 0o755 });
    await assert.rejects(validatePackage(executable, 'linux'), /resources/);
    await mkdir(path.join(root, 'resources'));
    await writeFile(path.join(root, 'resources', 'app.asar'), 'fixture');
    await validatePackage(executable, 'linux');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runner requires successful packaged report and every focused UI assertion', () => {
  const checks = ['packaged-assets', 'local-profile', 'legacy-ui-absent', 'offline-contact',
    'nickname-no-edit', 'nickname-modal-narrow', 'nickname-save', 'profile-backdrop', 'direct-room', 'secure-store'];
  const report = { ok: true, packaged: true, checks, rendererErrors: [], blockedRequests: 1, mediaRequests: 0 };
  assert.doesNotThrow(() => validateReport(report));
  assert.throws(() => validateReport({ ...report, packaged: false }), /packaged/);
  assert.throws(() => validateReport({ ...report, checks: checks.slice(1) }), /packaged-assets/);
  assert.throws(() => validateReport({ ...report, rendererErrors: ['ReferenceError'] }), /renderer/);
  assert.throws(() => validateReport({ ...report, blockedRequests: 0 }), /network/);
  assert.throws(() => validateReport({ ...report, mediaRequests: 1 }), /media/);
});

test('offline driver permits only local app assets and rejects remote and malformed URLs', () => {
  const { allowSmokeRequest } = require('../scripts/linux-smoke.cjs');
  assert.equal(allowSmokeRequest('vumiro://app/friends.html'), true);
  assert.equal(allowSmokeRequest('vumiro://app/call.html?embedded=1'), true);
  for (const url of ['https://example.test', 'wss://example.test', 'http://127.0.0.1',
    'file:///tmp/test', 'vumiro://other/friends.html', 'vumiro://user@app/friends.html', 'invalid']) {
    assert.equal(allowSmokeRequest(url), false, url);
  }
});

test('packaged main loads the smoke driver only with the explicit CLI flag', () => {
  const source = readFileSync(new URL('../Vumiro.Linux/main.cjs', import.meta.url), 'utf8');
  for (const enabled of [false, true]) {
    const paths = [], loaded = [];
    const app = { getAppPath: () => '/packaged/resources/app.asar', setName() {}, getPath: () => '/normal-data',
      setPath: (...args) => paths.push(args), getVersion: () => '1.0.0', requestSingleInstanceLock: () => false, quit() {} };
    const driver = { install({ app: selectedApp }) { assert.equal(selectedApp, app); loaded.push('installed'); return {}; } };
    vm.runInNewContext(source, {
      require(name) {
        if (name === 'electron') return { app, session: {}, protocol: { registerSchemesAsPrivileged() {} } };
        if (name === '/runner/linux-smoke.cjs') return driver;
        return require(name);
      },
      process: { argv: enabled ? ['vumiro', '--vumiro-smoke'] : ['vumiro'], env: { VUMIRO_SMOKE_DRIVER: '/runner/linux-smoke.cjs' } },
      __dirname: '/packaged/resources/app.asar', URL
    });
    assert.deepEqual(loaded, enabled ? ['installed'] : []);
    assert.equal(paths.length, enabled ? 0 : 1);
    if (!enabled) assert.equal(paths[0][0], 'userData');
  }
});
