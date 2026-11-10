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

function harness({stored='',route,authPage=false,oauth,href,localProfile=null,callFrame=null,pageMarker=true}={}) {
  href=href||(authPage?'https://vumiro.local/auth.html':'https://vumiro.local/friends.html');
  const elements=new Map();
  const element=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
  const listeners=new Map();
  const storage=new Map();
  const secure={value:stored,writes:[],async get(){return this.value;},async set(value){this.value=value;this.writes.push(value);},async delete(){this.value='';this.writes.push('');}};
  const calls=[];
  const events=[],clock={now:Date.now()};
  class ClockDate extends Date { static now(){return clock.now;} }
  const fetch=async(url,options={})=>{calls.push({url:String(url),options});return route?route(String(url),options,calls):response(200,{});};
  const navigations=[],createdProfiles=[];
  const sandbox={
    window:{vumiroDesktop:{secureStore:secure,oauth},VumiroLocalProfile:{profile:()=>localProfile,createProfile:async name=>{createdProfiles.push(name);localProfile={id:'new-local-identity',name};return localProfile;},accountSnapshot:async()=>({version:1,profile:{name:'Local',username:'',avatar:''},friends:[],blocked:[],settings:{}}),applyAccountSnapshot:async()=>{}}},
    document:{body:{dataset:pageMarker?{page:authPage?'auth':'friends'}:{}},getElementById:element,createElement:()=>new Element(),querySelector:selector=>selector==='#callFrameSlot iframe'?callFrame:null},location:{href,search:new URL(href).search,assign:url=>navigations.push(url)},fetch,Date:ClockDate,
    crypto:{...webcrypto,subtle:webcrypto.subtle,randomUUID,getRandomValues:bytes=>webcrypto.getRandomValues(bytes)},TextEncoder,Blob,URL,btoa:binary=>Buffer.from(binary,'binary').toString('base64'),
    localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    addEventListener:(type,callback)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(callback);},
    dispatchEvent(event){events.push(event);for(const callback of listeners.get(event.type)||[])callback(event);return true;},Event,StorageEvent:class {},setTimeout,clearTimeout,confirm:()=>true,console
  };
  sandbox.window.window=sandbox.window;sandbox.window.chrome=undefined;
  vm.runInNewContext(source,sandbox,{filename:'account-client.js'});
  return {elements,element,listeners,secure,calls,storage,sandbox,navigations,events,clock,createdProfiles,async start(){for(const callback of listeners.get('DOMContentLoaded')||[])await callback();}};
}

const config={authUrl:'https://project.supabase.co',publishableKey:'sb_publishable_abcdefghijklmnopqrstuvwxyz',serviceEnabled:true,registrationEnabled:true,privacyNoticeVersion:'2026-11-03'};
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

test('sign out preserves invitation routing while returning to the sign in screen',async()=>{
  const app=harness({stored:saved,route:commonRoute,href:'https://vumiro.local/friends.html?invite=room-code&view=local#room'});await app.start();
  await app.element('accountSignOut').onclick();
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?invite=room-code&authView=signin#room');
});

test('public account state is immutable and token-free and logout returns to sign in with the local profile intact',async()=>{
  const localProfile={id:'local-identity',name:'Local'},callFrame={connected:true};
  const app=harness({stored:saved,route:commonRoute,localProfile,callFrame});
  const account=app.sandbox.window.VumiroAccount;
  assert.equal(account.getState().signedIn,false);
  await app.start();
  const state=account.getState();
  assert.deepEqual(Object.keys(state).sort(),['email','signedIn']);
  assert.equal(state.signedIn,true);assert.equal(state.email,session.user.email);
  assert.ok(Object.isFrozen(state));
  assert.equal(JSON.stringify(account.state()),JSON.stringify(state));
  assert.doesNotMatch(JSON.stringify(state),/header\.payload|refresh-next|22222222|aaaaaaa/);
  const changes=app.events.filter(event=>event.type==='vumiro-account-state-changed').length;
  await account.signOut();
  assert.equal(account.getState().signedIn,false);assert.equal(account.getState().email,'');
  assert.ok(app.events.filter(event=>event.type==='vumiro-account-state-changed').length>changes);
  assert.equal(app.sandbox.window.VumiroLocalProfile.profile(),localProfile);
  assert.equal(app.sandbox.document.querySelector('#callFrameSlot iframe'),callFrame);
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?authView=signin');
  const requests=app.calls.length;account.scheduleSync();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(app.calls.length,requests,'signed-out profile changes cannot schedule account uploads');
});

