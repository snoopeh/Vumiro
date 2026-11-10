/* Local room layout only. Media tracks stay attached to their existing tiles. */
(() => {
  'use strict';
  const gap = 12;
  const fallbackAspect = 16 / 9;

  function aspect(value) {
    return Number.isFinite(value) && value >= 0.25 && value <= 6 ? value : fallbackAspect;
  }

  function plan(ratios, availableWidth, availableHeight) {
    const count = ratios.length;
    if (!count) return {columns: 1, rowHeight: 0};
    const width = Math.max(1, Number.isFinite(availableWidth) ? availableWidth : 320);
    const height = Math.max(240, Number.isFinite(availableHeight) ? availableHeight : 600);
    const maxColumns = width < 560 ? 1 : Math.min(4, count);
    let best = null;
    for (let columns = 1; columns <= maxColumns; columns++) {
      // A pair of streams belongs side by side once the scene is wide enough.
      if (count === 2 && width >= 800 && columns === 1) continue;
      const cellWidth = (width - gap * (columns - 1)) / columns;
      if (cellWidth < 180) continue;
      const rows = Math.ceil(count / columns);
      const heightBudget = (height - gap * (rows - 1)) / rows;
      const naturalHeight = Math.max(...ratios.map(ratio => cellWidth / aspect(ratio)));
      const rowHeight = Math.max(150, Math.min(heightBudget, naturalHeight));
      const score = ratios.reduce((total, ratio) => {
        const visibleWidth = Math.min(cellWidth, rowHeight * aspect(ratio));
        return total + visibleWidth * visibleWidth / aspect(ratio);
      }, 0);
      if (!best || score > best.score + 1) best = {columns, rowHeight, score};
    }
    return {columns: best?.columns || 1, rowHeight: Math.round(best?.rowHeight || 150)};
  }

  function create({root, grid, strip}) {
    if (!grid || !strip || typeof grid.insertBefore !== 'function' || typeof strip.insertBefore !== 'function') return null;
    let entries = [];
    let disposed = false;
    function replan() {
      if (disposed) return;
      const sharing = entries.filter(item => item.tile.sharing);
      const visible = sharing.length ? sharing : entries;
      if (!visible.length) return;
      const box = root.getBoundingClientRect();
      const width = box.width || root.clientWidth || 320;
      const height = Math.max(240, Math.min(760, window.innerHeight - box.top - 160));
      const ratios = visible.map(item => {
        const {videoWidth, videoHeight} = item.tile.video;
        return item.tile.sharing && videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : fallbackAspect;
      });
      const result = plan(ratios, width, height);
      grid.style.setProperty('--mosaic-columns', String(result.columns));
      grid.style.setProperty('--mosaic-row-height', result.rowHeight + 'px');
    }
    function place(target, items) {
      items.forEach((item, index) => {
        const element = item.tile.element;
        if (target.children[index] !== element) target.insertBefore(element, target.children[index] || null);
      });
    }
    function update(nextEntries, focusedId) {
      if (disposed) return;
      entries = nextEntries;
      const sharing = entries.filter(item => item.tile.sharing);
      const idle = entries.filter(item => !item.tile.sharing);
      for (const item of entries) {
        item.tile.element.classList.toggle('focused', item.id === focusedId);
        item.tile.element.classList.toggle('sharing', !!item.tile.sharing);
        item.tile.selectButton?.setAttribute('aria-pressed', String(item.id === focusedId));
      }
      place(grid, sharing.length ? sharing : idle);
      place(strip, sharing.length ? idle : []);
      grid.hidden = entries.length === 0;
      strip.hidden = sharing.length === 0 || idle.length === 0;
      replan();
    }
    let observedWidth = 0;
    const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(records => {
      const width = records[0]?.contentRect?.width;
      if (width > 0 && width !== observedWidth) { observedWidth = width; replan(); }
    }) : null;
    observer?.observe(root);
    window.addEventListener('resize', replan);
    return {update, replan, dispose() { disposed = true; observer?.disconnect(); window.removeEventListener('resize', replan); }};
  }

  window.VumiroStreamMosaic = {plan, create};
})();

