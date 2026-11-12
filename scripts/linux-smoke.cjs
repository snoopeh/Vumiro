'use strict';

// Loaded only by the packaged main process with --vumiro-smoke. No product globals are replaced.
const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');

function allowSmokeRequest(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'vumiro:' && url.hostname === 'app' && !url.username && !url.password && !url.port;
  } catch { return false; }
}

// Synthetic account transport lives only in the explicitly loaded smoke driver.
// HTTPS is fulfilled in-process; neither these values nor real credentials reach a server or keyring.
function createSmokeAccountFixture() {
  const service='https://vumiro-rooms.vumiro-signaling.workers.dev',auth='https://vumiro-smoke.supabase.co';
  const credentials=Object.freeze({email:'smoke@example.invalid',password:'smoke-fixture-password-not-a-secret'});
  const key='sb_publishable_vumiro_smoke_fixture_only',accessToken='smoke.access.signature',refreshToken='smoke-refresh-not-a-real-token';
  const user={id:'11111111-1111-4111-8111-111111111111',email:credentials.email,user_metadata:{full_name:'Linux Smoke'},app_metadata:{providers:['email']}};
  const deviceToken='smoke-device-token-not-a-real-token-0000000000';
  let memory='',deviceId='',requests=0,writes=0;
  const paths=new Set([service+'/api/v1/account/config',service+'/api/v1/account/devices/register',service+'/api/v1/account/data',auth+'/auth/v1/token?grant_type=password',auth+'/auth/v1/token?grant_type=refresh_token']);
  const allows=value=>{try{const url=new URL(value);return !url.username&&!url.password&&!url.port&&paths.has(url.href);}catch{return false;}};
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'vumiro://app','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, apikey, Authorization, X-Vumiro-Device, X-Vumiro-Device-Token, X-Vumiro-Profile-Cards, X-Vumiro-Profile-Media','Vary':'Origin'};
  const response=(status,value)=>new Response(status===204?null:JSON.stringify(value),{status,headers});
  async function serve(request) {
    if(!allows(request.url))return response(403,{message:'Offline smoke blocks this request.'});
    if(request.method==='OPTIONS')return response(204);
    const url=new URL(request.url);
    if(request.url===service+'/api/v1/account/config'&&request.method==='GET'){
      requests++;return response(200,{authUrl:auth,publishableKey:key,serviceEnabled:true,registrationEnabled:false,oauthProviders:[],privacyNoticeVersion:'2026-11-03'});
    }
    if(url.origin===auth&&request.method==='POST'&&request.headers.get('apikey')===key){
      let body;try{body=await request.json();}catch{return response(400,{message:'Invalid smoke fixture request.'});}
      const valid=url.searchParams.get('grant_type')==='password'?body?.email===credentials.email&&body?.password===credentials.password:body?.refresh_token===refreshToken;
      if(!valid)return response(401,{message:'Only the synthetic smoke account is accepted.'});
      requests++;return response(200,{access_token:accessToken,refresh_token:refreshToken,expires_in:3600,user});
    }
    if(request.headers.get('Authorization')!=='Bearer '+accessToken)return response(401,{message:'Synthetic account authorization is required.'});
    if(url.pathname==='/api/v1/account/devices/register'&&request.method==='POST'){
      const candidate=request.headers.get('X-Vumiro-Device');if(!/^[0-9a-f-]{36}$/i.test(candidate||''))return response(400,{message:'A smoke device identifier is required.'});
      deviceId=candidate;requests++;return response(201,{deviceToken});
    }
    if(url.pathname==='/api/v1/account/data'&&request.method==='GET'&&deviceId&&request.headers.get('X-Vumiro-Device')===deviceId&&request.headers.get('X-Vumiro-Device-Token')===deviceToken){
      requests++;return response(200,{account:{email:credentials.email},data:null,revision:0,devices:[]});
    }
    return response(403,{message:'Offline smoke blocks this operation.'});
  }
  function secureStore(event,request,contents) {
    let frame;
    try{frame=new URL(event.senderFrame.url);}catch{}
    if(!contents||event.sender!==contents||event.senderFrame!==contents.mainFrame||!frame||!allowSmokeRequest(frame.href)||!['/auth.html','/friends.html'].includes(frame.pathname))throw Error('Smoke storage is restricted to its own account main frame.');
    if(!request||!['get','set','delete','status'].includes(request.action)||Object.keys(request).sort().join(',')!==(request.action==='set'?'action,value':'action'))throw Error('Invalid smoke storage operation.');
    if(request.action==='status')return {available:true,code:null,backend:'smoke_fixture'};
    if(request.action==='get')return memory;
    if(request.action==='delete'){memory='';return true;}
    let value;try{if(typeof request.value!=='string'||request.value.length>8192)throw Error();value=JSON.parse(request.value);}catch{throw Error('Smoke storage accepts only its synthetic session.');}
    if(!value||Array.isArray(value)||Object.keys(value).some(name=>!['version','refreshToken','deviceId','deviceToken','deviceAccountId'].includes(name))||value.version!==2||value.refreshToken!==refreshToken||value.deviceAccountId!==user.id||!/^[0-9a-f-]{36}$/i.test(value.deviceId||'')||!['',deviceToken].includes(value.deviceToken))throw Error('Smoke storage accepts only its synthetic session.');
    memory=request.value;writes++;return true;
  }
  return {credentials,allows,serve,secureStore,stats:()=>({requests,writes})};
}

