import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createNetworkDiagnostics,classifyNetworkError}=require('../Vumiro.Linux/network-diagnostics.cjs');
const config='https://vumiro-rooms.vumiro-signaling.workers.dev/api/v1/account/config';

test('native transport errors expose only allowlisted categories',()=>{
  for(const code of ['ERR_CERT_AUTHORITY_INVALID','ERR_CERT_DATE_INVALID','ERR_CERT_COMMON_NAME_INVALID','ERR_SSL_PROTOCOL_ERROR'])
    assert.equal(classifyNetworkError('net::'+code),'NETWORK_CERTIFICATE');
  assert.equal(classifyNetworkError('net::ERR_NAME_NOT_RESOLVED'),'NETWORK_DNS');
  assert.equal(classifyNetworkError('net::ERR_CONNECTION_TIMED_OUT'),'NETWORK_TIMEOUT');
  assert.equal(classifyNetworkError('net::ERR_INTERNET_DISCONNECTED'),'NETWORK_OFFLINE');
  assert.equal(classifyNetworkError('unrecognized secret token'),'NETWORK_FAILED');
});

function fixture(){
  const listeners={};let clock=1000,online=true;
  const webRequest={onErrorOccurred(filter,fn){listeners.error=fn;},onCompleted(filter,fn){listeners.complete=fn;}};
  const diagnostics=createNetworkDiagnostics({webRequest,isOnline:()=>online,now:()=>clock});
  diagnostics.install();
  return {diagnostics,listeners,tick:()=>clock+=31000,offline:()=>online=false};
}

test('diagnostics observe failures and recovery without making or replaying requests',()=>{
  const f=fixture();
  f.listeners.error({url:config,error:'net::ERR_CERT_AUTHORITY_INVALID'});
  assert.deepEqual(f.diagnostics.check(config),{ok:false,code:'NETWORK_CERTIFICATE'});
  f.listeners.complete({url:config});
  assert.deepEqual(f.diagnostics.check(config),{ok:true,code:''});
  f.offline();assert.deepEqual(f.diagnostics.check(config),{ok:false,code:'NETWORK_OFFLINE'});
});

test('fresh native errors remain independent per origin and expire',()=>{
  const f=fixture(),auth='https://project.supabase.co/auth/v1/token?grant_type=password';
  f.listeners.error({url:auth,error:'net::ERR_NAME_NOT_RESOLVED'});
  assert.equal(f.diagnostics.check(auth).code,'NETWORK_DNS');
  assert.equal(f.diagnostics.check(config).code,'NETWORK_FAILED');
  f.listeners.error({url:config,error:'net::ERR_CERT_DATE_INVALID'});
  f.listeners.complete({url:auth});
  assert.equal(f.diagnostics.check(config).code,'NETWORK_CERTIFICATE');
  f.tick();assert.equal(f.diagnostics.check(config).code,'NETWORK_FAILED');
});

test('diagnostics reject unrelated endpoints and discard raw error details',()=>{
  const f=fixture();
  for(const url of ['https://attacker.test/api/v1/account/config','http://project.supabase.co/auth/v1/token','https://user:password@project.supabase.co/auth/v1/token','https://project.supabase.co:444/auth/v1/token','https://project.supabase.co/storage/v1/object','https://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling']){
    f.listeners.error({url,error:'net::ERR_CERT_AUTHORITY_INVALID secret-token'});
    assert.deepEqual(f.diagnostics.check(url),{ok:false,code:'NETWORK_FAILED'});
  }
  f.listeners.error({url:config+'?token=secret',error:'unexpected secret-token'});
  assert.doesNotMatch(JSON.stringify(f.diagnostics.check(config)),/secret|https|token/);
});

