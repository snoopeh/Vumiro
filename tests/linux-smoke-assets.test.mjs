import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {validateReport} from '../scripts/Test-LinuxSmoke.mjs';
const require=createRequire(import.meta.url),driver=require('../scripts/linux-smoke.cjs');
const root=new URL('../',import.meta.url),pages=['/auth.html','/friends.html','/call.html'];
const html=page=>fs.readFileSync(new URL('Vumiro.Client/WebServer'+page,root),'utf8');

test('Linux content policy allows owned embedded font blobs without allowing remote font sources',()=>{
  const main=fs.readFileSync(new URL('Vumiro.Linux/main.cjs',root),'utf8'),policy=vm.runInNewContext(main.slice(main.indexOf('const CSP ='),main.indexOf('protocol.registerSchemesAsPrivileged'))+';CSP'),directives=new Map(policy.split('; ').map(rule=>{const [name,...sources]=rule.split(' ');return [name,sources];}));
  assert.deepEqual(Array.from(directives.get('font-src')),['\'self\'','data:','blob:'],'managed font/woff2 Blob URLs must be usable by the Linux renderer');assert.deepEqual(Array.from(directives.get('script-src')),['\'self\'']);assert.deepEqual(Array.from(directives.get('object-src')),['\'none\'']);assert.ok(!directives.get('font-src').some(source=>source==='https:'||source==='*'),'packages cannot load fonts from external sites');
});

test('Linux trusted asset routes cover every bundled HTML script and prepared asset',()=>{
  const main=fs.readFileSync(new URL('Vumiro.Linux/main.cjs',root),'utf8');
  const routes=vm.runInNewContext(main.slice(main.indexOf('const ASSET_PATHS'),main.indexOf('const CSP'))+';Array.from(ASSET_PATHS.keys())');
  const prepare=fs.readFileSync(new URL('Vumiro.Linux/build/prepare-assets.mjs',root),'utf8');
  const prepared=vm.runInNewContext(prepare.slice(prepare.indexOf('const expectedAssets'),prepare.indexOf('function assertGeneratedPath'))+';expectedAssets');
  assert.deepEqual([...routes].sort(),[...prepared].map(name=>'/'+name).sort(),'every explicitly prepared asset must be served by the Linux host');
  for(const page of pages)for(const match of html(page).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g))assert.ok(routes.includes(match[1]),page+' references unserved '+match[1]);
});

test('all unbundled hosts prepare the standalone stream mosaic asset',()=>{
  const linux=fs.readFileSync(new URL('Vumiro.Linux/build/prepare-assets.mjs',root),'utf8');
  const cloudflare=fs.readFileSync(new URL('cloudflare/prepare-assets.mjs',root),'utf8');
  assert.match(linux, /'stream-mosaic\.js'/);
  assert.match(cloudflare, /'stream-mosaic\.js'/);
});

function collector(){assert.equal(typeof driver.createSmokeResources,'function','smoke needs an observable packaged-resource collector');return driver.createSmokeResources();}
function request(c,id,path,type='Script'){c.record('Network.requestWillBeSent',{requestId:id,type,request:{url:'vumiro://app'+path}});}
function complete(c,id,path,status=200){c.record('Network.responseReceived',{requestId:id,type:'Script',response:{url:'vumiro://app'+path,status,fromDiskCache:true}});c.record('Network.loadingFinished',{requestId:id});}

test('smoke derives required resources from all three actual packaged HTML documents',()=>{
  assert.equal(typeof driver.requiredSmokeResources,'function','derive asset expectations from packaged HTML');
  const expected=driver.requiredSmokeResources(html);
  for(const page of pages)assert.ok(expected.includes(page));
  for(const path of ['/notification-center.js','/settings-drafts.js','/chat-pane.js','/chat-scrollbar.js','/i18n.js','/stream-mosaic.js'])assert.ok(expected.includes(path));
  const added=driver.requiredSmokeResources(page=>html(page)+(page==='/call.html'?'<script src="/future-helper.js"></script>':''));
  assert.ok(added.includes('/future-helper.js'),'new packaged script references cannot silently escape smoke coverage');
  assert.throws(()=>driver.requiredSmokeResources(()=>'<script src="https://example.test/remote.js"></script>'),/local|trusted/);
});

test('resource coverage requires status 200 and completed transfer, including iframe scripts and cached responses',()=>{
  const c=collector();request(c,'child','/chat-scrollbar.js');
  assert.equal(c.ready(['/chat-scrollbar.js']),false);
  c.record('Network.responseReceived',{requestId:'child',type:'Script',frameId:'child-frame',response:{url:'vumiro://app/chat-scrollbar.js',status:200,fromDiskCache:true}});
  assert.equal(c.ready(['/chat-scrollbar.js']),false,'a response header or successful file read is not a completed load');
  c.record('Network.loadingFinished',{requestId:'child'});assert.equal(c.ready(['/chat-scrollbar.js']),true);assert.deepEqual(c.snapshot().errors,[]);
});