function smokeAuthReloadUrl(value) {
  const url=new URL(value);
  if(!allowSmokeRequest(value)||url.pathname!=='/auth.html')throw new Error('Smoke reload requires the trusted auth page.');
  // Native startup supplies signaling and room preferences in this query.
  // The real lobby needs them even though transport remains blocked offline.
  url.searchParams.set('platform','linux');return url.href;
}

function smokeFriendsOverviewReady() {
  return document.querySelector('#friendsBody')?.hidden===false &&
    document.querySelector('#directChatPane')?.hidden===true &&
    !document.body.classList.contains('conversations-view') &&
    !!document.querySelector('#friendsList .messageAction') &&
    document.querySelector('#workspaceHeading')?.textContent==='Friends';
}
function smokeFriendCardReady(expectedName) {
  const card=document.querySelector('#userCardDialog'),editor=document.querySelector('#nicknameDialog'),pencil=document.querySelector('#userCardEditNickname');
  return card?.open===true&&editor?.open!==true&&document.querySelector('#userCardName')?.textContent===expectedName&&!!pencil&&!pencil.hidden&&!pencil.disabled;
}

function smokeRoomReady() {
  const frame=document.querySelector('#callFrameSlot iframe'),doc=frame?.contentDocument,child=frame?.contentWindow;
  const profile=window.VumiroLocalProfile?.profile(),connection=doc?.querySelector('#roomConnection');
  // The parent reveals the frame only after its source/origin/launchId handshake.
  // End-of-script controls plus the loaded identity distinguish it from static HTML.
  return !!profile?.id&&child?.VumiroLocalProfile?.profile()?.id===profile.id&&
    document.querySelector('#callArea')?.hidden===false&&document.body.classList.contains('room-view')&&
    document.querySelector('#friendsBody')?.hidden===true&&!document.querySelector('dialog[open]')&&
    document.querySelector('.roomLaunchSurface')?.hidden===true&&frame.inert===false&&getComputedStyle(frame).visibility==='visible'&&
    doc.readyState==='complete'&&!!doc.querySelector('#replyPreview')&&typeof child.VumiroRoomConnection?.set==='function'&&
    connection?.hidden===false&&['joining','reconnecting','error','slow'].includes(connection.dataset.state)&&
    doc.querySelector('#connectionCancel')?.hidden===false&&doc.querySelector('#connectionCancel')?.disabled===false&&
    doc.querySelector('main')?.inert===true&&doc.querySelector('.call-dock')?.inert===true&&
    doc.querySelector('#mic')?.disabled===true&&doc.querySelector('#share')?.disabled===true&&
    doc.querySelector('#mute')?.hidden===true&&doc.querySelector('#stopShare')?.hidden===true;
}

function smokeRoomCleanupReady(expectedNickname) {
  return !document.querySelector('#callFrameSlot iframe')&&document.querySelector('#callArea')?.hidden===true&&
    !document.body.classList.contains('room-view')&&document.querySelector('#friendsBody')?.hidden===false&&
    document.querySelector('.roomLaunchSurface')?.hidden===true&&!document.querySelector('dialog[open]')&&
    window.VumiroAccount?.getState().signedIn===true&&document.querySelector('#selfName')?.textContent==='Linux Smoke'&&
    document.querySelector('#friendsList .friendNameButton')?.textContent===expectedNickname;
}

