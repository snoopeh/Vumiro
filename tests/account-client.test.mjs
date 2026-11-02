import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, randomUUID } from 'node:crypto';

const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/account-client.js',import.meta.url),'utf8');

class Element {
  constructor(id=''){this.id=id;this.hidden=false;this.value='';this.checked=false;this.disabled=false;this.textContent='';this.className='';this.attributes={};this.listeners=new Map();this.classList={toggle(){},add(){}};}
  append(...children){this.children=(this.children||[]).concat(children);}
  appendChild(child){this.append(child);return child;}
  after(){}
  before(){}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(type,callback){this.listeners.set(type,callback);}
  showModal(){this.open=true;}
  close(){this.open=false;this.listeners.get('close')?.();}
  focus(){}
  reportValidity(){return true;}
  querySelector(){return null;}
  replaceChildren(...children){this.children=children;}
  insertBefore(child){this.append(child);return child;}
  click(){}
}

function response(status,value){return {ok:status>=200&&status<300,status,async json(){return value;}};}

function harness({stored='',route,authPage=false,oauth,href='https://vumiro.local/friends.html'}={}) {
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const listeners=new Map();
  const storage=new Map();
  const secure={value:stored,writes:[],async get(){return this.value;},async set(value){this.value=value;this.writes.push(value);},async delete(){this.value='';this.writes.push('');}};
  const calls=[];
  const fetch=async(url,options={})=>{calls.push({url:String(url),options});return route?route(String(url),options,calls):response(200,{});};
  const navigations=[];
  const sandbox={
    window:{vumiroDesktop:{secureStore:secure,oauth},VumiroLocalProfile:{profile:()=>null,accountSnapshot:async()=>({version:1,profile:{name:'Local',username:'',avatar:''},friends:[],blocked:[],settings:{}}),applyAccountSnapshot:async()=>{}}},
    document:{body:{dataset:{page:authPage?'auth':'friends'}},getElementById:element,createElement:()=>new Element()},location:{href,search:new URL(href).search,assign:url=>navigations.push(url)},fetch,
    crypto:{...webcrypto,subtle:webcrypto.subtle,randomUUID,getRandomValues:bytes=>webcrypto.getRandomValues(bytes)},TextEncoder,Blob,URL,btoa:binary=>Buffer.from(binary,'binary').toString('base64'),
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    addEventListener:(type,callback)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(callback);},
    dispatchEvent(){},Event,StorageEvent:class {},setTimeout,clearTimeout,confirm:()=>true,console
  };
  sandbox.window.window=sandbox.window;sandbox.window.chrome=undefined;
  vm.runInNewContext(source,sandbox,{filename:'account-client.js'});
  return {elements,element,listeners,secure,calls,storage,sandbox,navigations,async start(){for(const callback of listeners.get('DOMContentLoaded')||[])await callback();}};
}

const config={authUrl:'https://project.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrstuvwxyz',serviceEnabled:true,registrationEnabled:true,privacyNoticeVersion:'2026-11-01'};
const session={access_token:'header.payload.signature',refresh_token:'refresh-next',expires_in:3600,user:{id:'11111111-1111-4111-8111-111111111111',email:'person@example.com'}};
const saved=JSON.stringify({version:2,refreshToken:'refresh-old',deviceId:'22222222-2222-4222-8222-222222222222',deviceToken:'a'.repeat(64)});

function commonRoute(url) {
  if(url.endsWith('/api/v1/account/config'))return response(200,config);
  if(url.includes('/auth/v1/token?grant_type=refresh_token'))return response(200,session);
  if(url.endsWith('/api/v1/account/data'))return response(200,{account:{email:'person@example.com'},data:null,revision:0,devices:[]});
  if(url.includes('/auth/v1/logout?scope='))return response(200,{});
  throw new Error(`Unexpected request ${url}`);
}

test('ordinary sign out uses local provider scope and retains only device credentials',async()=>{
  const app=harness({stored:saved,route:commonRoute});await app.start();
  await app.element('accountSignOut').onclick();
  assert.ok(app.calls.some(call=>call.url.endsWith('/auth/v1/logout?scope=local')));
  const persisted=JSON.parse(app.secure.value);
  assert.equal(persisted.refreshToken,undefined);
  assert.equal(persisted.deviceId,'22222222-2222-4222-8222-222222222222');
  assert.equal(persisted.deviceToken,'a'.repeat(64));
});