test('ordinary logout refreshes an expired access token before revoking the local provider session',async()=>{
  let refreshes=0;
  const app=harness({stored:saved,route:url=>{
    if(url.includes('grant_type=refresh_token'))return response(200,{...session,access_token:++refreshes===1?session.access_token:'fresh-logout-access'});
    return commonRoute(url);
  }});await app.start();
  app.clock.now+=3600000;
  await app.sandbox.window.VumiroAccount.signOut();
  assert.equal(refreshes,2);
  const logout=app.calls.find(call=>call.url.endsWith('/logout?scope=local'));
  assert.equal(logout.options.headers.Authorization,'Bearer fresh-logout-access');
  assert.equal(JSON.parse(app.secure.value).refreshToken,undefined);
  assert.equal(app.sandbox.window.VumiroAccount.getState().signedIn,false);
});

test('offline refresh and logout failures still clear saved authentication and return to sign in',async()=>{
  let offline=false;
  const localProfile={id:'local-identity',name:'Local'},callFrame={connected:true};
  const app=harness({stored:saved,localProfile,callFrame,route:url=>{
    if(offline&&url.includes('/auth/v1/'))throw new TypeError('Network unavailable');
    return commonRoute(url);
  }});await app.start();offline=true;app.clock.now+=3600000;
  await app.sandbox.window.VumiroAccount.signOut();
  assert.equal(app.sandbox.window.VumiroAccount.getState().signedIn,false);
  const persisted=JSON.parse(app.secure.value);
  assert.equal(persisted.refreshToken,undefined);assert.equal(persisted.deviceToken,'a'.repeat(64));
  assert.equal(app.sandbox.window.VumiroLocalProfile.profile(),localProfile);
  assert.equal(app.sandbox.document.querySelector('#callFrameSlot iframe'),callFrame);
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?authView=signin');
});

test('public logout waits for an in-flight account operation before clearing its session',async()=>{
  let releaseExport,exportStarted;
  const started=new Promise(resolve=>{exportStarted=resolve;}),gate=new Promise(resolve=>{releaseExport=resolve;});
  const app=harness({stored:saved,route:async url=>{
    if(url.endsWith('/account/export')){exportStarted();await gate;return response(200,{version:1,account:{},data:null,devices:[],noticeRecords:[]});}
    return commonRoute(url);
  }});await app.start();
  const exporting=app.element('accountExport').onclick();await started;
  const signingOut=app.sandbox.window.VumiroAccount.signOut();
  await Promise.resolve();assert.equal(app.calls.some(call=>call.url.includes('/logout?scope=')),false);
  releaseExport();await Promise.all([exporting,signingOut]);
  assert.equal(app.sandbox.window.VumiroAccount.getState().signedIn,false);
  assert.ok(app.calls.findIndex(call=>call.url.endsWith('/account/export'))<app.calls.findIndex(call=>call.url.includes('/logout?scope=local')));
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
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?authView=signin');
});

