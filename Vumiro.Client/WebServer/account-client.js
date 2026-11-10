(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const authPage = document.body?.dataset?.page === 'auth';
  const pageUrl = new URL(location.href || 'https://vumiro.local/friends.html');
  function navigate(page,local=false,screen='') {
    const next=new URL(page,pageUrl);next.search=pageUrl.search;next.hash=pageUrl.hash;
    if(local)next.searchParams.set('view','local');else next.searchParams.delete('view');
    next.searchParams.delete('authView');if(page==='auth.html'&&['signin','signup'].includes(screen))next.searchParams.set('authView',screen);
    location.assign(next.href);
  }
  const pendingStore = new Map();
  const pendingOAuth = new Map();
  const desktop = window.vumiroDesktop || window.chrome?.webview;
  if(authPage&&desktop&&!window.vumiroDesktop){
    const titlebar=$('authTitlebar');if(titlebar)titlebar.hidden=false;
    for(const action of ['minimize','maximize','close'])if($(`authWindow${action}`))$(`authWindow${action}`).onclick=()=>desktop.postMessage({type:'window',action});
    if(titlebar)titlebar.onpointerdown=event=>{if(event.button===0&&!event.target.closest('button'))desktop.postMessage({type:'window',action:'drag'});};
    window.chrome.webview.addEventListener('message',event=>{if(event.data?.type==='window-state'&&$('authWindowmaximize')){const maximized=event.data.maximized===true;$('authWindowmaximize').setAttribute('aria-label',maximized?'Restore window':'Maximize window');$('authWindowmaximize').innerHTML=maximized?'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 1.5h7v7h-2m-7-5h7v7h-7z" fill="none" stroke="currentColor"/></svg>':'<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor"/></svg>';}});
  }
  if (!window.vumiroDesktop && window.chrome?.webview) window.chrome.webview.addEventListener('message', event => {
    const data=event.data;if(!['secure-store-result','oauth-result'].includes(data?.type)||typeof data.requestId!=='string')return;
    const queue=data.type==='oauth-result'?pendingOAuth:pendingStore;
    const pending=queue.get(data.requestId);if(!pending)return;queue.delete(data.requestId);
    if(data.type==='oauth-result'){data.error?pending.reject(Error(data.error)):pending.resolve({code:data.code});return;}
    data.error?pending.reject(Error(data.error)):pending.resolve(data.value||'');
  });
  const secureStore = window.vumiroDesktop?.secureStore || (desktop?{
    get:()=>secureCall('get'),set:value=>secureCall('set',value),delete:()=>secureCall('delete')
  }:null);
  function secureCall(action,value) {
    return new Promise((resolve,reject)=>{
      const requestId=crypto.randomUUID();pendingStore.set(requestId,{resolve,reject});
      desktop.postMessage({type:'secure-store',action,requestId,...(action==='set'?{value}:{})});
      setTimeout(()=>{const pending=pendingStore.get(requestId);if(pending){pendingStore.delete(requestId);reject(Error('Secure account storage did not respond.'));}},10000);
    });
  }
  const NOTICE_VERSION = '2026-11-03';
  let authConfig, session = null, active = false, accountService = '', pendingSignup = null, pendingEmail = '', syncTimer = 0, restoring = false, reauthAction = null, accountRevision = 0;
  let deviceId = '', deviceToken = '', deviceAccountId = '';
  let identityRecovery = null, identityRecoveryCode = '', identityUnlock = null, identityRewrapPending = false;
  let operationTail = Promise.resolve();
  let accountScreen=pageUrl.searchParams.get('authView')==='signup'?'signup':'signin', identityRecoveryAccountId='', oauthInFlight=false;

  function setupAccountScreens() {
    const dialog=$('accountDialog'),details=$('accountDetails');
    if(!dialog||!details)return;
    if(!authPage){const profileEntry=document.createElement('button');profileEntry.type='button';profileEntry.className='accountEntry';profileEntry.textContent='Vumiro account · sign in, sync and recovery';details.before(profileEntry);profileEntry.onclick=()=>openAccount();}
    $('accountContent').append(details);details.open=true;
    const error=$('accountError');$('accountFeedback').after(error);
    const privacy=details.querySelector('details');if(privacy){privacy.id='accountPrivacyNotice';privacy.classList.add('accountPrivacy');}
    const ack=$('accountPrivacyAck')?.closest?.('label');if(ack)ack.id='accountPrivacyRow';
    const confirmLabel=document.createElement('label');confirmLabel.id='accountPasswordConfirmLabel';confirmLabel.htmlFor='accountPasswordConfirm';confirmLabel.textContent='Confirm password';
    const confirmInput=document.createElement('input');confirmInput.id='accountPasswordConfirm';confirmInput.type='password';confirmInput.autocomplete='new-password';confirmInput.maxLength=128;
    (authPage?$('accountPasswordField')||$('accountPassword'):$('accountPassword')).after(confirmLabel,confirmInput);
    if(authPage&&$('accountPasswordReveal'))$('accountPasswordReveal').onclick=()=>{const password=$('accountPassword'),revealed=password.type==='password';password.type=revealed?'text':'password';$('accountPasswordReveal').setAttribute('aria-pressed',String(revealed));$('accountPasswordReveal').setAttribute('aria-label',revealed?'Hide password':'Show password');};
    if($('accountNav'))$('accountNav').onclick=()=>openAccount();
    const setup=$('setupForm');
    if(setup){const row=document.createElement('div');row.className='accountSetupActions';for(const [screen,text]of[['signin','Sign in'],['signup','Create account']]){const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>openAccount(screen);row.append(button);}setup.before(row);}
    if($('accountClose'))$('accountClose').onclick=()=>authPage?navigate('friends.html',true):dialog.close();
    if(!authPage)dialog.addEventListener('close',()=>{if(!window.VumiroLocalProfile?.profile()&&!$('setupDialog')?.open)$('setupDialog')?.showModal();});
    if($('continueLocal'))$('continueLocal').onclick=()=>navigate('friends.html',true);
    $('accountSignInTab').onclick=()=>setAccountScreen('signin');$('accountSignUpTab').onclick=()=>setAccountScreen('signup');
    for(const [id,screen]of [['accountSignInTab','signin'],['accountSignUpTab','signup']])$(id).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?'signin':event.key==='End'?'signup':screen==='signin'?'signup':'signin';setAccountScreen(next);$(next==='signin'?'accountSignInTab':'accountSignUpTab').focus();}});
    $('accountForgotPassword').onclick=()=>{$('accountResetEmail').value=$('accountEmail').value;setAccountScreen('recover');};
    if($('accountVerificationNav'))$('accountVerificationNav').hidden=true;
    $('accountBack').onclick=()=>setAccountScreen('signin');
    $('accountRetry').onclick=async()=>{authConfig=null;$('accountRetry').disabled=true;$('accountError').textContent='';try{await loadAccountAvailability();status('Account service connected.');}catch(error){status(error.message,true);}finally{$('accountRetry').disabled=false;}};
  }
  function openAccount(screen) {
    if(!authPage&&!session&&!document.querySelector?.('#callFrameSlot iframe')){navigate('auth.html',false,screen);return;}
    for(const id of ['setupDialog','profileDialog'])if($(id)?.open)$(id).close();
    setAccountScreen(session?'manage':screen||(pendingSignup?'verify':'signin'));
    if(!authPage&&!$('accountDialog').open)$('accountDialog').showModal();
    const field=['recover','reset'].includes(accountScreen)?$('accountResetEmail'):accountScreen==='verify'?$('accountVerifyCode'):$('accountEmail');
    if(!session)field.focus();
  }
  function setAccountScreen(screen) {
    accountScreen=session&&screen!=='unlock'?'manage':screen;
    const copy={signin:['Welcome back.','Pick up where you left off.'],signup:['Join Vumiro.','Your profile and friends, wherever you go.'],verify:['Check your email.','Enter the verification code we sent to your email address.'],recover:['Forgot your password?','We’ll send a recovery code to your account email.'],reset:['Choose a new password.','Enter the code from your recovery email and set a new password.'],unlock:['Bring your friends with you.','Unlock your encrypted Vumiro identity.'],manage:['Your account.','Manage your saved data, linked devices and account security.']};
    const [heading,description]=copy[accountScreen]||copy.signin;$('accountHeading').textContent=heading;$('accountDescription').textContent=description;
    const formScreen=['signin','signup'].includes(accountScreen);
    $('accountForm').hidden=!formScreen;$('accountActions').hidden=!session||accountScreen==='unlock';
    if($('accountUnlockForm'))$('accountUnlockForm').hidden=accountScreen!=='unlock';
    $('accountVerifyForm').hidden=accountScreen!=='verify';$('accountResetRequestForm').hidden=accountScreen!=='recover';$('accountResetForm').hidden=accountScreen!=='reset';
    $('accountTabs').hidden=!['signin','signup'].includes(accountScreen);$('accountFooter').hidden=!!session;$('accountForgotPassword').hidden=accountScreen!=='signin';$('accountBack').hidden=!!session||['signin','signup'].includes(accountScreen);
    $('accountSignInTab').setAttribute('aria-selected',String(accountScreen==='signin'));$('accountSignUpTab').setAttribute('aria-selected',String(accountScreen==='signup'));
    $('accountSignIn').hidden=accountScreen!=='signin';$('accountSignUp').hidden=accountScreen!=='signup';
    const passwordVisible=true;$('accountPassword').hidden=!passwordVisible;const passwordLabel=$('accountForm').querySelector('label[for="accountPassword"]');if(passwordLabel)passwordLabel.hidden=!passwordVisible;
    if(authPage&&$('accountPasswordField')){$('accountPasswordField').hidden=!passwordVisible;$('accountPassword').type='password';$('accountPasswordReveal')?.setAttribute('aria-pressed','false');$('accountPasswordReveal')?.setAttribute('aria-label','Show password');}
    $('accountPassword').required=passwordVisible;$('accountPassword').minLength=accountScreen==='signup'?12:8;$('accountPassword').autocomplete=accountScreen==='signup'?'new-password':'current-password';
    $('accountPasswordConfirm').hidden=$('accountPasswordConfirmLabel').hidden=accountScreen!=='signup';$('accountPasswordConfirm').required=accountScreen==='signup';
    $('accountPasswordConfirm').value='';
    if($('accountPasswordHint'))$('accountPasswordHint').hidden=accountScreen!=='signup';
    if($('accountPrivacyRow'))$('accountPrivacyRow').hidden=accountScreen!=='signup'&&(accountScreen!=='manage'||!!readNoticeAck());
    if($('accountPrivacyNotice'))$('accountPrivacyNotice').hidden=!['signup','manage'].includes(accountScreen);
    $('accountRegistrationStatus').hidden=!['signin','signup'].includes(accountScreen)||!$('accountRegistrationStatus').textContent;
    if($('accountSocial'))$('accountSocial').hidden=!['signin','signup'].includes(accountScreen);
  }
  async function loadAccountAvailability() {
    let cfg;
    try { cfg=await config(); }
    catch(error) {
      $('accountSignIn').disabled=$('accountSignUp').disabled=true;
      $('accountRegistrationStatus').textContent='';
      $('accountRegistrationStatus').hidden=true;$('accountRetry').hidden=false;
      for(const id of ['accountGoogle','accountMicrosoft'])if($(id))$(id).disabled=true;
      throw error;
    }
    $('accountSignIn').disabled=!cfg.serviceEnabled;$('accountSignUp').disabled=!cfg.serviceEnabled||!cfg.registrationEnabled;
    $('accountRegistrationStatus').textContent=!cfg.serviceEnabled?'Accounts are temporarily unavailable. You can continue with your local profile.':cfg.registrationEnabled?'':'New account registration is paused. Existing accounts can sign in.';
    $('accountRegistrationStatus').hidden=!['signin','signup'].includes(accountScreen)||!$('accountRegistrationStatus').textContent;
    $('accountRetry').hidden=!!cfg.serviceEnabled;
    for(const [id,provider]of [['accountGoogle','google'],['accountMicrosoft','azure']])if($(id))$(id).disabled=!cfg.serviceEnabled||!cfg.oauthProviders?.includes(provider);
    return cfg;
  }

  function enqueue(operation) {
    const result=operationTail.then(operation,operation);
    operationTail=result.catch(()=>{});
    return result;
  }

  function ensureAccountControls() {
    const accountForm=$('accountForm'),verifyForm=$('accountVerifyForm'),actions=$('accountActions');
    const details=$('accountDetails'),intro=details?.querySelector?.('p.help');
    if(intro)intro.textContent='An account restores your profile, friends, blocks, stream preferences, and an encrypted signing identity on another device. Enabling recovery for an older profile changes its contact code; updated friends verify the signed transition automatically while older app versions may require a new friend acceptance.';
    for(const paragraph of details?.querySelectorAll?.('p.help')||[]){
      if(paragraph.textContent.includes('does not upload your device signing key'))paragraph.textContent='Vumiro uploads only the client-encrypted identity envelope. It does not upload the raw signing key, identity recovery code, room passwords, screen, voice, or chat.';
      if(paragraph.textContent.includes('Account data is not end-to-end encrypted'))paragraph.textContent='The signing-identity envelope is encrypted in the client. Other synced account fields are readable to authorized Vumiro infrastructure operators and providers.';
    }
    const signInActions=accountForm?.querySelector('.quickActions');
    if(signInActions&&!$('accountRegistrationStatus')){
      const state=document.createElement('div');state.id='accountRegistrationStatus';state.className='help';signInActions.after(state);
    }
    if(verifyForm&&!$('accountResendVerify')){
      const button=document.createElement('button');button.type='button';button.id='accountResendVerify';button.textContent='Resend code';verifyForm.append(button);
    }
    const actionButtons=actions?.querySelector('.quickActions');
    if(actionButtons&&!$('accountSignOutEverywhere')){
      const button=document.createElement('button');button.type='button';button.id='accountSignOutEverywhere';button.textContent='Sign out everywhere';actionButtons.append(button);
    }
    if(actions&&!$('accountChangePasswordForm')){
      const form=document.createElement('form');form.id='accountChangePasswordForm';
      const currentLabel=document.createElement('label');currentLabel.htmlFor='accountCurrentPassword';currentLabel.textContent='Current password';
      const current=document.createElement('input');current.id='accountCurrentPassword';current.type='password';current.autocomplete='current-password';current.minLength=8;current.maxLength=128;current.required=true;
      const nextLabel=document.createElement('label');nextLabel.htmlFor='accountChangedPassword';nextLabel.textContent='New password';
      const next=document.createElement('input');next.id='accountChangedPassword';next.type='password';next.autocomplete='new-password';next.minLength=12;next.maxLength=128;next.required=true;
      const recoveryLabel=document.createElement('label');recoveryLabel.htmlFor='accountChangeRecoveryCode';recoveryLabel.textContent='Identity recovery code (if not saved on this device)';
      const recovery=document.createElement('input');recovery.id='accountChangeRecoveryCode';recovery.autocomplete='off';recovery.maxLength=64;recovery.placeholder='vmr1.…';
      const submit=document.createElement('button');submit.id='accountChangePassword';submit.type='submit';submit.textContent='Change password';
      form.append(currentLabel,current,nextLabel,next,recoveryLabel,recovery,submit);actions.insertBefore(form,$('accountSyncStatus'));
    }
    const reset=$('accountResetForm');
    if(reset&&!$('accountIdentityRecoveryCode')){
      const label=document.createElement('label');label.htmlFor='accountIdentityRecoveryCode';label.textContent='Identity recovery code (optional)';
      const input=document.createElement('input');input.id='accountIdentityRecoveryCode';input.autocomplete='off';input.maxLength=64;input.placeholder='vmr1.…';
      const help=document.createElement('div');help.className='help';help.textContent='Use the identity code saved when recovery was enabled to preserve the same contact identity after resetting your password.';
      const anchor=reset.querySelector?.('label[for="accountNewPassword"]')||$('accountNewPassword');
      reset.insertBefore(label,anchor);reset.insertBefore(input,anchor);reset.insertBefore(help,anchor);
    }
    if(actions&&!$('accountRecoveryPanel')){
      const panel=document.createElement('div');panel.id='accountRecoveryPanel';panel.hidden=true;
      const heading=document.createElement('h3');heading.textContent='Save your identity recovery code';
      const help=document.createElement('p');help.className='help';help.textContent='Keep an offline copy. Vumiro cannot restore the same contact identity after a password reset without this code.';
      const code=document.createElement('textarea');code.id='accountRecoveryCode';code.className='profileCode';code.rows=2;code.readOnly=true;code.spellcheck=false;
      const buttons=document.createElement('div');buttons.className='quickActions';
      for(const [id,text] of [['accountCopyRecovery','Copy code'],['accountSaveRecovery','Save code'],['accountHideRecovery','I saved it']]){const button=document.createElement('button');button.type='button';button.id=id;button.textContent=text;buttons.append(button);}
      panel.append(heading,help,code,buttons);actions.insertBefore(panel,$('accountSyncStatus'));
    }
    const reauth=$('accountReauthForm');
    if(reauth&&!$('accountReauthProviders')){
      const providers=document.createElement('div');providers.id='accountReauthProviders';providers.className='quickActions';
      for(const [provider,label]of [['google','Google'],['azure','Microsoft']]){const button=document.createElement('button');button.id=`accountReauth${provider}`;button.type='button';button.textContent=`Confirm with ${label}`;button.hidden=true;button.onclick=()=>reauthWithProvider(provider);providers.append(button);}
      reauth.append(providers);
    }
    if(actions&&!$('accountSetPasswordForm')){
      const form=document.createElement('form');form.id='accountSetPasswordForm';form.hidden=true;
      const heading=document.createElement('h3');heading.textContent='Add a Vumiro password';
      const help=document.createElement('p');help.className='help';help.textContent='Set a separate Vumiro password to enable encrypted identity backup and email sign-in. Your Google or Microsoft password is never requested.';
      const label=document.createElement('label');label.htmlFor='accountSetPasswordValue';label.textContent='New Vumiro password';
      const password=document.createElement('input');password.id='accountSetPasswordValue';password.type='password';password.autocomplete='new-password';password.minLength=12;password.maxLength=128;password.required=true;
      const confirmLabel=document.createElement('label');confirmLabel.htmlFor='accountSetPasswordConfirm';confirmLabel.textContent='Confirm Vumiro password';
      const confirmation=document.createElement('input');confirmation.id='accountSetPasswordConfirm';confirmation.type='password';confirmation.autocomplete='new-password';confirmation.minLength=12;confirmation.maxLength=128;confirmation.required=true;
      const button=document.createElement('button');button.type='submit';button.textContent='Set Vumiro password';
      form.append(heading,help,label,password,confirmLabel,confirmation,button);actions.insertBefore(form,$('accountSyncStatus'));
    }
    if(actions&&!$('accountSecurityDetails')){
      const details=document.createElement('details');details.id='accountSecurityDetails';
      const summary=document.createElement('summary');summary.textContent='Password and identity recovery';details.append(summary);
      for(const id of ['accountChangePasswordForm','accountSetPasswordForm','accountRecoveryPanel']){const control=$(id);if(control)details.append(control);}
      actions.insertBefore(details,$('accountSyncStatus'));
    }
  }

  function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  async function providerSession(provider) {
      const cfg=await config();
      if(!cfg.serviceEnabled||!cfg.oauthProviders?.includes(provider))throw Error('This sign-in option is not available yet. You can continue locally.');
      const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
      const codeChallenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
      status(`Finish signing in with ${provider==='google'?'Google':'Microsoft'} in your browser. Keep this window open.`);
      const bridge=window.vumiroDesktop?.oauth;
      const result=bridge?.signIn?await bridge.signIn({authUrl:cfg.authUrl,provider,codeChallenge}):await new Promise((resolve,reject)=>{
        if(!window.chrome?.webview){reject(Error('Open the Vumiro desktop app to sign in with Google or Microsoft.'));return;}
        const requestId=crypto.randomUUID();pendingOAuth.set(requestId,{resolve,reject});
        window.chrome.webview.postMessage({type:'oauth',action:'start',requestId,authUrl:cfg.authUrl,provider,codeChallenge});
        setTimeout(()=>{if(pendingOAuth.delete(requestId))reject(Error('The browser sign-in expired. Please try again.'));},300000);
      });
      if(typeof result?.code!=='string'||!result.code||result.code.length>2048)throw Error('The browser did not return a valid sign-in code.');
      return auth('/token?grant_type=pkce',{auth_code:result.code,code_verifier:verifier});
  }
  async function socialSignIn(provider) {
    if(oauthInFlight)return;
    $('accountError').textContent='';
    try {
      const creatingAccount=accountScreen==='signup';
      if(creatingAccount&&!$('accountPrivacyAck').checked)throw Error('Review the privacy notice before creating an account.');
      await ensureSecureStorage();
      const cfg=await config();
      if(creatingAccount)requireBundledNotice();
      oauthInFlight=true;for(const id of ['accountGoogle','accountMicrosoft'])if($(id))$(id).disabled=true;
      const data=await providerSession(provider);
      pendingSignup=creatingAccount?{email:data.user?.email||'',acceptedAt:new Date().toISOString(),noticeVersion:cfg.privacyNoticeVersion||NOTICE_VERSION}:null;
      // Persist only Vumiro/Supabase refresh credentials. Google and Microsoft
      // access/refresh tokens never enter the secure session store.
      await activate(data);
    } catch(error){$('accountError').textContent=error.message;}
    finally {oauthInFlight=false;for(const [id,providerId]of [['accountGoogle','google'],['accountMicrosoft','azure']])if($(id))$(id).disabled=!authConfig?.serviceEnabled||!authConfig?.oauthProviders?.includes(providerId);}
  }
  async function reauthWithProvider(provider) {
    if(oauthInFlight||!reauthAction||!session)return;
    const currentAccountId=accountId();oauthInFlight=true;
    try {
      const fresh=await providerSession(provider);
      if(fresh.user?.id!==currentAccountId)throw Error('Sign in with the same account to confirm this change.');
      if(!fresh.access_token||!fresh.refresh_token)throw Error('The provider did not return a valid confirmation.');
      session={accessToken:fresh.access_token,refreshToken:fresh.refresh_token,expiresAt:Date.now()+Math.max(30,Number(fresh.expires_in)||3600)*1000,user:fresh.user};await persistCredentials();
      const action=reauthAction;reauthAction=null;$('accountReauthForm').hidden=true;await action(fresh.access_token,'');
    }catch(error){status(error.message,true);}
    finally{oauthInFlight=false;}
  }
  ensureAccountControls();
  setupAccountScreens();
  $('accountNewPassword').minLength=12;
  setAccountScreen(accountScreen);
  if($('accountGoogle'))$('accountGoogle').onclick=()=>socialSignIn('google');
  if($('accountMicrosoft'))$('accountMicrosoft').onclick=()=>socialSignIn('azure');
  for(const provider of ['google','azure'])if($(`accountReauth${provider}`))$(`accountReauth${provider}`).onclick=()=>reauthWithProvider(provider);

  function status(text, error = false) { for(const id of ['accountSyncStatus','accountFeedback']){const target=$(id);if(target){target.textContent=text;target.classList.toggle('error',error);}} }
  function authError(data) { return data?.msg || data?.message || data?.error_description || data?.error || 'The account service could not complete this request.'; }
  async function callJson(url, options={}) {
    const response=await fetch(url,{...options,credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})}});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok){const error=Error(authError(data));error.status=response.status;error.code=typeof data.code==='string'?data.code:typeof data.error_code==='string'?data.error_code:'';throw error;}
    return data;
  }
  async function config() {
    if(authConfig)return authConfig;
    // Accounts are pinned to the canonical Vumiro Worker. A user supplied
    // signaling URL may run calls, but it must never select a password target.
    accountService='https://vumiro-rooms.vumiro-signaling.workers.dev';
    const response=await fetch(`${accountService}/api/v1/account/config`,{credentials:'omit',cache:'no-store',headers:{'X-Vumiro-Profile-Cards':'1'}});
    let data={};try{data=await response.json();}catch{}
    if(!response.ok)throw Error(response.status===404?'Accounts are not available yet. You can continue with your local profile and try again later.':authError(data));
    if(typeof data.authUrl!=='string'||typeof data.publishableKey!=='string')throw Error('The account service is not configured.');
    let authUrl;
    try { authUrl=new URL(data.authUrl); } catch { throw Error('The account service returned an invalid authentication address.'); }
    if(authUrl.protocol!=='https:'||authUrl.username||authUrl.password||authUrl.port||authUrl.pathname!=='/'||authUrl.search||authUrl.hash||! /^[a-z0-9-]+\.supabase\.co$/i.test(authUrl.hostname)) throw Error('The authentication address is not a trusted Supabase project.');
    const key=data.publishableKey;
    if(!(typeof key==='string'&&(/^(sb_publishable_[A-Za-z0-9_-]{20,})$/.test(key)||/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)))) throw Error('The account service returned an invalid publishable key.');
    data.authUrl=authUrl.origin;
    data.serviceEnabled=data.serviceEnabled!==false;
    data.registrationEnabled=data.registrationEnabled===true;
    data.privacyNoticeVersion=typeof data.privacyNoticeVersion==='string'?data.privacyNoticeVersion:NOTICE_VERSION;
    authConfig=data;return data;
  }
  async function auth(path,body,token,method='POST') {
    const cfg=await config();
    if(!cfg.serviceEnabled)throw Error('Vumiro account service is temporarily unavailable. Your local profile remains available.');
    return callJson(`${cfg.authUrl}/auth/v1${path}`,{method,headers:{apikey:cfg.publishableKey,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  }
  async function persistCredentials() {
    if(!secureStore?.set||!secureStore?.delete)throw Error('This app version does not provide secure account session storage. Update Vumiro before signing in.');
    const state={version:2};
    if(session)Object.assign(state,{refreshToken:session.refreshToken,deviceId,deviceToken,deviceAccountId});
    if(pendingSignup)state.pendingSignup=pendingSignup;
    if(identityRecoveryCode&&identityRecoveryAccountId)Object.assign(state,{identityRecoveryCode,identityRecoveryAccountId});
    if(!session&&deviceId&&deviceToken)Object.assign(state,{deviceId,deviceToken,deviceAccountId});
    if(session||pendingSignup||identityRecoveryCode||(deviceId&&deviceToken))await secureStore.set(JSON.stringify(state));
    else await secureStore.delete();
  }
  async function ensureSecureStorage() {
    if(!secureStore?.get||!secureStore?.set||!secureStore?.delete)throw Error('This app version does not provide secure account session storage. Update Vumiro before signing in.');
    await secureStore.get();
  }
  async function activate(value,unlock=null) {
    if(!value?.access_token||!value?.refresh_token)throw Error('The account provider did not return a valid session.');
    const nextAccountId=value.user?.id||value.user?.email||'';
    if(identityRecoveryAccountId!==nextAccountId){identityRecoveryCode='';identityRecoveryAccountId='';identityRecovery=null;identityRewrapPending=false;$('accountRecoveryPanel').hidden=true;$('accountRecoveryCode').value='';}
    if(deviceId&&deviceToken&&(!deviceAccountId||!nextAccountId||deviceAccountId!==nextAccountId)){deviceId='';deviceToken='';}
    deviceAccountId=nextAccountId;
    session={accessToken:value.access_token,refreshToken:value.refresh_token,expiresAt:Date.now()+Math.max(30,Number(value.expires_in)||3600)*1000,user:value.user||{}};
    if(pendingSignup?.acceptedAt&&pendingSignup.email?.trim().toLowerCase()===value.user?.email?.trim().toLowerCase()&&accountId())writeNoticeAck(pendingSignup.acceptedAt,pendingSignup.noticeVersion||NOTICE_VERSION);
    pendingSignup=null;pendingEmail='';
    if(!deviceId)deviceId=crypto.randomUUID();
    identityUnlock=unlock;
    await persistCredentials(); active=false; render();
    try { await syncInitial();if(authPage&&accountScreen!=='unlock')navigate('friends.html');return true; } catch(error) { status(error.message,true);return false; } finally { identityUnlock=null; }
  }
  async function accessToken() {
    if(!session)throw Error('Sign in to your Vumiro account first.');
    if(session.expiresAt>Date.now()+60000)return session.accessToken;
    const data=await auth('/token?grant_type=refresh_token',{refresh_token:session.refreshToken});
    session={accessToken:data.access_token,refreshToken:data.refresh_token||session.refreshToken,expiresAt:Date.now()+Math.max(30,Number(data.expires_in)||3600)*1000,user:data.user||session.user};
    await persistCredentials();return session.accessToken;
  }
  async function enrollDevice(token) {
    if(deviceToken)return;
    const result=await callJson(`${accountService}/api/v1/account/devices/register`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'X-Vumiro-Device':deviceId}});
    if(typeof result.deviceToken!=='string'||result.deviceToken.length<32)throw Error('The account service did not return valid device credentials.');
    deviceToken=result.deviceToken; await persistCredentials();
  }
  async function accountRequest(method,body,tokenOverride,path='/api/v1/account/data') {
    const token=tokenOverride||await accessToken();
    if(!deviceToken)await enrollDevice(token);
    try{return await callJson(`${accountService}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'X-Vumiro-Device':deviceId,'X-Vumiro-Device-Token':deviceToken,...(path==='/api/v1/account/data'?{'X-Vumiro-Profile-Cards':'1',...(authConfig?.profileMediaEnabled===true?{'X-Vumiro-Profile-Media':'1'}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
    catch(error){if(error.status===401||error.status===403){session=null;deviceToken='';deviceId='';deviceAccountId='';active=false;await secureStore?.delete?.();render();if(error.status===403)throw Error('This device is no longer authorized. Sign in again to link it as a new device.');}throw error;}
  }
  async function coverRequest(method, manifest, blob) {
    if(authConfig?.profileMediaEnabled!==true)throw Error('Private high-resolution cover backup is not enabled on this service yet.');
    const tools=window.VumiroCoverMedia;if(!tools)throw Error('Reload Vumiro to restore high-resolution covers.');tools.validateManifest(manifest);
    const token=await accessToken();if(!deviceToken)await enrollDevice(token);
    const headers={Authorization:`Bearer ${token}`,'X-Vumiro-Device':deviceId,'X-Vumiro-Device-Token':deviceToken,'X-Vumiro-Profile-Cards':'1','X-Vumiro-Profile-Media':'1'};
    if(method==='POST'){headers['Content-Type']=manifest.mime;headers['X-Vumiro-Cover-Manifest']=JSON.stringify(manifest);}
    const controller=new AbortController();let reader=null,timedOut=false;
    const timeoutError=()=>Error('Cover transfer timed out. Your local cover is unchanged. Try again.');
    let rejectDeadline;
    const deadline=new Promise((_,reject)=>{rejectDeadline=reject;});
    const timer=setTimeout(()=>{
      timedOut=true;rejectDeadline(timeoutError());controller.abort();
      if(reader)void reader.cancel().catch(()=>{});
    },20000);
    const bounded=promise=>Promise.race([promise,deadline]);
    try {
      const response=await bounded(fetch(`${accountService}/api/v1/account/cover${method==='GET'?'/'+manifest.revision:''}`,{method,headers,signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'error',...(blob?{body:blob}:{})}));
      if(!response.ok){let data={};try{data=await bounded(response.json());}catch(error){if(timedOut)throw error;}const error=Error(authError(data));error.status=response.status;if(response.status===401||response.status===403){session=null;deviceToken='';active=false;await secureStore?.delete?.();render();}throw error;}
      if(method==='POST')return await bounded(response.json());
      if(Number(response.headers.get('Content-Length'))>tools.MAX_BYTES)throw Error('The downloaded cover exceeds its size limit.');
      reader=response.body?.getReader();let result;
      if(reader){const chunks=[];let count=0;while(true){const part=await bounded(reader.read());if(part.done)break;count+=part.value.byteLength;if(count>tools.MAX_BYTES)throw Error('The downloaded cover exceeds its size limit.');chunks.push(part.value);}result=new Blob(chunks,{type:response.headers.get('Content-Type')?.split(';')[0]||''});}
      else result=await bounded(response.blob());
      await bounded(tools.validateBlob(manifest,result));return result;
    } catch(error) {
      controller.abort();if(reader)void reader.cancel().catch(()=>{});
      if(timedOut)throw timeoutError();throw error;
    } finally {
      clearTimeout(timer);if(reader)reader.releaseLock();
    }
  }

  async function coverSnapshotForUpload(value) {
    const cover=value.profile.cover;if(!cover)return value;
    if(authConfig?.profileMediaEnabled!==true){const copy={...value,profile:{...value.profile}};delete copy.profile.cover;return copy;}
    // Staging can expire after a failed CAS or disappear after another device replaces
    // this revision. A page-lifetime cache cannot prove the server still has it.
    // Re-stage idempotently before every snapshot that references finished media.
    // This repeats at most 1 MiB per sync; optimize only with verified server state.
    const blob=await window.VumiroLocalProfile.coverBlob(cover.digest);if(!blob)throw Error('The cover changed during backup. Try again.');
    await window.VumiroCoverMedia.validateBlob(cover,blob,value.profile.banner);
    const result=await coverRequest('POST',cover,blob);
    window.VumiroCoverMedia.validateManifest(result.cover);
    if(Object.keys(cover).some(key=>result.cover[key]!==cover[key]))throw Error('The service did not confirm the finished cover.');
    return value;
  }
  function readSettings() {
    try { const value=JSON.parse(localStorage.getItem('vumiro-stream-settings')||'{}'); return value&&typeof value==='object'&&!Array.isArray(value)?value:{}; } catch { return {}; }
  }
  async function snapshot() {
    const data=await window.VumiroLocalProfile.accountSnapshot(); data.settings=readSettings();
    if(identityRecovery)data.identityRecovery=identityRecovery;
    const acknowledgement=readNoticeAck();
    data.privacyNoticeVersion=acknowledgement?.version||currentNoticeVersion();data.privacyNoticeAcceptedAt=acknowledgement?.acceptedAt||'';
    return data;
  }
  async function restore(data) {
    validateSnapshot(data);
    let restoredCover;
    if(data.profile.cover){const blob=await coverRequest('GET',data.profile.cover);await window.VumiroCoverMedia.validateBlob(data.profile.cover,blob,data.profile.banner||'');restoredCover={manifest:data.profile.cover,blob,banner:data.profile.banner||'',source:null,crop:null};}
    if(data.identityRecovery){
      if(!window.VumiroIdentityRecovery)throw Error('This app version cannot restore the encrypted account identity. Update Vumiro and try again.');
      await window.VumiroIdentityRecovery.validateEnvelope(data.identityRecovery);
      identityRecovery=data.identityRecovery;
      const current=window.VumiroLocalProfile?.profile();
      if(!current||current.id!==identityRecovery.identityId){
        let recovered;
        let usedRecoveryCode=false;
        if(identityUnlock?.password){
          try { recovered=await window.VumiroIdentityRecovery.recoverWithPassword(identityRecovery,identityUnlock.password); }
          catch(error){if(!identityUnlock?.recoveryCode)throw error;recovered=await window.VumiroIdentityRecovery.recoverWithCode(identityRecovery,identityUnlock.recoveryCode);usedRecoveryCode=true;}
        }else if(identityUnlock?.recoveryCode){recovered=await window.VumiroIdentityRecovery.recoverWithCode(identityRecovery,identityUnlock.recoveryCode);usedRecoveryCode=true;}
        if(!recovered)throw Error('Enter your account password or saved identity recovery code to restore this contact identity on a new device.');
        if(usedRecoveryCode){identityRecoveryCode=identityUnlock.recoveryCode;identityRecoveryAccountId=accountId();await persistCredentials();}
        if(usedRecoveryCode&&identityUnlock?.password){identityRecovery=await window.VumiroIdentityRecovery.rewrapPassword(identityRecovery,identityUnlock.recoveryCode,identityUnlock.password);identityRewrapPending=true;}
        await window.VumiroLocalProfile.installRecoveredIdentity(recovered,data.profile,identityRecovery.transition||null);
      }else if(identityUnlock?.recoveryCode&&identityUnlock?.password){
        identityRecovery=await window.VumiroIdentityRecovery.rewrapPassword(identityRecovery,identityUnlock.recoveryCode,identityUnlock.password);identityRecoveryCode=identityUnlock.recoveryCode;identityRecoveryAccountId=accountId();identityRewrapPending=true;await persistCredentials();
      }
    }
    restoring=true;
    const oldSettings=localStorage.getItem('vumiro-stream-settings'), oldNotice=accountId()?localStorage.getItem(privacyAckKey()):null;
    try {
      localStorage.setItem('vumiro-stream-settings',JSON.stringify(data.settings));
      if(typeof data.privacyNoticeAcceptedAt==='string'&&data.privacyNoticeAcceptedAt)writeNoticeAck(data.privacyNoticeAcceptedAt,data.privacyNoticeVersion);
      await window.VumiroLocalProfile.applyAccountSnapshot(data,restoredCover);
      dispatchEvent(new StorageEvent('storage',{key:'vumiro-stream-settings',newValue:JSON.stringify(data.settings)}));
      try { await saveAcknowledged(await snapshot()); } catch {}
    } catch(error) {
      try { oldSettings===null?localStorage.removeItem('vumiro-stream-settings'):localStorage.setItem('vumiro-stream-settings',oldSettings); } catch {}
      try { if(accountId())oldNotice===null?localStorage.removeItem(privacyAckKey()):localStorage.setItem(privacyAckKey(),oldNotice); } catch {}
      throw error;
    } finally { restoring=false; }
  }
  function validateSnapshot(data) {
    if(!data||data.version!==1||!data.profile||typeof data.profile!=='object'||!Array.isArray(data.friends)||data.friends.length>128||!Array.isArray(data.blocked)||data.blocked.length>64||!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings))throw Error('The saved account data is invalid.');
    if(Array.isArray(data.profile)||Object.keys(data.profile).some(key=>!['name','username','avatar','bio','banner','connections','cover'].includes(key)))throw Error('The saved profile is invalid.');
    if(data.profile.cover){if(!window.VumiroCoverMedia)throw Error('High-resolution covers are unavailable in this app.');window.VumiroCoverMedia.validateManifest(data.profile.cover);}
    for(const [field,validator] of [['bio','validateBio'],['banner','validateBanner'],['connections','validateConnections']]) {
      if(Object.hasOwn(data.profile,field)) {
        const validate=window.VumiroLocalProfile?.[validator];
        if(typeof validate!=='function'||JSON.stringify(validate(data.profile[field]))!==JSON.stringify(data.profile[field]))throw Error('The saved profile details are invalid.');
      }
    }
    if(data.blocked.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id))||new Set(data.blocked).size!==data.blocked.length)throw Error('The saved block list is invalid.');
    if(data.friends.some(friend=>!friend||typeof friend!=='object'||typeof friend.id!=='string'||typeof friend.key!=='string'||typeof friend.name!=='string'||(friend.username!=null&&typeof friend.username!=='string')||(friend.nickname!=null&&typeof friend.nickname!=='string')))throw Error('The saved contact list is invalid.');
    if(new Set(data.friends.map(friend=>friend.id)).size!==data.friends.length)throw Error('The saved contact list contains duplicates.');
    if(Object.hasOwn(data,'identityRecovery')&&(!data.identityRecovery||typeof data.identityRecovery!=='object'||Array.isArray(data.identityRecovery)))throw Error('The saved identity recovery data is invalid.');
    const settings=data.settings;
    if(Object.keys(settings).some(key=>!['fps','mbps','resolution','contentHint','audio','excludeDiscord'].includes(key))||
      ('fps'in settings&&(!Number.isInteger(settings.fps)||settings.fps<1||settings.fps>120))||
      ('mbps'in settings&&(!Number.isFinite(settings.mbps)||settings.mbps<1||settings.mbps>100))||
      ('resolution'in settings&&!['native','720p','1080p','1440p','2160p'].includes(settings.resolution))||
      ('contentHint'in settings&&!['detail','motion'].includes(settings.contentHint))||
      ('audio'in settings&&typeof settings.audio!=='boolean')||('excludeDiscord'in settings&&typeof settings.excludeDiscord!=='boolean'))throw Error('The saved settings are invalid.');
  }
  const accountId=()=>session?.user?.id||session?.user?.email||'';
  const ackKey=()=>`vumiro-account-ack:${accountId()}`;
  const privacyAckKey=()=>`vumiro-account-privacy:${accountId()}`;
  function currentNoticeVersion() { return authConfig?.privacyNoticeVersion||NOTICE_VERSION; }
  function requireBundledNotice() { if(currentNoticeVersion()!==NOTICE_VERSION)throw Error('Update Vumiro to review the current privacy notice before creating an account or backing up. Existing accounts can still sign in.'); }
  function readNoticeAck() {
    if(!accountId())return null;
    const raw=localStorage.getItem(privacyAckKey());if(!raw)return null;
    try { const value=JSON.parse(raw);return value?.version===currentNoticeVersion()&&Number.isFinite(Date.parse(value.acceptedAt))?value:null; }
    catch { return currentNoticeVersion()===NOTICE_VERSION&&Number.isFinite(Date.parse(raw))?{version:NOTICE_VERSION,acceptedAt:raw}:null; }
  }
  function writeNoticeAck(acceptedAt,version=currentNoticeVersion()) {
    if(!accountId()||version!==NOTICE_VERSION||version!==currentNoticeVersion()||!Number.isFinite(Date.parse(acceptedAt))||Date.parse(acceptedAt)>Date.now()+300000)return false;
    localStorage.setItem(privacyAckKey(),JSON.stringify({version,acceptedAt}));return true;
  }
  async function fingerprint(value) { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join(''); }
  async function saveAcknowledged(value) { if(accountId())localStorage.setItem(ackKey(),await fingerprint(value)); }
  async function differsFromAcknowledged(value) { try{return await fingerprint(value)!==localStorage.getItem(ackKey());}catch{return true;} }
  async function upload(replaceLatest=false) {
    await config(); requireBundledNotice();
    if(!readNoticeAck()) {
      if(!$('accountPrivacyAck').checked)throw Error('Review and acknowledge the privacy notice before syncing account data.');
      writeNoticeAck(new Date().toISOString());
    }
    if(replaceLatest){const remote=await accountRequest('GET');accountRevision=remote.revision||0;}
    const local=await snapshot(),wire=await coverSnapshotForUpload(local);const result=await accountRequest('PUT',{snapshot:wire,expectedRevision:accountRevision});
    accountRevision=result.revision;active=true;await saveAcknowledged(local);status(local.profile.cover&&authConfig?.profileMediaEnabled!==true?'Profile backed up. High-resolution covers still stay on this device and share directly with updated friends; private cover backup is not enabled on the service yet.':'This device is backed up. Only the finished cover is backed up; the editable original stays on this device. Changes will sync automatically while Vumiro is open.');
  }
  async function enableIdentityRecovery(password) {
    if(identityRecovery)return upload(true);
    if(!window.VumiroIdentityRecovery||!window.VumiroLocalProfile?.prepareIdentityMigration)throw Error('Update Vumiro before enabling identity recovery.');
    const created=await window.VumiroIdentityRecovery.create(password);
    const prepared=await window.VumiroLocalProfile.prepareIdentityMigration(created);
    created.identityRecovery.transition=prepared.transition;
    const previous=identityRecovery;identityRecovery=created.identityRecovery;
    try {
      await upload(true);
      restoring=true;
      try { await window.VumiroLocalProfile.commitIdentityMigration(prepared); }
      finally { restoring=false; }
      identityRecoveryCode=created.recoveryCode;identityRecoveryAccountId=accountId();await persistCredentials();showRecoveryCode();
      status('Identity recovery is enabled. Save the recovery code before closing this panel. Your contact code changed; older friends may need to accept a new request.');
    } catch(error) { identityRecovery=previous;throw error; }
  }
  async function syncInitial() {
    const remote=await accountRequest('GET');
    // Reuse this account's recorded acknowledgement on a new device. Signing
    // in is not evidence that a new or changed notice was acknowledged.
    if(!readNoticeAck()&&Array.isArray(remote.noticeRecords))for(const record of remote.noticeRecords)if(record?.version===currentNoticeVersion()&&writeNoticeAck(record.acceptedAt,record.version))break;
    $('accountPrivacyAck').checked=!!readNoticeAck();
    setAccountScreen(accountScreen);
    $('accountEmail').value=remote.account?.email||session?.user?.email||'';
    accountRevision=remote.revision||0;
    identityRecovery=remote.data?.identityRecovery||null;
    await renderDevices(remote.devices||[]);
    if(!remote.data) {
      if(!window.VumiroLocalProfile?.profile()) { active=false;status('Account ready. Your local profile will be backed up after you create it.');return; }
      active=false;
      status('This account has no saved profile. Choose “Back up this device” to copy this device’s profile and friends to this account.');return;
    }
    const localProfile=window.VumiroLocalProfile?.profile();
    if(authPage&&remote.data.identityRecovery&&localProfile?.id!==remote.data.identityRecovery.identityId&&!identityUnlock){active=false;setAccountScreen('unlock');status('Google and Microsoft cannot unlock your encrypted contact identity. Enter your Vumiro password or recovery code below.');return;}
    if(!localProfile){
      if(remote.data.identityRecovery&&identityUnlock){await restoreRemote();identityUnlock=null;return;}
      active=false;status(remote.data.identityRecovery?'Account data is ready. Sign in with your password, or use your saved identity recovery code after password reset, to restore this contact identity.':'Account data is ready. Create a local profile first, then choose whether to restore it.');return;
    }
    const local=await snapshot();
    if(!await differsFromAcknowledged(local)) { await restoreRemote();return; }
    active=false; status(`Account data is available from ${remote.updatedAt||'another device'}. This device has unbacked changes. Choose restore or back up to resolve them.`);
  }
  async function renderDevices(devices) {
    const box=$('accountDevices');if(!box)return;box.replaceChildren();
    for(const device of devices) {
      const row=document.createElement('div');row.className='roomRow';
      const label=document.createElement('span');label.className='friendInfo';label.textContent=(device.label||'Vumiro desktop')+(device.id===deviceId?' · This device':'');
      const last=document.createElement('small');last.textContent=device.revokedAt?'Revoked':`Last active ${new Date(device.lastSeen).toLocaleString()}`;label.append(last);row.append(label);
      if(device.id!==deviceId&&!device.revokedAt){const button=document.createElement('button');button.className='danger';button.textContent='Revoke';button.onclick=()=>revokeDevice(device.id,device.label||'this device');row.append(button);}
      box.append(row);
    }
    if(!devices.length)box.textContent='No other devices are linked to this account.';
  }
  async function loadDevices() { const result=await accountRequest('GET',undefined,undefined,'/api/v1/account/devices');await renderDevices(result.devices||[]); }
  async function revokeDevice(id,label) {
    if(!confirm(`Revoke ${label}? It will no longer be able to access this account.`))return;
    requestReauth(async token=>{await accountRequest('POST',{deviceId:id},token,'/api/v1/account/devices/revoke');await loadDevices();status(`${label} was revoked.`);});
  }
  function showRecoveryCode() {
    const panel=$('accountRecoveryPanel'),field=$('accountRecoveryCode');
    if(!panel||!field||!identityRecoveryCode)return;
    field.value=identityRecoveryCode;panel.hidden=false;const securityDetails=$('accountSecurityDetails');if(securityDetails)securityDetails.open=true;
  }
  function requestReauth(action) { reauthAction=action;$('accountConfirmPassword').value='';$('accountReauthForm').hidden=false;for(const provider of ['google','azure'])if($(`accountReauth${provider}`))$(`accountReauth${provider}`).hidden=!session?.user?.app_metadata?.providers?.includes(provider)||!authConfig?.oauthProviders?.includes(provider);$('accountConfirmPassword').focus(); }
  function accountState() { return Object.freeze({signedIn:!!session,email:session?.user?.email||''}); }
  function signOutLocally() {
    active=false;clearTimeout(syncTimer);
    return enqueue(()=>signOut(false));
  }
  async function signOut(everywhere=false, tokenOverride='') {
    active=false;clearTimeout(syncTimer);
    let providerToken=tokenOverride||'';
    if(session&&!providerToken)try{providerToken=await accessToken();}catch{providerToken=session?.accessToken||'';}
    if(everywhere&&providerToken)await accountRequest('POST',{},providerToken,'/api/v1/account/devices/revoke-all');
    if(session)try{await auth(`/logout?scope=${everywhere?'global':'local'}`,{},providerToken||session.accessToken);}catch{}
    session=null;active=false;clearTimeout(syncTimer);
    if(everywhere){deviceId='';deviceToken='';deviceAccountId='';}
    try{await persistCredentials();}finally{render();}
    status(everywhere?'Signed out on every device. Other devices must sign in again.':'Signed out of your account. Your local profile and contacts stay on this device.');
    navigate('auth.html',false,'signin');
  }
  function render() {
    const signed=!!session;
    if(!signed){$('accountReauthForm').hidden=true;reauthAction=null;}
    $('accountStatus').textContent=signed?`Signed in as ${session.user?.email||$('accountEmail').value}. Your session is saved securely on this device.`:'Not signed in. Your existing local data stays on this device.';
    $('accountPrivacyAck').checked=!!(signed&&readNoticeAck());
    if($('accountSetPasswordForm'))$('accountSetPasswordForm').hidden=!signed||!session.user?.app_metadata?.providers?.some(provider=>provider==='google'||provider==='azure');
    if(!signed&&pendingSignup){$('accountEmail').value=pendingSignup.email;status(`Enter the verification code sent to ${pendingSignup.email}.`);}
    setAccountScreen(signed?(accountScreen==='unlock'?'unlock':'manage'):pendingSignup?'verify':['manage','unlock'].includes(accountScreen)?'signin':accountScreen);
    dispatchEvent(new Event('vumiro-account-state-changed'));
  }
  async function restoreRemote() {
    const remote=await accountRequest('GET'); if(!remote.data)throw Error('There is no saved account data yet.');
    await restore(remote.data);identityUnlock=null;active=true;status('Account data restored to this device. Future changes will sync automatically.');
    accountRevision=remote.revision||0;
    if(identityRewrapPending){identityRewrapPending=false;await upload(false);}
    dispatchEvent(new Event('vumiro-account-restored'));
  }
  function scheduleSync() {
    if(restoring||!session||!active)return;clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>enqueue(upload).catch(error=>{if(error.status===409){active=false;status(error.message+' Automatic sync paused. Choose Restore or Back up to continue.',true);}else status(error.message,true);}),1200);
  }
  async function exportData() {
    let remote;
    try { remote=await accountRequest('GET',undefined,undefined,'/api/v1/account/export'); }
    catch(error) {
      if(error.status!==404)throw error;
      const data=await accountRequest('GET');
      remote={version:1,exportedAt:new Date().toISOString(),account:data.account||{},data:data.data||null,sync:{revision:data.revision||0,updatedAt:data.updatedAt||null},devices:data.devices||[],currentDevice:data.currentDevice||deviceId,noticeRecords:data.noticeRecords||[]};
    }
    if(remote.data?.profile?.cover){const manifest=remote.data.profile.cover,blob=await coverRequest('GET',manifest);const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));remote.finishedCover={manifest,dataUrl:`data:${manifest.mime};base64,${btoa(binary)}`};}
    const content=JSON.stringify(remote,null,2);
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='vumiro-account-export.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Your account data export was downloaded.');
  }
  async function deleteAccount() {
    if(!confirm('Delete your Vumiro account and synced data? This cannot be undone.'))return;
    requestReauth(async token=>{const result=await accountRequest('DELETE',undefined,token);session=null;active=false;deviceId='';deviceToken='';deviceAccountId='';await secureStore?.delete?.();render();status(result.ok===true?'Account and synced account data were deleted. Your local device profile remains on this device.':'Synced account data was deleted. Account identity deletion is pending and Vumiro will retry automatically. Your local device profile remains on this device.');});
  }
  $('accountReauthForm').onsubmit=async event=>{
    event.preventDefault();if(!reauthAction)return;
    $('accountConfirmAction').disabled=true;
    try {
      const fresh=await auth('/token?grant_type=password',{email:session?.user?.email||$('accountEmail').value.trim(),password:$('accountConfirmPassword').value});
      const password=$('accountConfirmPassword').value;
      const token=fresh.access_token;session={accessToken:token,refreshToken:fresh.refresh_token||session.refreshToken,expiresAt:Date.now()+Math.max(30,Number(fresh.expires_in)||3600)*1000,user:fresh.user||session.user};await persistCredentials();
      const action=reauthAction;reauthAction=null;$('accountReauthForm').hidden=true;$('accountConfirmPassword').value='';await action(token,password);
    } catch(error){status(error.message,true);} finally{$('accountConfirmAction').disabled=false;}
  };

  $('accountForm').onsubmit=async event=>{
    event.preventDefault();$('accountError').textContent='';
    if(accountScreen==='signup'){await $('accountSignUp').onclick();return;}
    const submit=$('accountSignIn');submit.disabled=true;
    try { await ensureSecureStorage();const password=$('accountPassword').value;const data=await auth('/token?grant_type=password',{email:$('accountEmail').value.trim(),password});await activate(data,{password});$('accountPassword').value=''; }
    catch(error){
      if(error.code==='email_not_confirmed'){
        pendingEmail=$('accountEmail').value.trim();
        // Resuming verification does not fabricate a privacy acknowledgement.
        if(pendingSignup?.email!==pendingEmail)pendingSignup={email:pendingEmail,acceptedAt:'',noticeVersion:currentNoticeVersion()};
        await persistCredentials();setAccountScreen('verify');$('accountVerifyCode').focus();
        status('Your email still needs verification. Enter the code from your signup email, or resend it.');
      }else $('accountError').textContent=error.message;
    } finally{submit.disabled=false;}
  };
  $('accountSignUp').onclick=async()=>{
    $('accountError').textContent='';
    if(!$('accountEmail').reportValidity()||!$('accountPassword').reportValidity())return;
    if($('accountPassword').value.length<12){$('accountError').textContent='Use at least 12 characters for a new account password.';return;}
    if($('accountPassword').value!==$('accountPasswordConfirm').value){$('accountError').textContent='Your passwords do not match.';$('accountPasswordConfirm').focus();return;}
    if(!$('accountPrivacyAck').checked){$('accountError').textContent='Review the privacy notice before creating an account.';return;}
    const button=$('accountSignUp');button.disabled=true;
    try {
      await ensureSecureStorage();
      const cfg=await config();if(!cfg.registrationEnabled)throw Error('New Vumiro account registration is currently unavailable. Existing accounts can still sign in.');
      requireBundledNotice();
      pendingEmail=$('accountEmail').value.trim();const password=$('accountPassword').value;
      await callJson(`${cfg.authUrl}/auth/v1/signup`,{method:'POST',headers:{apikey:cfg.publishableKey},body:JSON.stringify({email:pendingEmail,password})});
      pendingSignup={email:pendingEmail,acceptedAt:new Date().toISOString(),noticeVersion:cfg.privacyNoticeVersion||NOTICE_VERSION};
      await persistCredentials();
      setAccountScreen('verify');$('accountVerifyCode').focus();status(`Check ${pendingEmail} for a verification code, then enter it here.`);
    } catch(error){$('accountError').textContent=error.message;} finally{button.disabled=false;}
  };
  $('accountResendVerify').onclick=async()=>{
    $('accountError').textContent='';const button=$('accountResendVerify');button.disabled=true;
    try {
      if(!pendingSignup?.email)throw Error('Create an account or sign in with your unverified email first.');
      const cfg=await config();await callJson(`${cfg.authUrl}/auth/v1/resend`,{method:'POST',headers:{apikey:cfg.publishableKey},body:JSON.stringify({type:'signup',email:pendingSignup.email})});
      $('accountError').textContent='A new verification code was requested. Check your email.';
    } catch(error){$('accountError').textContent=error.message;} finally{button.disabled=false;}
  };
  $('accountVerifyForm').onsubmit=async event=>{
    event.preventDefault();$('accountError').textContent='';
    try { await ensureSecureStorage();const password=$('accountPassword').value;const data=await auth('/verify',{email:pendingSignup?.email||pendingEmail||$('accountEmail').value.trim(),token:$('accountVerifyCode').value.trim(),type:'signup'});await activate(data,password?{password}:null);$('accountPassword').value='';$('accountVerifyCode').value='';$('accountVerifyForm').hidden=true;$('accountPrivacyAck').checked=false; }
    catch(error){$('accountError').textContent=error.message;}
  };
  $('accountResetRequestForm').onsubmit=async event=>{
    event.preventDefault();$('accountError').textContent='';
    try { await auth('/recover',{email:$('accountResetEmail').value.trim()});pendingEmail=$('accountResetEmail').value.trim();setAccountScreen('reset');status('If an account exists for that address, a recovery code has been sent.');$('accountResetCode').focus(); }
    catch(error){status(error.message,true);}
  };
  $('accountResetForm').onsubmit=async event=>{
    event.preventDefault();
    try {
      await ensureSecureStorage();const data=await auth('/verify',{email:pendingEmail||$('accountResetEmail').value.trim(),token:$('accountResetCode').value.trim(),type:'recovery'});
      const password=$('accountNewPassword').value,recoveredAccountId=data.user?.id||data.user?.email||'',recoveryCode=$('accountIdentityRecoveryCode')?.value.trim()||(identityRecoveryAccountId===recoveredAccountId?identityRecoveryCode:'');
      await auth('/user',{password},data.access_token,'PUT');
      const synced=await activate(data,{password,recoveryCode});$('accountNewPassword').value='';$('accountResetCode').value='';if($('accountIdentityRecoveryCode'))$('accountIdentityRecoveryCode').value='';$('accountResetForm').hidden=true;if(synced)status('Your password was reset. You are signed in.');
    }
    catch(error){status(error.message,true);}
  };
  $('accountRestore').onclick=async()=>{ $('accountRestore').disabled=true;try{if(!confirm('Replace this device’s profile, contacts, blocks, stream settings, and compatible signed identity with the copy saved in your account?'))return;requestReauth((_token,password)=>{identityUnlock={password,recoveryCode:identityRecoveryCode};return enqueue(restoreRemote).catch(error=>status(error.message,true)).finally(()=>{identityUnlock=null;});});}catch(error){status(error.message,true);}finally{$('accountRestore').disabled=false;} };
  $('accountBackup').onclick=async()=>{ $('accountBackup').disabled=true;try{await config();requireBundledNotice();if(!readNoticeAck()&&!$('accountPrivacyAck').checked)throw Error('Review and acknowledge the privacy notice for this account before syncing data.');if(!confirm('Copy this device’s profile, friends, settings, and encrypted recovery identity into the signed-in account? This may replace data already saved there.'))return;if(!readNoticeAck())writeNoticeAck(new Date().toISOString());if(identityRecovery)await enqueue(()=>upload(true));else requestReauth((_token,password)=>{if(!password){status('Add a separate Vumiro password below, then choose Back up again to encrypt your identity.',true);const securityDetails=$('accountSecurityDetails');if(securityDetails)securityDetails.open=true;$('accountSetPasswordForm').hidden=false;$('accountSetPasswordValue').focus();return;}return enqueue(()=>enableIdentityRecovery(password)).catch(error=>status(error.message,true));}); }catch(error){status(error.message,true);}finally{$('accountBackup').disabled=false;} };
  if($('accountUnlockForm'))$('accountUnlockForm').onsubmit=async event=>{event.preventDefault();const password=$('accountUnlockPassword').value,recoveryCode=$('accountUnlockCode').value.trim();if(!password&&!recoveryCode){status('Enter your Vumiro password or identity recovery code.',true);return;}try{identityUnlock={password,recoveryCode};await enqueue(restoreRemote);$('accountUnlockPassword').value='';$('accountUnlockCode').value='';navigate('friends.html');}catch(error){status(error.message,true);}finally{identityUnlock=null;}};
  if($('accountSetPasswordForm'))$('accountSetPasswordForm').onsubmit=event=>{event.preventDefault();const password=$('accountSetPasswordValue').value;if(password.length<12||password!==$('accountSetPasswordConfirm').value){status('Use at least 12 characters and enter the same Vumiro password twice.',true);return;}if(identityRecovery){status('Use Change password with your recovery code to update an existing encrypted identity.',true);return;}requestReauth(async token=>{try{await auth('/user',{password},token,'PUT');$('accountSetPasswordValue').value='';$('accountSetPasswordConfirm').value='';status('Your Vumiro password is set. Use it to sign in by email and enable encrypted identity backup.');}catch(error){status(error.message,true);}});};
  $('accountExport').onclick=()=>enqueue(exportData).catch(error=>status(error.message,true));
  $('accountSignOut').onclick=()=>signOutLocally().catch(error=>status(error.message,true));
  $('accountSignOutEverywhere').onclick=()=>{
    if(!confirm('Sign out every linked device? Each device will need the password again.'))return;
    requestReauth(token=>enqueue(()=>signOut(true,token)).catch(error=>status(error.message,true)));
  };
  $('accountChangePasswordForm').onsubmit=async event=>{
    event.preventDefault();const button=$('accountChangePassword');button.disabled=true;
    try {
      const fresh=await auth('/token?grant_type=password',{email:session?.user?.email||$('accountEmail').value.trim(),password:$('accountCurrentPassword').value});
      const newPassword=$('accountChangedPassword').value;
      const recoveryCode=$('accountChangeRecoveryCode')?.value.trim()||identityRecoveryCode;
      let nextRecovery=identityRecovery;
      if(identityRecovery){
        if(!recoveryCode)throw Error('Enter your saved identity recovery code to keep the same contact identity when changing this password.');
        nextRecovery=await window.VumiroIdentityRecovery.rewrapPassword(identityRecovery,recoveryCode,newPassword);
      }
      await auth('/user',{password:newPassword},fresh.access_token,'PUT');
      session={accessToken:fresh.access_token,refreshToken:fresh.refresh_token||session.refreshToken,expiresAt:Date.now()+Math.max(30,Number(fresh.expires_in)||3600)*1000,user:fresh.user||session.user};await persistCredentials();
      if(nextRecovery!==identityRecovery){const previous=identityRecovery;identityRecovery=nextRecovery;try{await enqueue(()=>upload(true));}catch(error){identityRecovery=previous;throw Error('The password changed, but the encrypted identity backup could not be updated. Keep your recovery code and try Back up again. '+error.message);}}
      if(recoveryCode){identityRecoveryCode=recoveryCode;identityRecoveryAccountId=accountId();await persistCredentials();}
      $('accountCurrentPassword').value='';$('accountChangedPassword').value='';if($('accountChangeRecoveryCode'))$('accountChangeRecoveryCode').value='';status('Your password was changed.');
    } catch(error){status(error.message,true);} finally{button.disabled=false;}
  };
  $('accountDelete').onclick=deleteAccount;
  $('accountDevicesRefresh').onclick=()=>enqueue(loadDevices).catch(error=>status(error.message,true));
  $('accountCopyRecovery').onclick=async()=>{try{await navigator.clipboard.writeText(identityRecoveryCode);status('Identity recovery code copied.');}catch{showRecoveryCode();status('Copy the identity recovery code from the field above.');}};
  $('accountSaveRecovery').onclick=()=>{if(!identityRecoveryCode)return;const url=URL.createObjectURL(new Blob([identityRecoveryCode+'\n'],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='Vumiro-identity-recovery.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Identity recovery code saved.');};
  $('accountHideRecovery').onclick=()=>{$('accountRecoveryPanel').hidden=true;$('accountRecoveryCode').value='';};
  addEventListener('vumiro-profile-changed',scheduleSync);addEventListener('vumiro-friends-changed',scheduleSync);addEventListener('vumiro-account-data-changed',scheduleSync);
  addEventListener('DOMContentLoaded',async()=>{
    try {
      await window.VumiroLocalProfile?.initialize?.();
      accountService='https://vumiro-rooms.vumiro-signaling.workers.dev';
      if(secureStore?.get) {
        const stored=await secureStore.get();
        if(stored){
          let saved;try{saved=JSON.parse(stored);}catch{saved={refreshToken:stored};}
          if(saved.pendingSignup&&typeof saved.pendingSignup.email==='string'&&typeof saved.pendingSignup.acceptedAt==='string'){
            pendingSignup={email:saved.pendingSignup.email,acceptedAt:saved.pendingSignup.acceptedAt,noticeVersion:saved.pendingSignup.noticeVersion||NOTICE_VERSION};pendingEmail=pendingSignup.email;
          }
          if(typeof saved.identityRecoveryCode==='string'&&/^vmr1\.[A-Za-z0-9_-]{48}$/.test(saved.identityRecoveryCode)&&(saved.identityRecoveryAccountId||saved.deviceAccountId)){identityRecoveryCode=saved.identityRecoveryCode;identityRecoveryAccountId=saved.identityRecoveryAccountId||saved.deviceAccountId;}
          const hasDevice=typeof saved.deviceId==='string'&&/^[0-9a-f-]{36}$/i.test(saved.deviceId)&&typeof saved.deviceToken==='string'&&saved.deviceToken.length>=32;
          if(hasDevice){deviceId=saved.deviceId;deviceToken=saved.deviceToken;deviceAccountId=typeof saved.deviceAccountId==='string'?saved.deviceAccountId:'';}
          if(typeof saved.refreshToken==='string'&&saved.refreshToken){
            if(!hasDevice){await secureStore.delete();pendingSignup=null;throw Error('This saved session needs a fresh sign in to link this device securely.');}
            const data=await auth('/token?grant_type=refresh_token',{refresh_token:saved.refreshToken});session={accessToken:data.access_token,refreshToken:data.refresh_token||saved.refreshToken,expiresAt:Date.now()+Math.max(30,Number(data.expires_in)||3600)*1000,user:data.user||{}};deviceAccountId=data.user?.id||data.user?.email||deviceAccountId;if(identityRecoveryAccountId!==deviceAccountId){identityRecoveryCode='';identityRecoveryAccountId='';}await persistCredentials();await enqueue(syncInitial);
          }
        }
      }
      if(!authPage&&!session&&(pendingSignup||(!window.VumiroLocalProfile?.profile()&&pageUrl.searchParams.get('view')!=='local'))){navigate('auth.html');return;}
      await loadAccountAvailability();
    } catch(error) {
      if(error.status===400||error.status===401){await secureStore?.delete?.().catch(()=>{});session=null;deviceId='';deviceToken='';deviceAccountId='';}
      else {status(error.message,true);$('accountError').textContent='';$('accountSignIn').disabled=$('accountSignUp').disabled=true;$('accountRetry').hidden=false;}
    }
    render();
    if(authPage){setAccountScreen(accountScreen==='unlock'?'unlock':pendingSignup?'verify':session?'manage':accountScreen);if(session&&accountScreen!=='unlock')navigate('friends.html');}
  });
  window.VumiroAccount=Object.freeze({open:openAccount,state:accountState,getState:accountState,signOut:signOutLocally,onProfileReady:async()=>{if(session&&!active)try{await enqueue(syncInitial);}catch(error){status(error.message,true);}},scheduleSync});
})();
