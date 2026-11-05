(() => {
  'use strict';

  const MAX_INPUT_BYTES = 5 * 1024 * 1024;
  const MAX_PIXELS = 50000000;
  const MAX_DATA_URL_LENGTH = 32768;
  const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  let dialog;

  function ensureDialog() {
    if (dialog?.isConnected) return dialog;

    const style = document.createElement('style');
    style.dataset.vumiroAvatarEditor = '';
    style.textContent = `
      dialog.vumiro-avatar-editor{width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:24px;border:1px solid #3a3a43;border-radius:14px;background:#17171b;color:#f8f8f8;box-shadow:0 24px 90px #000b;font:14px/1.5 Sora,"Segoe UI",system-ui,sans-serif}
      dialog.vumiro-avatar-editor::backdrop{background:#050507c9;backdrop-filter:blur(4px)}
      .vae-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .vae-head h2{font-size:20px;letter-spacing:-.5px;margin:0 0 4px}
      .vae-head p,.vae-help{margin:0;color:#a1a1aa;font-size:12px}
      .vae-close{width:36px;height:36px;display:grid;place-items:center;border:1px solid #34343b;border-radius:8px;background:#222227;color:#eee;font-size:21px;cursor:pointer}
      .vae-close:focus-visible,.vae-actions button:focus-visible,.vae-zoom:focus-visible,.vae-crop:focus-visible{outline:2px solid #e11d2e;outline-offset:3px}
      .vae-crop-wrap{display:grid;place-items:center;padding:13px;background:#101013;border:1px solid #2d2d33;border-radius:12px}
      .vae-crop{position:relative;width:min(100%,360px);aspect-ratio:1;overflow:hidden;border-radius:50%;background:#222227;cursor:grab;touch-action:none;outline:none;user-select:none}
      .vae-crop:active{cursor:grabbing}
      .vae-image{position:absolute;left:0;top:0;max-width:none;max-height:none;pointer-events:none;user-select:none;will-change:transform}
      .vae-grid{position:absolute;inset:0;pointer-events:none;border:1px solid #ffffff55;border-radius:50%;box-shadow:inset 0 0 0 1px #0004}
      .vae-help{margin-top:12px;text-align:center}
      .vae-zoom-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;margin:20px 2px 0}
      .vae-zoom-row label{font-size:12px;font-weight:600}
      .vae-zoom-row output{min-width:40px;text-align:right;color:#b8b8c0;font-size:11px;font-variant-numeric:tabular-nums}
      .vae-zoom{width:100%;accent-color:#e11d2e}
      .vae-error{min-height:18px;margin:10px 2px 0;color:#ff9ca8;font-size:12px}
      .vae-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
      .vae-actions button{padding:10px 15px;border:1px solid #38383f;border-radius:8px;background:#242429;color:#f8f8f8;font:inherit;font-size:13px;font-weight:600;cursor:pointer}
      .vae-actions .vae-save{background:#e11d2e;border-color:#e11d2e}
      .vae-actions button:hover{filter:brightness(1.12)}
      @media(max-width:480px){dialog.vumiro-avatar-editor{padding:18px}.vae-crop-wrap{padding:8px}.vae-crop{width:min(100%,300px)}}
    `;
    document.head.append(style);

    dialog = document.createElement('dialog');
    dialog.className = 'vumiro-avatar-editor';
    dialog.setAttribute('aria-labelledby', 'vae-title');
    dialog.innerHTML = `
      <div class="vae-head">
        <div><h2 id="vae-title">Adjust profile picture</h2><p>Drag to reposition your picture.</p></div>
        <button class="vae-close" type="button" aria-label="Cancel picture editing">×</button>
      </div>
      <div class="vae-crop-wrap">
        <div class="vae-crop" role="img" aria-label="Circular preview of your profile picture. Use arrow keys to reposition it." tabindex="0">
          <img class="vae-image" alt="" draggable="false">
          <span class="vae-grid" aria-hidden="true"></span>
        </div>
      </div>
      <p class="vae-help">Use the slider to zoom. Arrow keys also move the picture.</p>
      <div class="vae-zoom-row">
        <label for="vae-zoom">Zoom</label>
        <input class="vae-zoom" id="vae-zoom" type="range" min="1" max="3" step="0.01" value="1">
        <output class="vae-zoom-value" for="vae-zoom">1.00×</output>
      </div>
      <p class="vae-error" role="alert" aria-live="polite"></p>
      <div class="vae-actions"><button class="vae-cancel" type="button">Cancel</button><button class="vae-save" type="button">Use picture</button></div>
    `;
    document.body.append(dialog);
    return dialog;
  }

  function inputError(file) {
    if (!file || !ACCEPTED_TYPES.has(file.type) || file.size > MAX_INPUT_BYTES) {
      return 'Choose a PNG, JPEG or WebP picture up to 5 MB.';
    }
    return '';
  }

  function validateOutput(value) {
    if (value.length > MAX_DATA_URL_LENGTH || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error('This picture could not be compressed under the 32 KiB profile limit. Choose another image.');
    }
    const validator = window.VumiroLocalProfile?.validateAvatar;
    if (validator) return validator(value);
    return value;
  }

  function encodeCrop(image, size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this picture.');
    // The image is scaled uniformly; converting the visible crop from preview
    // pixels back to source pixels keeps the saved square aligned with the UI.
    const scale = image.__previewScale;
    const cropSize = size / scale;
    const sourceX = Math.max(0, Math.min(image.naturalWidth - cropSize, -image.__offsetX / scale));
    const sourceY = Math.max(0, Math.min(image.naturalHeight - cropSize, -image.__offsetY / scale));
    context.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, 192, 192);

    for (const quality of [.85, .7, .5]) {
      const value = canvas.toDataURL('image/webp', quality);
      if (value.length <= MAX_DATA_URL_LENGTH) return validateOutput(value);
    }
    canvas.width = canvas.height = 128;
    const smaller = canvas.getContext('2d');
    smaller.drawImage(image, sourceX, sourceY, cropSize, cropSize, 0, 0, 128, 128);
    for (const quality of [.65, .5, .35]) {
      const value = canvas.toDataURL('image/jpeg', quality);
      if (value.length <= MAX_DATA_URL_LENGTH) return validateOutput(value);
    }
    throw new Error('This picture could not be compressed under the 32 KiB profile limit. Choose another image.');
  }

  function edit(file) {
    const problem = inputError(file);
    if (problem) return Promise.reject(new Error(problem));

    const ui = ensureDialog();
    const crop = ui.querySelector('.vae-crop');
    const image = ui.querySelector('.vae-image');
    const zoom = ui.querySelector('.vae-zoom');
    const zoomValue = ui.querySelector('.vae-zoom-value');
    const error = ui.querySelector('.vae-error');
    const save = ui.querySelector('.vae-save');
    const close = ui.querySelector('.vae-close');
    const cancel = ui.querySelector('.vae-cancel');
    const objectUrl = URL.createObjectURL(file);
    const previousFocus = document.activeElement;

    return new Promise((resolve) => {
      let settled = false;
      let pointer = null;
      let startPoint = null;
      let offsetX = 0;
      let offsetY = 0;
      let baseScale = 1;
      let scale = 1;
      let minZoom = 1;
      let maxZoom = 3;
      let imageWidth = 0;
      let imageHeight = 0;
      let previewSide = 0;
      let resizeObserver = null;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(objectUrl);
        image.removeAttribute('src');
        image.onload = null;
        image.onerror = null;
        resizeObserver?.disconnect();
        ui.removeEventListener('cancel', onDialogCancel);
        ui.removeEventListener('click', onBackdrop);
        crop.removeEventListener('pointerdown', onPointerDown);
        crop.removeEventListener('pointermove', onPointerMove);
        crop.removeEventListener('pointerup', onPointerUp);
        crop.removeEventListener('pointercancel', onPointerUp);
        crop.removeEventListener('keydown', onKeyDown);
        zoom.removeEventListener('input', onZoom);
        save.removeEventListener('click', onSave);
        close.removeEventListener('click', onCancel);
        cancel.removeEventListener('click', onCancel);
        if (ui.open) ui.close();
        if (previousFocus?.isConnected) previousFocus.focus();
        resolve(value);
      };
      const clamp = () => {
        const side = crop.clientWidth;
        const width = imageWidth * scale;
        const height = imageHeight * scale;
        offsetX = Math.min(0, Math.max(side - width, offsetX));
        offsetY = Math.min(0, Math.max(side - height, offsetY));
      };
      const render = () => {
        clamp();
        image.style.left = '0';
        image.style.top = '0';
        image.style.width = `${imageWidth}px`;
        image.style.height = `${imageHeight}px`;
        image.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
        image.style.transformOrigin = 'top left';
        image.__previewScale = scale;
        image.__offsetX = offsetX;
        image.__offsetY = offsetY;
        zoom.value = String(scale / baseScale);
        zoomValue.value = `${(scale / baseScale).toFixed(2)}×`;
        zoomValue.textContent = zoomValue.value;
      };
      const onCropResize = () => {
        if (!imageWidth || !imageHeight) return;
        const side = crop.clientWidth;
        if (!side || side === previewSide) return;
        const centerSourceX = (previewSide / 2 - offsetX) / scale;
        const centerSourceY = (previewSide / 2 - offsetY) / scale;
        const zoomRatio = scale / baseScale;
        baseScale = Math.max(side / imageWidth, side / imageHeight);
        scale = baseScale * zoomRatio;
        offsetX = side / 2 - centerSourceX * scale;
        offsetY = side / 2 - centerSourceY * scale;
        previewSide = side;
        render();
      };
      const onZoom = () => {
        const previousScale = scale;
        const ratio = Number(zoom.value);
        scale = baseScale * ratio;
        const side = crop.clientWidth;
        const centerX = side / 2;
        const centerY = side / 2;
        offsetX = centerX - (centerX - offsetX) * (scale / previousScale);
        offsetY = centerY - (centerY - offsetY) * (scale / previousScale);
        render();
      };
      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        pointer = event.pointerId;
        startPoint = {x: event.clientX, y: event.clientY, offsetX, offsetY};
        crop.setPointerCapture(pointer);
        event.preventDefault();
      };
      const onPointerMove = (event) => {
        if (pointer !== event.pointerId || !startPoint) return;
        offsetX = startPoint.offsetX + event.clientX - startPoint.x;
        offsetY = startPoint.offsetY + event.clientY - startPoint.y;
        render();
      };
      const onPointerUp = (event) => {
        if (pointer !== event.pointerId) return;
        pointer = null;
        startPoint = null;
        if (crop.hasPointerCapture(event.pointerId)) crop.releasePointerCapture(event.pointerId);
      };
      const onKeyDown = (event) => {
        const step = event.shiftKey ? 20 : 8;
        if (event.key === 'ArrowLeft') offsetX += step;
        else if (event.key === 'ArrowRight') offsetX -= step;
        else if (event.key === 'ArrowUp') offsetY += step;
        else if (event.key === 'ArrowDown') offsetY -= step;
        else return;
        event.preventDefault();
        render();
      };
      const onSave = () => {
        try {
          error.textContent = '';
          save.disabled = true;
          resolveSave();
        } catch (cause) {
          error.textContent = cause.message || 'Could not prepare this picture.';
          save.disabled = false;
        }
      };
      const onCancel = () => finish(null);
      const onDialogCancel = (event) => { event.preventDefault(); finish(null); };
      const onBackdrop = (event) => { if (event.target === ui) finish(null); };
      const resolveSave = () => finish(encodeCrop(image, crop.clientWidth));

      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          error.textContent = 'This image could not be decoded. Choose another picture.';
          return;
        }
        if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) {
          error.textContent = 'Choose a smaller picture.';
          return;
        }
        const side = crop.clientWidth;
        imageWidth = image.naturalWidth;
        imageHeight = image.naturalHeight;
        previewSide = side;
        baseScale = Math.max(side / imageWidth, side / imageHeight);
        scale = baseScale;
        minZoom = 1;
        maxZoom = 3;
        zoom.min = String(minZoom);
        zoom.max = String(maxZoom);
        zoom.value = '1';
        offsetX = (side - imageWidth * scale) / 2;
        offsetY = (side - imageHeight * scale) / 2;
        render();
        if (typeof ResizeObserver === 'function') {
          resizeObserver = new ResizeObserver(onCropResize);
          resizeObserver.observe(crop);
        }
        save.disabled = false;
        crop.focus();
      };
      image.onerror = () => { error.textContent = 'This image could not be decoded. Choose another picture.'; };
      image.src = objectUrl;
      error.textContent = '';
      save.disabled = true;
      close.addEventListener('click', onCancel);
      cancel.addEventListener('click', onCancel);
      save.addEventListener('click', onSave);
      zoom.addEventListener('input', onZoom);
      crop.addEventListener('pointerdown', onPointerDown);
      crop.addEventListener('pointermove', onPointerMove);
      crop.addEventListener('pointerup', onPointerUp);
      crop.addEventListener('pointercancel', onPointerUp);
      crop.addEventListener('keydown', onKeyDown);
      ui.addEventListener('cancel', onDialogCancel);
      ui.addEventListener('click', onBackdrop);
      if (!ui.open) ui.showModal();
    });
  }

  window.VumiroAvatarEditor = {edit};
})();