for(const [name,statusCode,result] of [
  ['completed',200,{ok:true}],
  ['pending',202,{deletionPending:true,error:'Identity deletion is pending.'}],
  ['pending from an older Worker',202,{error:'Identity deletion is pending.'}]
])test(`account deletion reports ${name} truthfully after clearing the local session`,async()=>{
  const app=harness({stored:saved,route:(url,options)=>{
    if(url.includes('/auth/v1/token?grant_type=password'))return response(200,session);
    if(url.endsWith('/api/v1/account/data')&&options.method==='DELETE')return response(statusCode,result);
    return commonRoute(url,options);
  }});await app.start();
  await app.element('accountDelete').onclick();
  app.element('accountConfirmPassword').value='current password';
  await app.element('accountReauthForm').onsubmit({preventDefault(){}});
  assert.equal(app.secure.value,'');
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?authView=signin');
  assert.match(app.element('accountFeedback').textContent,/local device profile remains/);
  if(statusCode===202){
    assert.match(app.element('accountFeedback').textContent,/identity deletion is pending.*retry automatically/);
    assert.doesNotMatch(app.element('accountFeedback').textContent,/Account and synced account data were deleted/);
  }else{
    assert.match(app.element('accountFeedback').textContent,/Account and synced account data were deleted/);
    assert.doesNotMatch(app.element('accountFeedback').textContent,/pending/);
  }
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
  const pending={version:2,pendingSignup:{email:'pending@example.com',acceptedAt:'2026-11-03T12:00:00.000Z',noticeVersion:'2026-11-03'}};
  const app=harness({authPage:true,stored:JSON.stringify(pending),route:url=>url.endsWith('/api/v1/account/config')?response(200,config):response(404,{error:'not found'})});await app.start();
  assert.equal(app.element('accountVerifyForm').hidden,false);
  assert.equal(app.element('accountEmail').value,'pending@example.com');
  assert.equal(app.secure.value.includes('password'),false);
});

test('manual backup and export share one serialized account-operation queue',async()=>{
  let inFlight=0,maxInFlight=0,measure=false;
  const remoteSnapshot={version:1,profile:{name:'Remote',username:'',avatar:''},friends:[],blocked:[],settings:{},privacyNoticeVersion:'2026-11-03',privacyNoticeAcceptedAt:'2026-11-03T12:00:00.000Z',identityRecovery:{version:1}};
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
  assert.equal(app.calls.find(call=>call.url.endsWith('/api/v1/account/config')).options.headers['X-Vumiro-Profile-Cards'],'1');
  app.element('accountPrivacyAck').checked=true;
  await Promise.all([app.element('accountBackup').onclick(),app.element('accountExport').onclick()]);
  assert.equal(maxInFlight,1);
  const dataCalls=app.calls.filter(call=>call.url.endsWith('/api/v1/account/data'));
  assert.ok(dataCalls.some(call=>call.options.method==='GET'));
  assert.ok(dataCalls.some(call=>call.options.method==='PUT'));
  for(const call of dataCalls)assert.equal(call.options.headers['X-Vumiro-Profile-Cards'],'1');
  assert.equal(app.calls.find(call=>call.url.endsWith('/api/v1/account/export')).options.headers['X-Vumiro-Profile-Cards'],undefined);
});

test('backup reveals password setup when the account shell has removed its security disclosure',async()=>{
  const app=harness({stored:saved,route:(url,options)=>{
    if(url.includes('/auth/v1/token?grant_type=password'))return response(200,session);
    return commonRoute(url,options);
  }});await app.start();
  const getElementById=app.sandbox.document.getElementById;
  app.sandbox.document.getElementById=id=>id==='accountSecurityDetails'?null:getElementById(id);
  app.element('accountPrivacyAck').checked=true;
  await app.element('accountBackup').onclick();
  await app.element('accountReauthForm').onsubmit({preventDefault(){}});
  assert.equal(app.element('accountSetPasswordForm').hidden,false);
  assert.match(app.element('accountFeedback').textContent,/Add a separate Vumiro password/);
});

test('reauthentication targets the existing reauth form id',()=>{
  assert.doesNotMatch(source,/\$\('accountReauth'\)/);
  assert.match(source,/\$\('accountReauthForm'\)/);
});

test('dedicated account page shows signup without an account-free escape',async()=>{
  const app=harness({route:commonRoute,authPage:true,href:'https://vumiro.local/auth.html?room=invite#shared'});await app.start();
  app.sandbox.window.VumiroAccount.open('signup');
  assert.equal(app.element('accountHeading').textContent,'Join Vumiro.');
  assert.equal(app.element('accountDescription').textContent,'Your profile and friends, wherever you go.');
  assert.equal(app.element('accountSignUp').hidden,false);
  assert.equal(app.element('accountSignIn').hidden,true);
  assert.equal(app.element('accountResetRequestForm').hidden,true);
  assert.equal(app.element('accountPassword').minLength,12);
  assert.equal(app.element('continueLocal').onclick,undefined);
  assert.equal(app.navigations.length,0);
});