/* Vumiro room: signaling-only server, direct WebRTC media. No TURN configuration. */
(() => {
  'use strict';
  function roomAccountAllowed() {
    let lobby=null;
    try{if(parent!==window&&parent.location.origin===location.origin&&parent.location.pathname==='/friends.html')lobby=parent;}catch{}
    if(lobby?.VumiroAccount?.getState?.().signedIn===true)return true;
    const home=new URL(location.href);home.pathname='/friends.html';for(const key of ['autojoin','embedded','launchId'])home.searchParams.delete(key);
    (lobby||window).location.replace(home.href);return false;
  }
  if(!roomAccountAllowed())return;
  const $ = id => document.getElementById(id), query = new URLSearchParams(location.search), linuxPlatform=query.get('platform')==='linux'||window.vumiroDesktop?.platform==='linux';
  window.VumiroChatPane?.create({layout:document.querySelector('.room-layout'),handle:$('chatResize'),storage:localStorage});
  window.VumiroChatScrollbar?.create({log:$('chatLog'),shell:$('chatScrollShell'),track:$('chatScrollTrack'),thumb:$('chatScrollThumb')});
  const clock=window.VumiroServerClock,serverNow=()=>clock?.now()??Date.now();
  const embedded = query.get('embedded') === '1' && parent !== window;
  const canonicalRoomHost='vumiro-rooms.vumiro-signaling.workers.dev';
  const legacyRoomHosts=new Set(['screentask-rooms.screentask-room-signaling.workers.dev','screentask-rooms.vumiro-signaling.workers.dev','vumiro-rooms.screentask-room-signaling.workers.dev']);
  function migrateRoomHost(url) { if(legacyRoomHosts.has(url.hostname.toLowerCase()))url.hostname=canonicalRoomHost;return url; }
  function canonicalSignalInput(raw) { try{return migrateRoomHost(new URL(raw)).href;}catch{return raw;} }
  document.body.classList.toggle('embedded', embedded);
  const settingsKey='vumiro-stream-settings', encoder=new TextEncoder();
  const defaultSettings={fps:Math.min(120,Math.max(1,Number(query.get('fps')) || 60)),mbps:Math.min(100,Math.max(1,Number(query.get('mbps')) || 20)),resolution:'native',contentHint:'detail',audio:!linuxPlatform,excludeDiscord:true};
  function validateSettings(value) {
    if(!value || typeof value!=='object' || !Number.isFinite(value.fps) || !Number.isFinite(value.mbps) || value.fps<1 || value.fps>120 || value.mbps<1 || value.mbps>100 || !['native','720p','1080p','1440p','2160p'].includes(value.resolution) || !['detail','motion'].includes(value.contentHint) || typeof value.audio!=='boolean') return null;
    return {fps:Math.round(value.fps),mbps:Math.round(value.mbps),resolution:value.resolution,contentHint:value.contentHint,audio:!linuxPlatform&&value.audio,excludeDiscord:value.excludeDiscord!==false};
  }
  let streamSettings={...defaultSettings};
  try { streamSettings=validateSettings(JSON.parse(localStorage.getItem(settingsKey))) || streamSettings; } catch { /* Use migrated query defaults. */ }
  let requestedFps=streamSettings.fps, bitrateMbps=streamSettings.mbps, roomGrant=null, disconnected=false;
  function grantValue(raw) {
    if(typeof raw!=='string' || raw.length>1024) return null;
    // Parse the proof before connecting, then validate its time bounds against
    // the room server clock after the challenge arrives.
    try { const value=JSON.parse(raw); return value && /^[A-Za-z0-9_-]{16,64}$/.test(value.nonce || '') && Number.isSafeInteger(value.expires) && (!clock?.isSynced() || (value.expires>serverNow() && value.expires<=serverNow()+86400000)) && /^[A-Za-z0-9_-]{86}$/.test(value.signature || '') ? {nonce:value.nonce,expires:value.expires,signature:value.signature} : null; } catch { return null; }
  }
  roomGrant=grantValue(query.get('grant'));
  let grantRoom=query.get('room') || '';
  const parentMessage=message=>{ if(embedded) parent.postMessage(message,location.origin); };
  let roomMode=['public','friends','private'].includes(query.get('mode'))?query.get('mode'):'friends', roomName=(query.get('roomName') || 'Your room').slice(0,60), ownerPolicy={mode:roomMode}, policyRevision=1, serverPolicy={mode:roomMode}, password='', accessReceived=false, accessResolve;
  const accessReady=embedded && query.has('mode')?new Promise(resolve=>{accessResolve=resolve;}):Promise.resolve();
  let passwordResolve=null, authenticationVersion=2, focusedId='', manualFocus=false, policyBusy=false, ownerBlocks='',policyAck=null,policyQueue=Promise.resolve();
  const profileCache=new Map();
  const mosaic=globalThis.VumiroStreamMosaic?.create({root:$('tiles'),grid:$('streamTiles'),strip:$('idleTiles')}) || {
    update(entries,id){for(const item of entries){item.tile.element.classList.toggle('focused',item.id===id);item.tile.selectButton?.setAttribute('aria-pressed',String(item.id===id));}},
    replan(){},dispose(){}
  };
  const roomState=()=>parentMessage({type:'vumiro-room-state',room:roomValue($('room').value),joined,sharing:!!screen,mode:roomMode,name:roomName});
  const ownsRoom=()=>!!identity && roomValue($('room').value).slice(0,43)===identity.id;
  const encode64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function decode64(value,length) { if(typeof value!=='string' || value.length>128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('Invalid room password settings.');const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));if(bytes.length!==length) throw Error('Invalid room password settings.');return bytes; }
  async function passwordKey(value,salt) { const key=await crypto.subtle.importKey('raw',encoder.encode(value),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:decode64(salt,16),iterations:150000,hash:'SHA-256'},key,256)); }
  async function privatePolicy(value) { if(typeof value!=='string' || value.length<6 || value.length>128) throw Error('Choose a password of 6–128 characters.');const salt=encode64(crypto.getRandomValues(new Uint8Array(16)));return {mode:'private',salt,verifier:encode64(await passwordKey(value,salt))}; }
  function displayPolicy(value,revision) { if(!value || !['public','friends','private','legacy','offline'].includes(value.mode)) throw Error('Invalid room access policy.');if(value.mode==='private') decode64(value.salt,16);serverPolicy=value;if(Number.isSafeInteger(revision) && revision>=0) policyRevision=revision;roomMode=['legacy','offline'].includes(value.mode)?'friends':value.mode;renderRoom(); }
  addEventListener('vumiro:localechange',()=>renderRoom());
  function renderRoom() { $('roomTitle').textContent=['Your room','Vumiro room'].includes(roomName)?(globalThis.VumiroI18n?.t(roomName)||roomName):roomName;$('privacyLabel').textContent=roomMode==='private'?'Private':roomMode==='public'?'Public':'Friends';$('privacyBadge').title=roomMode==='private'?'Password protected':roomMode==='public'?'Anyone with a profile may join':'Mutual friends may join';$('roomPolicyOpen').hidden=!joined || !ownsRoom() || authenticationVersion!==2;$('roomSubtitle').textContent=joined?'Your screens. Your people. Your space.':joining?'Connecting securely…':disconnected?'Connection interrupted':'A little closer, wherever you are.'; }
  function refreshLayout() {
    const entries=[...(localTile?[{id:selfId || identity?.id,tile:localTile,local:true}]:[]),...peers.values()];
    if(!manualFocus) { const sharing=entries.find(item=>!item.local && item.tile.sharing) || entries.find(item=>item.tile.sharing);focusedId=sharing?.id || entries.find(item=>!item.local)?.id || entries[0]?.id || ''; }
    if(!entries.some(item=>item.id===focusedId)) focusedId=entries.find(item=>!item.local)?.id || entries[0]?.id || '';
    mosaic.update(entries,focusedId);
    $('participantCount').textContent=joined?(entries.length+' '+(entries.length===1?'person':'people')):joining?'Connecting…':disconnected?'Disconnected':'Ready to join';$('peopleCount').textContent=String(entries.length);$('empty').hidden=entries.length>0;
    $('emptyTitle').textContent=disconnected?'Let’s get you back in':joining?'Your room is getting ready':'Make yourself at home';$('emptyDescription').textContent=disconnected?'Your room stays here. Reconnect when you’re ready to pick up where you left off.':'A place to watch, talk and share. Your screen and microphone stay off until you choose to turn them on.';$('emptyHint').textContent=disconnected?'Use Reconnect below':joining?'Connecting securely to your room…':'Choose a room to get started';
    const people=$('peopleList');people.replaceChildren();for(const item of entries) { const profile=profileCache.get(item.id) || {name:item.local?($('name').value || 'You'):item.name || 'Participant',username:'',avatar:''},row=document.createElement('li');row.className='person';row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-haspopup','dialog');row.setAttribute('aria-label','View '+profile.name+(item.local?' (you)':'')+' profile');row.onclick=()=>openParticipantProfile(item.id,item.local);row.onkeydown=event=>{ if(event.target===row && (event.key==='Enter'||event.key===' ')) { event.preventDefault();openParticipantProfile(item.id,item.local); } };const photo=avatarElement(profile),copy=document.createElement('div'),name=document.createElement('span'),state=document.createElement('span'),dot=document.createElement('span');copy.className='person-copy';name.className='person-name';name.textContent=profile.name+(item.local?' (you)':'');state.className='person-status';state.textContent=(globalThis.VumiroI18n?.translateLiteral(item.tile.sharing?'Sharing a screen':item.local?'In the room':item.pc.connectionState==='connected'?'Connected':'Connecting…')||(item.tile.sharing?'Sharing a screen':item.local?'In the room':item.pc.connectionState==='connected'?'Connected':'Connecting…'))+(item.tile.micMuted===true?' · '+(globalThis.VumiroI18n?.t('Mic off')||'Mic off'):'');dot.className='person-dot'+(item.local || item.pc.connectionState==='connected'?' online':'');copy.append(name,state);row.append(photo,copy,dot);people.append(row); }
  }

  function openParticipantProfile(id,isLocal) {
    const profile=profileCache.get(id) || {name:id===identity?.id?($('name').value||'You'):peers.get(id)?.name||'Participant',username:'',avatar:''};
    profileViewingId=id;profileViewingLocal=isLocal;renderParticipantCard(profile,isLocal);$('profileTag').hidden=true;$('profileTag').textContent='';$('profileNote').textContent='';
    const action=$('profileFriend');action.hidden=isLocal;action.disabled=true;action.textContent='Checking friendship…';profileAddBusy=false;profileRequestId=isLocal?'':id;clearTimeout(profileRequestTimer);
    if(!isLocal) {
      if(embedded) { parentMessage({type:'vumiro-friend-status-query',id});profileRequestTimer=setTimeout(()=>{ if(profileRequestId===id) { action.hidden=true;$('profileNote').textContent='Could not check friend status. Open the Friends page to manage this person.'; } },5000); }
      else { action.hidden=false;action.disabled=false;action.textContent='Open Friends';$('profileNote').textContent='Friend requests are managed from the Vumiro Friends page.'; }
    }
    const dialog=$('profilePopover');if(!dialog.open) dialog.showModal();$('profileClose').focus();
  }
  function renderParticipantCard(profile,isLocal) {
    $('profileName').textContent=profile.name+(isLocal?' (you)':'');$('profileUsername').textContent=profile.username?'@'+profile.username:'';$('profileUsername').hidden=!profile.username;$('profileAvatar').src=profile.avatar||fallbackAvatar(profile.name);
    const cover=peers.get(profileViewingId)?.coverImage, banner=cover?.banner===profile.banner?cover.url:profile.banner;
    if(cover?.banner===profile.banner){window.VumiroCoverMedia?.release($('profileBanner'));$('profileBanner').hidden=!banner;if(banner)$('profileBanner').src=banner;else $('profileBanner').removeAttribute('src');}
    else if(window.VumiroCoverMedia)void window.VumiroCoverMedia.display($('profileBanner'),profileViewingId,profile.banner,local);
    else {$('profileBanner').hidden=!banner;if(banner)$('profileBanner').src=banner;else $('profileBanner').removeAttribute('src');}
    $('profileBio').textContent=profile.bio||'';$('profileBio').hidden=!profile.bio;
    const links=$('profileLinks');links.replaceChildren();
    const labels={steam:'Steam',spotify:'Spotify',twitch:'Twitch',youtube:'YouTube',github:'GitHub',xbox:'Xbox'};
    for(const connection of profile.connections||[]) {
      const anchor=document.createElement('a');anchor.href=connection.url;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.textContent=labels[connection.provider]+' ↗';anchor.setAttribute('aria-label','Open '+labels[connection.provider]+' profile (external website)');links.append(anchor);
    }
    $('profileConnections').hidden=!links.children.length;
  }
  function friendStatus(message) {
    if(message.id!==profileRequestId) return;clearTimeout(profileRequestTimer);const action=$('profileFriend'),note=$('profileNote');action.disabled=profileAddBusy;
    // Friend handles come only from the trusted app parent's directory result,
    // never from direct peer display metadata or a claimed profile name.
    const named=/^[a-z0-9_.-]{3,24}#[0-9]{3,10}$/,handle=typeof message.friendHandle==='string'&&named.test(message.friendHandle)?message.friendHandle:'';
    const tag=handle||(typeof message.friendTag==='string'&&(/^#[0-9]{5}-[0-9]{5}$/.test(message.friendTag)||named.test(message.friendTag))?message.friendTag:'');$('profileTag').textContent=tag;$('profileTag').hidden=!tag;if(named.test(tag))$('profileUsername').hidden=true;
    if(message.status==='friend') { action.hidden=false;action.disabled=true;action.textContent='Already friends';note.textContent=message.message||'You are friends.'; }
    else if(message.status==='pending') { action.hidden=false;action.disabled=true;action.textContent='Request pending';note.textContent=message.message||'A friend request is already pending.'; }
    else if(message.status==='sent') { profileAddBusy=false;action.hidden=false;action.disabled=true;action.textContent='Request sent';note.textContent=message.message||'Friend request sent.'; }
    else if(message.status==='error') { profileAddBusy=false;action.hidden=false;action.disabled=false;action.textContent='Add friend';note.textContent=message.message||'Could not send the friend request.'; }
    else { profileAddBusy=false;action.hidden=false;action.disabled=false;action.textContent='Add friend';note.textContent=''; }
  }
  $('profileClose').onclick=()=>{ clearTimeout(profileRequestTimer);profileRequestId='';$('profilePopover').close(); };
  $('profilePopover').addEventListener('click',event=>{ if(event.target===$('profilePopover')) $('profilePopover').close(); });
  $('profilePopover').addEventListener('close',()=>{ window.VumiroCoverMedia?.release($('profileBanner'));clearTimeout(profileRequestTimer);profileRequestTimer=0;profileRequestId='';profileViewingId='';profileAddBusy=false; });
  $('profileFriend').onclick=()=>{ const id=profileRequestId;if(!id||profileAddBusy) return;if(!embedded) { location.href=new URL('/friends.html',location.href).href;return; }profileAddBusy=true;$('profileFriend').disabled=true;$('profileFriend').textContent='Sending…';$('profileNote').textContent='';parentMessage({type:'vumiro-add-friend',id});profileRequestTimer=setTimeout(()=>{ if(profileRequestId===id&&profileAddBusy) { profileAddBusy=false;$('profileFriend').disabled=false;$('profileFriend').textContent='Add friend';$('profileNote').textContent='No response from Vumiro. You can try again.'; } },8000); };
  function avatarElement(profile) { const image=document.createElement('img');image.className='avatar';image.alt='';image.src=profile.avatar || fallbackAvatar(profile.name);return image; }
  function fallbackAvatar(name) { const initial=Array.from(String(name || '?').trim())[0] || '?',svg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#3b303a"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#f8dce1" font-family="sans-serif">'+initial.replace(/[<>&"']/g,'')+'</text></svg>';return 'data:image/svg+xml,'+encodeURIComponent(svg); }
  function updateMessageProfiles(id) { const profile=profileCache.get(id);if(!profile) return;for(const row of $('chatLog').children) if(row.dataset.sender===id) { row.querySelector('.message-avatar').src=profile.avatar || fallbackAvatar(profile.name);row.querySelector('.message-label').textContent=profile.name+(id===identity?.id?' (you)':''); } }
  function cacheProfile(id,profile) { profileCache.set(id,profile);if(profileCache.size>128) profileCache.delete(profileCache.keys().next().value);updateMessageProfiles(id);if(profileViewingId===id&&$('profilePopover').open)renderParticipantCard(profile,profileViewingLocal); }
  const peers = new Map();
  const local = window.VumiroLocalProfile;
  let identity = null, roomNonce = '', roomFriendsRevision = 0;
  const identityReady = local.initialize().then(value => { identity = value; return value; });
  let selfId = '', socket = null, joined = false, reconnectTimer = 0, retry = 0, generation = 0;
  let profileRequestId='', profileRequestTimer=0, profileAddBusy=false,profileViewingId='',profileViewingLocal=false;
  let screen = null, microphone = null, localTile = null, joining = false;
  const voice = window.VumiroAudioSettings || null;
  let micMuted = false, micSuppressed = false, micChanging = false, microphoneEpoch = 0;
  const changingMicrophones = new Set();
  let nativeAudioReason='',nativeAudioSupported=false,nativeAudioSession=null,nativeAudioGeneration=0,audioContext=null,audioDestination=null,nativeAudioTrack=null;
  const readSaved = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optional */ } };
  function code() { return identity.id + '_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join(''); }
  function diagnostic(event,details={}) { try { window.VumiroDiagnostics?.record(event,details); } catch {} }
  function status(message) { const node=$('status');node.textContent=message;node.setAttribute?.('aria-busy',String(/^(?:Preparing|Saving|Searching|Starting|Stopping|Connecting|Reconnecting|Joining)\b/.test(message))); }
  const seenMessages=new Set(),chatHistory=[],chatFiles=new Map(),receivedChatFiles=new Map(),chatFileUrls=new Set();
  const maxChatFile=10*1024*1024,chatChunkBytes=12288;
  let chatRoom='',chatEpoch=0,chatSendQueue=Promise.resolve(),chatSendPending=0,pendingReply=null;
  const replyRows=new Map(),replyCitations=new Set(),replyDragTokens=new Map();
  let activeReplyDrag='',activeReplyRow=null;
  const replyKey=(authorId,id)=>authorId+':'+id;
  function rememberMessage(key) { if(seenMessages.has(key)) return false; seenMessages.add(key); if(seenMessages.size>1000) seenMessages.delete(seenMessages.values().next().value); return true; }
  function renderChatText(target,text) {
    const pattern=/\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|(https:\/\/[^\s<>]+)/g;let cursor=0,match;
    const cards=[];
    while((match=pattern.exec(text))){if(match.index>cursor)appendPlain(text.slice(cursor,match.index));let node;if(match[1]!==undefined){node=document.createElement('strong');node.textContent=match[1];}else if(match[2]!==undefined){node=document.createElement('em');node.textContent=match[2];}else if(match[3]!==undefined){node=document.createElement('code');node.textContent=match[3];}else{const url=publicChatUrl(match[4]);if(url){node=document.createElement('a');node.href=url.href;node.target='_blank';node.rel='noopener noreferrer';node.textContent=url.hostname+url.pathname;if(cards.length<3)cards.push(url);}else appendPlain(match[4]);}if(node)target.append(node);cursor=pattern.lastIndex;}
    if(cursor<text.length)appendPlain(text.slice(cursor));
    for(const url of cards)appendChatLinkCard(target,url);
    function appendPlain(value){const parts=value.split('\n');parts.forEach((part,index)=>{if(index)target.append(document.createElement('br'));if(part)target.append(document.createTextNode(part));});}
  }
  let callSoundsEnabled=true,callSoundVolume=100;
  try{callSoundsEnabled=localStorage.getItem('vumiro-app-sounds')!=='off';callSoundSettings(JSON.parse(localStorage.getItem('vumiro-app-sound-settings')));}catch{}
  function callSoundSettings(value){
    if(!value||typeof value.enabled!=='boolean')return;
    callSoundsEnabled=value.enabled;const volume=value.volume;
    callSoundVolume=(typeof volume==='number'||typeof volume==='string'&&volume.trim()!=='')&&Number.isFinite(Number(volume))?Math.round(Math.min(300,Math.max(0,Number(volume)))):100;
  }
  addEventListener('storage',event=>{if(event.key==='vumiro-app-sound-settings'){try{callSoundSettings(JSON.parse(event.newValue));}catch{}}else if(event.key==='vumiro-app-sounds')callSoundsEnabled=event.newValue!=='off';});
  addEventListener('message',event=>{if(embedded&&event.origin===location.origin&&event.source===parent&&event.data?.type==='vumiro-app-sound-settings')callSoundSettings(event.data.settings);});
  function playCallCue(kind){
    if(!callSoundsEnabled||callSoundVolume===0||(document.hidden&&kind!=='chat'))return;
    let ctx;
    try{
      const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;
      ctx=new Context();const osc=ctx.createOscillator(),gain=ctx.createGain();
      const tones=kind==='join'?[660,880]:kind==='leave'?[440,330]:kind==='chat'?[784]:[523,659,784],step=kind==='ring'?.12:.08,start=ctx.currentTime,duration=(tones.length-1)*step+.17;
      osc.type='sine';tones.forEach((tone,index)=>osc.frequency.setValueAtTime(tone,start+index*step));
      gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.12*callSoundVolume/100,start+.018);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
      osc.connect(gain);gain.connect(ctx.destination);osc.onended=()=>ctx.close().catch(()=>{});osc.start(start);osc.stop(start+duration+.01);
      if(ctx.state==='suspended')ctx.resume().catch(()=>ctx.close().catch(()=>{}));
    }catch{ctx?.close().catch(()=>{});}
  }
  function chatLine(text, sender, timestamp=Date.now(), signedMessage=null) {
    const log=$('chatLog'), nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<70,row=document.createElement('li');
    if(sender) {
      const profile=profileCache.get(sender) || {name:peers.get(sender)?.name || (sender===identity?.id?'You':'Participant'),avatar:''};
      const photo=avatarElement(profile),body=document.createElement('div'),author=document.createElement('div'),label=document.createElement('span'),time=document.createElement('span'),message=document.createElement('div');
      row.dataset.sender=sender;photo.classList.add('message-avatar');body.className='message-body';author.className='message-name';label.className='message-label';label.textContent=profile.name+(sender===identity?.id?' (you)':'');time.className='message-time';time.textContent=new Date(Math.abs(timestamp-Date.now())<86400000?timestamp:Date.now()).toLocaleTimeString(globalThis.VumiroI18n?.locale,{hour:'2-digit',minute:'2-digit'});renderChatText(message,text);author.append(label,time);body.append(author);
      if(signedMessage?.replyTo){
        const citation=document.createElement('button');citation.type='button';citation.className='chat-reply-citation';
        citation.onclick=()=>{const target=findReplyTarget(signedMessage.replyTo.authorId,signedMessage.replyTo.id),original=target&&replyRows.get(replyKey(target.author.id,target.id))?.row;if(original){original.scrollIntoView?.({block:'center'});original.focus?.();}else $('chatStatus').textContent='Original message unavailable.';};
        replyCitations.add({row,button:citation,target:signedMessage.replyTo});body.append(citation);updateReplyCitations();
      }
      body.append(message);
      if(signedMessage&&findReplyTarget(signedMessage.author.id,signedMessage.id)){
        const button=document.createElement('button');button.type='button';button.className='chat-reply-action';button.textContent='Reply';button.setAttribute?.('aria-label','Reply to '+profile.name);button.onclick=()=>selectChatReply(signedMessage.author.id,signedMessage.id);
        const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
        body.append(button);row.draggable=true;row.tabIndex=-1;row.dataset.replyToken=token;replyRows.set(replyKey(signedMessage.author.id,signedMessage.id),{row,button,token});replyDragTokens.set(token,{authorId:signedMessage.author.id,id:signedMessage.id});
      }
      row.append(photo,body);
    } else { row.className='system';row.textContent=text; }
    log.append(row);while(log.children.length>250){releaseChatRow(log.firstElementChild);log.firstElementChild.remove();}if(nearEnd) log.scrollTop=log.scrollHeight;return row;
  }
  const openChannels=()=>[...peers.values()].filter(peer=>peer.pc.connectionState==='connected' && peer.channel?.readyState==='open');
  function chatControls() {
    const count=openChannels().length,ready=joined||!!chatRoom&&disconnected;
    $('chatSend').disabled=!ready;$('chatText').disabled=!ready;
    if($('chatAttach')){$('chatAttach').disabled=!ready;$('chatAttach').title=count?'Share a file directly (up to 10 MiB)':'Choose a file (up to 10 MiB) · shared when someone connects';}
    $('chatStatus').textContent=!ready?'Join the room to chat.':count?`Direct chat · ${count} connected participant${count===1?'':'s'}`:disconnected?'Reconnecting · messages and files wait for the connection.':'Messages and selected files are ready for people who join.';
  }
  function channelSend(peer,message) {
    if(peer.channel?.readyState!=='open' || peer.channel.bufferedAmount>131072) return false;
    const value=JSON.stringify(message),bytes=encoder.encode(value).length;if(bytes>65536 || peer.channel.bufferedAmount+bytes>131072) return false;
    try { peer.channel.send(value);return true; } catch { return false; }
  }
  function setChatRoom(value) {
    if(chatRoom===value)return;
    chatRoom=value;++chatEpoch;chatSendQueue=Promise.resolve();chatSendPending=0;chatHistory.length=0;seenMessages.clear();chatFiles.clear();replyRows.clear();replyCitations.clear();replyDragTokens.clear();clearChatReply();
    for(const file of receivedChatFiles.values()){clearTimeout(file.timer);if(!file.url){file.parts=[];file.button.textContent='File unavailable · room ended';file.button.onclick=null;}}
    receivedChatFiles.clear();for(const url of chatFileUrls)URL.revokeObjectURL(url);chatFileUrls.clear();$('chatLog').replaceChildren();$('chatText').value='';
    for(const peer of peers.values()){peer.chatHistoryQueue=[];peer.chatHistoryReceived=0;}
  }
  function chatSignatureText(message) { return JSON.stringify(['vumiro-room-chat-v2',message.room,message.id,message.author.id,message.author.key,message.author.name,message.timestamp,message.text]); }
  function findReplyTarget(authorId,id) { return chatHistory.find(item=>item.room===chatRoom&&item.author.id===authorId&&item.id===id)||null; }
  function updateReplyCitations() {
    for(const citation of replyCitations){const target=findReplyTarget(citation.target.authorId,citation.target.id);citation.button.textContent=target?target.author.name+' · '+(target.text.length>100?target.text.slice(0,97)+'…':target.text):'Original message unavailable';}
  }
  function syncReplyRows() {
    for(const [key,value] of replyRows){const available=chatHistory.some(item=>replyKey(item.author.id,item.id)===key);value.button.disabled=!available;value.row.draggable=available;if(!available)replyDragTokens.delete(value.token);}
    updateReplyCitations();
  }
  function renderReplyPreview() {
    const target=pendingReply&&findReplyTarget(pendingReply.authorId,pendingReply.id);
    if(!target){pendingReply=null;$('replyPreview').hidden=true;return;}
    $('replyAuthor').textContent=target.author.name;
    $('replyExcerpt').textContent=target.text.length>120?target.text.slice(0,117)+'…':target.text;
    $('replyPreview').hidden=false;$('chatText').setAttribute?.('aria-describedby','replyAuthor replyExcerpt');
  }
  function selectChatReply(authorId,id) {
    if(!findReplyTarget(authorId,id))return false;
    pendingReply={authorId,id};renderReplyPreview();$('chatText').focus?.();return true;
  }
  function clearChatReply() { pendingReply=null;$('replyPreview').hidden=true;$('chatText').removeAttribute?.('aria-describedby'); }
  function bindChatReplyDrag() {
    const log=$('chatLog'),form=$('chatForm'),mime='application/x-vumiro-room-reply';
    if(typeof log.addEventListener!=='function'||typeof form.addEventListener!=='function')return;
    function clearDrag() { activeReplyRow?.classList.remove('chat-dragging');activeReplyRow=null;activeReplyDrag='';form.classList.remove('chat-reply-drop'); }
    log.addEventListener('dragstart',event=>{
      let node=event.target,interactive=false;
      while(node&&node!==log&&!node.dataset?.replyToken){if(['A','BUTTON','INPUT','TEXTAREA','SELECT'].includes(String(node.tagName).toUpperCase()))interactive=true;node=node.parentElement;}
      const row=node?.dataset?.replyToken?node:null,token=row?.dataset.replyToken;
      if(interactive||!row?.draggable||!replyDragTokens.has(token)||window.getSelection?.()?.toString()){event.preventDefault();return;}
      clearDrag();activeReplyRow=row;activeReplyDrag=token;event.dataTransfer?.setData(mime,token);if(event.dataTransfer)event.dataTransfer.effectAllowed='copy';row.classList.add('chat-dragging');
    });
    form.addEventListener('dragover',event=>{if(!activeReplyDrag)return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';form.classList.add('chat-reply-drop');});
    form.addEventListener('dragleave',event=>{if(!form.contains?.(event.relatedTarget))form.classList.remove('chat-reply-drop');});
    form.addEventListener('drop',event=>{if(!activeReplyDrag)return;const token=event.dataTransfer?.getData(mime);if(token===activeReplyDrag){event.preventDefault();const target=replyDragTokens.get(token);if(target)selectChatReply(target.authorId,target.id);}clearDrag();});
    log.addEventListener('dragend',clearDrag);
  }
  function bindChatReplyKeys() {
    $('chatView').addEventListener?.('keydown',event=>{if(event.key!=='Escape'||!pendingReply)return;event.preventDefault();clearChatReply();$('chatText').focus?.();});
  }
  function chatReplySignatureText(message) { return JSON.stringify(['vumiro-room-chat-reply-v1',chatSignatureText(message),message.signature,message.replyTo.authorId,message.replyTo.id]); }
  function validChatReply(message) {
    const hasTarget=Object.prototype.hasOwnProperty.call(message,'replyTo'),hasSignature=Object.prototype.hasOwnProperty.call(message,'replySignature');
    if(!hasTarget&&!hasSignature)return true;
    const target=message.replyTo;
    return hasTarget&&hasSignature&&target&&typeof target==='object'&&!Array.isArray(target)&&Object.keys(target).length===2&&/^[A-Za-z0-9_-]{43}$/.test(target.authorId||'')&&/^[A-Za-z0-9_-]{16,64}$/.test(target.id||'')&&typeof message.replySignature==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(message.replySignature);
  }
  function validChatMessage(message) { return !!message&&typeof message.id==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(message.id)&&typeof message.text==='string'&&!!message.text.trim()&&message.text.length<=2000&&Number.isSafeInteger(message.timestamp)&&Math.abs(message.timestamp-serverNow())<86400000; }
  function storeChatMessage(message) { if(!rememberMessage(message.author.id+':'+message.id))return false;chatHistory.push({type:'chat',version:2,room:message.room,id:message.id,text:message.text,timestamp:message.timestamp,signature:message.signature,author:{id:message.author.id,key:message.author.key,name:message.author.name},...(message.replyTo?{replyTo:{authorId:message.replyTo.authorId,id:message.replyTo.id},replySignature:message.replySignature}:{})});chatHistory.sort((a,b)=>a.timestamp-b.timestamp);if(chatHistory.length>100)chatHistory.splice(0,chatHistory.length-100);if(pendingReply&&!findReplyTarget(pendingReply.authorId,pendingReply.id))clearChatReply();syncReplyRows();return true; }
  async function acceptRoomChat(peer,message,history=false) {
    if(!validChatMessage(message))return false;
    if(message.version!==2){if(history||message.version!==undefined&&message.version!==1)return false;if(rememberMessage(peer.id+':'+message.id)){chatLine(message.text,peer.id,message.timestamp);if(peer.id!==identity?.id)playCallCue('chat');}return true;}
    if(!chatRoom||message.room!==chatRoom||!message.author||typeof message.author.id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(message.author.id)||typeof message.author.name!=='string'||!message.author.name.trim()||message.author.name.length>48||typeof message.author.key!=='string'||message.author.key.length>256||typeof message.signature!=='string'||message.signature.length>128||!validChatReply(message)||(!history&&message.author.id!==peer.id)||seenMessages.has(message.author.id+':'+message.id))return false;
    const epoch=chatEpoch;
    try {
      const author=message.author.id===identity?.id?(message.author.key===identity.key?message.author:null):await local.validateContact(message.author);
      if(!author||!await local.verify(author,chatSignatureText(message),message.signature)||message.replyTo&&!await local.verify(author,chatReplySignatureText(message),message.replySignature)||epoch!==chatEpoch||peers.get(peer.id)!==peer||!storeChatMessage(message))return false;
      if(!profileCache.has(author.id)){profileCache.set(author.id,{name:author.name,avatar:''});if(profileCache.size>128)profileCache.delete(profileCache.keys().next().value);}
      chatLine(message.text,author.id,message.timestamp,message);
      if(!history&&author.id!==identity?.id){
        if(typeof embedded!=='undefined'&&embedded)parentMessage({type:'vumiro-chat-notification',room:roomValue($('room').value),id:message.id,text:message.text,sender:{id:author.id,name:author.name,avatar:profileCache.get(author.id)?.avatar||''}});
        else playCallCue('chat');
      }
      return true;
    } catch{return false;}
  }
  function queueChatHistory(peer) { peer.chatHistoryQueue=chatHistory.filter(message=>message.room===chatRoom&&Math.abs(message.timestamp-serverNow())<86400000).slice(-100).map(message=>({message,history:true}));flushChatHistory(peer); }
  function flushChatHistory(peer) {
    if(peers.get(peer.id)!==peer)return;
    const queue=peer.chatHistoryQueue;
    while(queue?.length&&peer.channel?.readyState==='open'&&peer.channel.bufferedAmount<65536){const entry=queue[0];if(entry.message.room!==chatRoom){queue.shift();continue;}if(!channelSend(peer,entry.history?{type:'chat-history',message:entry.message}:entry.message))break;queue.shift();}
    offerChatFiles(peer);
  }
  async function sendRoomChat(event) {
    event.preventDefault();const draft=$('chatText').value,text=draft.trim(),epoch=chatEpoch;
    if(!(joined||!!chatRoom&&disconnected)||!chatRoom||!identity||!text||text.length>2000)return;
    if(chatSendPending>=120){$('chatStatus').textContent='Messages are still being signed. Your draft is ready to send when they finish.';return;}
    const target=pendingReply&&findReplyTarget(pendingReply.authorId,pendingReply.id);
    const message={type:'chat',version:2,room:chatRoom,id:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),text,timestamp:serverNow(),author:{id:identity.id,key:identity.key,name:identity.name},...(target?{replyTo:{authorId:target.author.id,id:target.id}}:{})};
    const current=()=>epoch===chatEpoch&&identity?.id===message.author.id&&identity?.key===message.author.key;
    ++chatSendPending;$('chatText').value='';$('chatText').style.height='';clearChatReply();
    chatSendQueue=chatSendQueue.then(async()=>{
      if(!current())return;
      try {
        message.signature=await local.sign(chatSignatureText(message));if(!current())return;
        if(message.replyTo){message.replySignature=await local.sign(chatReplySignatureText(message));if(!current())return;}
        storeChatMessage(message);chatLine(text,message.author.id,message.timestamp,message);
        for(const peer of openChannels())if(!channelSend(peer,message)){if(!peer.chatHistoryQueue)peer.chatHistoryQueue=[];peer.chatHistoryQueue.push({message,history:false});if(peer.chatHistoryQueue.length>100)peer.chatHistoryQueue.shift();}
        chatControls();
      }catch{if(current()){if(!$('chatText').value){$('chatText').value=draft;if(target&&!pendingReply)selectChatReply(target.author.id,target.id);}const error='Message could not be signed. Try again.';chatLine((globalThis.VumiroI18n?.t(error)||error)+'\n'+text);$('chatStatus').textContent=error;}}
    }).finally(()=>{if(epoch===chatEpoch)--chatSendPending;});
    await chatSendQueue;
  }
  function validChatFileId(value) { return typeof value==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(value); }
  function publicChatUrl(value) {
    try{const url=new URL(value),host=url.hostname.toLowerCase().replace(/\.$/,'');if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!host.includes('.')||host.includes(':')||/^[\d.]+$/.test(host)||/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host))return null;return url;}catch{return null;}
  }
  function appendChatLinkCard(target,url) {
    const card=document.createElement('div'),label=document.createElement('span');card.className='chat-link-card';label.textContent=url.hostname+url.pathname;card.append(label);
    let preview='';if(/\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname))preview=url.href;
    const youtube=url.hostname==='youtu.be'?url.pathname.slice(1).split('/')[0]:/^(?:www\.|m\.)?youtube\.com$/.test(url.hostname)?(url.pathname==='/watch'?url.searchParams.get('v'):/^\/(?:shorts|embed)\/([\w-]+)$/.exec(url.pathname)?.[1]):'';
    if(youtube&&/^[A-Za-z0-9_-]{11}$/.test(youtube))preview='https://i.ytimg.com/vi/'+youtube+'/hqdefault.jpg';
    if(preview){const button=document.createElement('button');button.type='button';button.className='chat-preview-load';button.textContent='Load preview';button.title='Loads an image from '+new URL(preview).hostname;button.onclick=()=>{button.onclick=null;button.remove();appendChatImage(card,preview,'Link preview');};card.append(button);}
    target.append(card);
  }
  function chatRasterType(bytes) {
    if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)){const number=offset=>bytes[offset]*16777216+bytes[offset+1]*65536+bytes[offset+2]*256+bytes[offset+3],width=number(16),height=number(20);return width>0&&height>0&&width*height<=40000000?'image/png':'';}
    if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
    if(bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
    if(bytes.length>=10&&/^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0,6)))){const width=bytes[6]+bytes[7]*256,height=bytes[8]+bytes[9]*256;return width>0&&height>0&&width*height<=40000000?'image/gif':'';}
    return '';
  }
  function appendChatImage(target,url,name) {
    const image=document.createElement('img');image.className='chat-media-preview';image.alt=name;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.onerror=()=>{image.remove();const fallback=document.createElement('span');fallback.className='chat-preview-error';fallback.textContent='Preview unavailable. Use the download or link.';target.append(fallback);};image.onload=()=>{if(image.naturalWidth*image.naturalHeight>40000000)image.onerror();};image.src=url;target.append(image);
  }
  function retainedChatFileBytes() { return [...chatFiles.values()].reduce((sum,file)=>sum+file.file.size,0)+[...receivedChatFiles.values()].filter(file=>file.active||file.url).reduce((sum,file)=>sum+file.size,0); }
  function releaseChatRow(row) {
    for(const [key,value] of replyRows)if(value.row===row){replyRows.delete(key);replyDragTokens.delete(value.token);}
    for(const citation of replyCitations)if(citation.row===row)replyCitations.delete(citation);
    for(const file of chatFiles.values())if(file.row===row){file.previewRetired=true;if(file.url){URL.revokeObjectURL(file.url);chatFileUrls.delete(file.url);file.url=null;}}
    for(const [key,file] of receivedChatFiles)if(file.row===row){releaseChatFile(file);if(file.url){URL.revokeObjectURL(file.url);chatFileUrls.delete(file.url);}receivedChatFiles.delete(key);}
  }
  function offerChatFiles(peer) {
    if(peers.get(peer.id)!==peer||peer.channel?.readyState!=='open')return;
    for(const file of chatFiles.values())if(!file.recipients.has(peer.id)&&channelSend(peer,{type:'file-offer',id:file.id,name:file.file.name,size:file.file.size}))file.recipients.add(peer.id);
  }
  function releaseChatFile(file,message='Transfer interrupted. Ask the sender to share it again.') { clearTimeout(file.timer);file.parts=[];file.active=false;file.button.textContent=message;file.button.onclick=null; }
  function receiveChatFile(peer,state) {
    if(!validChatFileId(state.id))return false;
    const key=peer.id+':'+state.id;
    if(state.type==='file-offer') {
      if(receivedChatFiles.has(key)||receivedChatFiles.size>=24||typeof state.name!=='string'||!state.name.trim()||state.name.length>180||/[\u0000-\u001f\u007f/\\]/.test(state.name)||!Number.isSafeInteger(state.size)||state.size<0||state.size>maxChatFile)return false;
      const row=chatLine('',peer.id),container=row.querySelector('.message-body'),button=document.createElement('a'),file={id:state.id,name:state.name,size:state.size,row,container,button,parts:[],bytes:0,index:0,active:false,peer};
      button.className='chat-file';button.textContent='Receive '+state.name+' ('+(state.size/1024/1024).toFixed(2)+' MiB)';button.href='#';
      button.onclick=event=>{event?.preventDefault();if(file.active)return;if(peers.get(peer.id)!==peer||peer.channel?.readyState!=='open'){releaseChatFile(file);return;}const retained=[...receivedChatFiles.values()].filter(item=>item.active||item.url);if(retained.some(item=>item.active&&item.peer===peer)){$('chatStatus').textContent='Wait for this sender’s current file to finish before receiving another.';return;}if(retained.filter(item=>item.active).length>=2||retainedChatFileBytes()+file.size>maxChatFile*2){$('chatStatus').textContent='The room holds up to 20 MiB of files and two incoming transfers at a time.';return;}if(channelSend(peer,{type:'file-request',id:file.id})){file.active=true;file.started=Date.now();file.timer=setTimeout(()=>{if(file.active)releaseChatFile(file,'Transfer timed out. Ask the sender to share it again.');},120000);button.textContent='Receiving '+file.name+'…';}else $('chatStatus').textContent='Connection busy. Try receiving the file again.';};
      row.querySelector('.message-body').append(button);receivedChatFiles.set(key,file);return true;
    }
    if(state.type==='file-request') {const file=chatFiles.get(state.id);if(!file||!file.recipients.has(peer.id)||peer.fileSending||file.requested.has(peer.id))return false;file.requested.add(peer.id);sendChatFile(peer,file);return true;}
    const file=receivedChatFiles.get(key);if(!file?.active||file.peer!==peer)return false;
    if(Date.now()-file.started>120000){releaseChatFile(file,'Transfer timed out. Ask the sender to share it again.');return false;}
    if(state.type==='file-chunk') {
      if(state.index!==file.index||typeof state.data!=='string'||state.data.length>16384||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(state.data)){releaseChatFile(file);return false;}
      const bytes=Uint8Array.from(atob(state.data),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>chatChunkBytes||file.bytes+bytes.length>file.size){releaseChatFile(file);return false;}file.parts.push(bytes);file.bytes+=bytes.length;++file.index;return true;
    }
    if(state.type==='file-end') {
      if(file.bytes!==file.size){releaseChatFile(file);return false;}clearTimeout(file.timer);const header=new Uint8Array(Math.min(32,file.bytes));let position=0;for(const part of file.parts){const count=Math.min(part.length,header.length-position);header.set(part.subarray(0,count),position);position+=count;if(position===header.length)break;}const type=chatRasterType(header);file.url=URL.createObjectURL(new Blob(file.parts,{type:type||'application/octet-stream'}));chatFileUrls.add(file.url);file.parts=[];file.active=false;file.button.textContent='Download '+file.name;file.button.href=file.url;file.button.download=file.name;file.button.onclick=null;if(type)appendChatImage(file.container,file.url,file.name);return true;
    }
    if(state.type==='file-cancel'){releaseChatFile(file);return true;}return false;
  }
  async function sendChatFile(peer,file) {
    const epoch=chatEpoch;peer.fileSending=true;
    try {
      let offset=0,index=0,started=Date.now();
      while(offset<file.file.size){
        if(epoch!==chatEpoch||peers.get(peer.id)!==peer||peer.channel?.readyState!=='open'||Date.now()-started>120000)throw Error('Transfer ended');
        if(peer.channel.bufferedAmount>32768){await new Promise(resolve=>setTimeout(resolve,25));continue;}
        const bytes=new Uint8Array(await file.file.slice(offset,offset+chatChunkBytes).arrayBuffer());if(epoch!==chatEpoch||peers.get(peer.id)!==peer)throw Error('Room changed');
        if(!channelSend(peer,{type:'file-chunk',id:file.id,index,data:btoa(String.fromCharCode(...bytes))})){await new Promise(resolve=>setTimeout(resolve,25));continue;}offset+=bytes.length;++index;
      }
      while(epoch===chatEpoch&&!channelSend(peer,{type:'file-end',id:file.id})){
        if(peers.get(peer.id)!==peer||peer.channel?.readyState!=='open'||Date.now()-started>120000)throw Error('Transfer ended');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
    }catch{if(epoch===chatEpoch)channelSend(peer,{type:'file-cancel',id:file.id});}finally{peer.fileSending=false;}
  }
  async function shareChatFile(file) {
    if(!(joined||!!chatRoom&&disconnected)||!chatRoom||!file)return;
    if(file.size>maxChatFile){$('chatStatus').textContent='Choose a file up to 10 MiB.';return;}
    if(file.name.length>180||/[\u0000-\u001f\u007f/\\]/.test(file.name)){ $('chatStatus').textContent='Choose a file with a shorter, plain filename.';return; }
    if(chatFiles.size>=3){$('chatStatus').textContent='Three files are already shared in this room. Rejoin to clear them.';return;}
    if(retainedChatFileBytes()+file.size>maxChatFile*2){$('chatStatus').textContent='The room holds up to 20 MiB of files. Rejoin to clear them.';return;}
    const epoch=chatEpoch,id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),row=chatLine('Shared '+file.name+' ('+(file.size/1024/1024).toFixed(2)+' MiB)',identity.id),entry={id,file,row,recipients:new Set(),requested:new Set()};
    chatFiles.set(id,entry);for(const peer of openChannels())offerChatFiles(peer);
    $('chatStatus').textContent=entry.recipients.size?'File shared. Participants choose Receive to download.':'File ready · waiting for participants to connect.';
    try{const type=chatRasterType(new Uint8Array(await file.slice(0,32).arrayBuffer()));if(epoch!==chatEpoch||chatFiles.get(id)!==entry||entry.previewRetired||!type)return;entry.url=URL.createObjectURL(new Blob([file],{type}));chatFileUrls.add(entry.url);appendChatImage(row.querySelector('.message-body'),entry.url,file.name);}catch{if(epoch===chatEpoch)$('chatStatus').textContent='File is shared, but its preview could not be read.';}
  }
  function bindChatMediaInputs(input) {
    input.onpaste=event=>{const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);if(files.length){event.preventDefault();for(const file of files)shareChatFile(file);}};
    input.ondragover=event=>{if([...event.dataTransfer?.types||[]].includes('Files'))event.preventDefault();};
    input.ondrop=event=>{const files=[...(event.dataTransfer?.files||[])];if(files.length){event.preventDefault();for(const file of files)shareChatFile(file);}};
  }
  function clearPeerChat(peer) { peer.chatHistoryQueue=[];if(!peers.has(peer.id)||peers.get(peer.id)===peer)for(const file of chatFiles.values()){file.recipients.delete(peer.id);file.requested.delete(peer.id);}for(const [key,file] of receivedChatFiles)if(file.peer===peer&&!file.url){releaseChatFile(file);receivedChatFiles.delete(key);} }
  function cleanProfile(value) {
    if(!value || typeof value.name!=='string' || Array.isArray(value)) return null;
    const name=value.name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').trim();
    if(!name || name.length>48 || (value.username!==undefined && typeof value.username!=='string') || (value.username && !/^[a-z0-9_.-]{3,24}$/.test(value.username))) return null;
    const avatar=typeof value.avatar==='string' && value.avatar.length<=32768 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatar) ? value.avatar : '';
    // The same validators protect saved profiles and untrusted room metadata.
    // Older clients without these validators safely omit the optional fields.
    try {
      const bio=typeof local.validateBio==='function'?local.validateBio(value.bio):'',banner=typeof local.validateBanner==='function'?local.validateBanner(value.banner):'',connections=typeof local.validateConnections==='function'?local.validateConnections(value.connections):[];
      const profile={name,username:value.username || '',avatar,bio,banner,connections};
      return encoder.encode(JSON.stringify({type:'profile',profile})).length<=65536?profile:null;
    } catch { return null; }
  }
  function showProfile(target,profile,isLocal=false) { target.heading.textContent=profile.name+(isLocal?' (you)':'');target.avatar.hidden=false;target.avatar.src=profile.avatar || fallbackAvatar(profile.name);target.placeholderAvatar.src=target.avatar.src;refreshLayout(); }
  function ownProfile() { return cleanProfile(local.profile?.() || identity); }
  function announceProfile(peer) { const profile=ownProfile();if(profile&&channelSend(peer,{type:'profile',profile}))void peer.cover?.announce(); }
  async function receiveProfile(peer,value) {
    const profile=cleanProfile(value);if(!profile) return;
    if(peers.get(peer.id)!==peer)return;
    if(peer.coverImage?.banner!==profile.banner)clearRoomCover(peer);
    peer.name=profile.name;cacheProfile(peer.id,profile);showProfile(peer.tile,profile);parentMessage({type:'vumiro-peer-profile',id:peer.id,profile});
    try { if(local.updateContactProfile) await local.updateContactProfile(peer.id,profile); } catch { /* A noncontact participant need not be saved. */ }
    if(peers.get(peer.id)===peer)await peer.cover?.profileReceived(profile.banner);
  }
  function syncSettingsControls() { $('settingFps').value=streamSettings.fps;$('settingMbps').value=streamSettings.mbps;$('settingResolution').value=streamSettings.resolution;$('settingContent').value=streamSettings.contentHint;$('settingAudio').checked=streamSettings.audio;$('settingAudio').disabled=linuxPlatform;$('settingExcludeDiscord').checked=streamSettings.excludeDiscord;$('settingExcludeDiscordLabel').hidden=false;$('settingExcludeDiscord').disabled=!nativeAudioSupported;$('excludeDiscordHelp').hidden=false;$('roomAudioCapability').hidden=nativeAudioSupported;$('roomAudioCapability').textContent=linuxPlatform?'Microphone works on Linux, but system audio capture is not supported in this release.':(nativeAudioReason||'Discord exclusion requires native audio capture on Windows build 20348 or newer. Browser-captured audio cannot filter Discord.'); }
  function videoConstraints() { const value={frameRate:{ideal:requestedFps,max:requestedFps}};if(streamSettings.resolution!=='native') { const height=Number.parseInt(streamSettings.resolution,10);value.height={max:height};value.width={max:Math.round(height*16/9)}; }return value; }
  function captureInfo() {
    const track=screen?.getVideoTracks()[0];if(!track) return;
    const actual=track.getSettings(),audioSelected=!!nativeAudioSession?.started||!!screen.getAudioTracks().length;$('captureInfo').textContent=`Capturing ${actual.width || '?'} × ${actual.height || '?'} · ${actual.frameRate ? Math.round(actual.frameRate) : '?'} FPS source · ${requestedFps} FPS requested · up to ${bitrateMbps} Mbps per participant. Screen audio ${audioSelected?(streamSettings.audio?'included':'paused'):'not selected'}.${nativeAudioSession?.started&&streamSettings.excludeDiscord?' Discord and Vumiro playback excluded.':''}`;
  }
  let settingsQueue=Promise.resolve();
  async function applySettings(value,notify=true) {
    const previous=streamSettings,clean=validateSettings(value);if(!clean)return false;if(!save(settingsKey,JSON.stringify(clean))){status('Could not save stream settings on this device.');return false;}streamSettings=clean;requestedFps=clean.fps;bitrateMbps=clean.mbps;syncSettingsControls();if(notify)parentMessage({type:'vumiro-stream-settings',settings:clean});
    settingsQueue=settingsQueue.then(async()=>{
      const track=screen?.getVideoTracks()[0];
      if(screen){if(nativeAudioSupported&&!linuxPlatform){screen.getAudioTracks().forEach(audio=>audio.stop());if(!streamSettings.audio)stopNativeAudioCapture();else if(!nativeAudioSession||previous.excludeDiscord!==streamSettings.excludeDiscord) { if(nativeAudioSession)stopNativeAudioCapture();startNativeAudioCapture(); }}else{screen.getAudioTracks().forEach(audio=>{audio.enabled=streamSettings.audio;});if(streamSettings.audio&&!screen.getAudioTracks().length)status('Screen audio was not selected. Stop sharing and choose a source with audio.');}}
      if(track) { track.contentHint=streamSettings.contentHint;try { await track.applyConstraints(videoConstraints()); } catch(error) { status('This capture could not apply every quality setting: '+(globalThis.VumiroI18n?.error(error)||error.message)); } }
      await replaceTracks();await Promise.all([...peers.values()].map(peer=>peer.slots[0] ? tune(peer.slots[0].sender) : Promise.resolve()));captureInfo();
    }).catch(error=>status((globalThis.VumiroI18n?.error(error)||error.message)));
    await settingsQueue;return true;
  }
  function roomValue(raw) { try { return new URL(raw).searchParams.get('room') || ''; } catch { return raw.trim(); } }
  const validRoom = value => /^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(value);
  const friendIds = async () => (await local.listFriends()).map(friend => friend.id).filter(id => id !== identity.id).sort();
  const blockIds = async () => (local.listBlocked?await local.listBlocked():[]).filter(id=>/^[A-Za-z0-9_-]{43}$/.test(id) && id!==identity.id).sort().slice(0,128);
  async function updateRoomFriends() {
    if(!joined || !roomNonce) return;
    const connection=socket,nonce=roomNonce,room=roomValue($('room').value),thisGeneration=generation,revision=++roomFriendsRevision,friends=await friendIds(),blockedIds=await blockIds();
    for(const id of blockedIds) removePeer(id);
    const text=authenticationVersion===2?`vumiro-room-friends-v2\n${room}\n${identity.id}\n${nonce}\n${revision}\n${friends.join(',')}\n${blockedIds.join(',')}`:`screentask-room-friends-v1\n${room}\n${identity.id}\n${nonce}\n${revision}\n${friends.join(',')}`;
    const signature=await local.sign(text);
    if(joined && socket===connection && generation===thisGeneration && nonce===roomNonce && revision===roomFriendsRevision) { send({type:'room-friends',...(authenticationVersion===2?{version:2,blockedIds}:{}),friends,revision,signature});if(authenticationVersion===2 && ownsRoom() && ownerBlocks!==blockedIds.join(',')) await updatePolicy(null,'',null); }
  }
  function passwordEntry() { if(password) return Promise.resolve(password);globalThis.VumiroRoomConnection?.set('password');$('passwordPrompt').hidden=false;$('guestPassword').focus();return new Promise(resolve=>{passwordResolve=resolve;}); }
  async function authenticateRoom(message,connection,thisGeneration) {
    const room=roomValue($('room').value),owner=ownsRoom(),challengeStarted=Date.now();
    if(message.id!==identity.id || message.room!==room || !/^[A-Za-z0-9_-]{43}$/.test(message.nonce || '')) throw Error('Invalid room identity challenge.');
    roomNonce=message.nonce;const nonce=roomNonce,friends=await friendIds(),blockedIds=await blockIds();let policy=null,revision=message.policyRevision || 0,passwordProof='';
    authenticationVersion=message.policy?2:1;if(authenticationVersion===1) { roomMode='friends';renderRoom(); }
    if(authenticationVersion===2) {
      if(owner) {
        await accessReady;
        if(roomMode==='private' && !ownerPolicy.verifier) { const value=await passwordEntry();if(generation!==thisGeneration || socket!==connection) return;if(Date.now()-challengeStarted>23000) { reconnect();return; }ownerPolicy=await privatePolicy(value);password=''; }
        else if(roomMode!=='private') ownerPolicy={mode:roomMode};
        policy=ownerPolicy;revision=1;policyRevision=1;ownerBlocks=blockedIds.join(',');
      } else {
        displayPolicy(message.policy,message.policyRevision);
        if(message.policy.mode==='private') { const value=await passwordEntry();if(generation!==thisGeneration || socket!==connection) return;if(Date.now()-challengeStarted>23000) { reconnect();return; }const derived=await passwordKey(value,message.policy.salt),key=await crypto.subtle.importKey('raw',derived,{name:'HMAC',hash:'SHA-256'},false,['sign']);passwordProof=encode64(await crypto.subtle.sign('HMAC',key,encoder.encode(`vumiro-room-password-v1\n${room}\n${identity.id}\n${nonce}\n${revision}`))); }
      }
      const signature=await local.sign(`vumiro-room-v2\n${room}\n${identity.id}\n${nonce}\n${friends.join(',')}\n${blockedIds.join(',')}\n${revision}\n${JSON.stringify(policy)}\n${passwordProof}`);
      if(generation===thisGeneration && socket===connection && nonce===roomNonce && connection.readyState===WebSocket.OPEN) connection.send(JSON.stringify({type:'room-authenticate',version:2,key:identity.key,signature,friends,blockedIds,policy,policyRevision:revision,...(passwordProof?{passwordProof}:{}),...(roomGrant && grantValue(JSON.stringify(roomGrant))?{grant:roomGrant}:{})}));
    } else {
      const signature=await local.sign(`screentask-room-v1\n${room}\n${identity.id}\n${nonce}\n${friends.join(',')}`);
      if(generation===thisGeneration && socket===connection && connection.readyState===WebSocket.OPEN) connection.send(JSON.stringify({type:'room-authenticate',key:identity.key,signature,friends,...(roomGrant && grantValue(JSON.stringify(roomGrant))?{grant:roomGrant}:{})}));
    }
  }
  function updatePolicy(mode,value,name) { const work=policyQueue.then(()=>commitPolicy(mode || roomMode,value,name===null?roomName:name));policyQueue=work.catch(()=>{});return work; }
  async function commitPolicy(mode,value,name) {
    if(!joined || !ownsRoom() || authenticationVersion!==2) throw Error('Room access can be changed by the connected owner.');
    if(!['public','friends','private'].includes(mode)) throw Error('Choose a room access mode.');
    const connection=socket,thisGeneration=generation,nonce=roomNonce,room=roomValue($('room').value),blockedIds=await blockIds();
    const policy=mode==='private'?(value?await privatePolicy(value):ownerPolicy.mode==='private' && ownerPolicy.verifier?ownerPolicy:null):{mode};
    if(!policy) throw Error('Choose a password of 6–128 characters.');
    const revision=policyRevision+1,signature=await local.sign(`vumiro-room-policy-v1\n${room}\n${identity.id}\n${nonce}\n${revision}\n${JSON.stringify(policy)}\n${blockedIds.join(',')}`);
    if(!joined || socket!==connection || generation!==thisGeneration || nonce!==roomNonce) throw Error('Reconnect before changing room access.');
    const confirmed=new Promise((resolve,reject)=>{ const timer=setTimeout(()=>{if(policyAck?.revision===revision) policyAck=null;reject(Error('Room access was not confirmed. Reconnect before trying again.'));},8000);policyAck={revision,resolve:()=>{clearTimeout(timer);policyAck=null;resolve();},reject:error=>{clearTimeout(timer);policyAck=null;reject(error);}}; });
    send({type:'room-policy',revision,policy,blockedIds,signature});await confirmed;ownerPolicy=policy;ownerBlocks=blockedIds.join(',');policyRevision=revision;roomMode=mode;roomName=name.trim().slice(0,60) || 'Your room';renderRoom();roomState();parentMessage({type:'vumiro-room-policy',room,mode:roomMode,name:roomName});
  }
  function signalUrl() {
    const url = migrateRoomHost(new URL($('signaling').value.trim()));
    if(url.protocol==='https:') url.protocol='wss:';else if(url.protocol==='http:') url.protocol='ws:';
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw Error('Use a ws:// or wss:// signaling URL.');
    if(url.protocol==='ws:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('Remote signaling requires wss://.');
    if(url.pathname==='/' || url.pathname==='/call' || url.pathname==='/call.html') url.pathname='/call-signaling';
    url.searchParams.set('room', roomValue($('room').value)); url.searchParams.set('name', $('name').value.trim().slice(0, 48) || 'Guest');
    url.searchParams.set('id', identity.id);
    return url;
  }
  function invitation() {
    const signal = signalUrl();
    const publicOrigin=(signal.protocol==='wss:'?'https:':'http:')+'//'+signal.host;
    // Invitations use the room service, never the desktop's private virtual host.
    const url = new URL('/call', publicOrigin);
    url.searchParams.set('room', roomValue($('room').value));url.searchParams.set('mode',roomMode);
    const clean = new URL(signal); clean.searchParams.delete('room'); clean.searchParams.delete('name'); clean.searchParams.delete('id');
    url.searchParams.set('signaling', clean.href); url.searchParams.set('fps', requestedFps); url.searchParams.set('mbps', bitrateMbps);
    // Grants belong to one approved identity and must never be copied into a public room link.
    return url.href;
  }
  function syncMuteControl() { const muted=!!microphone&&micMuted;$('muteLabel').textContent=muted?'Unmute mic':'Mute mic';$('mute').setAttribute('aria-pressed',String(muted));$('mute').setAttribute('aria-label',muted?'Unmute microphone':'Mute microphone');$('mute').classList.toggle('active',!muted&&!!microphone);$('muteIcon').setAttribute('href',muted?'#i-mic-off':'#i-mic'); }
  let invitationState=null;
  function renderInvitation() {
    const room=roomValue($('room').value),state=invitationState?.room===room?invitationState:null,value=embedded?state?.link||'':invitation();
    $('inviteLink').value=value;$('inviteLink').placeholder=embedded?'Getting a short invitation link…':'';$('inviteCopy').disabled=!value;
    $('inviteCode').value=state?.code||'';$('inviteCodeCopy').disabled=!state?.code;
    $('inviteHint').textContent=roomMode==='private'?'Share the room password separately.':roomMode==='public'?'Anyone with a Vumiro profile can join with this link.':'Only mutual friends can join. To invite someone new, change Room access to Public or Private.';
    if(embedded&&value)$('inviteHint').textContent+=' Link and code expire after 24 hours or when the host closes the room.';
    return value;
  }
  function receiveRoomInvitation(message) {
    const room=roomValue($('room').value);
    if(!joined||!$('inviteDialog').open||message.room!==room)return;
    if(message.action==='result'){
      $('inviteFriendsStatus').textContent=typeof message.message==='string'?message.message.slice(0,240):'Could not send the invitation.';
      for(const row of $('inviteFriends').children){const button=row.children[1];if(button?.dataset.friend===message.to){button.disabled=message.ok===true;button.textContent=message.ok?'Invited':'Invite';}}
      return;
    }
    if(message.action!=='state')return;
    let link='';try{const url=new URL(message.link),signal=signalUrl();if(url.origin===(signal.protocol==='wss:'?'https:':'http:')+'//'+signal.host&&!url.username&&!url.password&&!url.search&&!url.hash&&/^\/r\/[A-Za-z0-9_-]{12}$/.test(url.pathname))link=url.href;}catch{}
    const code=/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(message.code||'')?message.code:'';
    invitationState={room,link,code};renderInvitation();
    $('inviteCopyStatus').textContent=typeof message.error==='string'?message.error.slice(0,240):link?'Short link and room code are ready.':'';
    $('inviteFriends').replaceChildren();
    const friends=Array.isArray(message.friends)?message.friends.slice(0,100):[],seen=new Set();
    for(const friend of friends){
      if(!/^[A-Za-z0-9_-]{43}$/.test(friend?.id||'')||seen.has(friend.id)||typeof friend.name!=='string')continue;seen.add(friend.id);
      const row=document.createElement('li'),name=document.createElement('span'),button=document.createElement('button');name.textContent=friend.name.slice(0,80);button.type='button';button.textContent='Invite';button.dataset.friend=friend.id;
      button.onclick=()=>{button.disabled=true;button.textContent='Inviting…';$('inviteFriendsStatus').textContent='Sending invitation…';parentMessage({type:'vumiro-room-invite',action:'invite',room,to:friend.id});};row.append(name,button);$('inviteFriends').append(row);
    }
    $('inviteFriendsStatus').textContent=seen.size?'Send an invitation directly. Your friend can accept in Vumiro.':'No available friends online. Friends appear here when they connect.';
  }
  async function copyInvitation() {
    const value=renderInvitation();if(!value)return;
    try { await navigator.clipboard.writeText(value);$('inviteCopyStatus').textContent='Invitation link copied.'; }
    catch { $('inviteCopyStatus').textContent='Select the link and copy it with Ctrl+C, or press and hold on mobile.';$('inviteLink').focus();$('inviteLink').select(); }
  }
  function updateControls() {
    document.body.classList.toggle('in-room', joined || joining || !!localTile);
    $('join').disabled = joined || joining || !!localTile; $('leave').disabled = !joined && !joining && !localTile && !disconnected;
    for (const id of ['name', 'room', 'signaling']) $(id).disabled = joined || joining;
    $('share').disabled = !joined || !!screen; $('stopShare').disabled = !screen;
    $('mic').disabled = !joined || !!microphone || micChanging; $('mute').disabled = !microphone; $('deafen').disabled = !joined; syncMuteControl();
    $('copyInvite').disabled = !joined;
    $('reconnect').hidden=!disconnected && ![...peers.values()].some(peer=>(['failed','disconnected'].includes(peer.pc.connectionState)||peer.recovery?.needsManualReconnect()));$('reconnect').disabled=joining;chatControls();roomState();
    $('mic').hidden=!!microphone;$('mute').hidden=!microphone;$('share').hidden=!!screen;$('stopShare').hidden=!screen;renderRoom();refreshLayout();
    if(joined && $('inviteDialog').open) renderInvitation();
    if(!joined && $('inviteDialog').open) $('inviteDialog').close();
  }
  function tile(name, local) {
    const element = document.createElement('article'); element.className = 'tile';element.tabIndex=-1;element.setAttribute('role','group');element.setAttribute('aria-label','Stream from '+name);
    const header = document.createElement('header'), heading = document.createElement('h2'); heading.textContent = name + (local ? ' (you)' : '');
    const avatar=document.createElement('img');avatar.className='avatar';avatar.alt='';avatar.hidden=true;const identityBox=document.createElement('div');identityBox.className='identity';const muteBadge=document.createElement('span');muteBadge.className='remote-mute';muteBadge.hidden=true;muteBadge.setAttribute('role','status');const muteIcon=document.createElement('span'),muteLabel=document.createElement('span');muteIcon.setAttribute('aria-hidden','true');muteIcon.innerHTML='<svg class="icon"><use href="#i-mic-off"/></svg>';muteLabel.textContent='Mic off';muteBadge.append(muteIcon,muteLabel);identityBox.append(avatar,heading,muteBadge);
    const selectButton=document.createElement('button');selectButton.type='button';selectButton.className='tile-select';selectButton.textContent='Select';selectButton.setAttribute('aria-label','Show controls for '+name);selectButton.setAttribute('aria-pressed','false');identityBox.append(selectButton);
    const tools = document.createElement('div'), view = document.createElement('select'); view.setAttribute('aria-label', 'View ' + name);
    for (const [value, label] of [['fit','Fit'],['actual','Actual size']]) { const option = document.createElement('option'); option.value=value; option.textContent=label; view.append(option); }
    const full = document.createElement('button'); full.className='fullscreen-button';full.title='Fullscreen';full.setAttribute('aria-label','Fullscreen '+name);const fullIcon=document.createElement('span');fullIcon.setAttribute('aria-hidden','true');fullIcon.innerHTML='<svg class="icon"><use href="#i-fullscreen"/></svg>';const fullLabel=document.createElement('span');fullLabel.textContent='Fullscreen';full.append(fullIcon,fullLabel);tools.append(view, full); header.append(identityBox, tools);
    const stage = document.createElement('div'); stage.className='stage';
    const video = document.createElement('video'); video.autoplay=true; video.playsInline=true; video.muted=true;
    const placeholder=document.createElement('div'); placeholder.className='placeholder'; const placeholderAvatar=document.createElement('img'),placeholderLabel=document.createElement('small');placeholderAvatar.className='placeholder-avatar';placeholderAvatar.alt='';placeholderAvatar.src=fallbackAvatar(name);placeholderLabel.textContent='Here with you · not sharing a screen';placeholder.append(placeholderAvatar,placeholderLabel);
    const stats=document.createElement('div'); stats.className='stats'; stats.textContent=local?'Your screen preview':'Waiting for direct connection…';
    stage.append(video,placeholder); element.append(header,stage,stats); $('tiles').append(element);
    view.onchange = () => { stage.classList.toggle('actual', view.value === 'actual'); resize(); };
    function resize() { if (view.value==='actual') { video.style.width=video.videoWidth+'px'; video.style.height=video.videoHeight+'px'; } else { video.style.width='';video.style.height=''; } }
    async function fullscreen() { if(!result.sharing)return;try { if(document.fullscreenElement) await document.exitFullscreen();else await stage.requestFullscreen(); } catch(error) { status('Fullscreen: '+(globalThis.VumiroI18n?.error(error)||error.message)); } }
    video.onresize=()=>{resize();mosaic.replan();};full.onclick=fullscreen;stage.ondblclick=event=>{ event.preventDefault();fullscreen(); };
    const result={element,video,stats,placeholder,heading,avatar,placeholderAvatar,muteBadge,selectButton,audios:[],sharing:false,micMuted:null};
    if(!local) {
      const toggle=document.createElement('button');toggle.type='button';toggle.className='audio-controls-toggle';toggle.textContent='Audio';toggle.setAttribute('aria-label','Show playback controls for '+name);toggle.setAttribute('aria-expanded','false');tools.append(toggle);const controls=document.createElement('div');controls.className='audio-controls';controls.setAttribute('aria-label','Playback volume for '+name);toggle.onclick=event=>{event.stopPropagation();const shown=element.classList.toggle('audio-visible');toggle.setAttribute('aria-expanded',String(shown));toggle.setAttribute('aria-label',(shown?'Hide':'Show')+' playback controls for '+name);};
      const slots=new Map();
      for(const [slot,label] of [[1,'Screen'],[2,'Voice']]) {
        const row=document.createElement('label'),text=document.createElement('span'),slider=document.createElement('input'),level=document.createElement('output');
        text.textContent=label;slider.type='range';slider.min='0';slider.max='400';slider.step='1';slider.value='100';slider.disabled=true;slider.setAttribute('aria-label',label+' volume for '+name);slider.setAttribute('aria-valuetext','100 percent');level.textContent='100%';
        row.append(text,slider,level);controls.append(row);slots.set(slot,{slider,level,audio:null});
        slider.oninput=()=>{ const value=Math.min(400,Math.max(0,Number(slider.value)||0));slider.value=String(value);level.textContent=value+'%';slider.setAttribute('aria-valuetext',value===0?'Muted':value+' percent');const audio=slots.get(slot).audio;if(voice)voice.refreshPlayback();else if(audio){audio.volume=Math.min(1,value/100);audio.muted=value===0;} };
      }
      controls.onclick=event=>event.stopPropagation();controls.ondblclick=event=>event.stopPropagation();stage.append(controls);
      result.attachAudio=(slot,track)=>{
        const control=slots.get(slot);if(!control) return;
        let audio=control.audio;
        if(!audio) { audio=document.createElement('audio');audio.autoplay=false;control.audio=audio;element.append(audio);result.audios.push(audio); }
        control.track=track;audio.srcObject=new MediaStream([track]);const ready=voice?voice.registerPlayback(audio,()=>Number(control.slider.value)/100):null;if(!voice){audio.volume=Math.min(1,Number(control.slider.value)/100);audio.muted=audio.volume===0;}
        const available=()=>{ if(control.track!==track)return;control.slider.disabled=track.readyState==='ended'||track.muted;control.slider.title=control.slider.disabled?'Waiting for '+(slot===1?'screen audio':'voice'):'0% mutes; 100% is original volume; up to 400% boosts quiet audio (may distort)'; };
        track.onunmute=available;track.onmute=available;track.onended=available;available();if(ready)ready.then(()=>{if(control.track===track)play(audio);}).catch(()=>{});else play(audio);
      };
    }
    result.show = sharing => { result.sharing=sharing; placeholder.hidden=sharing; video.style.visibility=sharing?'visible':'hidden';refreshLayout(); };
    function selectTile(){const found=[...peers.values()].find(peer=>peer.tile===result);focusedId=found?.id || selfId || identity?.id || '';manualFocus=true;refreshLayout();}
    selectButton.onclick=event=>{event.stopPropagation();selectTile();};
    element.onclick=event=>{if(!event.target.closest('button,select,input,.audio-controls'))selectTile();};
    result.show(false);return result;
  }
  function play(element) { const promise=element.play(); if(promise) promise.catch(()=>{ $('enableAudio').hidden=false; }); }
  function send(message) { if(socket && socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  const relay = candidate => candidate && /\btyp\s+relay\b/i.test(typeof candidate==='string'?candidate:candidate.candidate || '');
  function validDescription(description) { return description && ['offer','answer'].includes(description.type) && typeof description.sdp==='string' && description.sdp.length<=60000 && !relay(description.sdp); }
  function currentTrack(slot) { return slot===0 ? screen?.getVideoTracks()[0] : slot===1 ? (nativeAudioSupported&&!linuxPlatform?(nativeAudioSession?.started?nativeAudioTrack:null):screen?.getAudioTracks()[0]) : microphone?.getAudioTracks()[0]; }
  async function ensureNativeAudioGraph(){if(!audioContext||audioContext.state==='closed'){const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw Error('This browser cannot play the native audio stream.');audioContext=new Context({latencyHint:'interactive'});audioContext.onstatechange=()=>diagnostic('audio-context-state',{state:audioContext?.state,sampleRate:audioContext?.sampleRate});audioDestination=audioContext.createMediaStreamDestination();nativeAudioTrack=audioDestination.stream.getAudioTracks()[0];}if(audioContext.state!=='running')await audioContext.resume();return audioContext;}
  function stopNativeAudioCapture(notify=true) {
    const session=nativeAudioSession;if(!session)return;nativeAudioSession=null;++nativeAudioGeneration;
    if(nativeAudioTrack)safeCleanup(()=>{nativeAudioTrack.enabled=false;});
    for(const source of session.sources){safeCleanup(()=>source.stop());safeCleanup(()=>source.disconnect());}
    session.sources.clear();
    if(notify&&embedded)safeCleanup(()=>parentMessage({type:'vumiro-stream-audio',action:'stop',id:session.id}));
  }
  function startNativeAudioCapture(){if(linuxPlatform||!nativeAudioSupported||!embedded||!screen||!streamSettings.audio||nativeAudioSession)return;const session={id:Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join(''),generation:++nativeAudioGeneration,started:false,lastSequence:-1,nextTime:0,sources:new Set()};nativeAudioSession=session;ensureNativeAudioGraph().then(()=>{if(nativeAudioSession!==session||!screen||!streamSettings.audio)return;nativeAudioTrack.enabled=true;parentMessage({type:'vumiro-stream-audio',action:'start',id:session.id,excludeDiscord:streamSettings.excludeDiscord});}).catch(error=>{if(nativeAudioSession!==session)return;nativeAudioSession=null;status('System audio could not start: '+(globalThis.VumiroI18n?.error(error)||error.message));replaceTracks().catch(()=>{});captureInfo();});}
  function playNativeAudio(message){const session=nativeAudioSession;if(!session||session.id!==message.id||!session.started||!screen||!streamSettings.audio||message.sampleRate!==48000||message.channels!==2||message.frames!==1920||!(message.pcm instanceof ArrayBuffer)||message.pcm.byteLength!==message.frames*message.channels*4||!Number.isSafeInteger(message.sequence)||message.sequence<=session.lastSequence)return;session.lastSequence=message.sequence;if(!audioContext||audioContext.state!=='running'||session.sources.size>=5)return;const now=audioContext.currentTime;if(!session.nextTime||session.nextTime<now+0.004)session.nextTime=now+0.06;if(session.nextTime-now>0.22)return;const samples=new Float32Array(message.pcm),buffer=audioContext.createBuffer(2,message.frames,message.sampleRate),left=buffer.getChannelData(0),right=buffer.getChannelData(1);for(let i=0,j=0;i<message.frames;i++,j+=2){left[i]=samples[j];right[i]=samples[j+1];}const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioDestination);session.sources.add(source);source.onended=()=>{session.sources.delete(source);try{source.disconnect();}catch{}};source.start(session.nextTime);session.nextTime+=message.frames/message.sampleRate;}
  function receiveNativeAudio(message){if(['state','started','warning','error'].includes(message.action)){const code=/0x([0-9a-f]{8})/i.exec(typeof message.message==='string'?message.message:'');diagnostic('native-audio-'+message.action,{source:'native',supported:message.supported,code:code?parseInt(code[1],16):undefined});}if(message.action==='state'){nativeAudioSupported=message.supported===true;nativeAudioReason=typeof message.reason==='string'?message.reason:'';syncSettingsControls();if(nativeAudioSupported&&screen){screen.getAudioTracks().forEach(track=>track.stop());if(streamSettings.audio)startNativeAudioCapture();}else if(!nativeAudioSupported&&nativeAudioSession){stopNativeAudioCapture();replaceTracks().catch(()=>{});}return;}const session=nativeAudioSession;if(!session||message.id!==session.id)return;if(message.action==='started'){if(message.sampleRate!==48000||message.channels!==2)return;session.started=true;session.nextTime=0;if(nativeAudioTrack)nativeAudioTrack.enabled=streamSettings.audio;replaceTracks().then(captureInfo).catch(error=>status((globalThis.VumiroI18n?.error(error)||error.message)));}else if(message.action==='stopped'){session.started=false;}else if(message.action==='warning'){status(typeof message.message==='string'?message.message:'An application audio source is unavailable. Screen sharing continues.');}else if(message.action==='error'){stopNativeAudioCapture(false);replaceTracks().catch(()=>{});status(typeof message.message==='string'?message.message:'System audio capture stopped. Your microphone is still available.');captureInfo();}else if(message.action==='samples')playNativeAudio(message);}
  function announce(peer) { channelSend(peer,{sharing:!!screen,mic:!!microphone && microphone.getAudioTracks().some(t=>t.enabled),micMuted:!microphone||micMuted||micSuppressed}); }
  async function tune(sender) {
    if(sender.track?.kind!=='video') return;
    const parameters=sender.getParameters(); if(!parameters.encodings?.length) parameters.encodings=[{}];
    for(const encoding of parameters.encodings) { encoding.maxBitrate=bitrateMbps*1000000; encoding.maxFramerate=requestedFps; encoding.scaleResolutionDownBy=1; }
    parameters.degradationPreference=streamSettings.contentHint==='motion'?'maintain-framerate':'maintain-resolution';
    try { await sender.setParameters(parameters); } catch {
      // Some engines reject degradationPreference but support the actual bitrate/FPS constraints.
      delete parameters.degradationPreference;
      try { await sender.setParameters(parameters); } catch { /* Browser retains its negotiated parameters. */ }
    }
  }
  function clearRoomCover(peer) { if(peer.coverImage){URL.revokeObjectURL(peer.coverImage.url);peer.coverImage=null;} }
  function dataChannel(peer, channel) {
    if(peer.channel && peer.channel!==channel) { channel.close();return; }
    peer.channel=channel;peer.dataWindow=Date.now();peer.dataCount=0;peer.chatHistoryReceived=0;peer.chatPending=0;peer.chatQueue=Promise.resolve();peer.fileWindow=Date.now();peer.fileCount=0;
    peer.cover?.dispose();peer.coverQueue=Promise.resolve();peer.coverQueued=0;
    peer.cover=window.VumiroCoverTransfer?.create({local,own:()=>local.profile?.()||identity,remoteId:peer.id,send:value=>channelSend(peer,value),active:()=>peers.get(peer.id)===peer&&channel.readyState==='open',buffered:()=>channel.bufferedAmount+(peer.fileSending?65536:0),onCover:(manifest,blob,banner)=>{if(peers.get(peer.id)!==peer||profileCache.get(peer.id)?.banner!==banner)return;clearRoomCover(peer);peer.coverImage={url:URL.createObjectURL(blob),banner,digest:manifest.digest};if(profileViewingId===peer.id&&$('profilePopover').open)renderParticipantCard(profileCache.get(peer.id),false);}});
    channel.bufferedAmountLowThreshold=32768;channel.onbufferedamountlow=()=>flushChatHistory(peer);
    channel.onopen=()=>{ if(peers.get(peer.id)!==peer)return;peer.cover?.start();announce(peer);announceProfile(peer);channelSend(peer,{type:'chat-ready',version:2});chatControls();chatLine(peer.name+' connected to direct chat.'); };
    channel.onclose=()=>{ if(peers.get(peer.id)!==peer)return;peer.cover?.dispose();clearRoomCover(peer);clearPeerChat(peer);chatControls();chatLine(peer.name+' disconnected from direct chat.'); };
    channel.onerror=()=>chatControls();
    channel.onmessage=event=>{
      if(typeof event.data!=='string' || event.data.length>65536 || encoder.encode(event.data).length>65536 || peers.get(peer.id)!==peer) return;
      const now=Date.now();
      try {
        const state=JSON.parse(event.data);
        if(!state || typeof state!=='object') return;
        if(typeof state.type==='string'&&state.type.startsWith('cover-')){if(peer.coverQueued>=100)return;peer.coverQueued++;peer.coverQueue=peer.coverQueue.then(()=>{if(peers.get(peer.id)===peer)peer.cover?.receive(state);}).catch(()=>{}).finally(()=>{peer.coverQueued--;});return;}
        if(typeof state.type==='string'&&state.type.startsWith('file-')){if(now-peer.fileWindow>10000){peer.fileWindow=now;peer.fileCount=0;}if(++peer.fileCount>1200)return;receiveChatFile(peer,state);return;}
        if(state.type==='chat'||state.type==='chat-history') {
          const history=state.type==='chat-history',message=history?state.message:state;
          if(history&&++peer.chatHistoryReceived>100)return;
          if(peer.chatPending>=120)return;
          ++peer.chatPending;const epoch=chatEpoch;peer.chatQueue=peer.chatQueue.then(()=>{if(epoch===chatEpoch&&peers.get(peer.id)===peer)return acceptRoomChat(peer,message,history);}).catch(()=>{}).finally(()=>{--peer.chatPending;});
          return;
        }
        if(now-peer.dataWindow>10000) { peer.dataWindow=now;peer.dataCount=0; }if(++peer.dataCount>240) return;
        if(state.type==='chat-ready'&&state.version===2){if(!peer.chatReady){peer.chatReady=true;queueChatHistory(peer);}return;}
        if(state.type==='profile') {
          if(!peer.profileWindow || now-peer.profileWindow>10000) { peer.profileWindow=now;peer.profileCount=0; }if(++peer.profileCount<=10){peer.coverQueue=peer.coverQueue.then(()=>receiveProfile(peer,state.profile)).catch(()=>{});}
        } else {if(typeof state.micMuted==='boolean'){peer.tile.micMuted=state.micMuted;peer.tile.muteBadge.hidden=!state.micMuted;refreshLayout();}if(typeof state.sharing==='boolean')peer.tile.show(state.sharing);}
      } catch { /* Ignore malformed direct metadata. */ }
    };
  }
  // One bounded recovery cycle per outage. ICE restart reuses authorized tracks
  // and the existing perfect-negotiation path; it never requests new capture.
  function createPeerRecovery(pc, isCurrent, report) {
    let timer = null, attempts = 0, disposed = false, exhausted = false;
    const cancel = () => { if(timer !== null) clearTimeout(timer); timer = null; };
    const current = () => !disposed && isCurrent() && pc.signalingState !== 'closed' && pc.connectionState !== 'closed';
    const failed = () => pc.connectionState === 'failed' || pc.iceConnectionState === 'failed';
    const connected = () => pc.connectionState === 'connected' && !['failed','disconnected','checking'].includes(pc.iceConnectionState);
    function finish() {
      cancel(); exhausted = true;
      report('Direct connection could not recover. Use Reconnect to try again. Some networks need a relay, which Vumiro does not use.');
    }
    function attempt() {
      timer = null;
      if(!current()) return;
      if(connected()) { attempts = 0; exhausted = false; return; }
      if(attempts >= 3 || typeof pc.restartIce !== 'function') { finish(); return; }
      ++attempts;
      report('Reconnecting direct connection (' + attempts + '/3). Your capture and mute settings are unchanged.');
      // Arm the watchdog before restartIce: browser state callbacks may run
      // immediately. Checking/connecting cannot leave an unbounded spinner.
      timer = setTimeout(attempt, 10000);
      try { pc.restartIce(); } catch { finish(); }
    }
    return {
      update() {
        if(!current()) { cancel(); return; }
        if(connected()) { cancel(); attempts = 0; exhausted = false; return; }
        if(exhausted) { finish(); return; }
        if(timer !== null) return;
        if(failed()) timer = setTimeout(attempt, 0);
        else if(pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
          report('Connection interrupted. Waiting briefly for the network to recover.');
          timer = setTimeout(attempt, 4000);
        }
      },
      needsManualReconnect() { return exhausted; },
      dispose() { disposed = true; cancel(); }
    };
  }
  function peerError(peer, error) { if(peers.get(peer.id)===peer) { peer.tile.stats.textContent='Connection issue: '+(globalThis.VumiroI18n?.error(error)||error.message); } }
  function createPeer(id, name) {
    if(typeof id!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(id) || id===selfId) return null;
    if(peers.has(id)) return peers.get(id);
    name=typeof name==='string'?name.slice(0,48):'Guest';
    if(peers.size>=7) return null;
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],bundlePolicy:'max-bundle'});
    const peer={id,name:name || 'Guest',pc,tile:tile(name || 'Guest',false),polite:selfId.localeCompare(id)>0,initiator:selfId.localeCompare(id)<0,makingOffer:false,ignoreOffer:false,settingAnswer:false,pending:[],queue:Promise.resolve(),lastStats:null,channel:null};
    const peerGeneration=generation;
    peer.isCurrent=()=>peers.get(id)===peer && generation===peerGeneration && joined && socket?.readyState===WebSocket.OPEN;
    peer.recovery=createPeerRecovery(pc,peer.isCurrent,message=>{peer.tile.stats.textContent=message;updateControls();});
    pc.oniceconnectionstatechange=()=>{if(!peer.isCurrent())return;peer.recovery.update();updateControls();};
    peers.set(id,peer);const cached=profileCache.get(id);if(cached) showProfile(peer.tile,cached);else local.listFriends().then(friends=>{ const friend=friends.find(item=>item.id===id);if(friend && !profileCache.has(id)) { const profile=cleanProfile(friend);if(profile) { cacheProfile(id,profile);if(peers.get(id)===peer) showProfile(peer.tile,profile); } } }).catch(()=>{});refreshLayout();
    // Only the initial offerer creates transceivers. Pre-creating them on the answerer
    // can duplicate media sections during rollback, leaving stale ICE generations.
    peer.slots=peer.initiator ? ['video','audio','audio'].map((kind,index)=>pc.addTransceiver(currentTrack(index) || kind,{direction:'sendrecv'})) : [];
    // Ordered, reliable direct channel carries bounded display state, profiles and room chat.
    if(peer.initiator) dataChannel(peer,pc.createDataChannel('room-state'));
    pc.ondatachannel=event=>{if(!peer.isCurrent()){safeCleanup(()=>event.channel.close());return;}dataChannel(peer,event.channel);};
    pc.ontrack=event=>{
      if(!peer.isCurrent()) return;
      const index=pc.getTransceivers().indexOf(event.transceiver), track=event.track;
      try {
        if('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget=50;
        else if('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint=0.05;
      } catch { /* Optional browser latency controls. */ }
      if(track.kind==='video') { peer.tile.video.srcObject=new MediaStream([track]); play(peer.tile.video); track.onunmute=()=>{ if(!peer.isCurrent())return;if(!peer.channel || peer.channel.readyState!=='open') peer.tile.show(true); }; }
      else peer.tile.attachAudio(index,track);
      if(track.kind==='video') track.onended=()=>{if(peer.isCurrent())peer.tile.show(false);};
    };
    pc.onicecandidate=event=>{ if(peer.isCurrent() && !relay(event.candidate)) send({type:'signal',to:id,candidate:event.candidate?.toJSON() ?? null}); };
    pc.onnegotiationneeded=()=>{
      peer.queue=peer.queue.then(async()=>{
        if(!peer.isCurrent() || pc.signalingState!=='stable' || (!pc.remoteDescription && !peer.initiator)) return;
        try { peer.makingOffer=true; await pc.setLocalDescription(); if(peer.isCurrent()) send({type:'signal',to:id,description:pc.localDescription}); }
        finally { peer.makingOffer=false; }
      }).catch(error=>peerError(peer,error));
    };
    pc.onconnectionstatechange=()=>{
      if(peer.isCurrent && !peer.isCurrent()) return;
      diagnostic('peer-state',{connectionState:pc.connectionState,iceConnectionState:pc.iceConnectionState,signalingState:pc.signalingState,peers:peers.size});
      if(['disconnected','failed','closed'].includes(pc.connectionState)){peer.tile.micMuted=null;peer.tile.muteBadge.hidden=true;refreshLayout();}
      updateControls();
      if(pc.connectionState==='connected') { peer.tile.stats.textContent='Direct connected · measuring video…'; for(const transceiver of peer.slots) tune(transceiver.sender); announce(peer); }
      peer.recovery?.update();
      updateControls();
    };
    return peer;
  }
  function receiveSignal(message) {
    const peer=peers.get(message.from); if(!peer) return;
    peer.queue=peer.queue.then(async()=>{
      const pc=peer.pc; if(!peer.isCurrent() || pc.signalingState==='closed') return;
      if(message.description) {
        const description=message.description; if(!validDescription(description)) throw Error('Invalid direct connection offer.');
        const ready=!peer.makingOffer && (pc.signalingState==='stable' || peer.settingAnswer);
        const collision=description.type==='offer' && !ready;
        peer.ignoreOffer=!peer.polite && collision; if(peer.ignoreOffer) return;
        peer.settingAnswer=description.type==='answer';
        try { await pc.setRemoteDescription(description); } finally { peer.settingAnswer=false; }
        if(!peer.isCurrent()) return;
        if(!peer.slots.length) {
          peer.slots=pc.getTransceivers().slice(0,3);
          for(let slot=0;slot<peer.slots.length;slot++) {
            peer.slots[slot].direction='sendrecv';
            await peer.slots[slot].sender.replaceTrack(currentTrack(slot) || null);
          }
        }
        for(const candidate of peer.pending.splice(0)) { if(!peer.isCurrent()) return; await pc.addIceCandidate(candidate); }
        if(description.type==='offer' && peer.isCurrent()) { await pc.setLocalDescription();if(peer.isCurrent()) send({type:'signal',to:peer.id,description:pc.localDescription}); }
      } else if('candidate' in message) {
        if(peer.ignoreOffer || relay(message.candidate)) return;
        if(pc.remoteDescription) await pc.addIceCandidate(message.candidate); else if(peer.pending.length<256) peer.pending.push(message.candidate);
      }
    }).catch(error=>peerError(peer,error));
  }
  // Resource cleanup is deliberately independent: one browser/device failure
  // must not keep unrelated capture or playback alive during departure.
  function safeCleanup(action) { try { action(); } catch { /* Continue releasing remaining resources. */ } }
  function stopCaptureTracks(stream) {
    if(!stream) return;
    for(const track of stream.getTracks()) {
      safeCleanup(()=>{track.onended=null;track.onunmute=null;track.enabled=false;});
      safeCleanup(()=>track.stop());
    }
  }
  function releaseRoomResources() {
    generation++;++microphoneEpoch;joined=false;joining=false;disconnected=false;
    safeCleanup(()=>globalThis.VumiroRoomConnection?.set('idle'));
    const captures=new Set([screen,microphone,...changingMicrophones]);
    screen=null;microphone=null;micChanging=false;micSuppressed=true;changingMicrophones.clear();
    // Stop local capture first, before any socket, peer, UI or audio cleanup.
    for(const capture of captures) safeCleanup(()=>stopCaptureTracks(capture));
    safeCleanup(()=>stopNativeAudioCapture());
    clearTimeout(reconnectTimer);reconnectTimer=0;
    const old=socket;socket=null;if(old)safeCleanup(()=>old.close(1000,'Left room'));
    clearPeers();
    safeCleanup(()=>voice?.stopTest());safeCleanup(()=>voice?.setDeafened(false));micSuppressed=false;
    const context=audioContext;audioContext=null;audioDestination=null;nativeAudioTrack=null;
    if(context)safeCleanup(()=>context.close().catch(()=>{}));
    if(localTile)safeCleanup(()=>localTile.element.remove());localTile=null;selfId='';
  }
  function removePeer(id) {
    const peer=peers.get(id);if(!peer)return;peers.delete(id);safeCleanup(()=>peer.cover?.dispose());safeCleanup(()=>clearRoomCover(peer));safeCleanup(()=>peer.recovery?.dispose());
    for(const name of ['ontrack','onicecandidate','onnegotiationneeded','onconnectionstatechange','oniceconnectionstatechange','ondatachannel'])safeCleanup(()=>{peer.pc[name]=null;});
    if(peer.channel) {
      for(const name of ['onopen','onclose','onerror','onmessage','onbufferedamountlow'])safeCleanup(()=>{peer.channel[name]=null;});
      safeCleanup(()=>peer.channel.close());
    }
    safeCleanup(()=>clearPeerChat(peer));
    for(const media of [peer.tile.video,...peer.tile.audios]) {
      if(!media)continue;
      safeCleanup(()=>voice?.forgetPlayback(media));
      safeCleanup(()=>stopCaptureTracks(media.srcObject));
      safeCleanup(()=>media.pause());safeCleanup(()=>{media.srcObject=null;});
    }
    safeCleanup(()=>peer.pc.close());safeCleanup(()=>peer.tile.element.remove());
    safeCleanup(()=>chatControls());safeCleanup(()=>refreshLayout());
  }
  function clearPeers() { for(const id of [...peers.keys()]) safeCleanup(()=>removePeer(id)); }
  async function replaceTracks() {
    await Promise.all([...peers.values()].map(async peer=>{
      try {
        for(let slot=0;slot<peer.slots.length;slot++) {
          if(peers.get(peer.id)!==peer || peer.pc.signalingState==='closed')return;
          await peer.slots[slot].sender.replaceTrack(currentTrack(slot) || null);
        }
        if(peers.get(peer.id)!==peer || peer.pc.signalingState==='closed')return;
        if(peer.slots[0])await tune(peer.slots[0].sender);
        if(peers.get(peer.id)===peer && peer.pc.signalingState!=='closed')announce(peer);
      } catch(error) {
        // A removed peer is not a failed microphone change for everyone else.
        if(peers.get(peer.id)===peer && peer.pc.signalingState!=='closed')throw error;
      }
    }));
  }
  async function stopShare() {
    const previous=screen; screen=null; if(previous){diagnostic('capture-stopped');status('Stopping screen share…');} safeCleanup(()=>stopCaptureTracks(previous));safeCleanup(()=>stopNativeAudioCapture());
    if(localTile) { localTile.show(false); localTile.video.srcObject=null; }
    try { await replaceTracks(); } catch(error) { status((globalThis.VumiroI18n?.error(error)||error.message)); }
    if(audioContext?.state==='running')audioContext.suspend().catch(()=>{});
    if(previous)status('Screen sharing stopped.');updateControls();
  }
  async function share() {
    diagnostic('capture-requested',{audio:streamSettings.audio,excludeDiscord:streamSettings.excludeDiscord,supported:nativeAudioSupported});
    $('share').disabled=true;status('Starting screen share…'); const thisGeneration=generation;
    try {
      const nativeWanted=nativeAudioSupported&&!linuxPlatform&&streamSettings.audio;if(embedded&&!linuxPlatform&&streamSettings.audio)ensureNativeAudioGraph().catch(error=>status('System audio could not start: '+(globalThis.VumiroI18n?.error(error)||error.message)));
      const options={video:videoConstraints(),audio:streamSettings.audio&&!nativeWanted};if(streamSettings.audio&&!nativeWanted&&!linuxPlatform)options.systemAudio='include';
      const capture=await navigator.mediaDevices.getDisplayMedia(options);
      if(!joined || generation!==thisGeneration) { capture.getTracks().forEach(t=>t.stop()); return; }
      const track=capture.getVideoTracks()[0]; if(!track) { capture.getTracks().forEach(t=>t.stop()); throw Error('No screen video was selected.'); }
      track.contentHint=streamSettings.contentHint; screen=capture;const actual=track.getSettings();diagnostic('capture-started',{width:actual.width,height:actual.height,frameRate:actual.frameRate,audioTracks:capture.getAudioTracks().length,videoTracks:capture.getVideoTracks().length});track.onended=()=>{diagnostic('capture-ended');if(screen===capture) stopShare();};
      if(nativeAudioSupported&&streamSettings.audio)startNativeAudioCapture();
      localTile.video.srcObject=new MediaStream([track]);localTile.show(true);play(localTile.video);
      await replaceTracks();
      captureInfo();
      status('Sharing your screen. Everyone can share at the same time.');
    } catch(error) { diagnostic('capture-error',{name:error.name});status(error.name==='NotAllowedError'?'Screen sharing was cancelled or denied.':(globalThis.VumiroI18n?.error(error)||error.message)); }
    finally { if(!screen&&audioContext?.state==='running')audioContext.suspend().catch(()=>{});updateControls(); }
  }
  function gateMicrophone(suppressed) {
    micSuppressed = suppressed;
    for (const stream of new Set([microphone,...changingMicrophones])) for (const track of stream?.getAudioTracks() || []) track.enabled = !micMuted && !micSuppressed;
    syncMuteControl(); for (const peer of peers.values()) announce(peer);
  }
  async function replaceMicrophone(value) {
    const epoch = ++microphoneEpoch, thisGeneration = generation, previous = microphone;
    micChanging = true; updateControls(); let capture;
    try {
      capture = await navigator.mediaDevices.getUserMedia(voice ? voice.constraints(value) : {audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if (!joined || generation !== thisGeneration || epoch !== microphoneEpoch) throw Error('Microphone change cancelled because the room changed.');
      for (const track of capture.getAudioTracks()) track.enabled = !micMuted && !micSuppressed;
      if(previous)changingMicrophones.add(previous);
      microphone = capture;
      try { await replaceTracks(); }
      catch (error) {
        // Keep the old capture alive until all sender replacements have succeeded.
        if (microphone === capture) microphone = previous?.getAudioTracks().some(track=>track.readyState==='live')&&joined&&generation===thisGeneration?previous:null;
        gateMicrophone(micSuppressed);
        await replaceTracks().catch(() => {}); throw error;
      }
      if (!joined || generation !== thisGeneration || epoch !== microphoneEpoch) { if (microphone === capture) microphone = null; throw Error('Microphone change cancelled because the room changed.'); }
      for (const track of capture.getAudioTracks()) track.onended = () => {
        if (microphone !== capture) return; microphone = null; ++microphoneEpoch;
        replaceTracks().catch(error => status((globalThis.VumiroI18n?.error(error)||error.message))); updateControls(); status('Microphone disconnected. Choose an available microphone in Voice & audio.');
      };
      previous?.getTracks().forEach(track => track.stop());
    } catch (error) { capture?.getTracks().forEach(track => track.stop());if(!joined||generation!==thisGeneration){previous?.getTracks().forEach(track=>track.stop());if(microphone===capture)microphone=null;}throw error; }
    finally { changingMicrophones.delete(previous);if(epoch===microphoneEpoch)micChanging = false; updateControls(); }
  }
  async function applyVoiceSettings(next, previous) {
    const changed = ['inputId','echoCancellation','noiseSuppression','autoGainControl'].some(name => next[name] !== previous[name]);
    if (!changed) return;
    if (microphone) await replaceMicrophone(next);
    else if (micChanging) { ++microphoneEpoch;micChanging=false;updateControls(); } // Cancel a capture requested with stale preferences.
  }
  async function enableMic() {
    if (!joined || microphone || micChanging) return;
    micMuted = false;
    try { await replaceMicrophone(voice?.snapshot()); status('Microphone enabled.'); }
    catch (error) { status('Microphone: ' + (globalThis.VumiroI18n?.error(error)||error.message)); }
  }
  function openSocket() {
    const thisGeneration=generation; roomNonce=''; roomFriendsRevision=0; joining=true;updateControls();
    globalThis.VumiroRoomConnection?.set(disconnected?'reconnecting':'joining');
    let connection; try { connection=new WebSocket(signalUrl()); } catch(error) { joining=false;status((globalThis.VumiroI18n?.error(error)||error.message));globalThis.VumiroRoomConnection?.set('error',(globalThis.VumiroI18n?.error(error)||error.message));updateControls();return; }
    socket=connection;
    connection.onmessage=async event=>{
      if(generation!==thisGeneration || socket!==connection || typeof event.data!=='string' || event.data.length>65536) return;
      try {
        const message=JSON.parse(event.data);
        if(message.type==='room-challenge') {
          clock?.sync(message.serverTime);
          await authenticateRoom(message,connection,thisGeneration);
        } else if(message.type==='welcome') {
          if(message.id!==identity.id) throw Error('Room identity does not match your local profile.');
          selfId=message.id;joined=true;joining=false;retry=0;disconnected=false;$('passwordPrompt').hidden=true;$('passwordError').textContent='';if(message.policy) displayPolicy(message.policy,message.policyRevision);if(ownsRoom()) parentMessage({type:'vumiro-room-policy',room:roomValue($('room').value),mode:roomMode,name:roomName});chatLine('Joined the room. Chat is sent directly to connected participants.');
          globalThis.VumiroRoomConnection?.set('connected');
          if(!localTile) localTile=tile($('name').value.trim() || 'Guest',true);
          const profile=ownProfile();if(profile) { cacheProfile(identity.id,profile);showProfile(localTile,profile,true); }
          if(screen) { localTile.video.srcObject=new MediaStream(screen.getVideoTracks());localTile.show(true);play(localTile.video); }
          for(const peer of message.peers || []) createPeer(peer.id,peer.name);
          status('In the room · '+(peers.size+1)+' participant'+(peers.size?'s':'')+'.');updateControls();
          updateRoomFriends().catch(error=>status((globalThis.VumiroI18n?.error(error)||error.message)));
        } else if(message.type==='peer-joined' && joined) { const existed=peers.has(message.id);createPeer(message.id,message.name);if(!existed&&peers.has(message.id))playCallCue('join');status('A participant joined · '+(peers.size+1)+' in the room.'); }
        else if(message.type==='peer-left') { const existed=peers.has(message.id);removePeer(message.id);if(existed)playCallCue('leave');status('A participant left · '+(peers.size+1)+' in the room.'); }
        else if(message.type==='room-policy' && joined) { displayPolicy(message.policy,message.policyRevision);if(policyAck?.revision===message.policyRevision) policyAck.resolve();roomState(); }
        else if(message.type==='signal' && joined) receiveSignal(message);
        else if(message.type==='error') { if(policyAck) policyAck.reject(Error(message.message || 'Room access was rejected.'));status(message.message || 'Signaling service rejected a request.');if(!joined)globalThis.VumiroRoomConnection?.set('error',message.message || 'Room access was rejected.'); }
      } catch(error) { if(generation!==thisGeneration||socket!==connection)return;status('Signaling error: '+(globalThis.VumiroI18n?.error(error)||error.message));if(!joined)globalThis.VumiroRoomConnection?.set('error',(globalThis.VumiroI18n?.error(error)||error.message)); }
    };
    connection.onerror=()=>{diagnostic('signaling-state',{state:'failed'});if(generation===thisGeneration&&socket===connection) { const message='Cannot reach the signaling service. Check its address and that it is running.';status(message);if(!joined)globalThis.VumiroRoomConnection?.set('error',message); } };
    connection.onclose=event=>{diagnostic('signaling-state',{state:'closed',code:event.code});
      if(generation!==thisGeneration || socket!==connection) return;
      socket=null;joined=false;joining=false;disconnected=true;if(policyAck) policyAck.reject(Error('Connection interrupted before room access was confirmed.'));clearPeers();updateControls();chatLine('Room connection lost. Reconnect is available.');
      if(passwordResolve) { passwordResolve('');passwordResolve=null; }if(serverPolicy.mode==='private' && !ownsRoom() && [1008,4003].includes(event.code)) { password='';$('passwordPrompt').hidden=false;$('passwordError').textContent=event.reason || 'Check your room password and try again.'; }
      if([1008,4001,4003,4008].includes(event.code)) { const message=event.reason || 'Room unavailable or full. Try another room.';status(message);globalThis.VumiroRoomConnection?.set(!$('passwordPrompt').hidden?'password':'error',message);return; }
      const seconds=Math.min(10,2**retry++);status(event.code===4004 ? 'Waiting for the room owner. Trying again in '+seconds+' seconds…' : 'Signaling disconnected. Rejoining in '+seconds+' seconds…');
      globalThis.VumiroRoomConnection?.set('reconnecting',event.code===4004?'Waiting for the room owner. Trying again in '+seconds+' seconds…':'Connection interrupted. Rejoining in '+seconds+' seconds…');
      reconnectTimer=setTimeout(()=>{ if(generation===thisGeneration) openSocket(); },seconds*1000);
    };
  }
  async function join() {
    if(joined || joining) return;
    const joinGeneration=generation;
    globalThis.VumiroRoomConnection?.set(disconnected?'reconnecting':'joining');
    try { await identityReady; } catch(error) { if(generation===joinGeneration){status((globalThis.VumiroI18n?.error(error)||error.message));globalThis.VumiroRoomConnection?.set('error',(globalThis.VumiroI18n?.error(error)||error.message));} return; }
    if(generation!==joinGeneration || joined || joining)return;
    if(!identity) { status('Create a local profile from Friends before joining a room.');globalThis.VumiroRoomConnection?.set('error','Create a local profile from Friends before joining a room.'); return; }
    let raw=$('room').value.trim();
    try {
      const pasted=new URL(raw); raw=pasted.searchParams.get('room') || '';
      roomGrant=grantValue(pasted.searchParams.get('grant'));grantRoom=raw;if(['public','friends','private'].includes(pasted.searchParams.get('mode'))) roomMode=pasted.searchParams.get('mode');
      if(pasted.searchParams.get('signaling')) $('signaling').value=canonicalSignalInput(pasted.searchParams.get('signaling'));
      else if(['http:','https:'].includes(pasted.protocol)) $('signaling').value=canonicalSignalInput((pasted.protocol==='https:'?'wss:':'ws:')+'//'+pasted.host+'/call-signaling');
    } catch { /* plain room code */ }
    if(!validRoom(raw)) { status('Use a new private-room invitation. Older anonymous room links are no longer supported.');globalThis.VumiroRoomConnection?.set('error','This invitation is invalid. Ask for a new room invitation.');return; }
    if(raw!==grantRoom) roomGrant=null;grantRoom=raw;
    $('room').value=raw;
    try { const normalized=signalUrl();normalized.searchParams.delete('room');normalized.searchParams.delete('name');normalized.searchParams.delete('id');$('signaling').value=normalized.href; } catch(error) { status((globalThis.VumiroI18n?.error(error)||error.message));globalThis.VumiroRoomConnection?.set('error',(globalThis.VumiroI18n?.error(error)||error.message));return; }
    setChatRoom($('signaling').value+'|'+raw);clearTimeout(reconnectTimer);generation++;save('call-name',$('name').value.trim());save('call-signaling',$('signaling').value.trim());
    const url=new URL(location.href);url.searchParams.set('room',raw);if(roomGrant) url.searchParams.set('grant',JSON.stringify(roomGrant));else url.searchParams.delete('grant');history.replaceState(null,'',url);status('Joining room…');openSocket();
  }
  async function leave() {
    releaseRoomResources();
    if(policyAck)safeCleanup(()=>policyAck.reject(Error('You left the room.')));
    password='';if(passwordResolve){safeCleanup(()=>passwordResolve(''));passwordResolve=null;}
    safeCleanup(()=>setChatRoom(''));
    safeCleanup(()=>syncMuteControl());safeCleanup(()=>updateControls());
    safeCleanup(()=>status('You left the room.'));safeCleanup(()=>chatLine('You left the room.'));
    if(embedded)parent.postMessage({type:'vumiro-call-ended'},location.origin);
  }
  $('name').value=query.get('name')?.slice(0,48) || readSaved('call-name') || 'Guest';$('room').value=query.get('room') || '';
  const savedSignal=readSaved('call-signaling'),querySignal=query.get('signaling');
  $('signaling').value=canonicalSignalInput(querySignal || savedSignal || (location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/call-signaling');
  if(!querySignal&&savedSignal&&savedSignal!==$('signaling').value)save('call-signaling',$('signaling').value);
  $('join').onclick=join;$('reconnect').onclick=reconnect;$('leave').onclick=leave;$('share').onclick=share;$('stopShare').onclick=stopShare;$('mic').onclick=enableMic;
  globalThis.VumiroRoomConnection=window.VumiroMotion?.connection({overlay:$('roomConnection'),title:$('connectionTitle'),detail:$('connectionDetail'),retry:$('connectionRetry'),cancel:$('connectionCancel'),onRetry:reconnect,onCancel:leave,content:[document.querySelector('main'),document.querySelector('.call-dock')],returnFocus:$('join')});
  $('mute').onclick=()=>{ if(microphone) { micMuted=!micMuted;gateMicrophone(micSuppressed); } };
  /* Embedded calls use the app's full-page audio settings without leaving the room. */
  function openAudioSettings() {
    if (window.parent !== window) {
      try {
        const app = window.parent, url = new URL(app.location.href);
        if (url.origin === location.origin && url.pathname === '/friends.html' && typeof app.VumiroAudioSettings?.open === 'function') {
          app.VumiroAudioSettings.open(); return;
        }
      } catch { /* A standalone or cross-origin embed keeps local audio settings. */ }
    }
    voice?.open();
  }
  $('audioOpen').onclick=openAudioSettings;
  $('deafen').onclick=()=>voice?.setDeafened(!voice.isDeafened());
  voice?.registerRoom({apply:applyVoiceSettings,gate:gateMicrophone,microphone:()=>microphone,active:()=>joined||joining,report:status,playbackReady:play});
  voice?.subscribe(value=>{ $('deafen').setAttribute('aria-pressed',String(value.deafened));$('deafen').setAttribute('aria-label',value.deafened?'Undeafen room audio':'Deafen room audio and microphone');$('deafenLabel').textContent=value.deafened?'Undeafen':'Deafen';$('deafen').classList.toggle('active',value.deafened); });
  $('copyInvite').onclick=()=>{ if(!joined)return;invitationState=null;renderInvitation();$('inviteCopyStatus').textContent='';$('inviteFriends').replaceChildren();$('inviteFriendsStatus').textContent=embedded?'Loading online friends…':'Direct invitations are available inside the Vumiro app.';$('inviteDialog').showModal();if(embedded)parentMessage({type:'vumiro-room-invite',action:'state',room:roomValue($('room').value)});else{$('inviteLink').focus();$('inviteLink').select();copyInvitation();} };
  $('inviteCopy').onclick=copyInvitation;
  $('inviteCodeCopy').onclick=async()=>{const value=$('inviteCode').value;if(!value)return;try{await navigator.clipboard.writeText(value);$('inviteCopyStatus').textContent='Room code copied.';}catch{$('inviteCopyStatus').textContent='Select the room code and copy it with Ctrl+C.';$('inviteCode').focus();$('inviteCode').select();}};
  $('inviteFriendsRefresh').onclick=()=>{if(embedded)parentMessage({type:'vumiro-room-invite',action:'state',room:roomValue($('room').value)});};
  $('inviteClose').onclick=()=>$('inviteDialog').close();
  $('inviteDialog').addEventListener('click',event=>{if(event.target===$('inviteDialog'))$('inviteDialog').close();});
  $('inviteDialog').addEventListener('close',()=>$('copyInvite').focus());
  $('inviteLink').onclick=()=>$('inviteLink').select();
  $('enableAudio').onclick=()=>{ $('enableAudio').hidden=true;for(const peer of peers.values()) { play(peer.tile.video);for(const audio of peer.tile.audios) play(audio); } };
  addEventListener('beforeunload',()=>{mosaic.dispose();releaseRoomResources();safeCleanup(()=>voice?.dispose());});
  addEventListener('message',event=>{
    if(!embedded || event.origin!==location.origin || event.source!==parent) return;
    if(event.data?.type==='vumiro-friend-status') friendStatus(event.data);
    else if(event.data?.type==='vumiro-room-invite') receiveRoomInvitation(event.data);
    else if(event.data?.type==='vumiro-friends-changed') { if(profileRequestId) parentMessage({type:'vumiro-friend-status-query',id:profileRequestId});updateRoomFriends().catch(error=>status((globalThis.VumiroI18n?.error(error)||error.message))); }
    else if(event.data?.type==='vumiro-call-leave') leave();
    else if(event.data?.type==='vumiro-call-reconnect') reconnect();
    else if(event.data?.type==='vumiro-open-chat') { $('chatTab').click();$('chatText').focus(); }
    else if(event.data?.type==='vumiro-stream-settings') applySettings(event.data.settings,false);
    else if(event.data?.type==='vumiro-stream-audio') receiveNativeAudio(event.data);
    else if(event.data?.type==='vumiro-profile') refreshProfile();
    else if(event.data?.type==='vumiro-room-access' && event.data.room===roomValue($('room').value) && ['public','friends','private'].includes(event.data.mode)) {
      if(accessReceived) return;accessReceived=true;roomMode=event.data.mode;ownerPolicy={mode:roomMode};if(typeof event.data.name==='string') roomName=event.data.name.trim().slice(0,60) || roomName;if(typeof event.data.password==='string' && event.data.password.length<=128) password=event.data.password;renderRoom();accessResolve?.();
    }
  });
  addEventListener('vumiro-friends-changed',()=>{ if(profileRequestId) parentMessage({type:'vumiro-friend-status-query',id:profileRequestId});updateRoomFriends().catch(error=>status((globalThis.VumiroI18n?.error(error)||error.message))); });
  function reconnect() { clearTimeout(reconnectTimer);generation++;if(policyAck) policyAck.reject(Error('Reconnecting before room access was confirmed.'));const old=socket;socket=null;if(old) old.close(1000,'Reconnecting');joined=false;joining=false;disconnected=true;clearPeers();status('Reconnecting to the room…');join(); }
  async function refreshProfile() { try { const current=await local.initialize();if(!current) return;identity=current; } catch { return; }const profile=ownProfile();if(!profile) return;$('name').value=profile.name;cacheProfile(identity.id,profile);if(localTile) showProfile(localTile,profile,true);for(const peer of peers.values()) announceProfile(peer); }
  let roomToastTimer=0;
  function roomToast(message,kind='success') { const toast=$('roomToast');toast.textContent=message;toast.className='room-toast '+kind;toast.hidden=false;clearTimeout(roomToastTimer);roomToastTimer=setTimeout(()=>{toast.hidden=true;},4200); }
  function setupStreamSettings() {
    const ids=['settingFps','settingMbps','settingResolution','settingContent','settingAudio','settingExcludeDiscord'];
    for(const id of ids)$(id).onchange=()=>{$('streamSettingsStatus').textContent='Unsaved changes. Choose Save stream settings to apply them.';};
    $('saveStreamSettings').onclick=async()=>{
      const button=$('saveStreamSettings');if(button.disabled)return;
      const value=validateSettings({fps:Number($('settingFps').value),mbps:Number($('settingMbps').value),resolution:$('settingResolution').value,contentHint:$('settingContent').value,audio:$('settingAudio').checked,excludeDiscord:$('settingExcludeDiscord').checked});
      if(!value){$('streamSettingsStatus').textContent='Choose 1–120 FPS and 1–100 Mbps.';roomToast($('streamSettingsStatus').textContent,'error');return;}
      button.disabled=true;button.textContent='Saving…';$('streamSettingsStatus').textContent='Saving stream settings…';status('Saving stream settings…');
      try {
        if(nativeAudioSupported&&screen&&value.audio)ensureNativeAudioGraph().catch(error=>status('System audio could not start: '+(globalThis.VumiroI18n?.error(error)||error.message)));
        if(!await applySettings(value))throw Error('Could not save stream settings on this device.');
        $('streamSettingsStatus').textContent='Stream settings saved.';status('Stream settings saved.');roomToast('Stream settings saved.','success');
      }catch(error){$('streamSettingsStatus').textContent=(globalThis.VumiroI18n?.error(error)||error.message);status((globalThis.VumiroI18n?.error(error)||error.message));roomToast((globalThis.VumiroI18n?.error(error)||error.message),'error');}
      finally{button.disabled=false;button.textContent='Save stream settings';}
    };
  }
  /* End stream settings */
  setupStreamSettings();
  $('chatTools')?.querySelectorAll?.('[data-format]').forEach(button=>button.onclick=()=>{const box=$('chatText'),mark=button.dataset.format,start=box.selectionStart,end=box.selectionEnd;box.setRangeText(mark+box.value.slice(start,end)+mark,start,end,'select');box.dispatchEvent(new Event('input'));box.focus();});
  function setupEmojiPicker() {
    const picker=$('emojiPicker'),panel=$('emojiPanel'),grid=$('emojiGrid'),search=$('emojiSearch'),categories=$('emojiCategories'),empty=$('emojiEmpty');
    if(!picker?.addEventListener||!grid?.replaceChildren||!categories?.replaceChildren)return;
    const groups=[
      ['Smileys','😀|grinning smile happy;😃|smiley happy;😄|smile happy;😁|beaming grin;😆|laughing;😅|sweat smile relieved;😂|joy laugh tears;🤣|rofl rolling laugh;🙂|slight smile;🙃|upside down;😉|wink;😊|blush smile;😇|innocent angel;🥰|smiling hearts love;😍|heart eyes;🤩|star eyes excited;😘|kiss;😋|yummy delicious;😛|tongue;🤪|crazy zany;🤭|giggle;🤫|shush quiet;🤔|thinking;🤨|raised eyebrow;😐|neutral;😏|smirk;😴|sleep sleepy;🤤|drool;😎|cool sunglasses;🤓|nerd glasses;🥳|party celebrate;😔|sad pensive;😢|cry sad;😭|sob crying;😤|triumph huff;😡|angry rage;😱|scream shocked;🥺|pleading please;😬|grimace awkward;🫡|salute'],
      ['People','👋|wave hello bye;🤚|raised hand;✋|stop hand;👌|ok okay;🤌|pinched fingers;✌️|peace victory;🤞|crossed fingers luck;🤟|love you;🤘|rock horns;🤙|call me;👈|point left;👉|point right;👆|point up;👇|point down;👍|thumbsup thumbs up like yes;👎|thumbsdown thumbs down dislike no;👏|clap applause;🙌|raised hands hooray;👐|open hands;🤝|handshake deal;🙏|pray thanks please;💪|muscle strong;🫶|heart hands love;👀|eyes look;🧠|brain'],
      ['Hearts','❤️|heart red love;🧡|orange heart;💛|yellow heart;💚|green heart;💙|blue heart;💜|purple heart;🖤|black heart;🤍|white heart;🤎|brown heart;💔|broken heart;❤️‍🔥|heart fire;💕|two hearts;💞|revolving hearts;💖|sparkling heart;💗|growing heart;💘|cupid heart;💝|gift heart;💟|heart decoration;💯|hundred perfect;💢|anger'],
      ['Animals','🐶|dog puppy;🐱|cat kitty;🐭|mouse;🐹|hamster;🐰|rabbit bunny;🦊|fox;🐻|bear;🐼|panda;🐨|koala;🐯|tiger;🦁|lion;🐮|cow;🐷|pig;🐸|frog;🐵|monkey;🐔|chicken;🐧|penguin;🐦|bird;🦆|duck;🦉|owl;🦋|butterfly;🐢|turtle;🐍|snake;🐉|dragon;🐬|dolphin;🌸|cherry blossom;🌻|sunflower;🌵|cactus;🌲|tree;🍀|clover luck'],
      ['Food','🍎|apple;🍊|orange;🍋|lemon;🍌|banana;🍉|watermelon;🍇|grapes;🍓|strawberry;🥑|avocado;🥕|carrot;🌽|corn;🍕|pizza;🍔|burger hamburger;🍟|fries;🌭|hot dog;🌮|taco;🍣|sushi;🍜|ramen noodles;🍿|popcorn;🍩|donut doughnut;🍪|cookie;🎂|cake birthday;🍫|chocolate;🍦|ice cream;☕|coffee tea;🧋|bubble tea;🥤|drink soda;🍺|beer;🥂|cheers;💧|water;🧊|ice'],
      ['Play','🎮|game gaming controller;🕹️|joystick arcade;🎲|dice game;♟️|chess;🃏|joker cards;🎯|target bullseye;🎳|bowling;⚽|soccer football;🏀|basketball;🏈|football american;⚾|baseball;🎾|tennis;🏐|volleyball;🏓|ping pong;🏆|trophy winner;🥇|gold medal first;🥈|silver medal;🥉|bronze medal;🎸|guitar rock;🥁|drum;🎹|piano;🎤|microphone karaoke;🎧|headphones music;🎵|music note;🎶|music notes;🎬|movie film;🎨|art paint;🎭|theater drama;🎪|circus;🎟️|ticket'],
      ['Travel','🚗|car;🚕|taxi;🚌|bus;🚓|police car;🚑|ambulance;🚒|fire truck;🚲|bicycle bike;🏍️|motorcycle;🚂|train;✈️|airplane plane;🚀|rocket launch;🛸|ufo spaceship;🚁|helicopter;⛵|boat sail;⚓|anchor;🏠|house home;🏙️|city skyline;🏖️|beach;🏔️|mountain;🌋|volcano;🗺️|map;🌍|earth globe;🌎|earth americas;🌏|earth asia;🌞|sun;🌙|moon night;⭐|star;🌈|rainbow;☁️|cloud;⚡|lightning bolt'],
      ['Objects','💡|idea light bulb;🔦|flashlight;🕯️|candle;🔋|battery;🔌|plug power;💻|computer laptop;🖥️|desktop monitor screen;⌨️|keyboard;🖱️|mouse computer;📱|phone mobile;📷|camera;🎥|movie camera;📺|television tv;📻|radio;⌚|watch;⏰|alarm clock;📎|paperclip attachment;📁|folder file;📄|document page;📝|memo pencil;📚|books;📦|package box;🎁|gift present;🔑|key;🔒|lock;🔓|unlock;🔨|hammer;🛠️|tools;⚙️|gear settings;🧸|teddy toy'],
      ['Symbols','✅|check yes done;❌|cross no;❓|question;❗|exclamation;⚠️|warning;🚫|prohibited no;⛔|stop no entry;♻️|recycle;🔴|red circle;🟠|orange circle;🟡|yellow circle;🟢|green circle;🔵|blue circle;🟣|purple circle;⚫|black circle;⚪|white circle;⬆️|arrow up;⬇️|arrow down;⬅️|arrow left;➡️|arrow right;🔄|refresh arrows;▶️|play;⏸️|pause;⏹️|stop;🔊|loud speaker sound;🔇|mute;🔔|bell notification;🔥|fire lit;✨|sparkles;🎉|tada party celebrate']
    ].map(([name,data])=>({name,items:data.split(';').map(entry=>{const [emoji,keywords]=entry.split('|');return {emoji,keywords,category:name};})}));
    const all=groups.flatMap(group=>group.items),byEmoji=new Map(all.map(item=>[item.emoji,item]));
    let recent=[],category='All';try{const saved=JSON.parse(localStorage.getItem('vumiro-recent-emoji')||'[]');if(Array.isArray(saved))recent=[...new Set(saved.filter(value=>byEmoji.has(value)))].slice(0,12);}catch{}
    function closePicker(){picker.open=false;try{panel?.hidePopover?.();}catch{}}
    function insert(item){
      const box=$('chatText');if(box.disabled)return;
      const start=Number.isInteger(box.selectionStart)?box.selectionStart:box.value.length,end=Number.isInteger(box.selectionEnd)?box.selectionEnd:start;
      if(box.value.length-(end-start)+item.emoji.length>2000){status('The message is full. Remove some text before adding an emoji.');return;}
      box.setRangeText(item.emoji,start,end,'end');box.dispatchEvent(new Event('input'));box.focus();closePicker();
      recent=[item.emoji,...recent.filter(value=>value!==item.emoji)].slice(0,12);try{localStorage.setItem('vumiro-recent-emoji',JSON.stringify(recent));}catch{}
    }
    function render(){
      const query=String(search.value||'').trim().toLowerCase().replace(/^:|:$/g,'').replace(/[_-]/g,' ');
      const pool=query?all:category==='Recent'?recent.map(value=>byEmoji.get(value)):category==='All'?all:groups.find(group=>group.name===category)?.items||all;
      const items=pool.filter(item=>!query||item.emoji===query||(item.keywords+' '+(globalThis.VumiroI18n?.translateLiteral(item.keywords)||'')).toLocaleLowerCase().includes(query)||item.category.toLowerCase().includes(query));
      grid.replaceChildren();for(const item of items){const button=document.createElement('button');button.type='button';button.textContent=item.emoji;button.title=item.keywords;button.setAttribute('aria-label',item.keywords);button.onclick=()=>insert(item);grid.append(button);}empty.hidden=items.length!==0;
      for(const button of categories.children)button.setAttribute('aria-pressed',String(button.dataset.category===category&&!query));
    }
    const categoryIcons={All:'⋯',Recent:'◷',Smileys:'😀',People:'👋',Hearts:'❤️',Animals:'🐻',Food:'🍕',Play:'🎮',Travel:'🚀',Objects:'💡',Symbols:'✨'};
    categories.replaceChildren();for(const name of ['All','Recent',...groups.map(group=>group.name)]){const button=document.createElement('button');button.type='button';button.textContent=categoryIcons[name];button.title=name;button.setAttribute('aria-label',name);button.dataset.category=name;button.onclick=()=>{category=name;search.value='';render();};categories.append(button);}
    search.oninput=render;picker.addEventListener('toggle',()=>{
      if(!picker.open){try{panel?.hidePopover?.();}catch{}return;}render();try{panel?.showPopover?.();}catch{}
      const anchor=picker.querySelector('summary')?.getBoundingClientRect?.(),box=panel?.getBoundingClientRect?.();
      if(anchor&&box){panel.style.left=Math.max(12,Math.min(anchor.left,innerWidth-box.width-12))+'px';panel.style.top=Math.max(12,Math.min(anchor.top-box.height-8,innerHeight-box.height-12))+'px';}search.focus();
    });
    picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closePicker();picker.querySelector('summary')?.focus();}});
    grid.addEventListener?.('keydown',event=>{const buttons=Array.from(grid.children),at=buttons.indexOf(event.target);if(at<0)return;const shift={ArrowRight:1,ArrowLeft:-1,ArrowDown:6,ArrowUp:-6}[event.key];if(shift){event.preventDefault();buttons[Math.min(buttons.length-1,Math.max(0,at+shift))]?.focus();}});
    document.addEventListener?.('pointerdown',event=>{if(picker.open&&picker.contains&&!picker.contains(event.target))closePicker();});render();
  }
  /* End emoji picker */
  setupEmojiPicker();
  function setupChatReplyComposer() {
    const preview=document.createElement('div'),copy=document.createElement('div'),heading=document.createElement('strong'),author=document.createElement('span'),excerpt=document.createElement('span'),cancel=document.createElement('button');
    preview.id='replyPreview';preview.className='chat-reply-preview';preview.hidden=true;preview.setAttribute('role','status');preview.setAttribute('aria-live','polite');preview.setAttribute('aria-label','Replying to message');
    heading.textContent='Replying to ';author.id='replyAuthor';excerpt.id='replyExcerpt';copy.append(heading,author,excerpt);
    cancel.id='replyCancel';cancel.type='button';cancel.textContent='Cancel';cancel.setAttribute('aria-label','Cancel reply');cancel.onclick=()=>{clearChatReply();$('chatText').focus();};
    preview.append(copy,cancel);$('chatForm').insertBefore?.(preview,$('chatTools'));
  }
  setupChatReplyComposer();
  bindChatReplyDrag();
  bindChatReplyKeys();
  $('chatForm').onsubmit=sendRoomChat;
  if($('chatAttach'))$('chatAttach').onclick=()=>$('chatFile')?.click();
  if($('chatFile'))$('chatFile').onchange=()=>{shareChatFile($('chatFile').files?.[0]);$('chatFile').value='';};
  bindChatMediaInputs($('chatText'));
  addEventListener('storage',event=>{ if(event.key===settingsKey) { try { applySettings(JSON.parse(event.newValue),false); } catch { /* Ignore malformed settings. */ } } });
  addEventListener('vumiro-profile-changed',refreshProfile);
  $('passwordForm').onsubmit=event=>{ event.preventDefault();const value=$('guestPassword').value;if(value.length<6 || value.length>128) { $('passwordError').textContent='Enter a password of 6–128 characters.';return; }password=value;$('guestPassword').value='';$('passwordError').textContent='';$('passwordPrompt').hidden=true;globalThis.VumiroRoomConnection?.set('joining');if(passwordResolve) { const resolve=passwordResolve;passwordResolve=null;resolve(value); }else reconnect(); };
  function policyFields() { const mode=$('policyVisibility').value;$('policyPasswordLabel').hidden=mode!=='private';$('policyHelp').textContent=mode==='private'?'Anyone with the password can join. Changing the password disconnects guests.':mode==='public'?'People with a profile can discover and join this room.':'Only mutual friends can discover and join this room.'; }
  $('roomPolicyOpen').onclick=()=>{ if(!ownsRoom()) return;$('policyName').value=roomName;$('policyVisibility').value=roomMode;$('policyPassword').value='';$('policyError').textContent='';$('roomPolicyDialog').hidden=false;$('streamSettings').hidden=true;policyFields();$('policyName').focus(); };
  $('roomPolicyClose').onclick=()=>{$('roomPolicyDialog').hidden=true;$('roomPolicyOpen').focus();};$('policyVisibility').onchange=policyFields;
  $('roomPolicyForm').onsubmit=async event=>{ event.preventDefault();if(policyBusy) return;policyBusy=true;$('policySave').disabled=true;$('policyError').textContent='';try { await updatePolicy($('policyVisibility').value,$('policyPassword').value,$('policyName').value);$('policyPassword').value='';$('roomPolicyDialog').hidden=true;status('Room access updated.'); } catch(error) { $('policyError').textContent=(globalThis.VumiroI18n?.error(error)||error.message); }finally { policyBusy=false;$('policySave').disabled=false; } };
  $('chatTab').onclick=()=>pane(false);$('peopleTab').onclick=()=>pane(true);function pane(people) { $('peopleView').hidden=!people;$('chatView').hidden=people;$('peopleTab').classList.toggle('active',people);$('chatTab').classList.toggle('active',!people);$('peopleTab').setAttribute('aria-pressed',String(people));$('chatTab').setAttribute('aria-pressed',String(!people)); }
  $('qualityOpen').onclick=()=>{syncSettingsControls();$('streamSettingsStatus').textContent='';$('streamSettings').hidden=!$('streamSettings').hidden;$('roomPolicyDialog').hidden=true;if(!$('streamSettings').hidden)$('settingFps').focus();};$('settingsClose').onclick=()=>{syncSettingsControls();$('streamSettingsStatus').textContent='';$('streamSettings').hidden=true;$('qualityOpen').focus();};
  addEventListener('keydown',event=>{ if(event.key==='Escape') { if(!$('streamSettings').hidden) $('qualityOpen').focus();else if(!$('roomPolicyDialog').hidden) $('roomPolicyOpen').focus();$('streamSettings').hidden=true;$('roomPolicyDialog').hidden=true; } });
  $('chatText').oninput=()=>{ $('chatText').style.height='auto';$('chatText').style.height=Math.min(144,$('chatText').scrollHeight+2)+'px'; };
  $('chatText').onkeydown=event=>{ if(event.key==='Escape'&&pendingReply){event.preventDefault();clearChatReply();return;}if(event.key==='Enter' && !event.shiftKey) { event.preventDefault();$('chatForm').requestSubmit(); } };
  syncSettingsControls();parentMessage({type:'vumiro-stream-settings',settings:streamSettings});
  let sampling=false;
  setInterval(async()=>{
    if(sampling) return;sampling=true;
    try { await Promise.all([...peers.values()].map(async peer=>{
      if(peer.pc.connectionState!=='connected') return;
      const report=await peer.pc.getStats();let frames=0,bytes=0,timestamp=0,path='direct';
      for(const entry of report.values()) {
        if(entry.type==='inbound-rtp' && entry.kind==='video') { frames+=entry.framesDecoded || 0;bytes+=entry.bytesReceived || 0;timestamp=Math.max(timestamp,entry.timestamp); }
        if(entry.type==='transport' && entry.selectedCandidatePairId) { const pair=report.get(entry.selectedCandidatePairId),local=pair && report.get(pair.localCandidateId),remote=pair && report.get(pair.remoteCandidateId);if(local?.candidateType==='relay' || remote?.candidateType==='relay') { peer.pc.close();peer.tile.stats.textContent='Media relay refused by direct-only mode.';return; } if(pair) path='direct '+(local?.protocol || '').toUpperCase()+(pair.currentRoundTripTime != null ? ' · '+Math.round(pair.currentRoundTripTime*1000)+' ms RTT':''); }
      }
      const old=peer.lastStats;peer.lastStats={frames,bytes,timestamp};if(!peer.lastDiagnosticAt||Date.now()-peer.lastDiagnosticAt>=30000){peer.lastDiagnosticAt=Date.now();diagnostic('stream-health',{frames,bytes,peers:peers.size,sequence:nativeAudioSession?.lastSequence>=0?nativeAudioSession.lastSequence:undefined});}
      let text=path+' · '+(peer.tile.sharing?'waiting for video':'not sharing');
      if(peer.tile.sharing && old && timestamp>old.timestamp) text=path+' · '+Math.max(0,(frames-old.frames)*1000/(timestamp-old.timestamp)).toFixed(1)+' decoded FPS · '+Math.max(0,(bytes-old.bytes)*8/(timestamp-old.timestamp)/1000).toFixed(2)+' Mbps';
      peer.tile.stats.textContent=text;
    })); } catch { /* A departing peer may close during sampling. */ } finally { sampling=false; }
  },2000);
  updateControls();
  if(query.get('autojoin')==='1') {
    globalThis.VumiroRoomConnection?.set('joining');
    if(embedded)parent.postMessage({type:'vumiro-room-ui-ready',launchId:query.get('launchId')||''},location.origin);
  }
  identityReady.then(value=>{
    if(!value) {
      const home=new URL('/friends.html',location.href);home.search=location.search;home.searchParams.delete('autojoin');home.searchParams.delete('embedded');location.replace(home.href);return;
    }
    if(!query.get('name')) $('name').value=value.name;
    if(!$('room').value) $('room').value=code();if(roomName==='Your room' && !ownsRoom()) roomName='Vumiro room';renderRoom();
    if(query.get('autojoin')==='1') join();
  }).catch(error=>{const message=globalThis.VumiroI18n?.error(error)||error.message;status(message);globalThis.VumiroRoomConnection?.set('error',message);});
})();
