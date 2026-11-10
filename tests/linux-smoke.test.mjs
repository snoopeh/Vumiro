import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildLaunch, validatePackage, validateReport, smokeDiagnostics } from '../scripts/Test-LinuxSmoke.mjs';

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
  const checks = ['account-gate', 'fixture-authentication', 'packaged-assets', 'local-profile', 'legacy-ui-absent', 'offline-contact',
    'nickname-no-edit', 'nickname-modal-narrow', 'nickname-save', 'profile-backdrop', 'direct-room', 'secure-store'];
  const report = { ok: true, packaged: true, checks, rendererErrors: [], blockedRequests: 1, mediaRequests: 0, authFixtureRequests: 4, memorySessionWrites: 1 };
  assert.doesNotThrow(() => validateReport(report));
  assert.throws(() => validateReport({ ...report, packaged: false }), /packaged/);
  assert.throws(() => validateReport({ ...report, checks: checks.filter(check=>check!=='packaged-assets') }), /packaged-assets/);
  assert.throws(() => validateReport({ ...report, rendererErrors: ['ReferenceError'] }), /renderer/);
  assert.throws(() => validateReport({ ...report, blockedRequests: 0 }), /network/);
  assert.throws(() => validateReport({ ...report, mediaRequests: 1 }), /media/);
  assert.throws(() => validateReport({ ...report, authFixtureRequests: 0 }), /authentication fixture/);
  assert.throws(() => validateReport({ ...report, memorySessionWrites: 0 }), /memory session/);
  assert.throws(() => validateReport({ ...report, checks: checks.filter(check=>check!=='account-gate') }), /account-gate/);
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


test('offline account fixture serves only exact in-process endpoints and verifies authentication headers',async()=>{
  const { createSmokeAccountFixture }=require('../scripts/linux-smoke.cjs'),fixture=createSmokeAccountFixture();
  const service='https://vumiro-rooms.vumiro-signaling.workers.dev',auth='https://vumiro-smoke.supabase.co';
  const config=await (await fixture.serve(new Request(service+'/api/v1/account/config'))).json();
  assert.equal(config.authUrl,auth);assert.equal(config.serviceEnabled,true);
  for(const url of ['https://example.test',service+'/api/v1/account/data?extra=1',auth+'/auth/v1/token?grant_type=password&redirect_to=https://example.test',auth+'/auth/v1/user'])assert.equal(fixture.allows(url),false,url);
  assert.equal((await fixture.serve(new Request(service+'/api/v1/account/data'))).status,401);
  const signed=await fixture.serve(new Request(auth+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:config.publishableKey},body:JSON.stringify(fixture.credentials)}));
  const session=await signed.json();assert.equal(signed.status,200);assert.equal(session.user.user_metadata.full_name,'Linux Smoke');
  const device='22222222-2222-4222-8222-222222222222',headers={Authorization:'Bearer '+session.access_token,'X-Vumiro-Device':device};
  const registration=await fixture.serve(new Request(service+'/api/v1/account/devices/register',{method:'POST',headers}));assert.equal(registration.status,201);
  const token=(await registration.json()).deviceToken;
  const data=await fixture.serve(new Request(service+'/api/v1/account/data',{headers:{...headers,'X-Vumiro-Device-Token':token}}));assert.equal(data.status,200);assert.equal((await data.json()).data,null);
  assert.equal((await fixture.serve(new Request('https://example.test'))).status,403);
  assert.ok(fixture.stats().requests>=4);
});