test('signup validates matching passwords then automatically verifies and carries its notice acknowledgement',async()=>{
  const app=harness({authPage:true,route:(url)=>{
    if(url.endsWith('/auth/v1/signup'))return response(200,{});
    if(url.endsWith('/auth/v1/verify'))return response(200,{...session,user:{...session.user,email:'new@example.com'}});
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    return commonRoute(url);
  }});await app.start();
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
  const acceptedAt=JSON.parse(app.secure.value).pendingSignup.acceptedAt;
  app.element('accountVerifyCode').value='123456';
  await app.element('accountVerifyForm').onsubmit({preventDefault(){}});
  assert.equal(JSON.parse(app.storage.get(`vumiro-account-privacy:${session.user.id}`)).acceptedAt,acceptedAt);
  assert.match(app.navigations.at(-1),/friends\.html/);
  assert.doesNotMatch(app.secure.value,/pendingSignup|a safe password 123|123456/);
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
  assert.equal(app.element('accountRetry').hidden,false);
  available=true;await app.element('accountRetry').onclick();
  assert.equal(app.element('accountError').textContent,'');
  assert.equal(app.element('accountFeedback').textContent,'Account service connected.');
  assert.equal(app.element('accountSignIn').disabled,false);
  assert.equal(app.element('accountRetry').hidden,true);
  assert.equal(app.element('accountRegistrationStatus').hidden,true);
});