/* Profile disclosure shares account state without exposing account credentials. */
(() => {
  'use strict';
  const trigger=document.getElementById('selfProfile'),panel=document.getElementById('profileDisclosure');
  if(!trigger||!panel)return;
  const $=id=>document.getElementById(id);
  function position() {
    const anchor=trigger.getBoundingClientRect(),box=panel.getBoundingClientRect();
    panel.style.left=Math.max(12,Math.min(anchor.left,innerWidth-box.width-12))+'px';
    panel.style.top=Math.max(12,Math.min(anchor.top-box.height-8,innerHeight-box.height-12))+'px';
  }
  function close(restoreFocus=false) {
    if(panel.hidden)return;
    panel.hidden=true;trigger.setAttribute('aria-expanded','false');
    if(restoreFocus)trigger.focus();
  }
  function open() {
    refresh();panel.hidden=false;trigger.setAttribute('aria-expanded','true');position();
  }
  function refresh() {
    const state=window.VumiroAccount?.getState?.()||{signedIn:false,email:''};
    $('selfAccountMode').textContent=state.signedIn?'Signed in':'Local profile';
    $('profileAccountStatus').textContent=state.signedIn?'Signed in · '+state.email:'Local profile · not signed in';
    $('profileSignOutSection').hidden=!state.signedIn;
    $('profileMenuName').textContent=window.VumiroLocalProfile?.profile?.()?.name||'Your profile';
    $('accountNav').disabled=!window.VumiroAccount?.open;
    $('accountNav').title=window.VumiroAccount?.open?'Account and backup settings':'Finish updating Vumiro to enable account settings';
  }
  trigger.onclick=()=>panel.hidden?open():close();
  trigger.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'){
      event.preventDefault();open();panel.querySelector('button:not([hidden]):not(:disabled)')?.focus();
    }
  });
  document.addEventListener('pointerdown',event=>{
    if(!panel.hidden&&!panel.contains(event.target)&&!trigger.contains(event.target))close();
  });
  document.addEventListener('focusin',event=>{
    if(!panel.hidden&&!panel.contains(event.target)&&!trigger.contains(event.target))close();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!panel.hidden){event.preventDefault();event.stopPropagation();close(true);}
  });
  panel.addEventListener('click',event=>{if(event.target.closest('button'))close();});
  addEventListener('resize',()=>{if(!panel.hidden)position();});
  addEventListener('vumiro-account-state-changed',refresh);
  addEventListener('vumiro-profile-changed',refresh);
  $('audioNav').onclick=()=>{
    close(true);
    const audio=window.VumiroAudioSettings;
    if(!audio?.open){$('status').textContent='Voice and audio settings are unavailable. Restart the app and try again.';return;}
    try{Promise.resolve(audio.open()).catch(error=>{$('status').textContent=error.message;});}
    catch(error){$('status').textContent=error.message;}
  };
  $('profileSignOut').onclick=async()=>{
    const button=$('profileSignOut');button.disabled=true;close(true);
    try{await window.VumiroAccount?.signOut?.();$('status').textContent='Signed out of your account. Your local profile, contacts and open room stay on this device.';}
    catch(error){$('status').textContent=error.message;}
    finally{button.disabled=false;refresh();}
  };
  refresh();
})();

/* Local contacts and signed requests. Photos never reach the directory. */
(() => {
'use strict';
const $ = id => document.getElementById(id), local = window.VumiroLocalProfile, query = new URLSearchParams(location.search);
const online = new Set(), seen = new Map(), lookups = new Map(), socialAcks = new Map(), responding = new Map(), blocking = new Set();
let profile=null,friends=[],selected='',filter='all',socket=null,ready=false,reconnectTimer=0,retry=0,stopped=false,pending=null,frame=null,leaveTimer=0;
let streamAudioSupported=false,streamAudioHostId='',roomFrameLoaded=false;
let generation=0,messages=Promise.resolve(),serviceUrl='',requests=[],requestTimer=0,rooms=[],currentRoom='',joined=false,sharing=false,lookupTimer=0,avatarDraft='',avatarSelection=0,avatarWork=Promise.resolve(),currentAccess=null,confirmation=null;
let updateAvailable=false,updateBusy=false,blocked=[],usernameCollision=false,socialV2Available=false;
const host=window.vumiroDesktop||window.chrome?.webview,linuxHost=host?.platform==='linux',webViewHost=!linuxHost?window.chrome?.webview:null;
const peerProfiles=window.VumiroPeerProfiles?.create({local,send,getFriend:id=>blocked.includes(id)||blocking.has(id)?null:friendById(id),onProfile:(id,value)=>local.updateContactProfile(id,value)});
const read = key => { try{return localStorage.getItem(key)||'';}catch{return '';} };
const save = (key,value) => { try{localStorage.setItem(key,value);}catch{} };
function normalizeSettings(value={}) { return {fps:Math.round(Math.min(120,Math.max(1,Number(value.fps)||60))),mbps:Math.min(100,Math.max(1,Number(value.mbps)||20)),resolution:['native','720p','1080p','1440p','2160p'].includes(value.resolution)?value.resolution:'native',contentHint:value.contentHint==='motion'?'motion':'detail',audio:!linuxHost&&value.audio!==false,excludeDiscord:value.excludeDiscord!==false}; }
let saved; try{saved=JSON.parse(read('vumiro-stream-settings'));}catch{}
let settings=normalizeSettings(saved||{fps:read('st-friends-fps')||query.get('fps'),mbps:read('st-friends-mbps')||query.get('mbps')});
save('vumiro-stream-settings',JSON.stringify(settings));
const friendById=id=>friends.find(friend=>friend.id===id);
const newRoom=()=>profile.id+'_'+Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join('');
const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]||'').join('').toUpperCase();
const status=text=>{$('status').textContent=text;};
function avatar(element,person) { element.replaceChildren();try{if(person.avatar&&local.validateAvatar(person.avatar)){const image=new Image();image.alt='';image.src=person.avatar;element.append(image);return;}}catch{}element.textContent=initials(person.nickname||person.name); }
const canonicalRoomHost='vumiro-rooms.vumiro-signaling.workers.dev';
const legacyRoomHosts=new Set(['screentask-rooms.screentask-room-signaling.workers.dev','screentask-rooms.vumiro-signaling.workers.dev','vumiro-rooms.screentask-room-signaling.workers.dev']);
function migrateRoomHost(url) { if(legacyRoomHosts.has(url.hostname.toLowerCase()))url.hostname=canonicalRoomHost;return url; }
function normalizeService(raw) { const url=migrateRoomHost(new URL(raw));if(url.protocol==='https:')url.protocol='wss:';if(url.protocol==='http:')url.protocol='ws:';if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password)throw Error('Use a valid wss:// service URL.');if(url.protocol==='ws:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use wss:// for a service outside this device.');url.pathname='/call-signaling';url.search='';url.hash='';return url.href; }
function serviceState(text,connected=false) { $('serviceStatus').textContent=text;$('serviceDot').classList.toggle('online',connected);$('reconnectService').hidden=connected; }
function send(message) { if(!socket||socket.readyState!==WebSocket.OPEN||!ready)throw Error('The service is offline. Reconnect to send this request.');const {from,...wire}=message;socket.send(JSON.stringify(wire)); }
function watch(){if(ready)send({type:'watch',ids:friends.map(friend=>friend.id)});}
function announce(){if(ready){const transition=local.identityTransition?.();send({type:'profile-announce',name:profile.name,username:profile.username||'',blockedIds:blocked,socialVersion:2,...(transition?{transition}:{})});}}
function serverNow(){const clock=window.VumiroServerClock;if(!clock?.isSynced())throw Error('The service clock is not synchronized. Reconnect before sending a friend request.');return clock.now();}
function runtimeNow(){const clock=window.VumiroServerClock;return clock?.isSynced()?clock.now():Date.now();}
function publishRoom(){if(ready)send({type:'room-state',room:currentRoom&&currentRoom.slice(0,43)===profile.id&&joined?currentRoom:null,live:!!(joined&&sharing&&currentRoom.slice(0,43)===profile.id),mode:currentAccess?.mode||'legacy'});}
function renderSettings(){for(const [id,key]of [['roomFps','fps'],['roomMbps','mbps'],['roomResolution','resolution'],['roomContentHint','contentHint']])$(id).value=settings[key];$('roomAudio').checked=settings.audio;$('roomAudio').disabled=linuxHost;$('linuxAudioHint').hidden=!linuxHost;$('excludeDiscordLabel').hidden=!streamAudioSupported;$('excludeDiscord').checked=settings.excludeDiscord;$('excludeDiscord').disabled=!streamAudioSupported;$('streamAudioCapability').hidden=streamAudioSupported;$('streamAudioCapability').textContent=linuxHost?'Microphone works on Linux, but system audio capture is not supported in this release.':'This device does not support Discord audio exclusion. Your browser may still offer screen audio, but it cannot filter Discord.';$('excludeDiscordHelp').hidden=!streamAudioSupported;}
function renderOwnProfile() {
  if (!profile) return;
  $('selfName').textContent=profile.name; $('selfUsername').textContent=profile.username?'@'+profile.username:'';$('selfUsername').hidden=!profile.username;
  avatar($('selfAvatar'),profile); avatar($('profileAvatar'),profile); $('ownCode').value=local.ownCode();renderOwnTag();
}
function renderProfile() {
  renderOwnProfile(); $('profileName').value=profile.name; $('profileUsername').value=profile.username||'';
  avatarDraft=profile.avatar||''; $('signaling').value=serviceUrl; renderSettings(); renderBlocked();renderProfileEditor();
}
async function shareOwnProfile() {
  const previous=profile; profile=local.profile(); if (!profile) return;
  renderOwnProfile();
  if(!previous){
    blocked=await local.listBlocked();renderProfile();await reloadFriends();if($('setupDialog').open)$('setupDialog').close();connect();showInvitation();return;
  }
  if(previous&&previous.id!==profile.id){
    clearPending('Your verified contact identity changed.');if(frame)finishRoom();connect();
    status('Identity recovery is enabled. Reconnecting with your new verified contact identity.');return;
  }
  if (!previous || previous.name!==profile.name || previous.username!==profile.username) announce();
  frame?.contentWindow.postMessage({type:'vumiro-profile',profile},location.origin); peerProfiles?.ownChanged();
}
addEventListener('vumiro-profile-changed',()=>shareOwnProfile().catch(error=>status(error.message)));
addEventListener('vumiro-account-restored',()=>{(async()=>{blocked=await local.listBlocked();await reloadFriends();renderProfile();announce();watch();})().catch(error=>status(error.message));});
function confirmAction(title,description,label) {
  if (confirmation) return Promise.resolve(false);
  $('confirmHeading').textContent=title; $('confirmDescription').textContent=description; $('confirmProceed').textContent=label;
  $('confirmDialog').returnValue='cancel';
  return new Promise(resolve=>{confirmation=resolve;$('confirmDialog').showModal();});
}
$('confirmDialog').addEventListener('close',()=>{const resolve=confirmation;confirmation=null;resolve?.($('confirmDialog').returnValue==='confirm');});
$('confirmDialog').addEventListener('cancel',()=>{$('confirmDialog').returnValue='cancel';});
function dialog(id){if(!profile&&id!=='setupDialog')return;if(!$(id).open)$(id).showModal();}
function showProfile(){renderProfile();$('profileError').textContent='';dialog('profileDialog');}
function showSettings(){showProfile();$('streamDetails').open=true;$('streamDetails').scrollIntoView({block:'nearest'});}
function canCall(friend){return ready&&online.has(friend.id)&&!pending&&!frame;}