test('explicit all-device sign out reauthenticates, revokes Worker devices, and uses global provider scope',async()=>{
  const app=harness({stored:saved,route:(url,options)=>{
    if(url.includes('/auth/v1/token?grant_type=password'))return response(200,session);
    if(url.endsWith('/api/v1/account/devices/revoke-all'))return response(200,{ok:true,revokedDevices:2});
    return commonRoute(url,options);
  }});await app.start();
  await app.element('accountSignOutEverywhere').onclick();
  app.element('accountConfirmPassword').value='current password';
  await app.element('accountReauthForm').onsubmit({preventDefault(){}});
  assert.ok(app.calls.some(call=>call.url.endsWith('/api/v1/account/devices/revoke-all')));
  assert.ok(app.calls.some(call=>call.url.endsWith('/auth/v1/logout?scope=global')));
  assert.equal(app.secure.value,'');
});

test('password recovery changes the password before activating and enrolling',async()=>{
  const order=[];
  const app=harness({route:(url,options)=>{
    if(url.endsWith('/api/v1/account/config'))return response(200,config);
    if(url.endsWith('/auth/v1/verify')){order.push('verify');return response(200,session);}
    if(url.endsWith('/auth/v1/user')){order.push('password');return response(200,{user:session.user});}
    if(url.endsWith('/api/v1/account/devices/register')){order.push('enroll');return response(201,{deviceToken:'b'.repeat(64)});}
    if(url.endsWith('/api/v1/account/data')){order.push('sync');return response(200,{account:{email:'person@example.com'},data:null,revision:0,devices:[]});}
    throw new Error(`Unexpected request ${url}`);
  }});await app.start();
  app.element('accountResetEmail').value='person@example.com';app.element('accountResetCode').value='123456';app.element('accountNewPassword').value='a long new password';
  await app.element('accountResetForm').onsubmit({preventDefault(){}});
  assert.deepEqual(order,['verify','password','enroll','sync']);
});

test('pending signup verification resumes without storing the password',async()=>{
  const pending={version:2,pendingSignup:{email:'pending@example.com',acceptedAt:'2026-11-01T12:00:00.000Z',noticeVersion:'2026-11-01'}};
  const app=harness({authPage:true,stored:JSON.stringify(pending),route:url=>url.endsWith('/api/v1/account/config')?response(200,config):response(404,{error:'not found'})});await app.start();
  assert.equal(app.element('accountVerifyForm').hidden,false);
  assert.equal(app.element('accountEmail').value,'pending@example.com');
  assert.equal(app.secure.value.includes('password'),false);
});

test('manual backup and export share one serialized account-operation queue',async()=>{
  let inFlight=0,maxInFlight=0,measure=false;
  const remoteSnapshot={version:1,profile:{name:'Remote',username:'',avatar:''},friends:[],blocked:[],settings:{},privacyNoticeVersion:'2026-11-01',privacyNoticeAcceptedAt:'2026-11-01T12:00:00.000Z',identityRecovery:{version:1}};
  const route=async (url,options)=>{
    if(measure){inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);await new Promise(resolve=>setTimeout(resolve,5));inFlight--;}
    if(url.endsWith('/api/v1/account/config'))return response(200,config);
    if(url.includes('/auth/v1/token?grant_type=refresh_token'))return response(200,session);
    if(url.endsWith('/api/v1/account/export'))return response(200,{version:1,account:{},data:null,sync:{revision:1},devices:[],noticeRecords:[]});
    if(url.endsWith('/api/v1/account/data')&&options.method==='PUT')return response(200,{ok:true,revision:2,updatedAt:new Date().toISOString()});
    if(url.endsWith('/api/v1/account/data'))return response(200,{account:{email:'person@example.com'},data:remoteSnapshot,revision:1,devices:[]});
    throw new Error(`Unexpected request ${url}`);
  };
  const app=harness({stored:saved,route});await app.start();measure=true;
  app.element('accountPrivacyAck').checked=true;
  await Promise.all([app.element('accountBackup').onclick(),app.element('accountExport').onclick()]);
  assert.equal(maxInFlight,1);
});