test('registration availability stays quiet when healthy and shows paused or unavailable states',async()=>{
  for(const [state,message,retryVisible]of [
    [{registrationEnabled:true,serviceEnabled:true},'',false],
    [{registrationEnabled:false,serviceEnabled:true},'New account registration is paused. Existing accounts can sign in.',false],
    [{registrationEnabled:false,serviceEnabled:false},'Accounts are temporarily unavailable. Please try again later.',true]
  ]){
    const app=harness({authPage:true,route:url=>url.endsWith('/api/v1/account/config')?response(200,{...config,...state}):commonRoute(url)});await app.start();
    assert.equal(app.element('accountDescription').textContent,'Pick up where you left off.');
    assert.equal(app.element('accountRegistrationStatus').textContent,message);
    assert.equal(app.element('accountRegistrationStatus').hidden,!message);
    assert.equal(app.element('accountRetry').hidden,!retryVisible);
    app.sandbox.window.VumiroAccount.open('signup');
    assert.equal(app.element('accountRegistrationStatus').hidden,!message);
  }
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

test('returning OAuth sign in needs no repeated acknowledgement and rejects invalid callbacks',async()=>{
  let calls=0;
  const app=harness({authPage:true,oauth:{signIn:async()=>{calls++;return {code:''};}},route:url=>url.endsWith('/api/v1/account/config')?response(200,{...config,oauthProviders:['azure']}):commonRoute(url)});await app.start();
  assert.equal(app.element('accountGoogle').disabled,true);assert.equal(app.element('accountMicrosoft').disabled,false);
  assert.equal(app.element('accountPrivacyRow').hidden,true);
  await app.element('accountMicrosoft').onclick();
  assert.equal(calls,1);assert.match(app.element('accountError').textContent,/valid sign-in code/);assert.equal(app.secure.value,'');
});

test('social signup still requires acknowledgement before opening a provider',async()=>{
  let providerCalls=0;
  const app=harness({authPage:true,oauth:{signIn:async()=>{providerCalls++;return {code:''};}},route:url=>url.endsWith('/api/v1/account/config')?response(200,{...config,oauthProviders:['google']}):commonRoute(url)});await app.start();
  app.sandbox.window.VumiroAccount.open('signup');
  await app.element('accountGoogle').onclick();
  assert.equal(providerCalls,0);assert.match(app.element('accountError').textContent,/privacy notice before creating/);
  app.element('accountPrivacyAck').checked=true;await app.element('accountGoogle').onclick();
  assert.equal(providerCalls,1);
});

test('password sign in reuses the current backend notice record without prompting again',async()=>{
  const acceptedAt='2026-11-03T12:00:00.000Z';
  const app=harness({authPage:true,route:(url,options)=>{
    if(url.includes('grant_type=password'))return response(200,session);
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    if(url.endsWith('/account/data'))return response(200,{account:{email:session.user.email},data:null,revision:0,devices:[],noticeRecords:[{version:config.privacyNoticeVersion,acceptedAt}]});
    return commonRoute(url,options);
  }});await app.start();
  app.element('accountEmail').value=session.user.email;app.element('accountPassword').value='existing password';
  assert.equal(app.element('accountPrivacyAck').checked,false);
  await app.element('accountForm').onsubmit({preventDefault(){}});
  assert.match(app.navigations.at(-1),/friends\.html/);
  assert.deepEqual(JSON.parse(app.storage.get(`vumiro-account-privacy:${session.user.id}`)),{version:config.privacyNoticeVersion,acceptedAt});
  assert.equal(app.element('accountPrivacyRow').hidden,true);
});

test('an unfinished signup acknowledgement cannot be transferred to a different signed-in account',async()=>{
  const pending={version:2,pendingSignup:{email:'another@example.com',acceptedAt:'2026-11-03T12:00:00.000Z',noticeVersion:config.privacyNoticeVersion}};
  const app=harness({authPage:true,stored:JSON.stringify(pending),route:(url,options)=>{
    if(url.includes('grant_type=password'))return response(200,session);
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    return commonRoute(url,options);
  }});await app.start();
  app.element('accountBack').onclick();app.element('accountEmail').value=session.user.email;app.element('accountPassword').value='existing password';
  await app.element('accountForm').onsubmit({preventDefault(){}});
  assert.equal(app.storage.has(`vumiro-account-privacy:${session.user.id}`),false);
  assert.match(app.navigations.at(-1),/friends\.html/);
});

for(const [name,noticeRecords]of [['absent',[]],['older',[{version:'2026-10-01',acceptedAt:'2026-10-01T12:00:00.000Z'}]],['previous-release',[{version:'2026-11-01',acceptedAt:'2026-11-01T12:00:00.000Z'}]],['malformed',[{acceptedAt:'2026-11-03T12:00:00.000Z'}]]])test(`OAuth sign in does not invent acknowledgement when a notice record is ${name}`,async()=>{
  const app=harness({authPage:true,oauth:{signIn:async()=>({code:'one-use-code'})},route:(url,options)=>{
    if(url.endsWith('/account/config'))return response(200,{...config,oauthProviders:['google']});
    if(url.includes('grant_type=pkce'))return response(200,session);
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    if(url.endsWith('/account/data'))return response(200,{account:{email:session.user.email},data:null,revision:0,devices:[],noticeRecords});
    return commonRoute(url,options);
  }});await app.start();await app.element('accountGoogle').onclick();
  assert.equal(app.storage.has(`vumiro-account-privacy:${session.user.id}`),false);
  assert.match(app.navigations.at(-1),/friends\.html/);
  await app.element('accountBackup').onclick();
  assert.match(app.element('accountFeedback').textContent,/acknowledge the privacy notice/);
  assert.equal(app.calls.some(call=>call.options.method==='PUT'&&call.url.endsWith('/account/data')),false);
});

test('unconfirmed password sign in resumes automatic signup verification without inventing privacy acceptance',async()=>{
  const app=harness({authPage:true,route:(url,options)=>{
    if(url.includes('grant_type=password'))return response(400,{code:'email_not_confirmed',msg:'Email not confirmed'});
    if(url.endsWith('/auth/v1/verify'))return response(200,session);
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    return commonRoute(url,options);
  }});await app.start();
  assert.equal(app.element('accountVerificationNav').hidden,true);
  app.element('accountEmail').value=session.user.email;app.element('accountPassword').value='existing password';
  await app.element('accountForm').onsubmit({preventDefault(){}});
  assert.equal(app.element('accountVerifyForm').hidden,false);
  assert.equal(JSON.parse(app.secure.value).pendingSignup.acceptedAt,'');
  app.element('accountVerifyCode').value='123456';await app.element('accountVerifyForm').onsubmit({preventDefault(){}});
  assert.equal(app.storage.has(`vumiro-account-privacy:${session.user.id}`),false);
  assert.match(app.navigations.at(-1),/friends\.html/);
  assert.doesNotMatch(app.secure.value,/existing password|123456/);
});

test('a newer server notice permits sign-in but cannot be acknowledged through older bundled prose',async()=>{
  const future={...config,privacyNoticeVersion:'2099-01-01',oauthProviders:['google']};
  let providerCalls=0;
  const app=harness({authPage:true,oauth:{signIn:async()=>{providerCalls++;return {code:'one-use-code'};}},route:(url,options)=>{
    if(url.endsWith('/account/config'))return response(200,future);
    if(url.includes('grant_type=pkce'))return response(200,session);
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    if(url.endsWith('/account/data'))return response(200,{account:{email:session.user.email},data:null,revision:0,devices:[],noticeRecords:[{version:future.privacyNoticeVersion,acceptedAt:new Date().toISOString()}]});
    return commonRoute(url,options);
  }});await app.start();await app.element('accountGoogle').onclick();
  assert.equal(providerCalls,1);
  assert.match(app.navigations.at(-1),/friends\.html/);
  assert.equal(app.storage.has(`vumiro-account-privacy:${session.user.id}`),false);
  app.element('accountPrivacyAck').checked=true;
  await app.element('accountBackup').onclick();
  assert.match(app.element('accountFeedback').textContent,/Update Vumiro.*privacy notice/);
  assert.equal(app.storage.has(`vumiro-account-privacy:${session.user.id}`),false);
  assert.equal(app.calls.some(call=>call.options.method==='PUT'&&call.url.endsWith('/account/data')),false);
});

test('email and social signup require the notice bundled with this version',async()=>{
  let providerCalls=0;
  const app=harness({authPage:true,oauth:{signIn:async()=>{providerCalls++;return {code:'unused'};}},route:(url,options)=>url.endsWith('/account/config')?response(200,{...config,privacyNoticeVersion:'2099-01-01',oauthProviders:['google']}):commonRoute(url,options)});
  await app.start();app.sandbox.window.VumiroAccount.open('signup');
  app.element('accountEmail').value='new@example.com';app.element('accountPassword').value='a safe password 123';app.element('accountPasswordConfirm').value='a safe password 123';app.element('accountPrivacyAck').checked=true;
  await app.element('accountSignUp').onclick();
  assert.match(app.element('accountError').textContent,/Update Vumiro.*privacy notice/);
  assert.equal(app.calls.some(call=>call.url.endsWith('/auth/v1/signup')),false);
  await app.element('accountGoogle').onclick();
  assert.match(app.element('accountError').textContent,/Update Vumiro.*privacy notice/);
  assert.equal(providerCalls,0);
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


test('signed-out startup gates existing local profiles and ignores the old local view parameter',async()=>{
  const profile={id:'preserved',name:'Existing'};
  const app=harness({localProfile:profile,href:'https://vumiro.local/friends.html?view=local&room=invitation',route:commonRoute});await app.start();
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?room=invitation');
  assert.equal(await app.sandbox.window.VumiroAccount.ready(),false);
  assert.equal(app.sandbox.window.VumiroLocalProfile.profile(),profile);
});

test('Google first sign-in creates only the local display profile and enters the lobby without email setup',async()=>{
  const app=harness({authPage:true,href:'https://vumiro.local/auth.html?invite=welcome',oauth:{signIn:async()=>({code:'returned-code'})},route:(url,options)=>{
    if(url.endsWith('/account/config'))return response(200,{...config,oauthProviders:['google']});
    if(url.includes('grant_type=pkce'))return response(200,{...session,user:{...session.user,user_metadata:{full_name:'Aki Example'},app_metadata:{providers:['google']}}});
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    return commonRoute(url,options);
  }});await app.start();await app.element('accountGoogle').onclick();
  assert.deepEqual(app.createdProfiles,['Aki Example']);
  assert.equal(app.navigations.at(-1),'https://vumiro.local/friends.html?invite=welcome');
  assert.equal(app.element('accountSetPasswordForm').hidden,true);
  assert.equal(app.element('accountForm').hidden,true);
  assert.equal(app.element('accountUnlockForm').hidden,true);
});

test('direct lobby startup with a different encrypted identity returns to genuine recovery without creating a key',async()=>{
  const localProfile={id:'another-device-identity',name:'Local'};
  const app=harness({stored:saved,localProfile,route:url=>{
    if(url.endsWith('/account/data'))return response(200,{account:{email:session.user.email},revision:1,devices:[],data:{identityRecovery:{identityId:'remote-identity'}}});
    return commonRoute(url);
  }});await app.start();
  assert.equal(await app.sandbox.window.VumiroAccount.ready(),false);
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html');
  assert.deepEqual(app.createdProfiles,[]);
  assert.equal(app.sandbox.window.VumiroLocalProfile.profile(),localProfile);
});

test('refreshing a signed-in account with no saved remote profile is ready before lobby bootstrap',async()=>{
  const app=harness({stored:saved,route:commonRoute});await app.start();
  assert.equal(await app.sandbox.window.VumiroAccount.ready(),true);
  assert.equal(app.createdProfiles.length,1);
  assert.equal(app.navigations.length,0);
});


test('email sign-in cannot enter lobby with the wrong encrypted identity password',async()=>{
  const app=harness({authPage:true,localProfile:{id:'local-key',name:'Preserved'},route:(url,options)=>{
    if(url.includes('grant_type=password'))return response(200,session);
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    if(url.endsWith('/account/data'))return response(200,{revision:1,devices:[],data:{version:1,profile:{name:'Remote'},friends:[],blocked:[],settings:{},identityRecovery:{identityId:'saved-identity'}}});
    return commonRoute(url,options);
  }});await app.start();let attempts=0;
  app.sandbox.window.VumiroIdentityRecovery={validateEnvelope:async()=>{},recoverWithPassword:async()=>{attempts++;throw Error('The identity password is incorrect.');}};
  app.element('accountEmail').value=session.user.email;app.element('accountPassword').value='wrong password';
  await app.element('accountForm').onsubmit({preventDefault(){}});
  assert.equal(attempts,1);
  assert.equal(app.navigations.length,0);
  assert.equal(app.sandbox.window.VumiroLocalProfile.profile().id,'local-key');
  assert.match(app.element('accountFeedback').textContent,/identity password is incorrect/);
});

test('successful identity unlock installs the recovered key before entering the lobby',async()=>{
  const app=harness({authPage:true,localProfile:{id:'local-key',name:'Preserved'},route:(url,options)=>{
    if(url.includes('grant_type=password'))return response(200,session);
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    if(url.endsWith('/account/data'))return response(200,{revision:1,devices:[],data:{version:1,profile:{name:'Remote'},friends:[],blocked:[],settings:{},identityRecovery:{identityId:'saved-identity'}}});
    return commonRoute(url,options);
  }});await app.start();const recovered={identityId:'saved-identity',privateKey:'opaque-key'},installed=[];
  app.sandbox.window.VumiroIdentityRecovery={validateEnvelope:async()=>{},recoverWithPassword:async()=>recovered};
  app.sandbox.window.VumiroLocalProfile.installRecoveredIdentity=async(value,profile)=>{installed.push({value,profile});};
  app.element('accountEmail').value=session.user.email;app.element('accountPassword').value='valid password';
  await app.element('accountForm').onsubmit({preventDefault(){}});
  assert.equal(installed.length,1);assert.equal(installed[0].value,recovered);
  assert.match(app.navigations.at(-1),/friends\.html/);
});


test('authenticated account entry delegates to the common settings shell without opening a second dialog',async()=>{
  const app=harness({stored:saved,route:commonRoute});await app.start();let opened=0;
  app.sandbox.window.VumiroAccount.setSettingsNavigation(()=>{opened++;});
  app.sandbox.window.VumiroAccount.open();
  assert.equal(opened,1);assert.equal(app.element('accountDialog').open,undefined);
  assert.equal(app.sandbox.window.VumiroAccount.prepare(),app.element('accountDialog'));
  assert.equal(opened,1);
});


test('revoked account credentials leave the lobby while preserving invitation routing and local data',async()=>{
  const localProfile={id:'retained-key',name:'Retained'};
  const app=harness({stored:saved,localProfile,href:'https://vumiro.local/friends.html?invite=keep#room',route:(url,options)=>url.endsWith('/account/export')?response(403,{message:'Device revoked'}):commonRoute(url,options)});
  await app.start();await app.element('accountExport').onclick();
  assert.equal(app.sandbox.window.VumiroAccount.getState().signedIn,false);
  assert.equal(app.navigations.at(-1),'https://vumiro.local/auth.html?invite=keep&authView=signin#room');
  assert.equal(app.sandbox.window.VumiroLocalProfile.profile(),localProfile);
});


for(const pageMarker of [true,false])test(`restored Google session with a local profile and no remote backup enters lobby (page marker ${pageMarker})`,async()=>{
  const localProfile={id:'existing-qa-identity',name:'Existing QA profile'};
  const app=harness({authPage:true,pageMarker,localProfile,stored:saved,href:'https://screentask.local/auth.html?invite=retained#room',route:(url,options)=>{
    if(url.includes('grant_type=refresh_token'))return response(200,{...session,user:{...session.user,app_metadata:{providers:['google']}}});
    return commonRoute(url,options);
  }});await app.start();
  assert.equal(app.navigations.at(-1),'https://screentask.local/friends.html?invite=retained#room');
  assert.equal(app.navigations.length,1,'completion schedules a single navigation');
  assert.equal(app.createdProfiles.length,0);assert.equal(app.sandbox.window.VumiroLocalProfile.profile(),localProfile);
  assert.equal(app.element('accountActions').hidden,true,'account management belongs only in lobby settings');
});

for(const pageMarker of [true,false])test(`fresh Google sign-in with existing local profile opens lobby (page marker ${pageMarker})`,async()=>{
  let releaseData,startedData;
  const gate=new Promise(resolve=>{releaseData=resolve;}),started=new Promise(resolve=>{startedData=resolve;});
  const localProfile={id:'existing-qa-identity',name:'Existing QA profile'};
  const app=harness({authPage:true,pageMarker,localProfile,href:'https://screentask.local/auth.html?invite=retained',oauth:{signIn:async()=>({code:'returned-code'})},route:async(url,options)=>{
    if(url.endsWith('/account/config'))return response(200,{...config,oauthProviders:['google']});
    if(url.includes('grant_type=pkce'))return response(200,{...session,user:{...session.user,app_metadata:{providers:['google']}}});
    if(url.endsWith('/devices/register'))return response(201,{deviceToken:'b'.repeat(64)});
    if(url.endsWith('/account/data')){startedData();await gate;return response(200,{account:{email:session.user.email},data:null,revision:0,devices:[]});}
    return commonRoute(url,options);
  }});await app.start();const signingIn=app.element('accountGoogle').onclick();await started;
  try {
    assert.equal(app.element('accountHeading').textContent,'Signing you in…');
    assert.equal(app.element('accountActions').hidden,true);
    assert.equal(app.element('accountForm').hidden,true);
  }finally{releaseData();await signingIn;}
  assert.equal(app.navigations.at(-1),'https://screentask.local/friends.html?invite=retained');
  assert.equal(app.navigations.length,1,'completion schedules a single navigation');
  assert.equal(app.createdProfiles.length,0);assert.equal(app.sandbox.window.VumiroLocalProfile.profile(),localProfile);
});


test('authenticated startup failure stays outside account management and retry completes into lobby',async()=>{
  let unavailable=true;
  const app=harness({authPage:true,stored:saved,localProfile:{id:'existing-qa-identity',name:'Existing QA profile'},route:(url,options)=>{
    if(url.endsWith('/account/data')&&unavailable)return response(503,{message:'Account data is temporarily unavailable.'});
    return commonRoute(url,options);
  }});await app.start();
  assert.equal(app.navigations.length,0);assert.equal(app.element('accountActions').hidden,true);
  assert.equal(app.element('accountHeading').textContent,'Signing you in…');
  assert.equal(app.element('accountRetry').hidden,false);assert.equal(app.element('accountFooter').hidden,false);
  unavailable=false;await app.element('accountRetry').onclick();
  assert.equal(app.navigations.at(-1),'https://vumiro.local/friends.html');
  assert.equal(app.navigations.length,1);
});