function requiredSmokeResources(readHtml) {
  const pages=['/auth.html','/friends.html','/call.html'],required=new Set(pages);
  for(const page of pages){
    const html=readHtml(page);
    for(const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)){
      const url=new URL(match[1],'vumiro://app'+page);
      if(!allowSmokeRequest(url.href)||url.search||url.hash)throw new Error('Packaged smoke scripts must use trusted local asset paths.');
      required.add(url.pathname);
    }
  }
  return [...required].sort();
}

function createSmokeResources() {
  const requests=new Map(),completed=new Set(),errors=[];
  const localPath=value=>{try{return allowSmokeRequest(value)?new URL(value).pathname:null;}catch{return null;}};
  const fail=(entry,reason)=>{if(entry.failed)return;entry.failed=true;if(errors.length<48)errors.push(entry.path+': '+reason);};
  function record(method,params) {
    if(method==='Network.requestWillBeSent'){
      const path=localPath(params.request?.url);if(path)requests.set(params.requestId,{path,done:false,status:null});
    }else if(method==='Network.responseReceived'){
      const path=localPath(params.response?.url);if(!path)return;
      const entry=requests.get(params.requestId)||{path,done:false};requests.set(params.requestId,entry);
      entry.status=params.response.status;if(entry.status!==200)fail(entry,'HTTP '+entry.status);
    }else if(method==='Network.loadingFinished'){
      const entry=requests.get(params.requestId);if(!entry)return;entry.done=true;
      if(entry.status===200&&!entry.failed)completed.add(entry.path);
    }else if(method==='Network.loadingFailed'){
      const entry=requests.get(params.requestId);if(!entry)return;entry.done=true;
      // Navigation can cancel an obsolete document or its outstanding scripts.
      // Its required paths must still finish successfully on a later navigation.
      if(!params.canceled)fail(entry,'load failed');
    }
  }
  const snapshot=()=>({errors:[...errors],completed:[...completed].sort(),pending:[...new Set([...requests.values()].filter(entry=>!entry.done).map(entry=>entry.path))].sort()});
  return {record,snapshot,ready:required=>{const state=snapshot();return !state.errors.length&&!state.pending.length&&required.every(path=>completed.has(path));}};
}