/* Profile cards use validated peer data; tags only come from the directory. */
const profileProviders={steam:'Steam',spotify:'Spotify',twitch:'Twitch',youtube:'YouTube',github:'GitHub',xbox:'Xbox'};
const profileIcons={steam:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-9.8 8.1l5.1 2.1a3.5 3.5 0 0 1 2-.6l2.3-3.4a4.5 4.5 0 1 1 4.2 6.5 4.4 4.4 0 0 1-4.2-3l-3.3-.1a3.5 3.5 0 0 1-5.1 2.6A10 10 0 1 0 12 2Z"/><circle cx="15.8" cy="10.5" r="2.4"/><circle cx="8.4" cy="15.1" r="1.8"/></svg>',spotify:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M5.7 9.1c4.6-1.4 9.5-.9 13.2 1.3M6.6 12.5c3.7-1.1 7.7-.6 10.9 1.2m-9.9 2.2c2.8-.8 5.8-.4 8.2 1" fill="none" stroke="#111" stroke-width="1.7" stroke-linecap="round"/></svg>',twitch:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2 2 6v15h5v3l4-3h5l6-6V2H4Zm16 12-3 3h-5l-3 3v-3H5V4h15v10ZM11 7h2v5h-2zm5 0h2v5h-2z"/></svg>',youtube:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.2 3.6-6.2 3.6Z"/></svg>',github:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 .8a11.2 11.2 0 0 0-3.5 21.8c.6.1.8-.2.8-.5v-2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.5 1.2 3.1.9.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.3-5.1-5.5 0-1.2.4-2.2 1.2-3-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.1 1.2a10.8 10.8 0 0 1 5.7 0c2.1-1.5 3.1-1.2 3.1-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3 0 4.2-2.6 5.2-5.1 5.5.4.4.8 1 .8 2.1v3.1c0 .3.2.6.8.5A11.2 11.2 0 0 0 12 .8Z"/></svg>',xbox:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm5.8 4.3c1.2 1.2 1.7 2.8 1.7 4.5 0 3.1-3.6 7.2-5.6 9.1-.9.8-1.5 1.3-1.9 1.3s-1-.5-1.9-1.3c-2-1.9-5.6-6-5.6-9.1 0-1.7.5-3.3 1.7-4.5 2.5-.1 5.3 1.9 5.8 2.4.5-.5 3.3-2.5 5.8-2.4Zm-5.8 2.9c1.6-1.3 3.2-2 4.9-2.2-1.1-1-2.7-1.6-4.9-1.6s-3.8.6-4.9 1.6c1.7.2 3.3.9 4.9 2.2Z"/></svg>'};
let userCardId='',bannerSelection=0,bannerWork=Promise.resolve();
let directoryTags={};try{const saved=JSON.parse(localStorage.getItem('vumiro-directory-tags')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))for(const [id,tag]of Object.entries(saved).slice(-256))if(/^[A-Za-z0-9_-]{43}$/.test(id)&&/^#[0-9]{5}-[0-9]{5}$/.test(tag))directoryTags[id]=tag;}catch{}
function rememberDirectoryProfile(value){if(!value||!/^[A-Za-z0-9_-]{43}$/.test(value.id||'')||!/^#[0-9]{5}-[0-9]{5}$/.test(value.friendTag||'')||directoryTags[value.id]===value.friendTag)return;directoryTags[value.id]=value.friendTag;directoryTags=Object.fromEntries(Object.entries(directoryTags).slice(-256));try{localStorage.setItem('vumiro-directory-tags',JSON.stringify(directoryTags));}catch{}renderOwnTag();}
function renderOwnTag(){if(!$('ownFriendTag'))return;const tag=directoryTags[profile?.id]||'';$('ownFriendTag').textContent=tag||'Connect to assign your tag';$('copyFriendTag').disabled=!tag;}
function renderLinks(target,values){target.replaceChildren();let safe=[];try{safe=local.validateConnections(values||[]);}catch{}for(const item of safe){const link=document.createElement('a');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';const label=document.createElement('span'),icon=document.createElement('span');icon.className='serviceIcon serviceIcon-'+item.provider;icon.innerHTML=profileIcons[item.provider]||'';const name=document.createElement('span');name.textContent=profileProviders[item.provider];label.append(icon,name);const address=document.createElement('small');address.textContent=new URL(item.url).pathname.replace(/^\//,'')+' ↗';link.append(label,address);target.append(link);}}
function setBanner(target,value){if(value){try{target.src=local.validateBanner(value);target.hidden=false;return;}catch{}}target.removeAttribute('src');target.hidden=true;}
function renderProfileDetails(friend){setBanner($('contactBannerImage'),friend.banner);$('contactTag').textContent=directoryTags[friend.id]||'';$('contactBio').textContent=friend.bio||'';$('contactBio').hidden=!friend.bio;renderLinks($('contactLinks'),friend.connections);}
function renderProfileEditor(){if(!$('profileBio'))return;$('profileBio').value=profile.bio||'';setBanner($('profileBannerPreview'),profile.banner);for(const key of Object.keys(profileProviders))$('profileLink-'+key).value=profile.connections?.find(item=>item.provider===key)?.url||'';renderOwnTag();}
function renderUserCard(){const own=userCardId===profile?.id,value=own?profile:friendById(userCardId);if(!value){$('userCardDialog').close();return;}avatar($('userCardAvatar'),value);setBanner($('userCardBanner'),value.banner);$('userCardName').textContent=value.nickname||value.name;$('userCardUsername').textContent=value.username?'@'+value.username:'';$('userCardTag').textContent=directoryTags[value.id]||'';$('userCardBio').textContent=value.bio||'No bio yet.';renderLinks($('userCardLinks'),value.connections);$('userCardLinksHeading').hidden=!value.connections?.length;$('userCardCall').hidden=own;$('userCardCall').disabled=own||!canCall(value);$('userCardEdit').hidden=!own;$('userCardBlock').hidden=own;}
function openUserCard(id){userCardId=id;renderUserCard();if(!$('userCardDialog').open)$('userCardDialog').showModal();}
$('previewProfile').onclick=()=>openUserCard(profile.id);$('viewUserCard').onclick=()=>{if(selected)openUserCard(selected);};
$('userCardCall').onclick=()=>{const friend=friendById(userCardId);if(friend){$('userCardDialog').close();invite(friend).catch(error=>status(error.message));}};
$('userCardEdit').onclick=()=>{$('userCardDialog').close();showProfile();};
$('userCardBlock').onclick=()=>{selected=userCardId;$('userCardDialog').close();$('blockFriend').click();};
async function copyFriendTag(id){const tag=directoryTags[id];if(!tag){status('This friend’s tag is not available yet. Reconnect and try again.');return;}try{await navigator.clipboard.writeText(tag);status('Copied '+tag+'.');}catch{status('Could not access the clipboard. Select the tag in the profile card and copy it manually.');}}
function editFriendNickname(id){const friend=friendById(id);if(!friend)return;selected=id;renderFriends();$('nickname').value=friend.nicknameOverride?friend.nickname:'';if(!$('nicknameDialog').open)$('nicknameDialog').showModal();$('nickname').focus();}
$('contactName').onclick=()=>{if(selected)copyFriendTag(selected);};
$('editNickname').onclick=()=>editFriendNickname(selected);
$('copyFriendTag').onclick=()=>copyFriendTag(profile?.id);
$('userCardDialog').addEventListener('click',event=>{if(event.target===$('userCardDialog'))$('userCardDialog').close();});
async function resizeBanner(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose a PNG, JPEG or WebP background under 10 MiB.');const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>25000000)throw Error('Choose a background smaller than 25 megapixels.');for(const width of [480,360,240]){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(width/3);const context=canvas.getContext('2d');const scale=Math.max(width/bitmap.width,canvas.height/bitmap.height),sw=width/scale,sh=canvas.height/scale;context.drawImage(bitmap,(bitmap.width-sw)/2,(bitmap.height-sh)/2,sw,sh,0,0,width,canvas.height);for(const quality of [.8,.65,.5,.35,.2]){const value=canvas.toDataURL('image/jpeg',quality);if(value.length<=16384)return local.validateBanner(value);}}throw Error('This background is too detailed. Choose a simpler image.');}finally{bitmap.close();}}
$('bannerFile').onchange=()=>{const file=$('bannerFile').files[0],version=++bannerSelection;$('bannerFile').value='';if(!file)return;bannerWork=(async()=>{try{const value=await resizeBanner(file);if(version!==bannerSelection)return;profile=await local.updateProfile({banner:value});setBanner($('profileBannerPreview'),profile.banner);status('Profile background saved.');}catch(error){$('profileError').textContent=error.message;}})();};
$('removeBanner').onclick=async()=>{++bannerSelection;try{await bannerWork;profile=await local.updateProfile({banner:''});setBanner($('profileBannerPreview'),'');}catch(error){$('profileError').textContent=error.message;}};

function renderDetails(){const friend=friendById(selected);$('contactEmpty').hidden=!!friend;$('contactDetails').hidden=!friend;if(!friend)return;avatar($('contactAvatar'),friend);$('contactName').textContent=friend.nickname;$('contactName').title=directoryTags[friend.id]?'Copy friend tag '+directoryTags[friend.id]:'Friend tag unavailable';$('editNickname').setAttribute('aria-label','Edit nickname for '+friend.nickname);$('contactStatus').textContent=(friend.username?'@'+friend.username+'\n':'')+(online.has(friend.id)?'Online · ready to connect':'Offline')+(friend.nicknameOverride?'\n'+friend.name:'');if(document.activeElement!==$('nickname'))$('nickname').value=friend.nicknameOverride?friend.nickname:'';$('contactCall').disabled=!canCall(friend);renderProfileDetails(friend);if($('userCardDialog').open)renderUserCard();}
function renderFriends(){
$('createRoom').disabled=$('createRoomFromDialog').disabled=$('roomCreateNav').disabled=!profile||!!pending||!!frame;$('installUpdate').disabled=!updateAvailable||updateBusy||(!linuxHost&&!!frame)||(!linuxHost&&!!pending);$('sidebarCount').textContent=friends.length;$('onlineCount').textContent=online.size;
const search=$('search').value.trim().toLocaleLowerCase();const visible=friends.filter(friend=>(filter!=='online'||online.has(friend.id))&&(friend.nickname+' '+friend.name+' '+(friend.username||'')).toLocaleLowerCase().includes(search));visible.sort((a,b)=>Number(online.has(b.id))-Number(online.has(a.id))||a.nickname.localeCompare(b.nickname));const list=$('friendsList');list.replaceChildren();
 for(const friend of visible){const row=document.createElement('div');row.className='friend'+(friend.id===selected?' selected':'');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label','View '+friend.nickname);const photo=document.createElement('span');photo.className='avatar';avatar(photo,friend);const info=document.createElement('span');info.className='friendInfo truncate';const name=document.createElement('span');name.className='friendName';const nickname=document.createElement('button');nickname.type='button';nickname.className='friendNameButton';nickname.textContent=friend.nickname;nickname.title='Copy friend tag';nickname.onclick=event=>{event.stopPropagation();copyFriendTag(friend.id);};const edit=document.createElement('button');edit.type='button';edit.className='iconButton friendEdit';edit.setAttribute('aria-label','Edit nickname for '+friend.nickname);edit.title='Edit nickname';edit.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.1 2.1 0 0 0-3-3L4 16.5Z"/><path d="m14.9 6.6 3 3"/></svg>';edit.onclick=event=>{event.stopPropagation();editFriendNickname(friend.id);};name.append(nickname,edit);const state=document.createElement('span');state.className='friendState';const dot=document.createElement('i');dot.className='dot'+(online.has(friend.id)?' online':'');state.append(dot,document.createTextNode(online.has(friend.id)?'Online':'Offline'));info.append(name,state);const call=document.createElement('button');call.className='callAction';call.textContent='Call';call.disabled=!canCall(friend);call.setAttribute('aria-label','Call '+friend.nickname);call.onclick=event=>{event.stopPropagation();invite(friend).catch(error=>status(error.message));};const select=()=>{selected=friend.id;renderFriends();openUserCard(friend.id);};row.onclick=select;row.onkeydown=event=>{if(event.target===row&&['Enter',' '].includes(event.key)){event.preventDefault();select();}};row.append(photo,info,call);list.append(row);}
$('listHeading').textContent=(filter==='online'?'Online':'Your people')+' · '+visible.length;$('emptyState').hidden=friends.length>0;$('noResults').hidden=!friends.length||visible.length>0;$('filterAll').setAttribute('aria-pressed',String(filter==='all'));$('filterOnline').setAttribute('aria-pressed',String(filter==='online'));renderDetails();renderRooms();}
async function reloadFriends(){const old=friends.map(friend=>friend.id).join(',');friends=await local.listFriends();for(const id of online)if(!friendById(id))online.delete(id);if(!friendById(selected))selected=friends[0]?.id||'';if(pending&&!friendById(pending.friend))clearPending('The contact was removed.');peerProfiles?.syncContacts();if(old!==friends.map(friend=>friend.id).join(','))watch();renderFriends();}
addEventListener('vumiro-friends-changed',()=>{if(profile)reloadFriends().catch(error=>status(error.message));});
function showInvitation(){if(!query.get('room'))return;$('roomInvitation').value=location.href;$('roomError').textContent='Request approval from the room owner to join.';showRooms();query.delete('room');}
function clearPending(text){if(pending)clearTimeout(pending.timer);pending=null;$('invitation').hidden=true;if(text)status(text);renderFriends();}
function renderPending(){if(!pending)return;const name=friendById(pending.friend)?.nickname||'Your friend',incoming=pending.direction==='incoming';$('invitation').hidden=false;$('invitationTitle').textContent=incoming?name+' is calling':'Calling '+name+'…';$('invitationText').textContent=(incoming?'Join a room together. ':'Waiting for them to accept. ')+Math.max(0,Math.ceil((pending.expires-runtimeNow())/1000))+'s remaining';$('acceptInvite').hidden=!incoming;$('declineInvite').hidden=!incoming;$('cancelInvite').hidden=incoming;}
function setPending(value){pending=value;renderPending();renderFriends();const tick=()=>{if(pending!==value)return;if(runtimeNow()>=value.expires){clearPending('The call invitation expired.');return;}renderPending();value.timer=setTimeout(tick,1000);};value.timer=setTimeout(tick,1000);}
const inviteText=m=>`screentask-invite-v1\n${m.from}\n${m.to}\n${m.room}\n${m.nonce}\n${m.expires}`;
const answerText=m=>`screentask-answer-v1\n${m.from}\n${m.to}\n${m.room}\n${m.nonce}\n${m.accepted}\n${m.expires}`;
const socialText=m=>`vumiro-social-v1\n${m.from}\n${m.to}\n${m.kind}\n${m.nonce}\n${m.expires}\n${JSON.stringify(m.payload)}`;
const socialV2Text=m=>`vumiro-social-v2\n${m.from}\n${m.to}\n${m.kind}\n${m.nonce}\n${m.expires}\n${JSON.stringify(m.payload)}`;
const grantText=(owner,to,room,grant)=>`vumiro-room-grant-v1\n${owner}\n${to}\n${room}\n${grant.nonce}\n${grant.expires}`;
async function createGrant(to,room){const grant={nonce:crypto.randomUUID(),expires:runtimeNow()+86400000-5000};grant.signature=await local.sign(grantText(profile.id,to,room,grant));return grant;}
async function validGrant(owner,to,room,grant){return !!owner&&!!grant&&/^[A-Za-z0-9_-]{16,64}$/.test(grant.nonce||'')&&Number.isSafeInteger(grant.expires)&&grant.expires>runtimeNow()&&grant.expires<=runtimeNow()+86400000&&await local.verify(owner,grantText(owner.id,to,room,grant),grant.signature);}
async function answer(value,accepted){const message={type:'answer',from:profile.id,to:value.friend,room:value.room,nonce:value.nonce,accepted,expires:value.expires};message.signature=await local.sign(answerText(message));if(accepted){const saved=await local.listFriends();if(pending!==value||value.expires<=runtimeNow()||!saved.some(friend=>friend.id===value.friend)||blocked.includes(value.friend))throw Error('This invitation is no longer available from a saved friend.');}send(message);}
async function invite(friend){if(!canCall(friend))throw Error('Wait until you and your friend are online and free to call.');const value={direction:'outgoing',friend:friend.id,room:newRoom(),nonce:crypto.randomUUID(),expires:runtimeNow()+60000};setPending(value);try{const message={type:'invite',from:profile.id,to:friend.id,room:value.room,nonce:value.nonce,expires:value.expires};message.grant=await createGrant(friend.id,value.room);message.signature=await local.sign(inviteText(message));if(pending!==value)return;send(message);status('Calling '+friend.nickname+'. Your screen and microphone stay off until you enable them.');}catch(error){if(pending===value)clearPending(error.message);}}
function validEnvelope(m){return m.to===profile.id&&/^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(m.room||'')&&(m.type!=='invite'||m.room.slice(0,43)===m.from)&&/^[A-Za-z0-9_-]{16,100}$/.test(m.nonce||'')&&Number.isSafeInteger(m.expires)&&m.expires>runtimeNow()&&m.expires<=runtimeNow()+65000;}
function replayed(m){for(const[key,expires]of seen)if(expires<=runtimeNow())seen.delete(key);const key=m.from+':'+m.nonce;if(seen.has(key))return true;seen.set(key,m.expires);while(seen.size>256)seen.delete(seen.keys().next().value);return false;}
function settleSocialAck(nonce, error, to) {
  const ack = socialAcks.get(nonce);
  if (!ack || (to && ack.to !== to) || ack.socket !== socket || ack.generation !== generation) return;
  clearTimeout(ack.timer); socialAcks.delete(nonce);
  if (error) ack.reject(error); else ack.resolve();
}
function rejectSocialAcks(message = 'The service disconnected. Reconnect and try again.') {
  for (const ack of socialAcks.values()) { clearTimeout(ack.timer); ack.reject(Error(message)); }
  socialAcks.clear();
}
async function contactCapacity(id) {
  const saved = await local.listFriends();
  if (!saved.some(friend => friend.id === id) && saved.length >= 128) throw Error('Your local contact book is full (128 friends). Remove a friend before accepting or sending another request.');
}
async function social(to,kind,payload,guard,requireAck=false,protocol=1,expires) {
  const current = socket, version = generation;
  const valid = () => ready && socket === current && generation === version && !stopped && (!guard || guard());
  if (!valid()) throw Error('This request is no longer available.');
  if(protocol===2&&!socialV2Available)throw Error('Friend requests need the updated Vumiro service. Update the service and reconnect.');
  const message = {type:'social',...(protocol===2?{version:2}:{}),from:profile.id,to,kind,nonce:crypto.randomUUID(),expires:expires??runtimeNow()+115000,payload};
  message.signature = await local.sign(protocol===2?socialV2Text(message):socialText(message));
  if (!valid()) throw Error('This request is no longer available.');
  if (requireAck) {
    if (socialAcks.size >= 16) throw Error('Too many responses are waiting for the service. Try again shortly.');
    // Register synchronously before sending so an immediate receipt cannot be lost.
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => {
        const ack = socialAcks.get(message.nonce);
        if (!ack) return;
        socialAcks.delete(message.nonce); ack.reject(Error('The service did not confirm this response. Reconnect and ask your friend to retry.'));
      },8000);
      socialAcks.set(message.nonce,{resolve,reject,timer,to,socket:current,generation:version});
      try { send(message); } catch (error) { settleSocialAck(message.nonce,error,to); }
    });
    if (!valid()) throw Error('This request is no longer available.');
  } else send(message);
  return message;
}
async function storeRequest(value){const index=requests.findIndex(item=>item.id===value.id);if(index>=0)Object.assign(requests[index],value);else requests.push(value);await local.saveRequest(value);renderRequests();}
async function removeRequest(id){requests=requests.filter(item=>item.id!==id);await local.removeRequest(id);renderRequests();renderRooms();}
function requestNow(item){return item.version===2?(window.VumiroServerClock?.isSynced()?window.VumiroServerClock.now():null):runtimeNow();}
function renderRequests(){clearTimeout(requestTimer);const nowByItem=new Map(requests.map(item=>[item,requestNow(item)]));const expired=requests.filter(item=>nowByItem.get(item)!==null&&item.expires<=nowByItem.get(item));requests=requests.filter(item=>!expired.includes(item));expired.forEach(item=>local.removeRequest(item.id).catch(()=>{}));for(const target of [$('requests'),$('roomRequests')]){target.replaceChildren();for(const item of requests){const row=document.createElement('div');row.className='request';const photo=document.createElement('span');photo.className='avatar';avatar(photo,friendById(item.contact.id)||item.contact);const text=document.createElement('span');text.className='friendInfo';const label=document.createElement('strong');label.textContent=friendById(item.contact.id)?.nickname||item.contact.name;const hint=document.createElement('small');hint.textContent=item.error||item.canceling?'':item.direction==='outgoing'?(item.kind==='join-request'?'Waiting for room approval…':item.version===2?(item.delivered?'Delivered · waiting for acceptance':'Sent · waiting for delivery'):'Friend request sent · waiting for acceptance'):item.kind==='join-request'?'Would like to join your room':'Would like to be your friend';text.append(label,hint);if(item.error){const inline=document.createElement('small');inline.className='error';inline.textContent=item.error;text.append(inline);}else if(item.canceling){const inline=document.createElement('small');inline.textContent='Cancelling…';text.append(inline);}row.append(photo,text);if(item.direction==='incoming'){const no=document.createElement('button');no.textContent='Decline';const yes=document.createElement('button');yes.textContent='Accept';yes.className='primary';const respond=async accepted=>{no.disabled=yes.disabled=true;try{await respondRequest(item,accepted);}catch(error){item.error=error.message;await local.saveRequest(item);renderRequests();}};no.onclick=()=>respond(false);yes.onclick=()=>respond(true);no.disabled=yes.disabled=responding.has(item.id)||item.responsePending;const block=document.createElement('button');block.textContent='Block';block.className='danger';block.disabled=responding.has(item.id);block.onclick=()=>blockIdentity(item.contact.id).catch(error=>status(error.message));row.append(no,yes,block);}else{const dismiss=document.createElement('button');dismiss.textContent=item.version===2?'Cancel request':'Dismiss';dismiss.disabled=!!item.canceling;dismiss.onclick=()=>item.version===2?cancelFriendRequest(item).catch(error=>{item.error=error.message;renderRequests();}):removeRequest(item.id).catch(error=>status(error.message));row.append(dismiss);}target.append(row);}}const remaining=requests.map(item=>{const now=requestNow(item);return now===null?Infinity:item.expires-now;}).filter(value=>value>0);if(remaining.length&&Number.isFinite(Math.min(...remaining)))requestTimer=setTimeout(renderRequests,Math.max(50,Math.min(...remaining)+10));}
async function respondRequest(item,accepted) {
  if (responding.has(item.id)) throw Error('This request is already being answered.');
  const token = {}, current = socket, version = generation;
  const valid = () => ready && socket === current && generation === version && !stopped && requests.includes(item) && item.expires > (item.version===2?serverNow():runtimeNow()) && responding.get(item.id) === token && !blocked.includes(item.contact.id) && !blocking.has(item.contact.id);
  responding.set(item.id,token); renderRequests();
  try {
    if (!valid()) throw Error('This request expired. Ask your friend to try again.');
    if (item.kind === 'friend-request') {
      if(item.version===2){
        if(!socialV2Available)throw Error('Friend requests need the updated Vumiro service. Update the service and reconnect.');
        if(accepted)await contactCapacity(item.contact.id);
        if(!valid())throw Error('This request is no longer available.');
        const answerExpires=serverNow()+115000;
        await social(item.contact.id,'friend-answer',{requestNonce:item.nonce,accepted},valid,true,2,answerExpires);
        if(!valid())throw Error('This request is no longer available.');
        item.responsePending=true;item.error='';await local.saveRequest(item);status('Your response was saved. Waiting for the friend list to sync.');return;
      }
      if (accepted) await contactCapacity(item.contact.id);
      if (!valid()) throw Error('This request is no longer available.');
      await social(item.contact.id,'friend-answer',{requestNonce:item.nonce,accepted},valid,true);
      if (!valid()) throw Error('This request is no longer available.');
      if (accepted) {
        selected = await local.addContact(item.contact,undefined,valid);
        if (!valid()) throw Error('This request is no longer available.');
        await reloadFriends();
      }
    } else {
      const roomValid = () => !accepted || (!!frame && joined && currentRoom === item.room && currentRoom.slice(0,43) === profile.id && !!friendById(item.contact.id));
      if (!roomValid()) throw Error('Your owned room is no longer available.');
      const payload = {requestNonce:item.nonce,room:item.room,accepted};
      if (accepted) payload.grant = await createGrant(item.contact.id,item.room);
      if (!valid() || !roomValid()) throw Error('This room request is no longer available.');
      await social(item.contact.id,'join-answer',payload,() => valid() && roomValid(),true);
      if (!valid() || !roomValid()) throw Error('This room request is no longer available.');
    }
    if (!valid()) throw Error('This request is no longer available.');
    await removeRequest(item.id);
    if (socket === current && generation === version && ready && item.expires > runtimeNow() && !blocked.includes(item.contact.id) && !blocking.has(item.contact.id)) status(accepted ? (item.kind === 'friend-request' ? 'You are now friends. Both contact books update automatically.' : 'Room request accepted.') : 'Request declined.');
  } finally {
    if (responding.get(item.id) === token) responding.delete(item.id);
    renderRequests();
  }
}
function friendRequestItem(request,contact,otherContact,state='pending',delivered=false){return {id:request.nonce,direction:request.from===profile.id?'outgoing':'incoming',kind:'friend-request',version:2,nonce:request.nonce,contact,expires:request.expires,delivered,state,otherContact};}
function sendFriendReceipt(requestNonce,phase){try{send({type:'friend-received',requestNonce,phase});}catch(error){status(error.message);}}
async function receiveFriendState(value,active){
  if(!value||!['pending','accepted','declined','cancelled'].includes(value.state)||!value.request||!Number.isSafeInteger(value.expires))return;
  const request=value.request,now=serverNow(),terminal=value.state!=='pending';
  if(request.type!=='social'||request.version!==2||request.kind!=='friend-request'||request.to!==profile.id&&request.from!==profile.id||request.from===request.to||!/^[A-Za-z0-9_-]{16,64}$/.test(request.nonce||'')||!Number.isSafeInteger(request.expires)||!request.payload||Object.keys(request.payload).length!==0)return;
  if((!terminal&&(request.expires!==value.expires||request.expires<=now))||(terminal&&(value.expires<=now||value.expires>now+7*86400000+60000)))return;
  const sender=request.from===profile.id?local.profile():await local.validateContact(request.profile);
  if(sender.id!==request.from||!await local.verify(sender,socialV2Text(request),request.signature)||!active())return;
  const otherId=request.from===profile.id?request.to:request.from;
  const contact=await local.validateContact(value.contact);
  if(contact.id!==otherId||!active())return;
  const current=friendById(otherId),saved=requests.find(item=>item.id===request.nonce),blockedPeer=blocked.includes(otherId);
  if(value.state==='pending'){
    if(request.expires<=now||value.response)return;
    if(blockedPeer)return;
    const item=friendRequestItem(request,contact,contact,'pending',value.delivered===true);
    if(saved?.nickname)item.nickname=saved.nickname;
    await storeRequest(item);
    if(request.to===profile.id){sendFriendReceipt(request.nonce,'pending');if(!saved){status(contact.name+' sent you a friend request.');host?.postMessage({type:'window',action:'notify'});}}
    return;
  }
  let accepted=false;
  if(value.state==='accepted'||value.state==='declined'){
    const response=value.response;
    if(!response||response.type!=='social'||response.version!==2||response.kind!=='friend-answer'||response.from!==request.to||response.to!==request.from||!response.payload||response.payload.requestNonce!==request.nonce||typeof response.payload.accepted!=='boolean'||!/^[A-Za-z0-9_-]{16,64}$/.test(response.nonce||'')||!Number.isSafeInteger(response.expires))return;
    const responder=response.from===profile.id?local.profile():await local.validateContact(response.profile);
    if(responder.id!==response.from||!await local.verify(responder,socialV2Text(response),response.signature)||!active())return;
    accepted=value.state==='accepted';if(response.payload.accepted!==accepted)return;
  }else if(value.response)return;
  let result;
  const acceptedForSave=accepted&&!blockedPeer;
  try{result=await local.applyFriendResolution({nonce:request.nonce,contact,accepted:acceptedForSave,nickname:saved?.nickname||'',expires:value.expires},()=>active()&&(!acceptedForSave||!blocked.includes(otherId)));}
  catch(error){if(saved){saved.error=error.message;await local.saveRequest(saved);renderRequests();}status(error.message);return;}
  if(!active())return;
  if(result?.added){selected=otherId;await reloadFriends();}
  await removeRequest(request.nonce);
  sendFriendReceipt(request.nonce,'resolved');
  if(value.state==='accepted')status(blockedPeer?'Friend request resolved; the blocked identity was not added.':result?.alreadyProcessed?'Friend request was already resolved.':current?'You are now friends.':'Friend request accepted. You are now friends.');
  else if(value.state==='declined')status('Friend request declined.');
  else status('Friend request cancelled.');
}
async function cancelFriendRequest(item){
  if(!item||item.version!==2||item.direction!=='outgoing')throw Error('This friend request cannot be cancelled.');
  item.error='';item.canceling=true;renderRequests();
  try{send({type:'friend-cancel',requestNonce:item.nonce});status('Cancellation sent. Waiting for the service to confirm.');}
  catch(error){item.canceling=false;item.error=error.message;await local.saveRequest(item);renderRequests();throw error;}
}
async function receiveSocial(m,active){
if(m.version===2)return;
if(m.to!==profile.id||!['friend-request','friend-answer','join-request','join-answer'].includes(m.kind)||!/^[A-Za-z0-9_-]{16,64}$/.test(m.nonce||'')||!Number.isSafeInteger(m.expires)||m.expires<=runtimeNow()||m.expires>runtimeNow()+120000||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))return;
const contact=await local.validateContact(m.profile);if(blocked.includes(contact.id)||contact.id!==m.from||!await local.verify(contact,socialText(m),m.signature)||!active()||m.expires<=runtimeNow()||replayed(m))return;const p=m.payload;
if(m.kind==='friend-request'||m.kind==='join-request'){if(m.kind==='join-request'&&(!friendById(contact.id)||!frame||!joined||currentRoom!==p.room||currentRoom.slice(0,43)!==profile.id))return;if(requests.some(item=>item.direction==='incoming'&&item.contact.id===contact.id&&item.kind===m.kind))return;await storeRequest({id:m.nonce,direction:'incoming',kind:m.kind,contact,nonce:m.nonce,expires:m.expires,room:p.room||''});status(contact.name+(m.kind==='friend-request'?' sent you a friend request.':' wants to join your room.'));host?.postMessage({type:'window',action:'notify'});return;}
if(typeof p.accepted!=='boolean')return;const request=requests.find(item=>item.direction==='outgoing'&&item.nonce===p.requestNonce&&item.contact.id===contact.id&&item.expires>runtimeNow()&&item.kind===(m.kind==='friend-answer'?'friend-request':'join-request'));if(!request)return;
if(m.kind==='friend-answer'){if(p.accepted){if(!active()||!requests.includes(request)||request.expires<=runtimeNow()||blocked.includes(contact.id))return;selected=await local.addContact(contact,request.nickname,()=>active()&&requests.includes(request)&&request.expires>runtimeNow()&&!blocked.includes(contact.id));await reloadFriends();}await removeRequest(request.id);status(p.accepted?contact.name+' accepted. You are now friends.':contact.name+' declined the friend request.');}else{if(p.room!==request.room||p.room.slice(0,43)!==contact.id||!friendById(contact.id))return;if(p.accepted&&!await validGrant(contact,profile.id,p.room,p.grant))return;const currentFriends=await local.listFriends();if(!active()||!requests.includes(request)||request.expires<=runtimeNow()||blocked.includes(contact.id)||!currentFriends.some(friend=>friend.id===contact.id))return;await removeRequest(request.id);const stillFriends=await local.listFriends();if(!active()||request.expires<=runtimeNow()||blocked.includes(contact.id)||!stillFriends.some(friend=>friend.id===contact.id))return;if(p.accepted){if(frame||pending){status('Approval received. Finish your current room first.');return;}openRoom(p.room,serviceUrl,friendById(contact.id)?.nickname||contact.name,p.grant);if($('roomDialog').open)$('roomDialog').close();}else status(contact.name+' declined the room request.');}}
async function lookup(value){if(value.trim().startsWith('vm1.'))value=(await local.parseContactCode(value)).id;const nonce=crypto.randomUUID();return new Promise((resolve,reject)=>{try{send({type:'lookup',query:value,nonce});}catch(error){reject(error);return;}const timer=setTimeout(()=>{lookups.delete(nonce);reject(Error('Lookup timed out. Reconnect or use your friend’s contact code.'));},8000);lookups.set(nonce,{resolve,reject,timer});});}
async function refreshContact(value){try{const contact=await local.validateContact(value);rememberDirectoryProfile(value);if(friendById(contact.id))await local.updateContactProfile(contact.id,{name:contact.name,username:contact.username});}catch{}}
async function receive(m,current,version){const active=()=>socket===current&&generation===version&&!stopped;if(!active())return;
if(m.type==='challenge'){if(typeof m.nonce!=='string'||!/^[A-Za-z0-9_-]{16,160}$/.test(m.nonce))throw Error('The service sent an invalid challenge.');const signature=await local.sign(`screentask-directory-v1\n${profile.id}\n${m.nonce}`);if(active()&&current.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'authenticate',key:profile.key,signature}));return;}
if(m.type==='ready'){rememberDirectoryProfile(m);if(m.id!==profile.id){current.close(1008,'Identity mismatch');return;}try{window.VumiroServerClock?.sync(m.serverTime);}catch{}socialV2Available=m.socialVersion===2&&!!window.VumiroServerClock?.isSynced();ready=true;retry=0;serviceState('Online',true);announce();watch();publishRoom();renderRequests();renderFriends();status(frame?'Service reconnected. Your room is open.':socialV2Available?'Online. Find a friend by #tag, username or contact code.':'Online. Friend requests need the updated Vumiro service.');return;}
if(!ready)return;
if(m.type==='profile-ready'){rememberDirectoryProfile(m.profile);status(usernameCollision?'That username is in use. You are online with your contact code.':profile.username?'Online as @'+profile.username+'.':'Online. Friends can find you with your #tag or contact code.');usernameCollision=false;return;}
if(m.type==='lookup-result'){const task=lookups.get(m.nonce);if(task){clearTimeout(task.timer);lookups.delete(m.nonce);rememberDirectoryProfile(m.profile);task.resolve(m.profile||null);}return;}
if(m.type==='profile-signal'){await peerProfiles?.receive(m).catch(()=>{});return;}
if(m.type==='friend-state'){await receiveFriendState(m,active);return;}
if(m.type==='social'){await receiveSocial(m,active);return;}
if(m.type==='identity-transition'){
  const from=m.transition?.fromId,to=m.transition?.toId,old=friendById(from);
  if(!old||!m.profile||m.profile.id!==to||m.profile.key!==m.transition.toKey)return;
  const migrated=await local.applyIdentityTransition(m.transition,m.profile);
  if(!migrated||!active())return;
  if(selected===from)selected=to;online.delete(from);rooms=rooms.filter(item=>item.owner!==from);
  await reloadFriends();watch();status(`${migrated.nickname||migrated.name} updated their verified contact identity.`);return;
}
if(m.type==='rooms'&&Array.isArray(m.rooms)){const previous=new Map(rooms.map(item=>[item.room,item.live]));rooms=m.rooms.filter(item=>friendById(item.owner)&&typeof item.room==='string'&&item.room.slice(0,43)===item.owner&&/^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(item.room)).slice(0,128);const fresh=rooms.filter(item=>!previous.has(item.room)||(item.live&&!previous.get(item.room)));renderRooms();if(fresh.length){const first=fresh[0],name=friendById(first.owner)?.nickname||'A friend';status(fresh.length===1?name+(first.live?' is live in their room. Open Rooms to request to join.':' opened a room. Open Rooms to request to join.'):fresh.length+' friends have new room activity. Open Rooms to join.');host?.postMessage({type:'window',action:'notify'});}return;}
if(m.type==='presence'&&friendById(m.id)&&typeof m.online==='boolean'){if(m.online)online.add(m.id);else{online.delete(m.id);rooms=rooms.filter(item=>item.owner!==m.id);}if(m.profile?.id===m.id)await refreshContact(m.profile);if(active())peerProfiles?.presence(m.id,m.online);renderFriends();return;}
if(m.type==='social-sent'){settleSocialAck(m.nonce,null,m.to);return;}
if(m.type==='unavailable'){settleSocialAck(m.nonce,Error('Your friend is unavailable. Ask them to reconnect and retry.'),m.to);if(pending?.direction==='outgoing'&&pending.friend===m.to&&pending.nonce===m.nonce)clearPending('Your friend is unavailable. Try again when you are both online.');const request=requests.find(item=>item.direction==='outgoing'&&item.contact.id===m.to&&item.nonce===m.nonce);if(request){await removeRequest(request.id);status('Your friend is unavailable. Ask them to open Vumiro, then try again.');}return;}
if(m.type==='error'||m.type==='social-error'){if(m.nonce)settleSocialAck(m.nonce,Error(typeof m.message==='string'?m.message:'The service rejected this response.'));else if(m.type==='social-error')rejectSocialAcks(typeof m.message==='string'?m.message:'The service rejected this response.');if(m.code==='username-taken'){profile=await local.updateProfile({username:''});if(!active())return;usernameCollision=true;renderProfile();announce();}const text=typeof m.message==='string'?m.message:'The service could not complete that request.';status(text);if($('profileDialog').open)$('profileError').textContent=text;if($('addDialog').open)$('addError').textContent=text;const request=requests.find(item=>item.direction==='outgoing'&&item.nonce===m.nonce);if(request)await removeRequest(request.id);return;}
if(!['invite','answer'].includes(m.type)||!validEnvelope(m))return;const friend=friendById(m.from);if(!friend||(m.type==='answer'&&typeof m.accepted!=='boolean'))return;if(!await local.verify(friend,m.type==='invite'?inviteText(m):answerText(m),m.signature)||!active())return;if(!(await local.listFriends()).some(saved=>saved.id===m.from)||!active()||m.expires<=runtimeNow())return;
if(m.type==='invite'){if(replayed(m))return;const value={direction:'incoming',friend:friend.id,room:m.room,nonce:m.nonce,expires:m.expires,grant:m.grant};if(pending||frame||!await validGrant(friend,profile.id,m.room,m.grant)){await answer(value,false);if(!m.grant)status('Your friend needs the latest Vumiro version to approve room access.');return;}const latestFriends=await local.listFriends();if(!active()||m.expires<=runtimeNow()||blocked.includes(friend.id)||!latestFriends.some(saved=>saved.id===friend.id))return;setPending(value);status(friend.nickname+' is calling. Accept to open your shared room.');host?.postMessage({type:'window',action:'notify'});}else if(pending&&pending.friend===friend.id&&pending.nonce===m.nonce&&pending.room===m.room&&pending.expires===m.expires){if(!m.accepted){clearPending(pending.direction==='incoming'?friend.nickname+' cancelled the call.':friend.nickname+' declined the call.');return;}if(pending.direction!=='outgoing')return;const value=pending;clearPending();openRoom(value.room,serviceUrl,friend.nickname);}}
async function hydrateRequests(){const values=await local.listRequests();requests=values.filter(item=>{const now=requestNow(item);return now===null||item.expires>now;});for(const item of values)if(!requests.includes(item))await local.removeRequest(item.id);renderRequests();}
function clearLegacyRequests(){const old=requests.filter(item=>item.version!==2);requests=requests.filter(item=>item.version===2);for(const item of old)local.removeRequest(item.id).catch(()=>{});renderRequests();}
function rejectLookups(){for(const task of lookups.values()){clearTimeout(task.timer);task.reject(Error('The service disconnected. Reconnect and try again.'));}lookups.clear();}
function connect(){clearTimeout(reconnectTimer);if(stopped||!profile)return;const version=++generation;ready=false;socialV2Available=false;online.clear();rooms=[];peerProfiles?.reset();serviceState('Connecting…');rejectLookups();rejectSocialAcks();clearLegacyRequests();const previous=socket;socket=null;previous?.close();renderFriends();try{const url=new URL(serviceUrl);url.pathname='/friends-signaling';url.searchParams.set('id',profile.id);const current=socket=new WebSocket(url);messages=Promise.resolve();let timeout=setTimeout(()=>{if(socket===current&&!ready)current.close(4000,'Authentication timed out');},12000);current.onmessage=event=>{if(socket!==current||generation!==version||typeof event.data!=='string'||event.data.length>65536)return;messages=messages.then(async()=>{await receive(JSON.parse(event.data),current,version);if(ready){clearTimeout(timeout);timeout=0;}}).catch(error=>status(error.message));};current.onerror=()=>{if(socket===current)serviceState('Offline');};current.onclose=event=>{clearTimeout(timeout);if(socket!==current||generation!==version||stopped)return;socket=null;ready=false;socialV2Available=false;online.clear();rooms=[];peerProfiles?.reset();clearPending();rejectLookups();rejectSocialAcks();clearLegacyRequests();serviceState('Offline');renderFriends();if(event.code===4001){serviceState('Open in another window');status('This identity connected from another Vumiro window. Use that window for requests and calls.');return;}status(frame?'Service disconnected. Your direct room can keep running. Use Reconnect if needed.':'Service offline. Reconnecting automatically; you can also use Reconnect.');reconnectTimer=setTimeout(connect,Math.min(30000,1000*2**Math.min(retry++,5))+Math.random()*350);};}catch(error){serviceState('Offline');status(error.message);}}
function openRoom(room,signaling,name='Your room',grant,access) {
  if(frame)throw Error('Leave your current room before opening another one.');
  const owner=room.slice(0,43)===profile.id, hint=access?.mode||rooms.find(value=>value.room===room)?.mode||(owner?'friends':'legacy');
  currentAccess={mode:['public','friends','private'].includes(hint)?hint:'legacy',name:access?.name||''};
  if(owner && currentAccess.mode==='legacy')currentAccess.mode='friends';
  if(owner && typeof access?.password==='string')currentAccess.password=access.password;
  const url=new URL('/call.html',location.href);
  url.searchParams.set('room',room);url.searchParams.set('signaling',normalizeService(signaling));url.searchParams.set('name',profile.name);
  if(linuxHost)url.searchParams.set('platform','linux');
  if(currentAccess.mode!=='legacy')url.searchParams.set('mode',currentAccess.mode);
  if(currentAccess.name)url.searchParams.set('roomName',currentAccess.name);
  for(const[key,value]of Object.entries(settings))url.searchParams.set(key,String(value));
  if(grant)url.searchParams.set('grant',JSON.stringify(grant));
  url.searchParams.set('autojoin','1');url.searchParams.set('embedded','1');currentRoom=room;joined=sharing=false;
  const roomFrame=frame=document.createElement('iframe');roomFrame.title='Vumiro room';roomFrame.allow='display-capture; microphone; speaker-selection; autoplay; fullscreen';roomFrame.allowFullscreen=true;
  roomFrame.onload=()=>{
    if(frame!==roomFrame)return;
    if(roomFrameLoaded)stopStreamAudioHost();roomFrameLoaded=true;
    if(owner)roomFrame.contentWindow.postMessage({type:'vumiro-room-access',room,...currentAccess},location.origin);
    roomFrame.contentWindow.postMessage({type:'vumiro-stream-settings',settings},location.origin);
    roomFrame.contentWindow.postMessage({type:'vumiro-profile',profile},location.origin);
    if(!linuxHost)roomFrame.contentWindow.postMessage({type:'vumiro-stream-audio',action:'state',supported:streamAudioSupported},location.origin);
    if(webViewHost)webViewHost.postMessage({type:'stream-audio',action:'state'});
  };
  roomFrame.src=url.href;$('callFrameSlot').append(roomFrame);
  $('callTitle').textContent=currentAccess.name||(name==='Your room'?name:'Room with '+name);
  $('roomReturnTitle').textContent=$('callTitle').textContent;
  $('callArea').hidden=false;$('callArea').style.cssText='';$('callArea').setAttribute('aria-hidden','false');$('roomReturn').hidden=true;$('friendsBody').hidden=true;setRoomView(true);renderFriends();status('Your room is opening. Enable your microphone or share a screen when ready.');
}
function setRoomView(visible){document.body.classList.toggle('room-view',visible);$('watchNav').hidden=!frame;for(const button of document.querySelectorAll('.nav>button')){if(visible)button.classList.toggle('active',button.id==='watchNav');else if(button.id==='watchNav')button.classList.remove('active');}if(!visible)$('friendsNav').classList.add('active');$('watchNav').setAttribute('aria-current',visible?'page':'false');$('friendsNav').setAttribute('aria-current',visible?'false':'page');}
function browseRoom(){if(!frame)return;$('callArea').hidden=false;$('callArea').style.cssText='position:absolute;inset:0;visibility:hidden;pointer-events:none';$('callArea').setAttribute('aria-hidden','true');$('friendsBody').hidden=false;$('roomReturn').hidden=false;setRoomView(false);}
function returnToRoom(){if(!frame)return;$('callArea').style.cssText='';$('callArea').setAttribute('aria-hidden','false');$('friendsBody').hidden=true;$('roomReturn').hidden=true;setRoomView(true);}
function stopStreamAudioHost(id=streamAudioHostId){if(!id||!webViewHost)return;webViewHost.postMessage({type:'stream-audio',action:'stop',id});if(streamAudioHostId===id)streamAudioHostId='';}
function finishRoom(){clearTimeout(leaveTimer);stopStreamAudioHost();roomFrameLoaded=false;frame?.remove();frame=null;currentRoom='';currentAccess=null;joined=sharing=false;publishRoom();$('callArea').style.cssText='';$('callArea').setAttribute('aria-hidden','false');$('callArea').hidden=true;$('roomReturn').hidden=true;$('friendsBody').hidden=false;setRoomView(false);for(const item of requests.filter(item=>item.kind==='join-request'))removeRequest(item.id).catch(()=>{});renderFriends();status('You left the room.');}
function leaveRoom(){if(!frame)return;frame.contentWindow.postMessage({type:'vumiro-call-leave'},location.origin);clearTimeout(leaveTimer);leaveTimer=setTimeout(finishRoom,1200);}
addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
  const data=event.data;
  if(data?.type==='vumiro-friend-status-query'||data?.type==='vumiro-add-friend'){
    const sourceFrame=frame,id=data.id;
    const reply=(status,message)=>{if(frame===sourceFrame)sourceFrame.contentWindow.postMessage({type:'vumiro-friend-status',id,status,message,friendTag:directoryTags[id]||''},location.origin);};
    (async()=>{
      try{
        if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id) )throw Error('This room member has an invalid identity.');
        if(id===profile?.id){reply('self','Your profile');return;}
        const friend=friendById(id);
        if(friend){reply('friend',friend.nickname||friend.name);return;}
        if(blocked.includes(id))throw Error('Unblock this identity before sending a friend request.');
        const savedRequest=requests.find(item=>item.contact.id===id&&item.kind==='friend-request'&&item.expires>runtimeNow());
        if(savedRequest){reply('pending',savedRequest.direction==='outgoing'?'Friend request waiting for acceptance.':'They already sent you a friend request.');return;}
        if(!ready)throw Error('Reconnect to look up this member.');
        const found=await lookup(id);if(!found)throw Error('This member is offline or could not be verified.');
        if(frame!==sourceFrame)return;const contact=await local.validateContact(found);if(contact.id!==id)throw Error('The directory returned a different identity.');
        if(frame!==sourceFrame)return;if(data.type==='vumiro-friend-status-query'){reply('available',contact.name+' · Not in your friends yet.');return;}
        if(friendById(id)){reply('friend','Already in your friends.');return;}
        if(requests.some(item=>item.contact.id===id&&item.kind==='friend-request'&&item.expires>runtimeNow())){reply('pending','Friend request is already waiting.');return;}
        await contactCapacity(id);if(blocked.includes(id))throw Error('Unblock this identity before sending a friend request.');
        if(!socialV2Available)throw Error('Friend requests need the updated Vumiro service. Update the service and reconnect.');
        const expires=serverNow()+86400000-5000;
        const message=await social(id,'friend-request',{},()=>frame===sourceFrame&&ready&&!blocked.includes(id),true,2,expires);
        await storeRequest({id:message.nonce,direction:'outgoing',kind:'friend-request',version:2,contact,nonce:message.nonce,expires:message.expires,nickname:'',state:'pending',delivered:false});
        reply('sent','Friend request sent to '+contact.name+'.');
      }catch(error){reply('error',error.message||'Could not verify this room member.');}
    })();return;
  }
  if(data?.type==='vumiro-call-ended'){finishRoom();return;}
  if(data?.type==='vumiro-room-state'&&data.room===currentRoom){
    const changed=joined!==(data.joined===true)||sharing!==(data.sharing===true)||currentAccess?.mode!==data.mode;
    joined=data.joined===true;sharing=data.sharing===true;
    if(['public','friends','private','legacy'].includes(data.mode))currentAccess={...currentAccess,mode:data.mode};
    if(typeof data.name==='string'&&data.name.trim())$('callTitle').textContent=data.name.trim().slice(0,60);$('roomReturnTitle').textContent=$('callTitle').textContent;
    if(changed){publishRoom();status(joined?(sharing?'Your screen is shared with the room.':'Your room is ready.'):'Reconnecting your room…');}
  }
  if(data?.type==='vumiro-room-policy'&&data.room===currentRoom&&['public','friends','private','legacy'].includes(data.mode)){
    currentAccess={...currentAccess,mode:data.mode,name:typeof data.name==='string'?data.name.slice(0,60):currentAccess?.name||''};
    delete currentAccess.password;
    if(currentAccess.name)$('callTitle').textContent=currentAccess.name;$('roomReturnTitle').textContent=$('callTitle').textContent;publishRoom();
  }
  if(data?.type==='vumiro-peer-profile'&&friendById(data.id)&&data.profile&&typeof data.profile==='object')local.updateContactProfile(data.id,data.profile).catch(()=>{});
  if(data?.type==='vumiro-stream-settings'&&data.settings){settings=normalizeSettings(data.settings);save('vumiro-stream-settings',JSON.stringify(settings));renderSettings();}
  if(data?.type==='vumiro-stream-audio'&&webViewHost){
    const keys=Object.keys(data).sort().join(',');
    if(data.action==='state'&&keys==='action,type'){webViewHost.postMessage({type:'stream-audio',action:'state'});return;}
    if(data.action==='start'&&keys==='action,excludeDiscord,id,type'&&streamAudioSupported&&typeof data.id==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(data.id)&&typeof data.excludeDiscord==='boolean'){
      stopStreamAudioHost();streamAudioHostId=data.id;webViewHost.postMessage({type:'stream-audio',action:'start',id:data.id,excludeDiscord:data.excludeDiscord});return;
    }
    if(data.action==='stop'&&keys==='action,id,type'&&typeof data.id==='string'&&data.id===streamAudioHostId){stopStreamAudioHost(data.id);return;}
    if(data.action==='ack'&&keys==='action,id,sequence,type'&&typeof data.id==='string'&&data.id===streamAudioHostId&&Number.isSafeInteger(data.sequence)&&data.sequence>=0)webViewHost.postMessage({type:'stream-audio',action:'ack',id:data.id,sequence:data.sequence});
  }
});
function renderRooms(){
  const target=$('roomsList');target.replaceChildren();const visible=rooms.filter(item=>friendById(item.owner));
  $('roomsBadge').hidden=!visible.length;$('roomsBadge').textContent=visible.length;$('roomNav').title=visible.length+' friends’ rooms available';
  $('roomsEmpty').hidden=visible.length>0;$('roomsEmpty').textContent=ready?'No friends’ rooms are open right now.':'Reconnect to see your friends’ rooms.';
  for(const item of visible.sort((a,b)=>Number(b.live)-Number(a.live))){
    const friend=friendById(item.owner),row=document.createElement('div');row.className='roomRow';
    const photo=document.createElement('span');photo.className='avatar';avatar(photo,friend);
    const info=document.createElement('span');info.className='friendInfo';const label=document.createElement('strong');label.textContent=friend.nickname;
    const state=document.createElement('small'), mode=item.mode==='public'?'Public':item.mode==='private'?'Password protected':item.mode==='friends'?'Friends':'Owner approval';
    state.textContent=(item.live?'● Live · ': 'Room open · ')+mode;if(item.live)state.className='live';info.append(label,state);
    const button=document.createElement('button'),requested=requests.some(request=>request.direction==='outgoing'&&request.kind==='join-request'&&request.room===item.room);
    button.textContent=requested?'Requested':item.mode==='private'?'Enter password':item.mode&&item.mode!=='legacy'?'Join room':'Request to join';
    button.disabled=!ready||!!frame||!!pending||requested;
    button.onclick=()=>requestJoin(item.room,item.mode).catch(error=>{$('roomError').textContent=error.message;});row.append(photo,info,button);target.append(row);
  }
}
function showRooms(){renderRooms();dialog('roomDialog');if(ready)watch();}
async function requestJoin(room,mode){
  if(frame||pending)throw Error('Finish your current room or call invitation first.');
  const owner=friendById(room.slice(0,43));mode=rooms.find(value=>value.room===room)?.mode||mode||(!owner?'public':'legacy');
  if(['public','friends','private'].includes(mode)){
    openRoom(room,serviceUrl,owner?.nickname||'Vumiro',undefined,{mode});if($('roomDialog').open)$('roomDialog').close();return;
  }
  if(!owner)throw Error('Add the room owner as a friend first.');
  if(requests.some(item=>item.direction==='outgoing'&&item.kind==='join-request'&&item.room===room))throw Error('Your request is waiting for the room owner.');
  const message=await social(owner.id,'join-request',{room});
  await storeRequest({id:message.nonce,direction:'outgoing',kind:'join-request',nonce:message.nonce,expires:message.expires,contact:{id:owner.id,name:owner.name,key:owner.key,username:owner.username||''},room});
  renderRooms();status('Room request sent to '+owner.nickname+'.');
}
$('acceptInvite').onclick=async()=>{const value=pending;if(!value||value.direction!=='incoming')return;$('acceptInvite').disabled=true;try{if(runtimeNow()>=value.expires||!await validGrant(friendById(value.friend),profile.id,value.room,value.grant))throw Error('This call approval expired.');await answer(value,true);if(pending!==value)return;const name=friendById(value.friend)?.nickname||'Your friend';clearPending();openRoom(value.room,serviceUrl,name,value.grant);}catch(error){status(error.message);}finally{$('acceptInvite').disabled=false;}};
async function dismissInvite(){const value=pending;if(!value)return;try{if(runtimeNow()<value.expires)await answer(value,false);}catch(error){status(error.message);}if(pending===value)clearPending(value.direction==='incoming'?'Call declined.':'Call cancelled.');}
$('declineInvite').onclick=dismissInvite;$('cancelInvite').onclick=dismissInvite;$('leaveCall').onclick=leaveRoom;$('leaveRoomFromBrowse').onclick=leaveRoom;$('browseApp').onclick=browseRoom;$('returnToRoom').onclick=returnToRoom;
$('watchNav').onclick=returnToRoom;
$('addFriend').onclick=$('emptyAdd').onclick=()=>{$('addError').textContent='';dialog('addDialog');};$('roomSettings').onclick=showSettings;
$('reconnectService').onclick=()=>{clearPending();connect();};$('reconnectRoom').onclick=()=>{frame?.contentWindow.postMessage({type:'vumiro-call-reconnect'},location.origin);if(!ready)connect();status('Reconnecting your room…');};
function requestUpdate(action){if(action==='install'&&!linuxHost&&(frame||pending)){status('Leave your room or finish the call invitation before installing an update.');return;}if(host)host.postMessage({type:'updates',action:linuxHost&&action==='install'?'download':action});else $('updateStatus').textContent='This browser client updates when reloaded. Get the desktop app from the project releases.';}
$('updatesNav').onclick=()=>{if(!$('profileDialog').open){browseRoom();showProfile();}$('updateDetails').open=true;$('updateDetails').scrollIntoView({block:'nearest'});requestUpdate('state');};$('checkUpdate').onclick=()=>requestUpdate('check');$('installUpdate').onclick=()=>requestUpdate('install');
if(host){document.documentElement.classList.add('native');if(linuxHost){document.documentElement.classList.add('desktop-linux');$('windowControls').hidden=true;$('installUpdate').textContent='Download update';$('updateInstallHelp').textContent='Download the Linux package and install it manually. Your local profile and friends stay on this device.';}else{$('windowControls').hidden=false;document.querySelectorAll('[data-window]').forEach(button=>{button.onclick=()=>host.postMessage({type:'window',action:button.dataset.window});});$('windowTitlebar').onpointerdown=event=>{if(event.button===0&&!event.target.closest('button'))host.postMessage({type:'window',action:'drag'});};document.querySelectorAll('[data-edge]').forEach(edge=>{edge.onpointerdown=event=>{if(event.button===0)host.postMessage({type:'window',action:'resize',edge:edge.dataset.edge});};});}host.addEventListener('message',event=>{const state=event.data;if(state?.type==='window-state'){document.documentElement.classList.toggle('backdrop',!linuxHost&&state.backdrop===true);document.documentElement.classList.toggle('maximized',state.maximized===true);document.documentElement.classList.toggle('fullscreen',state.fullscreen===true);return;}if(state?.type==='stream-audio'&&!linuxHost){if(state.action==='state'){streamAudioSupported=state.supported===true;renderSettings();if(frame)frame.contentWindow.postMessage({...state,type:'vumiro-stream-audio'},location.origin);return;}if(state.id===streamAudioHostId&&['started','stopped','error'].includes(state.action)){if(state.action==='error')streamAudioHostId='';if(frame)frame.contentWindow.postMessage({...state,type:'vumiro-stream-audio'},location.origin);}return;}if(state?.type!=='updates')return;updateAvailable=state.available===true;updateBusy=state.busy===true;$('updateStatus').textContent=typeof state.message==='string'?state.message:'';$('clientVersion').textContent=typeof state.current==='string'?'Vumiro '+state.current:'';$('checkUpdate').disabled=updateBusy;$('installUpdate').disabled=!updateAvailable||updateBusy||(!linuxHost&&!!frame)||(!linuxHost&&!!pending);$('updateBadge').hidden=!updateAvailable;$('profileUpdateDot').hidden=!updateAvailable;$('updateProgress').hidden=!updateBusy;$('updateProgress').value=Number(state.progress)||0;});}
if(host)host.addEventListener('message',event=>{
  if(event.data?.type!=='window-state')return;
  const caption=document.querySelector('[data-window="maximize"]');
  if(caption){const label=event.data.maximized?'Restore down':'Maximize';caption.setAttribute('aria-label',label);caption.title=label;}
});
if(webViewHost){webViewHost.addEventListener('sharedbufferreceived',event=>{const meta=event.additionalData;let original=null,valid=meta?.type==='stream-audio'&&meta.action==='samples'&&typeof meta.id==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(meta.id)&&Number.isSafeInteger(meta.sequence)&&meta.sequence>=0&&meta.sampleRate===48000&&meta.channels===2&&meta.frames===1920;try{original=event.getBuffer();if(valid&&original.byteLength===meta.frames*meta.channels*4&&frame&&meta.id===streamAudioHostId){const copy=original.slice(0);frame.contentWindow.postMessage({type:'vumiro-stream-audio',action:'samples',id:meta.id,sequence:meta.sequence,sampleRate:meta.sampleRate,channels:meta.channels,frames:meta.frames,pcm:copy},location.origin,[copy]);}}catch{}finally{if(original)try{webViewHost.releaseBuffer(original);}catch{}if(valid)webViewHost.postMessage({type:'stream-audio',action:'ack',id:meta.id,sequence:meta.sequence});}});webViewHost.postMessage({type:'stream-audio',action:'state'});}
$('shareMyCode').onclick=()=>{$('addDialog').close();showProfile();};
$('createRoom').onclick=$('createRoomFromDialog').onclick=$('roomCreateNav').onclick=()=>{
  if(!profile){dialog('setupDialog');return;}if(pending||frame){status('Finish your current room or call invitation first.');return;}
  if($('roomDialog').open)$('roomDialog').close();
  try{openRoom(newRoom(),serviceUrl,'Your room',undefined,{mode:'friends',name:'Your room'});}catch(error){status(error.message);}
};
$('roomNav').onclick=()=>{browseRoom();const expanded=$('roomSubnav').hidden;$('roomSubnav').hidden=!expanded;$('roomNav').setAttribute('aria-expanded',String(expanded));if(matchMedia('(max-width:570px)').matches)showRooms();};$('discoverRooms').onclick=$('manualRoom').onclick=()=>{browseRoom();$('roomError').textContent='';showRooms();};
const goHome=()=>{browseRoom();$('friendsNav').classList.add('active');$('roomNav').classList.remove('active');$('settingsNav').classList.remove('active');$('updatesNav').classList.remove('active');$('profileNav').classList.remove('active');if(!frame)$('search').focus();};$('homeNav').onclick=$('friendsNav').onclick=goHome;$('settingsNav').onclick=()=>{browseRoom();showSettings();};$('profileNav').onclick=()=>{browseRoom();showProfile();};$('search').oninput=renderFriends;$('filterAll').onclick=()=>{filter='all';renderFriends();};$('filterOnline').onclick=()=>{filter='online';renderFriends();};document.querySelectorAll('[data-close]').forEach(button=>{button.onclick=()=>$(button.dataset.close).close();});$('setupDialog').addEventListener('cancel',event=>event.preventDefault());
$('setupForm').onsubmit=async event=>{event.preventDefault();$('createProfile').disabled=true;$('setupError').textContent='';try{profile=await local.createProfile($('setupName').value);await window.VumiroAccount?.onProfileReady();$('setupDialog').close();renderProfile();await reloadFriends();connect();showInvitation();}catch(error){$('setupError').textContent=error.message;}finally{$('createProfile').disabled=false;}};
$('profileForm').onsubmit=async event=>{
  event.preventDefault(); $('profileError').textContent='';
  const button=event.submitter, name=$('profileName').value, username=$('profileUsername').value;
  if(button)button.disabled=true;
  try {
    await avatarWork;
    // Photos save independently. Never resubmit a stale image with edited text.
    await bannerWork;const bio=local.validateBio($('profileBio').value),connections=local.validateConnections(Object.keys(profileProviders).filter(key=>$('profileLink-'+key).value.trim()).map(provider=>({provider,url:$('profileLink-'+provider).value.trim()})));profile=await local.updateProfile({name,username,bio,connections}); renderProfile();
    status(ready?'Profile saved and shared with your online friends.':'Profile saved on this device. It will be shared when you reconnect.');
  } catch(error) { $('profileError').textContent=error.message; }
  finally { if(button)button.disabled=false; }
};
async function saveAvatar(value,version) {
  if(version!==avatarSelection)return;
  await local.updateProfile({avatar:value});
  if(version!==avatarSelection)return;profile=local.profile();
  avatarDraft=profile.avatar||''; renderOwnProfile();
  status(value?'Profile picture saved automatically and shared directly with online friends.':'Profile picture removed and shared with online friends.');
}
$('avatarFile').onchange=()=>{
  const file=$('avatarFile').files[0], version=++avatarSelection;
  $('avatarFile').value=''; $('profileError').textContent='';
  if(!file)return;
  avatarWork=(async()=>{try{const editor=window.VumiroAvatarEditor;if(!editor?.edit)throw Error('The profile picture editor is unavailable.');const value=await editor.edit(file);if(value)await saveAvatar(value,version);}catch(error){if(version===avatarSelection)$('profileError').textContent=error.message;}})();
};
$('removeAvatar').onclick=async()=>{
  if(!await confirmAction('Remove your profile picture?','Your friends will see your initials. You can choose another picture at any time.','Remove picture'))return;
  const version=++avatarSelection; $('profileError').textContent='';
  avatarWork=saveAvatar('',version).catch(error=>{$('profileError').textContent=error.message;});
  await avatarWork;
};
function renderBlocked(){const target=$('blockedList');target.replaceChildren();if(!blocked.length){target.textContent='No blocked identities.';target.className='help';return;}for(const id of blocked){const row=document.createElement('div');row.className='roomRow';const label=document.createElement('span');label.className='friendInfo truncate';label.textContent=id.slice(0,12)+'…';label.title=id;const button=document.createElement('button');button.textContent='Unblock';button.onclick=async()=>{try{if(!await confirmAction('Unblock this identity?','They can find you and send requests again. This does not add them to your friends.','Unblock'))return;await local.unblockContact(id);blocked=await local.listBlocked();announce();renderBlocked();}catch(error){status(error.message);}};row.append(label,button);target.append(row);}}
async function blockIdentity(id) {
  if (blocking.has(id) || requests.some(item => item.contact.id === id && responding.has(item.id))) throw Error('Wait for the current response before blocking this identity.');
  const name=friendById(id)?.nickname||requests.find(item=>item.contact.id===id)?.contact.name||'this identity';
  if(!await confirmAction('Block '+name+'?','They will be removed from your friends and cannot find you or send requests while this profile is online.','Block identity'))return;
  if(blocking.has(id)||requests.some(item=>item.contact.id===id&&responding.has(item.id)))throw Error('Wait for the current response before blocking this identity.');
  blocking.add(id);
  try {
    if (pending?.friend === id) await dismissInvite();
    await local.blockContact(id); blocked = await local.listBlocked();
    for (const item of requests.filter(item => item.contact.id === id)) await removeRequest(item.id);
    await reloadFriends(); announce(); renderBlocked(); status('Identity blocked on this device.');
  } finally { blocking.delete(id); renderRequests(); }
}
$('blockFriend').onclick=()=>{if(selected)blockIdentity(selected).catch(error=>status(error.message));};
$('importFriend').onclick=async()=>{$('addError').textContent='';try{const contact=await local.parseContactCode($('friendCode').value.trim());if(blocked.includes(contact.id))throw Error('Unblock this identity in your profile settings first.');selected=await local.addContact(contact,$('friendNickname').value);await reloadFriends();$('addDialog').close();$('addForm').reset();status('Contact saved locally. Your friend must accept your request or save your contact code for calls.');}catch(error){$('addError').textContent=error.message;}};
$('friendCode').oninput=()=>{clearTimeout(lookupTimer);$('lookupPreview').textContent='';const value=$('friendCode').value.trim();if(!value)return;lookupTimer=setTimeout(async()=>{try{const offline=/^(?:vm1\.|stfriend1\.)/.test(value)?await local.parseContactCode(value):null;const contact=ready?await lookup(value):offline;if($('friendCode').value.trim()!==value)return;$('lookupPreview').textContent=contact?contact.name+(contact.username?' · @'+contact.username:'')+(ready?' · Online':' · Contact code valid'):'No online match. Ask your friend for their contact code.';}catch(error){if($('friendCode').value.trim()===value)$('lookupPreview').textContent=error.message;}},450);};
$('addForm').onsubmit=async event=>{event.preventDefault();$('saveFriend').disabled=true;$('addError').textContent='';try{const value=$('friendCode').value.trim(),offline=/^(?:vm1\.|stfriend1\.)/.test(value)?await local.parseContactCode(value):null;if(!ready)throw Error(offline?offline.name+'’s code is valid. Reconnect to send a request; they must also be online.':'Reconnect to look up a #tag or username, or use your friend’s contact code.');if(!socialV2Available)throw Error('Friend requests need the updated Vumiro service. Update the service and reconnect.');const found=await lookup(value);if(!found)throw Error(offline?offline.name+' is offline. Ask them to open Vumiro, then try again.':'No online match for that tag or username. Ask your friend to open Vumiro, or use their contact code.');const contact=await local.validateContact(found);if(friendById(contact.id))throw Error('This person is already in your friends.');if(requests.some(item=>item.kind==='friend-request'&&item.contact.id===contact.id&&item.expires>requestNow(item)))throw Error('A friend request is already waiting.');await contactCapacity(contact.id);if(blocked.includes(contact.id))throw Error('Unblock this identity before sending a request.');const nickname=$('friendNickname').value.trim(),expires=serverNow()+86400000-5000;const message=await social(contact.id,'friend-request',{},()=>!blocked.includes(contact.id),true,2,expires);await storeRequest({id:message.nonce,direction:'outgoing',kind:'friend-request',version:2,contact,nonce:message.nonce,expires:message.expires,nickname,state:'pending',delivered:false});$('addDialog').close();$('addForm').reset();status('Friend request sent to '+contact.name+'. They can accept in Vumiro.');}catch(error){$('addError').textContent=error.message;}finally{$('saveFriend').disabled=false;}};
$('nicknameForm').onsubmit=async event=>{event.preventDefault();if(!selected)return;try{await local.renameFriend(selected,$('nickname').value);await reloadFriends();$('nicknameDialog').close();status('Nickname saved. Blank nicknames follow your friend’s current name.');}catch(error){status(error.message);}};
$('removeFriend').onclick=async()=>{const friend=friendById(selected);if(!friend)return;try{if(!await confirmAction('Remove '+friend.nickname+'?','They will be removed from your local friends. You can send a new request or save their contact code to add them again.','Remove friend'))return;if(!friendById(friend.id))return;if(pending?.friend===friend.id)await dismissInvite();await local.removeFriend(friend.id);online.delete(friend.id);rooms=rooms.filter(item=>item.owner!==friend.id);for(const item of requests.filter(item=>item.contact.id===friend.id))await removeRequest(item.id);await reloadFriends();watch();status(friend.nickname+' was removed from your local friends.');}catch(error){status(error.message);}};
$('contactCall').onclick=()=>{const friend=friendById(selected);if(friend)invite(friend).catch(error=>status(error.message));};
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(local.ownCode());status('Public contact code copied. Your friend can use it to send a request.');}catch{$('ownCode').focus();$('ownCode').select();status('Copy your contact code from the profile panel.');}};
$('exportCode').onclick=()=>{const url=URL.createObjectURL(new Blob([local.ownCode()+'\n'],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='Vumiro-contact.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Your public contact code was saved.');};
$('saveSignaling').onclick=()=>{try{serviceUrl=normalizeService($('signaling').value.trim());save('st-friends-signaling',serviceUrl);$('profileError').textContent='';$('signaling').value=serviceUrl;clearPending();connect();}catch(error){$('profileError').textContent=error.message;}};
$('saveRoomSettings').onclick=()=>{const fps=Number($('roomFps').value),mbps=Number($('roomMbps').value);if(!Number.isInteger(fps)||fps<1||fps>120||!Number.isFinite(mbps)||mbps<1||mbps>100){$('profileError').textContent='Choose 1–120 FPS and 1–100 Mbps per participant.';return;}settings=normalizeSettings({fps,mbps,resolution:$('roomResolution').value,contentHint:$('roomContentHint').value,audio:$('roomAudio').checked,excludeDiscord:$('excludeDiscord').checked});save('vumiro-stream-settings',JSON.stringify(settings));dispatchEvent(new Event('vumiro-account-data-changed'));frame?.contentWindow.postMessage({type:'vumiro-stream-settings',settings},location.origin);$('profileError').textContent='';status(frame?'Stream settings saved and sent to your open room.':'Stream settings saved for your next room.');};
$('roomForm').onsubmit=async event=>{event.preventDefault();$('roomError').textContent='';try{const raw=$('roomInvitation').value.trim();let room=raw,mode;try{const invitation=new URL(raw);if(!['https:','http:'].includes(invitation.protocol)||invitation.username||invitation.password)throw Error('Use a Vumiro room invitation.');const other=normalizeService(invitation.searchParams.get('signaling')||invitation.origin);if(other!==serviceUrl)throw Error('This invitation uses a different service. Save that service in Settings first.');room=invitation.searchParams.get('room')||'';const hint=invitation.searchParams.get('mode');if(['public','friends','private'].includes(hint))mode=hint;}catch(error){if(/^[a-z]+:/i.test(raw))throw error;}if(!/^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(room))throw Error('Paste a complete private room invitation.');if(room.slice(0,43)===profile.id)throw Error('This is your own invitation. Create a room to host your friends.');await requestJoin(room,mode);$('roomForm').reset();}catch(error){$('roomError').textContent=error.message;}};
addEventListener('storage',event=>{if(event.key==='vumiro-stream-settings'&&event.newValue){try{settings=normalizeSettings(JSON.parse(event.newValue));renderSettings();frame?.contentWindow.postMessage({type:'vumiro-stream-settings',settings},location.origin);}catch{}}});
addEventListener('beforeunload',()=>{stopStreamAudioHost();stopped=true;++generation;peerProfiles?.reset();rejectSocialAcks();clearTimeout(reconnectTimer);clearTimeout(leaveTimer);clearTimeout(requestTimer);clearTimeout(lookupTimer);if(pending)clearTimeout(pending.timer);const previous=socket;socket=null;previous?.close();frame?.contentWindow.postMessage({type:'vumiro-call-leave'},location.origin);});
(async()=>{try{const savedService=read('st-friends-signaling');serviceUrl=normalizeService(savedService||query.get('signaling')||location.origin);if(savedService&&savedService!==serviceUrl)save('st-friends-signaling',serviceUrl);profile=await local.initialize();await window.VumiroAccount?.onProfileReady();blocked=await local.listBlocked();if(!profile){serviceState('Profile needed');status('Create your local profile to get started.');dialog('setupDialog');return;}renderProfile();await hydrateRequests();await reloadFriends();connect();showInvitation();}catch(error){serviceState('Not connected');status(error.message);$('setupError').textContent=error.message;}})();
})();