test('reauthentication targets the existing reauth form id',()=>{
  assert.doesNotMatch(source,/\$\('accountReauth'\)/);
  assert.match(source,/\$\('accountReauthForm'\)/);
});

test('dedicated account page shows signup and keeps local profile access available',async()=>{
  const app=harness({route:commonRoute,authPage:true,href:'https://vumiro.local/auth.html?room=invite#shared'});await app.start();
  app.sandbox.window.VumiroAccount.open('signup');
  assert.equal(app.element('accountHeading').textContent,'Make yourself at home.');
  assert.equal(app.element('accountSignUp').hidden,false);
  assert.equal(app.element('accountSignIn').hidden,true);
  assert.equal(app.element('accountResetRequestForm').hidden,true);
  assert.equal(app.element('accountPassword').minLength,12);
  app.element('continueLocal').onclick();
  assert.equal(app.navigations.at(-1),'https://vumiro.local/friends.html?room=invite&view=local#shared');
});

test('signup validates matching passwords then enters a dedicated verification screen',async()=>{
  const app=harness({authPage:true,route:(url)=>url.endsWith('/auth/v1/signup')?response(200,{}):commonRoute(url)});await app.start();
  app.sandbox.window.VumiroAccount.open('signup');
  app.element('accountEmail').value='new@example.com';app.element('accountPassword').value='a safe password 123';app.element('accountPasswordConfirm').value='wrong';app.element('accountPrivacyAck').checked=true;
  await app.element('accountForm').onsubmit({preventDefault(){}});
  assert.equal(app.element('accountError').textContent,'Your passwords do not match.');
  assert.equal(app.calls.filter(call=>call.url.endsWith('/auth/v1/signup')).length,0);
  app.element('accountPasswordConfirm').value='a safe password 123';
  await app.element('accountForm').onsubmit({preventDefault(){}});
  assert.equal(app.element('accountHeading').textContent,'Check your email.');
  assert.equal(app.element('accountVerifyForm').hidden,false);
  assert.equal(app.element('accountForm').hidden,true);
  assert.equal(app.secure.value.includes('a safe password 123'),false);
});

test('forgot password only shows the request screen and recovery errors stay visible',async()=>{
  const app=harness({authPage:true,route:url=>url.endsWith('/auth/v1/recover')?response(429,{message:'Please try again shortly.'}):commonRoute(url)});await app.start();
  app.sandbox.window.VumiroAccount.open('signin');app.element('accountEmail').value='person@example.com';app.element('accountForgotPassword').onclick();
  assert.equal(app.element('accountResetRequestForm').hidden,false);
  assert.equal(app.element('accountForm').hidden,true);
  assert.equal(app.element('accountResetEmail').value,'person@example.com');
  await app.element('accountResetRequestForm').onsubmit({preventDefault(){}});
  assert.equal(app.element('accountFeedback').textContent,'Please try again shortly.');
  assert.equal(app.element('accountResetForm').hidden,true);
});

test('unprovisioned account service shows an honest message and can retry without losing local profile access',async()=>{
  let available=false;
  const app=harness({authPage:true,route:url=>url.endsWith('/api/v1/account/config')?response(available?200:404,available?config:{}):commonRoute(url)});await app.start();
  app.sandbox.window.VumiroAccount.open('signin');
  assert.match(app.element('accountFeedback').textContent,/Accounts are not available yet/);
  available=true;await app.element('accountRetry').onclick();
  assert.equal(app.element('accountError').textContent,'');
  assert.equal(app.element('accountFeedback').textContent,'Account service connected.');
  assert.equal(app.element('accountSignIn').disabled,false);
});

test('first run and signed-out account entry route to a dedicated page without dropping invitation parameters',async()=>{
  const app=harness({route:commonRoute,href:'https://vumiro.local/friends.html?invite=room-code&password=secret#room'});await app.start();
  assert.equal(app.navigations[0],'https://vumiro.local/auth.html?invite=room-code&password=secret#room');
  app.sandbox.window.VumiroAccount.open();
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?invite=room-code&password=secret#room');
});

