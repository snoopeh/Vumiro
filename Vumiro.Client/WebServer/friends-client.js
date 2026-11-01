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

/* Local contacts and signed requests. Photos never reach the directory. */
(() => {
'use strict';
const $ = id => document.getElementById(id), local = window.VumiroLocalProfile, query = new URLSearchParams(location.search);
const online = new Set(), seen = new Map(), lookups = new Map(), socialAcks = new Map(), responding = new Map(), blocking = new Set();
let profile=null,friends=[],selected='',filter='all',socket=null,ready=false,reconnectTimer=0,retry=0,stopped=false,pending=null,frame=null,leaveTimer=0;
let generation=0,messages=Promise.resolve(),serviceUrl='',requests=[],requestTimer=0,rooms=[],currentRoom='',joined=false,sharing=false,lookupTimer=0,avatarDraft='',avatarSelection=0,avatarWork=Promise.resolve(),currentAccess=null,confirmation=null;
let updateAvailable=false,updateBusy=false,blocked=[],usernameCollision=false;
const host=window.chrome?.webview;
const peerProfiles=window.VumiroPeerProfiles?.create({local,send,getFriend:id=>blocked.includes(id)||blocking.has(id)?null:friendById(id),onProfile:(id,value)=>local.updateContactProfile(id,value)});
const read = key => { try{return localStorage.getItem(key)||'';}catch{return '';} };
const save = (key,value) => { try{localStorage.setItem(key,value);}catch{} };
function normalizeSettings(value={}) { return {fps:Math.round(Math.min(120,Math.max(1,Number(value.fps)||60))),mbps:Math.min(100,Math.max(1,Number(value.mbps)||20)),resolution:['native','720p','1080p','1440p','2160p'].includes(value.resolution)?value.resolution:'native',contentHint:value.contentHint==='motion'?'motion':'detail',audio:value.audio!==false}; }
let saved; try{saved=JSON.parse(read('vumiro-stream-settings'));}catch{}
let settings=normalizeSettings(saved||{fps:read('st-friends-fps')||query.get('fps'),mbps:read('st-friends-mbps')||query.get('mbps')});
save('vumiro-stream-settings',JSON.stringify(settings));
const friendById=id=>friends.find(friend=>friend.id===id);
const newRoom=()=>profile.id+'_'+Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join('');
const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]||'').join('').toUpperCase();
const status=text=>{$('status').textContent=text;};
function avatar(element,person) { element.replaceChildren();try{if(person.avatar&&local.validateAvatar(person.avatar)){const image=new Image();image.alt='';image.src=person.avatar;element.append(image);return;}}catch{}element.textContent=initials(person.nickname||person.name); }
function normalizeService(raw) { const url=new URL(raw);if(url.protocol==='https:')url.protocol='wss:';if(url.protocol==='http:')url.protocol='ws:';if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password)throw Error('Use a valid wss:// service URL.');if(url.protocol==='ws:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use wss:// for a service outside this device.');url.pathname='/call-signaling';url.search='';url.hash='';return url.href; }
function serviceState(text,connected=false) { $('serviceStatus').textContent=text;$('serviceDot').classList.toggle('online',connected);$('reconnectService').hidden=connected; }
function send(message) { if(!socket||socket.readyState!==WebSocket.OPEN||!ready)throw Error('The service is offline. Reconnect to send this request.');const {from,...wire}=message;socket.send(JSON.stringify(wire)); }
function watch(){if(ready)send({type:'watch',ids:friends.map(friend=>friend.id)});}
function announce(){if(ready)send({type:'profile-announce',name:profile.name,username:profile.username||'',blockedIds:blocked});}
function publishRoom(){if(ready)send({type:'room-state',room:currentRoom&&currentRoom.slice(0,43)===profile.id&&joined?currentRoom:null,live:!!(joined&&sharing&&currentRoom.slice(0,43)===profile.id),mode:currentAccess?.mode||'legacy'});}
function renderSettings(){for(const [id,key]of [['roomFps','fps'],['roomMbps','mbps'],['roomResolution','resolution'],['roomContentHint','contentHint']])$(id).value=settings[key];$('roomAudio').checked=settings.audio;}
function renderOwnProfile() {
  if (!profile) return;
  $('selfName').textContent=profile.name; $('selfUsername').textContent=profile.username?'@'+profile.username:'On this device';
  avatar($('selfAvatar'),profile); avatar($('profileAvatar'),profile); $('ownCode').value=local.ownCode();
}
function renderProfile() {
  renderOwnProfile(); $('profileName').value=profile.name; $('profileUsername').value=profile.username||'';
  avatarDraft=profile.avatar||''; $('signaling').value=serviceUrl; renderSettings(); renderBlocked();
}
function shareOwnProfile() {
  const previous=profile; profile=local.profile(); if (!profile) return;
  renderOwnProfile();
  if (!previous || previous.name!==profile.name || previous.username!==profile.username) announce();
  frame?.contentWindow.postMessage({type:'vumiro-profile',profile},location.origin); peerProfiles?.ownChanged();
}
addEventListener('vumiro-profile-changed',shareOwnProfile);
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
function renderDetails(){const friend=friendById(selected);$('contactEmpty').hidden=!!friend;$('contactDetails').hidden=!friend;if(!friend)return;avatar($('contactAvatar'),friend);$('contactName').textContent=friend.nickname;$('contactStatus').textContent=(friend.username?'@'+friend.username+'\n':'')+(online.has(friend.id)?'Online · ready to connect':'Offline')+(friend.nicknameOverride?'\n'+friend.name:'');if(document.activeElement!==$('nickname'))$('nickname').value=friend.nicknameOverride?friend.nickname:'';$('contactIdentity').textContent='PUBLIC IDENTITY\n'+friend.id;$('contactCall').disabled=!canCall(friend);}
function renderFriends(){
$('createRoom').disabled=$('createRoomFromDialog').disabled=$('roomCreateNav').disabled=!profile||!!pending||!!frame;$('installUpdate').disabled=!updateAvailable||updateBusy||!!frame||!!pending;$('sidebarCount').textContent=friends.length;$('onlineCount').textContent=online.size;
const search=$('search').value.trim().toLocaleLowerCase();const visible=friends.filter(friend=>(filter!=='online'||online.has(friend.id))&&(friend.nickname+' '+friend.name+' '+(friend.username||'')).toLocaleLowerCase().includes(search));visible.sort((a,b)=>Number(online.has(b.id))-Number(online.has(a.id))||a.nickname.localeCompare(b.nickname));const list=$('friendsList');list.replaceChildren();
for(const friend of visible){const row=document.createElement('div');row.className='friend'+(friend.id===selected?' selected':'');row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-label','View '+friend.nickname);const photo=document.createElement('span');photo.className='avatar';avatar(photo,friend);const info=document.createElement('span');info.className='friendInfo truncate';const name=document.createElement('span');name.className='friendName truncate';name.textContent=friend.nickname;const state=document.createElement('span');state.className='friendState';const dot=document.createElement('i');dot.className='dot'+(online.has(friend.id)?' online':'');state.append(dot,document.createTextNode(online.has(friend.id)?'Online':'Offline'));info.append(name,state);const call=document.createElement('button');call.className='callAction';call.textContent='Call';call.disabled=!canCall(friend);call.setAttribute('aria-label','Call '+friend.nickname);call.onclick=event=>{event.stopPropagation();invite(friend).catch(error=>status(error.message));};const select=()=>{selected=friend.id;renderFriends();};row.onclick=select;row.onkeydown=event=>{if(event.target===row&&['Enter',' '].includes(event.key)){event.preventDefault();select();}};row.append(photo,info,call);list.append(row);}
$('listHeading').textContent=(filter==='online'?'Online':'Your people')+' · '+visible.length;$('emptyState').hidden=friends.length>0;$('noResults').hidden=!friends.length||visible.length>0;$('filterAll').setAttribute('aria-pressed',String(filter==='all'));$('filterOnline').setAttribute('aria-pressed',String(filter==='online'));renderDetails();renderRooms();}
async function reloadFriends(){const old=friends.map(friend=>friend.id).join(',');friends=await local.listFriends();for(const id of online)if(!friendById(id))online.delete(id);if(!friendById(selected))selected=friends[0]?.id||'';if(pending&&!friendById(pending.friend))clearPending('The contact was removed.');peerProfiles?.syncContacts();if(old!==friends.map(friend=>friend.id).join(','))watch();renderFriends();}
addEventListener('vumiro-friends-changed',()=>{if(profile)reloadFriends().catch(error=>status(error.message));});
function showInvitation(){if(!query.get('room'))return;$('roomInvitation').value=location.href;$('roomError').textContent='Request approval from the room owner to join.';showRooms();query.delete('room');}
function clearPending(text){if(pending)clearTimeout(pending.timer);pending=null;$('invitation').hidden=true;if(text)status(text);renderFriends();}
function renderPending(){if(!pending)return;const name=friendById(pending.friend)?.nickname||'Your friend',incoming=pending.direction==='incoming';$('invitation').hidden=false;$('invitationTitle').textContent=incoming?name+' is calling':'Calling '+name+'…';$('invitationText').textContent=(incoming?'Join a room together. ':'Waiting for them to accept. ')+Math.max(0,Math.ceil((pending.expires-Date.now())/1000))+'s remaining';$('acceptInvite').hidden=!incoming;$('declineInvite').hidden=!incoming;$('cancelInvite').hidden=incoming;}
function setPending(value){pending=value;renderPending();renderFriends();const tick=()=>{if(pending!==value)return;if(Date.now()>=value.expires){clearPending('The call invitation expired.');return;}renderPending();value.timer=setTimeout(tick,1000);};value.timer=setTimeout(tick,1000);}
const inviteText=m=>`screentask-invite-v1\n${m.from}\n${m.to}\n${m.room}\n${m.nonce}\n${m.expires}`;
const answerText=m=>`screentask-answer-v1\n${m.from}\n${m.to}\n${m.room}\n${m.nonce}\n${m.accepted}\n${m.expires}`;
const socialText=m=>`vumiro-social-v1\n${m.from}\n${m.to}\n${m.kind}\n${m.nonce}\n${m.expires}\n${JSON.stringify(m.payload)}`;
const grantText=(owner,to,room,grant)=>`vumiro-room-grant-v1\n${owner}\n${to}\n${room}\n${grant.nonce}\n${grant.expires}`;
async function createGrant(to,room){const grant={nonce:crypto.randomUUID(),expires:Date.now()+86400000-5000};grant.signature=await local.sign(grantText(profile.id,to,room,grant));return grant;}
async function validGrant(owner,to,room,grant){return !!owner&&!!grant&&/^[A-Za-z0-9_-]{16,64}$/.test(grant.nonce||'')&&Number.isSafeInteger(grant.expires)&&grant.expires>Date.now()&&grant.expires<=Date.now()+86400000&&await local.verify(owner,grantText(owner.id,to,room,grant),grant.signature);}
async function answer(value,accepted){const message={type:'answer',from:profile.id,to:value.friend,room:value.room,nonce:value.nonce,accepted,expires:value.expires};message.signature=await local.sign(answerText(message));if(accepted){const saved=await local.listFriends();if(pending!==value||value.expires<=Date.now()||!saved.some(friend=>friend.id===value.friend)||blocked.includes(value.friend))throw Error('This invitation is no longer available from a saved friend.');}send(message);}
async function invite(friend){if(!canCall(friend))throw Error('Wait until you and your friend are online and free to call.');const value={direction:'outgoing',friend:friend.id,room:newRoom(),nonce:crypto.randomUUID(),expires:Date.now()+60000};setPending(value);try{const message={type:'invite',from:profile.id,to:friend.id,room:value.room,nonce:value.nonce,expires:value.expires};message.grant=await createGrant(friend.id,value.room);message.signature=await local.sign(inviteText(message));if(pending!==value)return;send(message);status('Calling '+friend.nickname+'. Your screen and microphone stay off until you enable them.');}catch(error){if(pending===value)clearPending(error.message);}}
function validEnvelope(m){return m.to===profile.id&&/^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(m.room||'')&&(m.type!=='invite'||m.room.slice(0,43)===m.from)&&/^[A-Za-z0-9_-]{16,100}$/.test(m.nonce||'')&&Number.isSafeInteger(m.expires)&&m.expires>Date.now()&&m.expires<=Date.now()+65000;}
function replayed(m){for(const[key,expires]of seen)if(expires<=Date.now())seen.delete(key);const key=m.from+':'+m.nonce;if(seen.has(key))return true;seen.set(key,m.expires);while(seen.size>256)seen.delete(seen.keys().next().value);return false;}
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
async function social(to,kind,payload,guard,requireAck=false) {
  const current = socket, version = generation;
  const valid = () => ready && socket === current && generation === version && !stopped && (!guard || guard());
  if (!valid()) throw Error('This request is no longer available.');
  const message = {type:'social',from:profile.id,to,kind,nonce:crypto.randomUUID(),expires:Date.now()+115000,payload};
  message.signature = await local.sign(socialText(message));
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
async function storeRequest(value){requests.push(value);await local.saveRequest(value);renderRequests();}
async function removeRequest(id){requests=requests.filter(item=>item.id!==id);await local.removeRequest(id);renderRequests();renderRooms();}
function renderRequests(){clearTimeout(requestTimer);const now=Date.now();const expired=requests.filter(item=>item.expires<=now);requests=requests.filter(item=>item.expires>now);expired.forEach(item=>local.removeRequest(item.id).catch(()=>{}));for(const target of [$('requests'),$('roomRequests')]){target.replaceChildren();for(const item of requests){const row=document.createElement('div');row.className='request';const photo=document.createElement('span');photo.className='avatar';avatar(photo,friendById(item.contact.id)||item.contact);const text=document.createElement('span');text.className='friendInfo';const label=document.createElement('strong');label.textContent=friendById(item.contact.id)?.nickname||item.contact.name;const hint=document.createElement('small');hint.textContent=item.direction==='outgoing'?(item.kind==='join-request'?'Waiting for room approval…':'Friend request sent · waiting for acceptance'):item.kind==='join-request'?'Would like to join your room':'Would like to be your friend';text.append(label,hint);row.append(photo,text);if(item.direction==='incoming'){const no=document.createElement('button');no.textContent='Decline';const yes=document.createElement('button');yes.textContent='Accept';yes.className='primary';const respond=async accepted=>{no.disabled=yes.disabled=true;try{await respondRequest(item,accepted);}catch(error){status(error.message);no.disabled=yes.disabled=false;}};no.onclick=()=>respond(false);yes.onclick=()=>respond(true);no.disabled=yes.disabled=responding.has(item.id);const block=document.createElement('button');block.textContent='Block';block.className='danger';block.disabled=responding.has(item.id);block.onclick=()=>blockIdentity(item.contact.id).catch(error=>status(error.message));row.append(no,yes,block);}else{const dismiss=document.createElement('button');dismiss.textContent='Dismiss';dismiss.onclick=()=>removeRequest(item.id).catch(error=>status(error.message));row.append(dismiss);}target.append(row);}}if(requests.length)requestTimer=setTimeout(renderRequests,Math.max(50,Math.min(...requests.map(item=>item.expires))-now+10));}
async function respondRequest(item,accepted) {
  if (responding.has(item.id)) throw Error('This request is already being answered.');
  const token = {}, current = socket, version = generation;
  const valid = () => ready && socket === current && generation === version && !stopped && requests.includes(item) && item.expires > Date.now() && responding.get(item.id) === token && !blocked.includes(item.contact.id) && !blocking.has(item.contact.id);
  responding.set(item.id,token); renderRequests();
  try {
    if (!valid()) throw Error('This request expired. Ask your friend to try again.');
    if (item.kind === 'friend-request') {
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
    if (socket === current && generation === version && ready && item.expires > Date.now() && !blocked.includes(item.contact.id) && !blocking.has(item.contact.id)) status(accepted ? (item.kind === 'friend-request' ? 'You are now friends. Both contact books update automatically.' : 'Room request accepted.') : 'Request declined.');
  } finally {
    if (responding.get(item.id) === token) responding.delete(item.id);
    renderRequests();
  }
}
async function receiveSocial(m,active){
if(m.to!==profile.id||!['friend-request','friend-answer','join-request','join-answer'].includes(m.kind)||!/^[A-Za-z0-9_-]{16,64}$/.test(m.nonce||'')||!Number.isSafeInteger(m.expires)||m.expires<=Date.now()||m.expires>Date.now()+120000||!m.payload||typeof m.payload!=='object'||Array.isArray(m.payload))return;
const contact=await local.validateContact(m.profile);if(blocked.includes(contact.id)||contact.id!==m.from||!await local.verify(contact,socialText(m),m.signature)||!active()||m.expires<=Date.now()||replayed(m))return;const p=m.payload;
if(m.kind==='friend-request'||m.kind==='join-request'){if(m.kind==='join-request'&&(!friendById(contact.id)||!frame||!joined||currentRoom!==p.room||currentRoom.slice(0,43)!==profile.id))return;if(requests.some(item=>item.direction==='incoming'&&item.contact.id===contact.id&&item.kind===m.kind))return;await storeRequest({id:m.nonce,direction:'incoming',kind:m.kind,contact,nonce:m.nonce,expires:m.expires,room:p.room||''});status(contact.name+(m.kind==='friend-request'?' sent you a friend request.':' wants to join your room.'));host?.postMessage({type:'window',action:'notify'});return;}
if(typeof p.accepted!=='boolean')return;const request=requests.find(item=>item.direction==='outgoing'&&item.nonce===p.requestNonce&&item.contact.id===contact.id&&item.expires>Date.now()&&item.kind===(m.kind==='friend-answer'?'friend-request':'join-request'));if(!request)return;
if(m.kind==='friend-answer'){if(p.accepted){if(!active()||!requests.includes(request)||request.expires<=Date.now()||blocked.includes(contact.id))return;selected=await local.addContact(contact,request.nickname,()=>active()&&requests.includes(request)&&request.expires>Date.now()&&!blocked.includes(contact.id));await reloadFriends();}await removeRequest(request.id);status(p.accepted?contact.name+' accepted. You are now friends.':contact.name+' declined the friend request.');}else{if(p.room!==request.room||p.room.slice(0,43)!==contact.id||!friendById(contact.id))return;if(p.accepted&&!await validGrant(contact,profile.id,p.room,p.grant))return;const currentFriends=await local.listFriends();if(!active()||!requests.includes(request)||request.expires<=Date.now()||blocked.includes(contact.id)||!currentFriends.some(friend=>friend.id===contact.id))return;await removeRequest(request.id);const stillFriends=await local.listFriends();if(!active()||request.expires<=Date.now()||blocked.includes(contact.id)||!stillFriends.some(friend=>friend.id===contact.id))return;if(p.accepted){if(frame||pending){status('Approval received. Finish your current room first.');return;}openRoom(p.room,serviceUrl,friendById(contact.id)?.nickname||contact.name,p.grant);if($('roomDialog').open)$('roomDialog').close();}else status(contact.name+' declined the room request.');}}
async function lookup(value){if(value.trim().startsWith('vm1.'))value=(await local.parseContactCode(value)).id;const nonce=crypto.randomUUID();return new Promise((resolve,reject)=>{try{send({type:'lookup',query:value,nonce});}catch(error){reject(error);return;}const timer=setTimeout(()=>{lookups.delete(nonce);reject(Error('Lookup timed out. Reconnect or use your friend’s contact code.'));},8000);lookups.set(nonce,{resolve,reject,timer});});}
async function refreshContact(value){try{const contact=await local.validateContact(value);if(friendById(contact.id))await local.updateContactProfile(contact.id,{name:contact.name,username:contact.username});}catch{}}
async function receive(m,current,version){const active=()=>socket===current&&generation===version&&!stopped;if(!active())return;
if(m.type==='challenge'){if(typeof m.nonce!=='string'||!/^[A-Za-z0-9_-]{16,160}$/.test(m.nonce))throw Error('The service sent an invalid challenge.');const signature=await local.sign(`screentask-directory-v1\n${profile.id}\n${m.nonce}`);if(active()&&current.readyState===WebSocket.OPEN)current.send(JSON.stringify({type:'authenticate',key:profile.key,signature}));return;}
if(m.type==='ready'){if(m.id!==profile.id){current.close(1008,'Identity mismatch');return;}ready=true;retry=0;serviceState('Online',true);announce();watch();publishRoom();renderFriends();status(frame?'Service reconnected. Your room is open.':'Online. Find a friend by username or contact code.');return;}
if(!ready)return;
if(m.type==='profile-ready'){status(usernameCollision?'That username is in use. You are online with your contact code.':profile.username?'Online as @'+profile.username+'.':'Online. Friends can find you with your contact code.');usernameCollision=false;return;}
if(m.type==='lookup-result'){const task=lookups.get(m.nonce);if(task){clearTimeout(task.timer);lookups.delete(m.nonce);task.resolve(m.profile||null);}return;}
if(m.type==='profile-signal'){await peerProfiles?.receive(m).catch(()=>{});return;}
if(m.type==='social'){await receiveSocial(m,active);return;}
if(m.type==='rooms'&&Array.isArray(m.rooms)){const previous=new Map(rooms.map(item=>[item.room,item.live]));rooms=m.rooms.filter(item=>friendById(item.owner)&&typeof item.room==='string'&&item.room.slice(0,43)===item.owner&&/^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(item.room)).slice(0,128);const fresh=rooms.filter(item=>!previous.has(item.room)||(item.live&&!previous.get(item.room)));renderRooms();if(fresh.length){const first=fresh[0],name=friendById(first.owner)?.nickname||'A friend';status(fresh.length===1?name+(first.live?' is live in their room. Open Rooms to request to join.':' opened a room. Open Rooms to request to join.'):fresh.length+' friends have new room activity. Open Rooms to join.');host?.postMessage({type:'window',action:'notify'});}return;}
if(m.type==='presence'&&friendById(m.id)&&typeof m.online==='boolean'){if(m.online)online.add(m.id);else{online.delete(m.id);rooms=rooms.filter(item=>item.owner!==m.id);}if(m.profile?.id===m.id)await refreshContact(m.profile);if(active())peerProfiles?.presence(m.id,m.online);renderFriends();return;}
if(m.type==='social-sent'){settleSocialAck(m.nonce,null,m.to);return;}
if(m.type==='unavailable'){settleSocialAck(m.nonce,Error('Your friend is unavailable. Ask them to reconnect and retry.'),m.to);if(pending?.direction==='outgoing'&&pending.friend===m.to&&pending.nonce===m.nonce)clearPending('Your friend is unavailable. Try again when you are both online.');const request=requests.find(item=>item.direction==='outgoing'&&item.contact.id===m.to&&item.nonce===m.nonce);if(request){await removeRequest(request.id);status('Your friend is unavailable. Ask them to open Vumiro, then try again.');}return;}
if(m.type==='error'||m.type==='social-error'){if(m.nonce)settleSocialAck(m.nonce,Error(typeof m.message==='string'?m.message:'The service rejected this response.'));else if(m.type==='social-error')rejectSocialAcks(typeof m.message==='string'?m.message:'The service rejected this response.');if(m.code==='username-taken'){profile=await local.updateProfile({username:''});if(!active())return;usernameCollision=true;renderProfile();announce();}const text=typeof m.message==='string'?m.message:'The service could not complete that request.';status(text);if($('profileDialog').open)$('profileError').textContent=text;if($('addDialog').open)$('addError').textContent=text;const request=requests.find(item=>item.direction==='outgoing'&&item.nonce===m.nonce);if(request)await removeRequest(request.id);return;}
if(!['invite','answer'].includes(m.type)||!validEnvelope(m))return;const friend=friendById(m.from);if(!friend||(m.type==='answer'&&typeof m.accepted!=='boolean'))return;if(!await local.verify(friend,m.type==='invite'?inviteText(m):answerText(m),m.signature)||!active())return;if(!(await local.listFriends()).some(saved=>saved.id===m.from)||!active()||m.expires<=Date.now())return;
if(m.type==='invite'){if(replayed(m))return;const value={direction:'incoming',friend:friend.id,room:m.room,nonce:m.nonce,expires:m.expires,grant:m.grant};if(pending||frame||!await validGrant(friend,profile.id,m.room,m.grant)){await answer(value,false);if(!m.grant)status('Your friend needs the latest Vumiro version to approve room access.');return;}const latestFriends=await local.listFriends();if(!active()||m.expires<=Date.now()||blocked.includes(friend.id)||!latestFriends.some(saved=>saved.id===friend.id))return;setPending(value);status(friend.nickname+' is calling. Accept to open your shared room.');host?.postMessage({type:'window',action:'notify'});}else if(pending&&pending.friend===friend.id&&pending.nonce===m.nonce&&pending.room===m.room&&pending.expires===m.expires){if(!m.accepted){clearPending(pending.direction==='incoming'?friend.nickname+' cancelled the call.':friend.nickname+' declined the call.');return;}if(pending.direction!=='outgoing')return;const value=pending;clearPending();openRoom(value.room,serviceUrl,friend.nickname);}}
async function clearRequests(){requests=[];renderRequests();const values=await local.listRequests();await Promise.all(values.map(item=>local.removeRequest(item.id)));}
function rejectLookups(){for(const task of lookups.values()){clearTimeout(task.timer);task.reject(Error('The service disconnected. Reconnect and try again.'));}lookups.clear();}
function connect(){clearTimeout(reconnectTimer);if(stopped||!profile)return;const version=++generation;ready=false;online.clear();rooms=[];peerProfiles?.reset();serviceState('Connecting…');rejectLookups();rejectSocialAcks();clearRequests().catch(()=>{});const previous=socket;socket=null;previous?.close();renderFriends();try{const url=new URL(serviceUrl);url.pathname='/friends-signaling';url.searchParams.set('id',profile.id);const current=socket=new WebSocket(url);messages=Promise.resolve();let timeout=setTimeout(()=>{if(socket===current&&!ready)current.close(4000,'Authentication timed out');},12000);current.onmessage=event=>{if(socket!==current||generation!==version||typeof event.data!=='string'||event.data.length>65536)return;messages=messages.then(async()=>{await receive(JSON.parse(event.data),current,version);if(ready){clearTimeout(timeout);timeout=0;}}).catch(error=>status(error.message));};current.onerror=()=>{if(socket===current)serviceState('Offline');};current.onclose=event=>{clearTimeout(timeout);if(socket!==current||generation!==version||stopped)return;socket=null;ready=false;online.clear();rooms=[];peerProfiles?.reset();clearPending();rejectLookups();rejectSocialAcks();clearRequests().catch(()=>{});serviceState('Offline');renderFriends();if(event.code===4001){serviceState('Open in another window');status('This identity connected from another Vumiro window. Use that window for requests and calls.');return;}status(frame?'Service disconnected. Your direct room can keep running. Use Reconnect if needed.':'Service offline. Reconnecting automatically; you can also use Reconnect.');reconnectTimer=setTimeout(connect,Math.min(30000,1000*2**Math.min(retry++,5))+Math.random()*350);};}catch(error){serviceState('Offline');status(error.message);}}
function openRoom(room,signaling,name='Your room',grant,access) {
  if(frame)throw Error('Leave your current room before opening another one.');
  const owner=room.slice(0,43)===profile.id, hint=access?.mode||rooms.find(value=>value.room===room)?.mode||(owner?'friends':'legacy');
  currentAccess={mode:['public','friends','private'].includes(hint)?hint:'legacy',name:access?.name||''};
  if(owner && currentAccess.mode==='legacy')currentAccess.mode='friends';
  if(owner && typeof access?.password==='string')currentAccess.password=access.password;
  const url=new URL('/call.html',location.href);
  url.searchParams.set('room',room);url.searchParams.set('signaling',normalizeService(signaling));url.searchParams.set('name',profile.name);
  if(currentAccess.mode!=='legacy')url.searchParams.set('mode',currentAccess.mode);
  if(currentAccess.name)url.searchParams.set('roomName',currentAccess.name);
  for(const[key,value]of Object.entries(settings))url.searchParams.set(key,String(value));
  if(grant)url.searchParams.set('grant',JSON.stringify(grant));
  url.searchParams.set('autojoin','1');url.searchParams.set('embedded','1');currentRoom=room;joined=sharing=false;
  const roomFrame=frame=document.createElement('iframe');roomFrame.title='Vumiro room';roomFrame.allow='display-capture; microphone; autoplay; fullscreen';roomFrame.allowFullscreen=true;
  roomFrame.onload=()=>{
    if(frame!==roomFrame)return;
    if(owner)roomFrame.contentWindow.postMessage({type:'vumiro-room-access',room,...currentAccess},location.origin);
    roomFrame.contentWindow.postMessage({type:'vumiro-stream-settings',settings},location.origin);
    roomFrame.contentWindow.postMessage({type:'vumiro-profile',profile},location.origin);
  };
  roomFrame.src=url.href;$('callFrameSlot').append(roomFrame);
  $('callTitle').textContent=currentAccess.name||(name==='Your room'?name:'Room with '+name);
  $('roomReturnTitle').textContent=$('callTitle').textContent;
  $('callArea').hidden=false;$('callArea').style.cssText='';$('callArea').setAttribute('aria-hidden','false');$('roomReturn').hidden=true;$('friendsBody').hidden=true;renderFriends();status('Your room is opening. Enable your microphone or share a screen when ready.');
}
function browseRoom(){if(!frame)return;$('callArea').hidden=false;$('callArea').style.cssText='position:absolute;inset:0;visibility:hidden;pointer-events:none';$('callArea').setAttribute('aria-hidden','true');$('friendsBody').hidden=false;$('roomReturn').hidden=false;}
function returnToRoom(){if(!frame)return;$('callArea').style.cssText='';$('callArea').setAttribute('aria-hidden','false');$('friendsBody').hidden=true;$('roomReturn').hidden=true;}
function finishRoom(){clearTimeout(leaveTimer);frame?.remove();frame=null;currentRoom='';currentAccess=null;joined=sharing=false;publishRoom();$('callArea').style.cssText='';$('callArea').setAttribute('aria-hidden','false');$('callArea').hidden=true;$('roomReturn').hidden=true;$('friendsBody').hidden=false;for(const item of requests.filter(item=>item.kind==='join-request'))removeRequest(item.id).catch(()=>{});renderFriends();status('You left the room.');}
function leaveRoom(){if(!frame)return;frame.contentWindow.postMessage({type:'vumiro-call-leave'},location.origin);clearTimeout(leaveTimer);leaveTimer=setTimeout(finishRoom,1200);}
addEventListener('message',event=>{
  if(!frame||event.source!==frame.contentWindow||event.origin!==location.origin)return;
  const data=event.data;
  if(data?.type==='vumiro-friend-status-query'||data?.type==='vumiro-add-friend'){
    const sourceFrame=frame,id=data.id;
    const reply=(status,message)=>{if(frame===sourceFrame)sourceFrame.contentWindow.postMessage({type:'vumiro-friend-status',id,status,message},location.origin);};
    (async()=>{
      try{
        if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id)||id===profile?.id)throw Error('This room member has an invalid identity.');
        const friend=friendById(id);
        if(friend){reply('friend',friend.nickname||friend.name);return;}
        if(blocked.includes(id))throw Error('Unblock this identity before sending a friend request.');
        const savedRequest=requests.find(item=>item.contact.id===id&&item.kind==='friend-request'&&item.expires>Date.now());
        if(savedRequest){reply('pending',savedRequest.direction==='outgoing'?'Friend request waiting for acceptance.':'They already sent you a friend request.');return;}
        if(!ready)throw Error('Reconnect to look up this member.');
        const found=await lookup(id);if(!found)throw Error('This member is offline or could not be verified.');
        if(frame!==sourceFrame)return;const contact=await local.validateContact(found);if(contact.id!==id)throw Error('The directory returned a different identity.');
        if(frame!==sourceFrame)return;if(data.type==='vumiro-friend-status-query'){reply('available',contact.name+' · Not in your friends yet.');return;}
        if(friendById(id)){reply('friend','Already in your friends.');return;}
        if(requests.some(item=>item.contact.id===id&&item.kind==='friend-request'&&item.expires>Date.now())){reply('pending','Friend request is already waiting.');return;}
        await contactCapacity(id);if(blocked.includes(id))throw Error('Unblock this identity before sending a friend request.');
        const message=await social(id,'friend-request',{},()=>frame===sourceFrame&&ready&&!blocked.includes(id));
        await storeRequest({id:message.nonce,direction:'outgoing',kind:'friend-request',contact,nonce:message.nonce,expires:message.expires,nickname:''});
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
    if(changed)publishRoom();
  }
  if(data?.type==='vumiro-room-policy'&&data.room===currentRoom&&['public','friends','private','legacy'].includes(data.mode)){
    currentAccess={...currentAccess,mode:data.mode,name:typeof data.name==='string'?data.name.slice(0,60):currentAccess?.name||''};
    delete currentAccess.password;
    if(currentAccess.name)$('callTitle').textContent=currentAccess.name;$('roomReturnTitle').textContent=$('callTitle').textContent;publishRoom();
  }
  if(data?.type==='vumiro-peer-profile'&&friendById(data.id)&&data.profile&&typeof data.profile==='object')local.updateContactProfile(data.id,data.profile).catch(()=>{});
  if(data?.type==='vumiro-stream-settings'&&data.settings){settings=normalizeSettings(data.settings);save('vumiro-stream-settings',JSON.stringify(settings));renderSettings();}
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
$('acceptInvite').onclick=async()=>{const value=pending;if(!value||value.direction!=='incoming')return;$('acceptInvite').disabled=true;try{if(Date.now()>=value.expires||!await validGrant(friendById(value.friend),profile.id,value.room,value.grant))throw Error('This call approval expired.');await answer(value,true);if(pending!==value)return;const name=friendById(value.friend)?.nickname||'Your friend';clearPending();openRoom(value.room,serviceUrl,name,value.grant);}catch(error){status(error.message);}finally{$('acceptInvite').disabled=false;}};
async function dismissInvite(){const value=pending;if(!value)return;try{if(Date.now()<value.expires)await answer(value,false);}catch(error){status(error.message);}if(pending===value)clearPending(value.direction==='incoming'?'Call declined.':'Call cancelled.');}
$('declineInvite').onclick=dismissInvite;$('cancelInvite').onclick=dismissInvite;$('leaveCall').onclick=leaveRoom;$('leaveRoomFromBrowse').onclick=leaveRoom;$('browseApp').onclick=browseRoom;$('returnToRoom').onclick=returnToRoom;
$('addFriend').onclick=$('emptyAdd').onclick=()=>{$('addError').textContent='';dialog('addDialog');};$('selfProfile').onclick=showProfile;$('topSettings').onclick=$('roomSettings').onclick=showSettings;
$('reconnectService').onclick=()=>{clearPending();connect();};$('reconnectRoom').onclick=()=>{frame?.contentWindow.postMessage({type:'vumiro-call-reconnect'},location.origin);if(!ready)connect();status('Reconnecting your room…');};
function requestUpdate(action){if(action==='install'&&(frame||pending)){status('Leave your room or finish the call invitation before installing an update.');return;}if(host)host.postMessage({type:'updates',action});else $('updateStatus').textContent='This browser client updates when reloaded. Get the desktop app from the project releases.';}
$('updatesNav').onclick=()=>{browseRoom();showProfile();$('updateDetails').open=true;$('updateDetails').scrollIntoView({block:'nearest'});requestUpdate('state');};$('checkUpdate').onclick=()=>requestUpdate('check');$('installUpdate').onclick=()=>requestUpdate('install');
if(host){document.documentElement.classList.add('native');$('windowControls').hidden=false;document.querySelectorAll('[data-window]').forEach(button=>{button.onclick=()=>host.postMessage({type:'window',action:button.dataset.window});});$('windowTitlebar').onpointerdown=event=>{if(event.button===0&&!event.target.closest('button')&&event.detail<2)host.postMessage({type:'window',action:'drag'});};$('windowTitlebar').ondblclick=event=>{if(!event.target.closest('button')){event.preventDefault();host.postMessage({type:'window',action:'maximize'});}};document.querySelectorAll('[data-edge]').forEach(edge=>{edge.onpointerdown=event=>{if(event.button===0)host.postMessage({type:'window',action:'resize',edge:edge.dataset.edge});};});host.addEventListener('message',event=>{const state=event.data;if(state?.type==='window-state'){document.documentElement.classList.toggle('backdrop',state.backdrop===true);document.documentElement.classList.toggle('maximized',state.maximized===true);document.documentElement.classList.toggle('fullscreen',state.fullscreen===true);return;}if(state?.type!=='updates')return;updateAvailable=state.available===true;updateBusy=state.busy===true;$('updateStatus').textContent=typeof state.message==='string'?state.message:'';$('clientVersion').textContent=typeof state.current==='string'?'Vumiro '+state.current:'';$('checkUpdate').disabled=updateBusy;$('installUpdate').disabled=!updateAvailable||updateBusy||!!frame||!!pending;$('updateBadge').hidden=!updateAvailable;$('updateProgress').hidden=!updateBusy;$('updateProgress').value=Number(state.progress)||0;});}
$('shareMyCode').onclick=()=>{$('addDialog').close();showProfile();};
function roomPrivacyFields(){
  const mode=$('newRoomMode').value; $('newRoomPasswordField').hidden=mode!=='private'; $('newRoomPassword').required=mode==='private';
  $('newRoomHint').textContent=mode==='public'?'Anyone with a Vumiro identity and the invitation can join.':mode==='private'?'Anyone with the invitation and password can join. Share the password separately.':'Only people in both contact books can join. You won’t need to approve each join.';
}
function createRoom(){
  if(!profile){dialog('setupDialog');return;}if(pending||frame){status('Finish your current room or call invitation first.');return;}
  if($('roomDialog').open)$('roomDialog').close();$('createRoomError').textContent='';roomPrivacyFields();dialog('createRoomDialog');
}
$('newRoomMode').onchange=roomPrivacyFields;
$('createRoomDialog').addEventListener('close',()=>{$('createRoomForm').reset();roomPrivacyFields();});
$('createRoomForm').onsubmit=event=>{
  event.preventDefault();$('createRoomError').textContent='';
  try{
    if(frame||pending)throw Error('Finish your current room or call invitation first.');
    const mode=$('newRoomMode').value,name=$('newRoomName').value.trim(),password=$('newRoomPassword').value;
    if(!['public','friends','private'].includes(mode))throw Error('Choose a valid room access setting.');
    if(mode==='private'&&(password.length<6||password.length>128))throw Error('Choose a room password between 6 and 128 characters.');
    openRoom(newRoom(),serviceUrl,'Your room',undefined,{mode,name,...(mode==='private'?{password}:{})});$('createRoomDialog').close();
  }catch(error){$('createRoomError').textContent=error.message;}
};
$('createRoom').onclick=$('createRoomFromDialog').onclick=$('roomCreateNav').onclick=createRoom;
$('roomNav').onclick=()=>{browseRoom();const expanded=$('roomSubnav').hidden;$('roomSubnav').hidden=!expanded;$('roomNav').setAttribute('aria-expanded',String(expanded));if(matchMedia('(max-width:570px)').matches)showRooms();};$('discoverRooms').onclick=$('manualRoom').onclick=()=>{browseRoom();$('roomError').textContent='';showRooms();};
const goHome=()=>{browseRoom();$('friendsNav').classList.add('active');$('roomNav').classList.remove('active');$('settingsNav').classList.remove('active');$('updatesNav').classList.remove('active');$('profileNav').classList.remove('active');if(!frame)$('search').focus();};$('homeNav').onclick=$('friendsNav').onclick=goHome;$('settingsNav').onclick=()=>{browseRoom();showSettings();};$('profileNav').onclick=()=>{browseRoom();showProfile();};$('search').oninput=renderFriends;$('filterAll').onclick=()=>{filter='all';renderFriends();};$('filterOnline').onclick=()=>{filter='online';renderFriends();};document.querySelectorAll('[data-close]').forEach(button=>{button.onclick=()=>$(button.dataset.close).close();});$('setupDialog').addEventListener('cancel',event=>event.preventDefault());
$('setupForm').onsubmit=async event=>{event.preventDefault();$('createProfile').disabled=true;$('setupError').textContent='';try{profile=await local.createProfile($('setupName').value);$('setupDialog').close();renderProfile();await reloadFriends();connect();showInvitation();}catch(error){$('setupError').textContent=error.message;}finally{$('createProfile').disabled=false;}};
$('profileForm').onsubmit=async event=>{
  event.preventDefault(); $('profileError').textContent='';
  const button=event.submitter, name=$('profileName').value, username=$('profileUsername').value;
  if(button)button.disabled=true;
  try {
    await avatarWork;
    // Photos save independently. Never resubmit a stale image with edited text.
    profile=await local.updateProfile({name,username}); renderProfile();
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
$('addForm').onsubmit=async event=>{event.preventDefault();$('saveFriend').disabled=true;$('addError').textContent='';try{const value=$('friendCode').value.trim(),offline=/^(?:vm1\.|stfriend1\.)/.test(value)?await local.parseContactCode(value):null;if(!ready)throw Error(offline?offline.name+'’s code is valid. Reconnect to send a request; they must also be online.':'Reconnect to look up an online username, or use your friend’s contact code.');const found=await lookup(value);if(!found)throw Error(offline?offline.name+' is offline. Ask them to open Vumiro, then try again.':'No online user has that username. Ask them for their contact code.');const contact=await local.validateContact(found);if(friendById(contact.id))throw Error('This person is already in your friends.');if(requests.some(item=>item.direction==='outgoing'&&item.kind==='friend-request'&&item.contact.id===contact.id))throw Error('Your request is already waiting for acceptance.');await contactCapacity(contact.id);if(blocked.includes(contact.id))throw Error('Unblock this identity before sending a request.');const nickname=$('friendNickname').value.trim();const message=await social(contact.id,'friend-request',{},()=>!blocked.includes(contact.id));await storeRequest({id:message.nonce,direction:'outgoing',kind:'friend-request',contact,nonce:message.nonce,expires:message.expires,nickname});$('addDialog').close();$('addForm').reset();status('Friend request sent to '+contact.name+'. They can accept in Vumiro.');}catch(error){$('addError').textContent=error.message;}finally{$('saveFriend').disabled=false;}};
$('nicknameForm').onsubmit=async event=>{event.preventDefault();if(!selected)return;try{await local.renameFriend(selected,$('nickname').value);await reloadFriends();status('Nickname saved. Blank nicknames follow your friend’s current name.');}catch(error){status(error.message);}};
$('removeFriend').onclick=async()=>{const friend=friendById(selected);if(!friend)return;try{if(!await confirmAction('Remove '+friend.nickname+'?','They will be removed from your local friends. You can send a new request or save their contact code to add them again.','Remove friend'))return;if(!friendById(friend.id))return;if(pending?.friend===friend.id)await dismissInvite();await local.removeFriend(friend.id);online.delete(friend.id);rooms=rooms.filter(item=>item.owner!==friend.id);for(const item of requests.filter(item=>item.contact.id===friend.id))await removeRequest(item.id);await reloadFriends();watch();status(friend.nickname+' was removed from your local friends.');}catch(error){status(error.message);}};
$('contactCall').onclick=()=>{const friend=friendById(selected);if(friend)invite(friend).catch(error=>status(error.message));};
$('copyCode').onclick=async()=>{try{await navigator.clipboard.writeText(local.ownCode());status('Public contact code copied. Your friend can use it to send a request.');}catch{$('ownCode').focus();$('ownCode').select();status('Copy your contact code from the profile panel.');}};
$('exportCode').onclick=()=>{const url=URL.createObjectURL(new Blob([local.ownCode()+'\n'],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='Vumiro-contact.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Your public contact code was saved.');};
$('saveSignaling').onclick=()=>{try{serviceUrl=normalizeService($('signaling').value.trim());save('st-friends-signaling',serviceUrl);$('profileError').textContent='';$('signaling').value=serviceUrl;clearPending();connect();}catch(error){$('profileError').textContent=error.message;}};
$('saveRoomSettings').onclick=()=>{const fps=Number($('roomFps').value),mbps=Number($('roomMbps').value);if(!Number.isInteger(fps)||fps<1||fps>120||!Number.isFinite(mbps)||mbps<1||mbps>100){$('profileError').textContent='Choose 1–120 FPS and 1–100 Mbps per participant.';return;}settings=normalizeSettings({fps,mbps,resolution:$('roomResolution').value,contentHint:$('roomContentHint').value,audio:$('roomAudio').checked});save('vumiro-stream-settings',JSON.stringify(settings));frame?.contentWindow.postMessage({type:'vumiro-stream-settings',settings},location.origin);$('profileError').textContent='';status(frame?'Stream settings saved and sent to your open room.':'Stream settings saved for your next room.');};
$('roomForm').onsubmit=async event=>{event.preventDefault();$('roomError').textContent='';try{const raw=$('roomInvitation').value.trim();let room=raw,mode;try{const invitation=new URL(raw);if(!['https:','http:'].includes(invitation.protocol)||invitation.username||invitation.password)throw Error('Use a Vumiro room invitation.');const other=normalizeService(invitation.searchParams.get('signaling')||invitation.origin);if(other!==serviceUrl)throw Error('This invitation uses a different service. Save that service in Settings first.');room=invitation.searchParams.get('room')||'';const hint=invitation.searchParams.get('mode');if(['public','friends','private'].includes(hint))mode=hint;}catch(error){if(/^[a-z]+:/i.test(raw))throw error;}if(!/^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(room))throw Error('Paste a complete private room invitation.');if(room.slice(0,43)===profile.id)throw Error('This is your own invitation. Create a room to host your friends.');await requestJoin(room,mode);$('roomForm').reset();}catch(error){$('roomError').textContent=error.message;}};
addEventListener('storage',event=>{if(event.key==='vumiro-stream-settings'&&event.newValue){try{settings=normalizeSettings(JSON.parse(event.newValue));renderSettings();frame?.contentWindow.postMessage({type:'vumiro-stream-settings',settings},location.origin);}catch{}}});
addEventListener('beforeunload',()=>{stopped=true;++generation;peerProfiles?.reset();rejectSocialAcks();clearTimeout(reconnectTimer);clearTimeout(leaveTimer);clearTimeout(requestTimer);clearTimeout(lookupTimer);if(pending)clearTimeout(pending.timer);const previous=socket;socket=null;previous?.close();frame?.contentWindow.postMessage({type:'vumiro-call-leave'},location.origin);});
(async()=>{try{serviceUrl=normalizeService(read('st-friends-signaling')||query.get('signaling')||location.origin);profile=await local.initialize();blocked=await local.listBlocked();if(!profile){serviceState('Profile needed');status('Create your local profile to get started.');dialog('setupDialog');return;}renderProfile();await clearRequests();await reloadFriends();connect();showInvitation();}catch(error){serviceState('Not connected');status(error.message);$('setupError').textContent=error.message;}})();
})();