function createSmokeProgress(report,now=Date.now) {
  const started=now();report.progress=[];
  return stage=>{report.stage=stage;report.progress.push({stage,ms:Math.max(0,now()-started)});if(report.progress.length>48)report.progress.shift();};
}
async function withSmokeDeadline(operation,stage,milliseconds=5000) {
  let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Smoke stage timed out after ${milliseconds} ms: ${stage}.`)),milliseconds);})]);}
  finally{clearTimeout(timer);}
}

function install({ app, session }) {
  const directory = process.env.VUMIRO_SMOKE_DIR;
  if (!directory || !path.isAbsolute(directory) || !fs.statSync(directory).isDirectory()) throw new Error('Smoke mode needs a disposable runner directory.');
  const fixture=createSmokeAccountFixture(),resources=createSmokeResources();
  let fixtureEnabled=false,runtimeReady=null;
  const report = { ok: false, packaged: app.isPackaged, checks: [], rendererErrors: [], blockedRequests: 0, mediaRequests: 0, lobbyConnectionAttempts:0 };
  const progress=createSmokeProgress(report);progress('driver:installed');
  let finished = false;
  const finish = error => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    report.ok = !error;
    report.authFixtureRequests=fixture.stats().requests;report.memorySessionWrites=fixture.stats().writes;
    const resourceState=resources.snapshot();report.resourceErrors=resourceState.errors;report.completedResources=resourceState.completed;report.pendingResources=resourceState.pending;
    if (error) report.error = error.message || String(error);
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report));
    app.exit(error ? 1 : 0);
  };
  const timer = setTimeout(() => finish(new Error('Smoke UI timed out after 45 seconds at '+report.stage+'.')), 45000);
  for (const [name, folder] of [['userData', 'user-data'], ['sessionData', 'session-data']]) {
    const target = path.join(directory, folder);
    fs.mkdirSync(target, { recursive: true });
    app.setPath(name, target);
  }
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  // The only Node network caller used during startup is the update check; fail closed if one is added.
  globalThis.fetch = async () => { report.blockedRequests++; throw new Error('Offline smoke mode blocks network access.'); };
  process.on('uncaughtException', finish);
  process.on('unhandledRejection', finish);
  const assets = new Set();
  async function verifyPackagedResources() {
    const required=requiredSmokeResources(page=>fs.readFileSync(path.join(app.getAppPath(),'webserver',page.slice(1)),'utf8'));
    report.expectedResources=required;progress('resources:completion');
    await withSmokeDeadline(async()=>{
      while(!resources.ready(required)){
        const state=resources.snapshot();if(state.errors.length)throw new Error('Packaged resource failed: '+state.errors[0]);
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    },'packaged resource completion');
    for(const asset of required)if(!assets.has(asset))throw new Error('Packaged asset did not load: '+asset);
  }
  function configure() {
    progress('configure:starting');
    const ses = session.defaultSession;
    // Intercept the entire HTTPS scheme. No request is forwarded to net.fetch,
    // including unknown URLs. onBeforeRequest opens only exact fixture routes.
    ses.protocol.handle('https',request=>{
      if(!fixtureEnabled)return new Response('Offline smoke mode',{status:503});
      const url=new URL(request.url),label=url.pathname==='/auth/v1/token'?'fixture:token':url.pathname==='/api/v1/account/config'?'fixture:config':url.pathname==='/api/v1/account/devices/register'?'fixture:device':'fixture:account-data';
      progress(label);return withSmokeDeadline(()=>fixture.serve(request),label);
    });
    progress('configure:https-interceptor-ready');
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = allowSmokeRequest(details.url) || fixtureEnabled&&fixture.allows(details.url);
      if (!allowed) report.blockedRequests++;
      callback({ cancel: !allowed });
    });
    ses.setPermissionCheckHandler((_contents, permission) => { if (['media', 'display-capture'].includes(permission)) report.mediaRequests++; return false; });
    ses.setPermissionRequestHandler((_contents, permission, callback) => { if (['media', 'display-capture'].includes(permission)) report.mediaRequests++; callback(false); });
    ses.setDisplayMediaRequestHandler((_request, callback) => { report.mediaRequests++; callback(null); });
    progress('configure:ready');
  }
  async function observe(window) {
    progress('observe:starting');
    const navigationStage=(event,url,isInPlace,isMainFrame)=>{
      if(!isMainFrame||isInPlace)return;
      let page='other';try{const target=new URL(url);if(allowSmokeRequest(url)&&['/auth.html','/friends.html','/call.html'].includes(target.pathname))page=target.pathname;}catch{}
      progress('navigation:starting:'+page);
    };
    window.webContents.on('did-start-navigation',navigationStage);
    window.webContents.on('dom-ready',()=>progress('navigation:dom-ready'));
    window.webContents.on('did-finish-load',()=>progress('navigation:finished'));

    window.webContents.on('render-process-gone', (_event, details) => finish(new Error(`Renderer exited: ${details.reason}`)));
    window.webContents.debugger.on('message', (_event, method, params) => {
      resources.record(method,params);
      if(method==='Network.webSocketCreated'){
        try{const url=new URL(params.url);if(url.protocol==='wss:'&&url.hostname==='vumiro-rooms.vumiro-signaling.workers.dev'&&url.pathname==='/friends-signaling')report.lobbyConnectionAttempts++;}catch{}
      }
      if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails;
        report.rendererErrors.push(details.exception?.description || details.text);
      }
    });
    progress('observe:debugger-attach');window.webContents.debugger.attach('1.3');
    progress('observe:runtime-requested');
    // A new hidden BrowserWindow may not have a renderer yet. Main must reach
    // its initial loadURL before it waits for Runtime.enable to complete.
    runtimeReady=Promise.resolve().then(()=>Promise.all([window.webContents.debugger.sendCommand('Runtime.enable'),window.webContents.debugger.sendCommand('Network.enable')]));
    runtimeReady.catch(()=>{}); // Preserve failure for run(), without an unhandled rejection before navigation.
    progress('observe:ready');
  }
  async function run(window) {
    try {
      progress('run:starting');
      if (!app.isPackaged) throw new Error('Smoke mode requires packaged app resources.');
      if(!runtimeReady)throw new Error('Smoke observer was not installed before navigation.');
      progress('run:runtime-enable');
      await withSmokeDeadline(()=>runtimeReady,'run:runtime-enable');
      progress('run:renderer-ready');
      let action='initial';
      const evaluate = (fn, ...args) => withSmokeDeadline(()=>window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true),'renderer:'+action);
      const wait = async (fn, label, ...args) => {
        action=label;progress('ui:'+label);
        const deadline = Date.now() + 5000;
        do {
          if (report.rendererErrors.length) throw new Error(`Renderer exception: ${report.rendererErrors[0]}`);
          if (await evaluate(fn, ...args)) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        } while (Date.now() < deadline);
        throw new Error(`UI assertion timed out: ${label}`);
      };
      const check = name => {report.checks.push(name);progress('passed:'+name);};
      await wait(() => location.pathname==='/auth.html' && !!document.querySelector('#accountForm'), 'signed-out account gate');
      if(!await evaluate(()=>!window.VumiroAccount.getState().signedIn&&!document.querySelector('#continueLocal')&&!document.querySelector('#setupDialog')?.open))throw new Error('Anonymous app entry bypassed the account gate.');
      check('account-gate');
      action='original secure-store read';progress('secure-store:original-read');
      const secure = await evaluate(async () => {
        try { return { value: await window.vumiroDesktop.secureStore.get() }; }
        catch (error) { return { error: error.message }; }
      });
      if (secure.value !== '' && !/secure storage service is unavailable|GNOME Keyring or KWallet/.test(secure.error || '')) throw new Error('Unexpected secure-store result in disposable profile.');
      if (fs.existsSync(path.join(app.getPath('userData'), 'account-session.bin'))) throw new Error('Smoke profile unexpectedly contains account credentials.');
      check('secure-store');
      // Replace the native transport adapter only in this disposable smoke
      // process. The preload and renderer account/profile globals stay real.
      const {ipcMain}=require('electron');
      ipcMain.removeHandler('vumiro:secure-store');
      ipcMain.handle('vumiro:secure-store',(event,request)=>({ok:true,value:fixture.secureStore(event,request,window.webContents)}));
      fixtureEnabled=true;progress('fixture:native-adapter-ready');
      const authReloadUrl=smokeAuthReloadUrl(await evaluate(()=>location.href));
      progress('fixture:auth-document-load');
      await withSmokeDeadline(()=>window.loadURL(authReloadUrl),'fixture:auth-document-load',7000);
      await wait(()=>location.pathname==='/auth.html'&&document.querySelector('#accountSignIn')?.disabled===false,'fixture account availability');
      action='fixture sign-in submission';progress('fixture:sign-in-submission');
      await evaluate(credentials=>{
        document.querySelector('#accountEmail').value=credentials.email;
        document.querySelector('#accountPassword').value=credentials.password;
        document.querySelector('#accountSignIn').click();
      },fixture.credentials);
      await wait(()=>location.pathname==='/friends.html'&&window.VumiroAccount?.getState().signedIn&&document.querySelector('#selfName')?.textContent==='Linux Smoke'&&!document.querySelector('#setupDialog')?.open,'real account-client authentication and lobby');
      // renderProfile precedes asynchronous lobby hydration. The first real
      // signaling attempt happens only after hydration and lobbyInitialized.
      progress('ui:lobby initialization');
      await withSmokeDeadline(async()=>{
        while(!report.lobbyConnectionAttempts){
          if(report.rendererErrors.length)throw new Error(`Renderer exception: ${report.rendererErrors[0]}`);
          await new Promise(resolve=>setTimeout(resolve,25));
        }
      },'lobby initialization');
      check('fixture-authentication');check('local-profile');
      if (!await evaluate(() => !document.querySelector('#topSettings, #TechnicalIdentity, #technicalIdentity, .technicalIdentity, #contactIdentity, #createRoomDialog'))) throw new Error('Retired UI is present.');
      check('legacy-ui-absent');
      // Disposable public fixture only; its private key is discarded before import.
      const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
      const compressed = Buffer.concat([Buffer.from([2 | (Buffer.from(publicKey.y, 'base64url')[31] & 1)]), Buffer.from(publicKey.x, 'base64url')]);
      const code = `vm1.${compressed.toString('base64url')}`;
      await evaluate(contactCode => {
        document.querySelector('#addFriend').click();
        document.querySelector('#friendCode').value = contactCode;
        document.querySelector('#friendNickname').value = 'Smoke Friend';
        document.querySelector('#importFriend').click();
      }, code);
      await wait(() => !document.querySelector('#addDialog').open && document.querySelector('.friendNameButton')?.textContent === 'Smoke Friend', 'offline contact import');
      check('offline-contact');
      await wait(smokeFriendsOverviewReady,'dedicated Friends overview');
      await evaluate(() => document.querySelector('#friendsList .messageAction').click());
      await wait(() => !document.querySelector('#directChatConversation').hidden &&
        document.querySelector('#directChatName').textContent === 'Smoke Friend' &&
        !document.querySelector('#userCardDialog').open, 'person opens conversation');
      check('people-conversation');
      await evaluate(() => document.querySelector('#directChatProfile').click());
      await wait(smokeFriendCardReady,'chat header opens inspection without editing','Smoke Friend');
      check('nickname-no-edit');
      window.setMinimumSize(480, 640); window.setContentSize(540, 760);
      await wait(() => innerWidth <= 570, 'narrow viewport');
      await evaluate(() => document.querySelector('#userCardEditNickname').click());
      await wait(() => {
        const dialog = document.querySelector('#nicknameDialog'), input = document.querySelector('#nickname');
        const rect = dialog.getBoundingClientRect(), style = getComputedStyle(dialog);
        return dialog.open && style.display !== 'none' && style.visibility === 'visible' && rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && document.activeElement === input && input.value === 'Smoke Friend';
      }, 'visible narrow nickname modal');
      check('nickname-modal-narrow');
      await evaluate(() => { document.querySelector('#nickname').value = 'Renamed Smoke'; document.querySelector('#saveNickname').click(); });
      await wait(() => !document.querySelector('#nicknameDialog').open && document.querySelector('.friendNameButton')?.textContent === 'Renamed Smoke', 'nickname persisted');
      check('nickname-save');
      // The nickname editor is modal above the inspection card. Close that
      // original card through its product control, then inspect saved data.
      await evaluate(() => document.querySelector('#userCardDialog [data-close="userCardDialog"]').click());
      await wait(()=>!document.querySelector('#userCardDialog').open,'inspection card closes after nickname save');
      await evaluate(() => document.querySelector('#directChatProfile').click());
      await wait(smokeFriendCardReady,'saved nickname appears in reopened profile','Renamed Smoke');
      // Send real pointer events through Chromium so the dialog backdrop is hit-tested.
      const point = await evaluate(() => { const rect = document.querySelector('#userCardDialog').getBoundingClientRect(); return { x: Math.max(1, rect.left / 2), y: Math.max(1, rect.top / 2) }; });
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      await wait(() => !document.querySelector('#userCardDialog').open, 'profile backdrop dismissal');
      check('profile-backdrop');
      if (fs.existsSync(path.join(app.getPath('userData'), 'account-session.bin'))) throw new Error('Synthetic session escaped memory storage.');
      await evaluate(() => document.querySelector('#createRoom').click());
      await wait(smokeRoomReady,'initialized offline room and parent ready handshake');
      check('direct-room');
      await verifyPackagedResources();
      // Use the child's real cancellation path, which releases room resources
      // and acknowledges leave. The parent's fallback timeout is not exercised.
      await evaluate(()=>document.querySelector('#callFrameSlot iframe').contentDocument.querySelector('#connectionCancel').click());
      await wait(smokeRoomCleanupReady,'room cancellation restores authenticated lobby','Renamed Smoke');
      check('room-cleanup');
      await verifyPackagedResources();
      if (report.rendererErrors.length) throw new Error(`Renderer exception: ${report.rendererErrors[0]}`);
      if (report.mediaRequests) throw new Error('Smoke UI attempted media capture.');
      if (!report.blockedRequests) throw new Error('The offline network guard was not exercised.');
      check('packaged-assets'); finish();
    } catch (error) { finish(error); }
  }
  return { configure, observe, run, fail: finish, assetLoaded: value => assets.add(value) };
}

module.exports = { allowSmokeRequest, createSmokeAccountFixture, smokeAuthReloadUrl, smokeFriendsOverviewReady, smokeFriendCardReady, smokeRoomReady, smokeRoomCleanupReady, requiredSmokeResources, createSmokeResources, createSmokeProgress, withSmokeDeadline, install };