test('404 and failed local packaged resources fail coverage without relying on runtime exceptions',()=>{
  for(const failure of ['404','failed']){
    const c=collector();request(c,'request','/notification-center.js');
    if(failure==='404')complete(c,'request','/notification-center.js',404);
    else c.record('Network.loadingFailed',{requestId:'request',errorText:'net::ERR_FILE_NOT_FOUND',canceled:false});
    assert.equal(c.ready(['/notification-center.js']),false);assert.equal(c.snapshot().errors.length,1);assert.match(c.snapshot().errors[0],/notification-center/);
  }
});

test('superseded navigation cancellations are harmless only if eventual required resources finish successfully',()=>{
  const c=collector();request(c,'old','/friends.html','Document');
  c.record('Network.loadingFailed',{requestId:'old',errorText:'net::ERR_ABORTED',canceled:true});
  assert.deepEqual(c.snapshot().errors,[]);assert.equal(c.ready(['/friends.html']),false);
  request(c,'new','/friends.html','Document');complete(c,'new','/friends.html');assert.equal(c.ready(['/friends.html']),true);
});

test('intentional offline account and websocket requests never become packaged resource failures',()=>{
  const c=collector();
  for(const [id,url]of [['auth','https://vumiro-smoke.supabase.co/auth/v1/token?grant_type=password'],['lobby','wss://vumiro-rooms.vumiro-signaling.workers.dev/friends-signaling?id=private']]){
    c.record('Network.requestWillBeSent',{requestId:id,type:'Fetch',request:{url}});c.record('Network.loadingFailed',{requestId:id,errorText:'net::ERR_BLOCKED_BY_CLIENT'});
  }
  assert.deepEqual(c.snapshot(),{errors:[],completed:[],pending:[]});
});

test('runner rejects missing, failed or unfinished resource evidence even when UI checks pass',()=>{
  const checks=['account-gate','fixture-authentication','packaged-assets','local-profile','legacy-ui-absent','offline-contact','nickname-no-edit','nickname-modal-narrow','nickname-save','profile-backdrop','direct-room','room-cleanup','secure-store'];
  const report={ok:true,packaged:true,checks,rendererErrors:[],blockedRequests:1,mediaRequests:0,authFixtureRequests:4,memorySessionWrites:1,resourceErrors:[],expectedResources:['/auth.html','/friends.html','/call.html','/chat-scrollbar.js'],completedResources:['/auth.html','/friends.html','/call.html','/chat-scrollbar.js'],pendingResources:[]};
  assert.doesNotThrow(()=>validateReport(report));
  assert.throws(()=>validateReport({...report,resourceErrors:undefined}),/resource/);
  assert.throws(()=>validateReport({...report,resourceErrors:['/chat-scrollbar.js: HTTP 404']}),/resource/);
  assert.throws(()=>validateReport({...report,completedResources:report.completedResources.slice(0,-1)}),/resource/);
  assert.throws(()=>validateReport({...report,pendingResources:['/chat-scrollbar.js']}),/resource/);
  assert.throws(()=>validateReport({...report,checks:checks.filter(name=>name!=='room-cleanup')}),/room-cleanup/);
});

test('real smoke observer enables resource tracking before navigation and retains child-frame failures in its report',async()=>{
  const events=new Map(),commands=[],reports=[],timers=new Map();let nextTimer=0;
  const sandbox={module:{exports:{}},URL,Response,process:{env:{VUMIRO_SMOKE_DIR:path.resolve('disposable-smoke')},on(){}},
    require:name=>name==='node:fs'?{statSync:()=>({isDirectory:()=>true}),mkdirSync(){},writeFileSync:(_path,value)=>reports.push(JSON.parse(value))}:require(name),
    setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(fs.readFileSync(new URL('scripts/linux-smoke.cjs',root),'utf8'),sandbox);
  const app={isPackaged:true,setPath(){},commandLine:{appendSwitch(){}},exit(){}},smoke=sandbox.module.exports.install({app,session:{}});
  await smoke.observe({webContents:{on(){},debugger:{on:(name,fn)=>events.set(name,fn),attach(){},sendCommand:name=>{commands.push(name);return Promise.resolve();}}}});
  assert.deepEqual(commands,['Runtime.enable','Network.enable']);
  const send=(method,params)=>events.get('message')({},method,params);
  send('Network.webSocketCreated',{url:'wss://vumiro-rooms.vumiro-signaling.workers.dev/friends-signaling?id=must-not-log'});
  send('Network.requestWillBeSent',{requestId:'child',type:'Script',frameId:'child-frame',request:{url:'vumiro://app/chat-scrollbar.js'}});
  send('Network.responseReceived',{requestId:'child',type:'Script',frameId:'child-frame',response:{url:'vumiro://app/chat-scrollbar.js',status:404}});
  send('Network.loadingFinished',{requestId:'child'});smoke.fail(Error('end observable fixture'));
  assert.equal(reports[0].lobbyConnectionAttempts,1);assert.equal(reports[0].resourceErrors.length,1);assert.match(reports[0].resourceErrors[0],/chat-scrollbar.*404/);
  assert.equal(reports[0].completedResources.length,0);assert.doesNotMatch(JSON.stringify(reports),/must-not-log/);assert.equal(timers.size,0);
});