/* Full-page settings navigation. */
/* A shared settings shell keeps native dialog focus and Escape behavior. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const profileDialog = $('profileDialog'), accountDialog = $('accountDialog');
  if (!profileDialog) return;
  const sections = [
    ['profile', 'Your profile'], ['account', 'Account'], ['audio', 'Voice & audio'],
    ['stream', 'Screen sharing'], ['connection', 'Connection'], ['blocked', 'Blocked people'], ['updates', 'App updates']
  ];
  const panels = new Map();
  let currentSection = 'profile';
  let profileDraftInSession = false, settingsTransitions = 0;
  const titlebar = $('windowTitlebar');
  const titlebarSlot = titlebar ? document.createComment('Desktop title bar home') : null;
  if (titlebarSlot) titlebar.before(titlebarSlot);

  function syncTitlebar() {
    if (!titlebar) return;
    const active = [...document.querySelectorAll('dialog.settingsScreen[open]')].at(-1);
    if (active) {
      if (titlebar.parentElement !== active) active.prepend(titlebar);
    } else if (titlebarSlot?.parentNode && titlebar.previousSibling !== titlebarSlot) titlebarSlot.after(titlebar);
  }

  function syncSettingsSession() {
    if (profileDialog.open) profileDraftInSession = true;
    else if (!settingsTransitions && !document.querySelector('dialog.settingsScreen[open]')) profileDraftInSession = false;
    syncTitlebar();
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function closeSettings() {
    for (const dialog of document.querySelectorAll('dialog.settingsScreen[open]')) dialog.close();
  }
  function selectPanel(key) {
    currentSection = key;
    for (const [name, panel] of panels) panel.hidden = name !== key;
    const heading = profileDialog.querySelector('.dialogHead h2');
    if (heading) heading.textContent = sections.find(([name]) => name === key)?.[1] || 'Settings';
    refreshNavigation();
    profileDialog.querySelector('.settingsBody')?.scrollTo?.(0, 0);
  }
  async function navigate(key, from) {
    if (profileDialog.open) profileDraftInSession = true;
    settingsTransitions++;
    try {
      if (key === 'account' || key === 'audio') {
        closeSettings();
        const service = key === 'account' ? window.VumiroAccount : window.VumiroAudioSettings;
        if (typeof service?.open !== 'function') throw Error('These settings are unavailable. Restart Vumiro and try again.');
        await service.open();
      } else {
        if (from !== profileDialog) closeSettings();
        if (!profileDialog.open) {
          // Keep the existing field nodes and avatar draft throughout this settings visit.
          if (profileDraftInSession) profileDialog.showModal();
          else $('profileNav')?.click();
        }
        if (key === 'updates') $('updatesNav')?.click();
        selectPanel(key);
      }
    } catch (error) {
      if ($('status')) $('status').textContent = error.message;
    } finally {
      settingsTransitions--;
      syncSettingsSession();
    }
  }
  function navigation(dialog, active) {
    const nav = element('nav', 'settingsNav');
    nav.setAttribute('aria-label', 'Settings');
    nav.append(element('div', 'settingsNavTitle', 'Settings'));
    for (const [key, label] of sections) {
      const button = element('button', '', label);
      button.type = 'button'; button.dataset.settingsSection = key;
      if (key === active) button.setAttribute('aria-current', 'page');
      button.onclick = () => navigate(key, dialog);
      nav.append(button);
    }
    nav.addEventListener('keydown', event => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...nav.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    });
    const back = element('button', 'settingsReturn', '← Back to Vumiro');
    back.type = 'button'; back.onclick = () => dialog.close(); nav.append(back);
    return nav;
  }
  function refreshNavigation() {
    for (const dialog of document.querySelectorAll('dialog.settingsScreen')) {
      const active = dialog === profileDialog ? currentSection : dialog === accountDialog ? 'account' : 'audio';
      for (const button of dialog.querySelectorAll('[data-settings-section]')) {
        if (button.dataset.settingsSection === active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    }
  }
  function shell(dialog, active) {
    if (!dialog || dialog.classList.contains('settingsScreen')) return;
    const body = element('div', 'settingsBody');
    while (dialog.firstChild) body.append(dialog.firstChild);
    const layout = element('div', 'settingsLayout');
    layout.append(navigation(dialog, active), body);
    dialog.classList.add('settingsScreen'); dialog.append(layout);
    dialog.addEventListener('close', syncSettingsSession);
  }

  // Group the existing controls without replacing nodes, event handlers or field IDs.
  const original = [...profileDialog.children];
  const heading = original.find(node => node.classList.contains('dialogHead'));
  const details = original.filter(node => node.tagName === 'DETAILS' && node.id !== 'accountDetails');
  const names = new Map(details.map(node => [node, node.id === 'streamDetails' ? 'stream' : node.id === 'updateDetails' ? 'updates' : node.querySelector('summary')?.textContent.includes('Connection') ? 'connection' : 'blocked']));
  const profilePanel = element('section', 'settingsPanel'); profilePanel.id = 'settingsProfilePanel';
  panels.set('profile', profilePanel);
  if (heading?.querySelector('h2')) {
    heading.querySelector('h2').id = 'settingsProfileHeading';
    profileDialog.setAttribute('aria-labelledby', 'settingsProfileHeading');
  }
  for (const node of original) {
    if (node === heading || node.id === 'profileError') continue;
    if (node.tagName === 'HR') { node.remove(); continue; }
    if (node.classList.contains('accountEntry')) { node.hidden = true; continue; }
    const key = names.get(node);
    if (key) {
      node.open = true; node.classList.add('settingsPanel', 'settingsDetailPanel');
      node.hidden = true; panels.set(key, node);
    } else profilePanel.append(node);
  }
  if (heading) heading.after(profilePanel); else profileDialog.prepend(profilePanel);
  shell(profileDialog, 'profile');
  shell(accountDialog, 'account');
  for (const id of ['profileNav', 'shareMyCode']) $(id)?.addEventListener('click', () => selectPanel('profile'), true);
  for (const id of ['settingsNav', 'roomSettings']) $(id)?.addEventListener('click', () => selectPanel('stream'), true);
  $('updatesNav')?.addEventListener('click', () => selectPanel('updates'), true);

  function actionRow(id, title, description, label, danger = false) {
    const button = $(id); if (!button) return null;
    const row = element('div', 'settingsActionRow' + (danger ? ' settingsDangerRow' : ''));
    const copy = element('div', 'settingsActionCopy');
    copy.append(element('h3', '', title), element('p', '', description));
    if (label) button.textContent = label;
    row.append(copy, button); return row;
  }
  function group(title, description) {
    const section = element('section', 'settingsSection');
    section.append(element('h3', 'settingsSectionTitle', title));
    if (description) section.append(element('p', 'settingsSectionDescription', description));
    return section;
  }
  function appendRows(section, rows) { for (const row of rows) if (row) section.append(row); }
  const actions = $('accountActions');
  if (actions && $('accountRestore')) {
    const oldButtons = actions.querySelector('.quickActions');
    const backup = group('Profile backup', 'Keep your profile, friends and preferences together across devices.');
    appendRows(backup, [
      actionRow('accountBackup', 'Back up this device', 'Save this device’s profile and contacts to your account.', 'Back up now'),
      actionRow('accountRestore', 'Restore saved data', 'Replace this device’s data with your account backup.', 'Restore')
    ]);
    const password = group('Password & identity');
    const changeForm = $('accountChangePasswordForm');
    if (changeForm) {
      const disclosure = element('details', 'settingsPasswordDisclosure');
      disclosure.append(element('summary', '', 'Change your password'), changeForm); password.append(disclosure);
    }
    for (const id of ['accountSetPasswordForm', 'accountRecoveryPanel']) if ($(id)) password.append($(id));
    const devices = group('Linked devices', 'Revoke a lost device to stop its account session from syncing.');
    if ($('accountDevices')) devices.append($('accountDevices'));
    if ($('accountDevicesRefresh')) { $('accountDevicesRefresh').textContent = 'Refresh devices'; devices.append($('accountDevicesRefresh')); }
    const sessions = group('Sessions');
    appendRows(sessions, [
      actionRow('accountSignOut', 'Sign out on this device', 'Return to the sign-in screen. Your local profile stays on this device.', 'Sign out'),
      actionRow('accountSignOutEverywhere', 'Sign out on all devices', 'End all saved account sessions, including this one.', 'Sign out everywhere')
    ]);
    const privacy = group('Your data');
    appendRows(privacy, [
      actionRow('accountExport', 'Export account data', 'Download a copy of the data saved in your account.', 'Export data'),
      actionRow('accountDelete', 'Delete your account', 'Permanently remove your account and its saved data.', 'Delete account', true)
    ]);
    // Keep the sync status anchor in place for account security controls.
    for (const child of [...actions.children]) {
      if (child.id === 'accountReauthForm' || child.id === 'accountSyncStatus') continue;
      if (![backup, password, devices, sessions, privacy].includes(child)) child.remove();
    }
    actions.append(backup, password, devices, sessions, privacy);
    oldButtons?.remove();
  }

  // Audio settings are created lazily; decorate them once without changing capture state.
  const decorateAudio = () => {
    const audio = document.querySelector('dialog.vumiro-audio-dialog');
    if (audio) shell(audio, 'audio');
  };
  decorateAudio();
  new MutationObserver(records => {
    if (!records.some(record => record.target === document.body || record.type === 'attributes')) return;
    decorateAudio(); syncSettingsSession();
  }).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['open']
  });
  syncSettingsSession();
})();