test('smoke credential adapter accepts only its synthetic session from its own main frame and keeps it in memory',async()=>{
  const {createSmokeAccountFixture}=require('../scripts/linux-smoke.cjs'),fixture=createSmokeAccountFixture();
  const contents={mainFrame:{url:'vumiro://app/auth.html'}},event={sender:contents,senderFrame:contents.mainFrame};
  const signed=await fixture.serve(new Request('https://vumiro-smoke.supabase.co/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:'sb_publishable_vumiro_smoke_fixture_only'},body:JSON.stringify(fixture.credentials)}));
  const session=await signed.json(),value=JSON.stringify({version:2,refreshToken:session.refresh_token,deviceId:'22222222-2222-4222-8222-222222222222',deviceToken:'',deviceAccountId:session.user.id});
  assert.equal(fixture.secureStore(event,{action:'get'},contents),'');
  assert.throws(()=>fixture.secureStore({...event,senderFrame:{url:'vumiro://app/auth.html'}},{action:'set',value},contents),/main frame/);
  assert.throws(()=>fixture.secureStore(event,{action:'set',value:JSON.stringify({refreshToken:'unrelated-real-credential'})},contents),/synthetic/);
  assert.equal(fixture.secureStore(event,{action:'set',value},contents),true);
  assert.equal(fixture.secureStore(event,{action:'get'},contents),value);assert.equal(fixture.stats().writes,1);
  assert.equal(fixture.secureStore(event,{action:'delete'},contents),true);assert.equal(fixture.secureStore(event,{action:'get'},contents),'');
  contents.mainFrame.url='vumiro://app/call.html';assert.throws(()=>fixture.secureStore(event,{action:'get'},contents),/main frame/);
});


test('failed smoke diagnostics retain bounded stage progress without session or renderer contents',()=>{
  const summary=smokeDiagnostics({stage:'observe:runtime-enable',progress:[{stage:'driver:installed',ms:0},{stage:'observe:runtime-enable',ms:100}],checks:['account-gate'],blockedRequests:3,authFixtureRequests:0,memorySessionWrites:0,rendererErrors:['must-not-leak-renderer-content'],refreshToken:'must-not-leak-session'});
  assert.equal(summary.stage,'observe:runtime-enable');assert.equal(summary.progress.at(-1).ms,100);
  assert.equal(summary.blockedRequests,3);assert.doesNotMatch(JSON.stringify(summary),/must-not-leak/);
});

test('smoke stage deadlines identify a pending native operation and retain earlier ordered progress',async()=>{
  const {createSmokeProgress,withSmokeDeadline}=require('../scripts/linux-smoke.cjs');
  const report={};let now=100;const progress=createSmokeProgress(report,()=>now);
  progress('driver:installed');now=150;progress('configure:ready');now=200;progress('observe:runtime-enable');
  await assert.rejects(withSmokeDeadline(()=>new Promise(()=>{}),'observe:runtime-enable',5),/observe:runtime-enable/);
  assert.deepEqual(report.progress.map(item=>item.stage),['driver:installed','configure:ready','observe:runtime-enable']);
  assert.equal(report.stage,'observe:runtime-enable');assert.equal(report.progress.at(-1).ms,100);
  assert.equal(await withSmokeDeadline(async()=>true,'completed-stage',20),true);
});


function bootstrapDriver(sendCommand){
  const timers=new Map(),order=[],reports=[],exits=[];let timerId=0;
  const app={isPackaged:true,setPath(){},commandLine:{appendSwitch(){}},exit:code=>exits.push(code)};
  const sandbox={module:{exports:{}},require:name=>name==='node:fs'?{statSync:()=>({isDirectory:()=>true}),mkdirSync(){},writeFileSync:(_path,value)=>reports.push(JSON.parse(value))}:require(name),
    process:{env:{VUMIRO_SMOKE_DIR:path.join(os.tmpdir(),'vumiro-smoke-bootstrap')},on(){}},URL,Response,
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(readFileSync(new URL('../scripts/linux-smoke.cjs',import.meta.url),'utf8'),sandbox);
  const driver=sandbox.module.exports.install({app,session:{}});
  const contents={on(){},debugger:{on(){},attach(){order.push('attach');},sendCommand:command=>{order.push(command);return sendCommand();}},executeJavaScript(){order.push('evaluate');throw Error('bootstrap evaluation reached');}};
  return {driver,window:{webContents:contents},timers,order,reports,exits};
}

test('smoke observer lets main load the first document before awaiting runtime readiness',async()=>{
  let enableRuntime;
  const ready=new Promise(resolve=>{enableRuntime=resolve;}),f=bootstrapDriver(()=>ready);
  let observed=false;const observing=f.driver.observe(f.window).then(()=>{observed=true;});observing.catch(()=>{});
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(observed,true,'observe must not block main before its initial loadURL');
  assert.equal([...f.timers.values()].filter(timer=>timer.ms===5000).length,0,'runtime deadline starts after initial navigation');
  f.order.push('loadURL');enableRuntime();await observing;
  await f.driver.run(f.window);
  assert.deepEqual(f.order,['attach','Runtime.enable','loadURL','evaluate']);
  assert.match(f.reports.at(-1).error,/bootstrap evaluation reached/);
  assert.ok(f.reports.at(-1).progress.some(item=>item.stage==='run:renderer-ready'));
});

test('runtime readiness rejection is retained and reported when run starts',async()=>{
  const f=bootstrapDriver(()=>Promise.reject(Error('CDP readiness failed')));
  await f.driver.observe(f.window);await Promise.resolve();
  await f.driver.run(f.window);
  assert.equal(f.order.includes('evaluate'),false);assert.match(f.reports.at(-1).error,/CDP readiness failed/);assert.deepEqual(f.exits,[1]);
});