test('Google uses a fresh PKCE challenge and persists only the app refresh token',async()=>{
  let bridgeInput;
  const app=harness({authPage:true,oauth:{signIn:async input=>{bridgeInput=input;return {code:'single-use-code'};}},route:(url,options)=>{
    if(url.endsWith('/api/v1/account/config'))return response(200,{...config,oauthProviders:['google','azure']});
    if(url.endsWith('/auth/v1/token?grant_type=pkce'))return response(200,{...session,provider_token:'private-google-token',provider_refresh_token:'private-google-refresh',user:{...session.user,app_metadata:{providers:['google']}}});
    if(url.endsWith('/api/v1/account/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    return commonRoute(url,options);
  }});await app.start();app.element('accountPrivacyAck').checked=true;
  await app.element('accountGoogle').onclick();
  assert.equal(bridgeInput.provider,'google');assert.equal(bridgeInput.authUrl,config.authUrl);assert.match(bridgeInput.codeChallenge,/^[A-Za-z0-9_-]{43}$/);
  const request=app.calls.find(call=>call.url.endsWith('/token?grant_type=pkce'));
  const body=JSON.parse(request.options.body);assert.equal(body.auth_code,'single-use-code');assert.match(body.code_verifier,/^[A-Za-z0-9_-]{43}$/);
  const digest=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(body.code_verifier));
  assert.equal(Buffer.from(digest).toString('base64url'),bridgeInput.codeChallenge);
  assert.equal(JSON.parse(app.secure.value).refreshToken,session.refresh_token);
  assert.doesNotMatch(app.secure.value,/private-google|code_verifier|single-use-code/);
  assert.match(app.navigations.at(-1),/friends\.html/);
});

test('OAuth waits for privacy acknowledgement, rejects invalid callbacks, and shows disabled providers truthfully',async()=>{
  let calls=0;
  const app=harness({authPage:true,oauth:{signIn:async()=>{calls++;return {code:''};}},route:url=>url.endsWith('/api/v1/account/config')?response(200,{...config,oauthProviders:['azure']}):commonRoute(url)});await app.start();
  assert.equal(app.element('accountGoogle').disabled,true);assert.equal(app.element('accountMicrosoft').disabled,false);
  await app.element('accountMicrosoft').onclick();assert.equal(calls,0);assert.match(app.element('accountError').textContent,/privacy/);
  app.element('accountPrivacyAck').checked=true;await app.element('accountMicrosoft').onclick();
  assert.equal(calls,1);assert.match(app.element('accountError').textContent,/valid sign-in code/);assert.equal(app.secure.value,'');
});

test('social security confirmation rejects a different user even when emails match',async()=>{
  const socialSession={...session,user:{...session.user,app_metadata:{providers:['google']}}};
  const app=harness({stored:saved,oauth:{signIn:async()=>({code:'confirmation-code'})},route:url=>{
    if(url.endsWith('/api/v1/account/config'))return response(200,{...config,oauthProviders:['google']});
    if(url.includes('grant_type=refresh_token'))return response(200,socialSession);
    if(url.includes('grant_type=pkce'))return response(200,{...socialSession,user:{...socialSession.user,id:'other-user'}});
    return commonRoute(url);
  }});await app.start();app.element('accountDelete').onclick();
  await app.element('accountReauthgoogle').onclick();
  assert.match(app.element('accountFeedback').textContent,/same account/);
  assert.equal(app.calls.some(call=>call.url.endsWith('/api/v1/account/data')&&call.options.method==='DELETE'),false);
});

test('restored social session stays on encrypted identity unlock before entering friends',async()=>{
  const app=harness({authPage:true,stored:saved,route:url=>{
    if(url.endsWith('/api/v1/account/config'))return response(200,{...config,oauthProviders:['google']});
    if(url.includes('grant_type=refresh_token'))return response(200,session);
    if(url.endsWith('/api/v1/account/data'))return response(200,{account:{email:session.user.email},revision:1,devices:[],data:{identityRecovery:{identityId:'saved-identity'}}});
    throw Error(`Unexpected request ${url}`);
  }});await app.start();
  assert.equal(app.element('accountUnlockForm').hidden,false);
  assert.equal(app.element('accountActions').hidden,true);
  assert.equal(app.element('accountHeading').textContent,'Bring your friends with you.');
  assert.equal(app.navigations.length,0);
});