test('native observer ignores untrusted requests and bounds retained origin outcomes',()=>{
  let onError;
  const diagnostics=createNetworkDiagnostics({webRequest:{onErrorOccurred(_filter,fn){onError=fn;},onCompleted(){}},isTrustedRequest:details=>details.trusted===true});
  diagnostics.install();
  onError({url:config,error:'net::ERR_CERT_AUTHORITY_INVALID'});
  assert.equal(diagnostics.check(config).code,'NETWORK_FAILED');
  for(let i=0;i<33;i++)onError({url:`https://project-${i}.supabase.co/auth/v1/token`,error:'net::ERR_NAME_NOT_RESOLVED',trusted:true});
  assert.equal(diagnostics.check('https://project-0.supabase.co/auth/v1/token').code,'NETWORK_FAILED');
  assert.equal(diagnostics.check('https://project-32.supabase.co/auth/v1/token').code,'NETWORK_DNS');
});

test('actual diagnostics IPC closure rejects foreign callers and malformed requests before lookup',()=>{
  const source=fs.readFileSync(new URL('../Vumiro.Linux/main.cjs',import.meta.url),'utf8');
  const functions=['parseAppUrl','isTrustedPage','validMainFrame','validAccountFrame'].map(name=>{
    const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);return source.slice(start,end+2);
  }).join('\n');
  const start=source.indexOf("  ipcMain.handle('vumiro:network-diagnostics'"),end=source.indexOf("  ipcMain.handle('vumiro:oauth'",start);
  let handler,calls=0;
  const contents={mainFrame:{url:'vumiro://app/auth.html'}};
  vm.runInNewContext(functions+'\n'+source.slice(start,end),{APP_SCHEME:'vumiro',APP_HOST:'app',URL,mainWindow:{webContents:contents},
    networkDiagnostics:{check(){calls++;return {ok:false,code:'NETWORK_CERTIFICATE'};}},ipcMain:{handle(_channel,fn){handler=fn;}}});
  const trusted={sender:contents,senderFrame:contents.mainFrame};
  for(const event of [{sender:{},senderFrame:contents.mainFrame},{sender:contents,senderFrame:{url:contents.mainFrame.url}}]){
    assert.equal(handler(event,{get url(){throw Error('untrusted request inspected');}}).code,'NETWORK_FAILED');
  }
  for(const request of [null,[],{}, {url:config,body:'secret'}, {url:7}, {url:'x'.repeat(2049)}])assert.equal(handler(trusted,request).code,'NETWORK_FAILED');
  assert.equal(calls,0);
  assert.equal(handler(trusted,{url:config}).code,'NETWORK_CERTIFICATE');assert.equal(calls,1);
  contents.mainFrame.url='vumiro://app/call.html';assert.equal(handler(trusted,{url:config}).code,'NETWORK_FAILED');assert.equal(calls,1);
});

test('packaged host and preload use a trusted, read-only diagnostics boundary',async()=>{
  const main=fs.readFileSync(new URL('../Vumiro.Linux/main.cjs',import.meta.url),'utf8');
  assert.match(main,/ipcMain\.handle\('vumiro:network-diagnostics'/);
  const fragment=main.slice(main.indexOf("ipcMain.handle('vumiro:network-diagnostics'"));
  assert.match(fragment.slice(0,600),/validAccountFrame\(event.sender, event.senderFrame\)/);
  const pkg=JSON.parse(fs.readFileSync(new URL('../Vumiro.Linux/package.json',import.meta.url)));
  assert.ok(pkg.build.files.includes('network-diagnostics.cjs'));
  let bridge;const invocations=[];
  const electron={contextBridge:{exposeInMainWorld(_name,value){bridge=value;}},ipcRenderer:{on(){},async invoke(...args){invocations.push(args);return {ok:false,code:'NETWORK_DNS'};}}};
  vm.runInNewContext(fs.readFileSync(new URL('../Vumiro.Linux/preload.js',import.meta.url),'utf8'),{require:()=>electron,process:{argv:[]}});
  assert.equal((await bridge.networkDiagnostics.check(config)).code,'NETWORK_DNS');
  assert.deepEqual(invocations[0].slice(0,1),['vumiro:network-diagnostics']);
});
