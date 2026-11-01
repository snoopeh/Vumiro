/* Vumiro room: signaling-only server, direct WebRTC media. No TURN configuration. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), query = new URLSearchParams(location.search), linuxPlatform=query.get('platform')==='linux'||window.vumiroDesktop?.platform==='linux';
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
  const roomState=()=>parentMessage({type:'vumiro-room-state',room:roomValue($('room').value),joined,sharing:!!screen,mode:roomMode,name:roomName});
  const ownsRoom=()=>!!identity && roomValue($('room').value).slice(0,43)===identity.id;
  const encode64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function decode64(value,length) { if(typeof value!=='string' || value.length>128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error('Invalid room password settings.');const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));if(bytes.length!==length) throw Error('Invalid room password settings.');return bytes; }
  async function passwordKey(value,salt) { const key=await crypto.subtle.importKey('raw',encoder.encode(value),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:decode64(salt,16),iterations:150000,hash:'SHA-256'},key,256)); }
  async function privatePolicy(value) { if(typeof value!=='string' || value.length<6 || value.length>128) throw Error('Choose a password of 6–128 characters.');const salt=encode64(crypto.getRandomValues(new Uint8Array(16)));return {mode:'private',salt,verifier:encode64(await passwordKey(value,salt))}; }
  function displayPolicy(value,revision) { if(!value || !['public','friends','private','legacy','offline'].includes(value.mode)) throw Error('Invalid room access policy.');if(value.mode==='private') decode64(value.salt,16);serverPolicy=value;if(Number.isSafeInteger(revision) && revision>=0) policyRevision=revision;roomMode=['legacy','offline'].includes(value.mode)?'friends':value.mode;renderRoom(); }
  function renderRoom() { $('roomTitle').textContent=roomName;$('privacyLabel').textContent=roomMode==='private'?'Private':roomMode==='public'?'Public':'Friends';$('privacyBadge').title=roomMode==='private'?'Password protected':roomMode==='public'?'Anyone with a profile may join':'Mutual friends may join';$('roomPolicyOpen').hidden=!joined || !ownsRoom() || authenticationVersion!==2;$('roomSubtitle').textContent=joined?'Your screens. Your people. Your space.':joining?'Connecting securely…':disconnected?'Connection interrupted':'A little closer, wherever you are.'; }
  function refreshLayout() {
    const entries=[...(localTile?[{id:selfId || identity?.id,tile:localTile,local:true}]:[]),...peers.values()];
    if(!manualFocus) { const sharing=entries.find(item=>!item.local && item.tile.sharing) || entries.find(item=>item.tile.sharing);focusedId=sharing?.id || entries.find(item=>!item.local)?.id || entries[0]?.id || ''; }
    if(!entries.some(item=>item.id===focusedId)) focusedId=entries.find(item=>!item.local)?.id || entries[0]?.id || '';
    for(const item of entries) item.tile.element.classList.toggle('focused',item.id===focusedId);
    $('participantCount').textContent=joined?(entries.length+' '+(entries.length===1?'person':'people')):joining?'Connecting…':disconnected?'Disconnected':'Ready to join';$('peopleCount').textContent=String(entries.length);$('empty').hidden=entries.length>0;
    $('emptyTitle').textContent=disconnected?'Let’s get you back in':joining?'Your room is getting ready':'Make yourself at home';$('emptyDescription').textContent=disconnected?'Your room stays here. Reconnect when you’re ready to pick up where you left off.':'A place to watch, talk and share. Your screen and microphone stay off until you choose to turn them on.';$('emptyHint').textContent=disconnected?'Use Reconnect below':joining?'Connecting securely to your room…':'Choose a room to get started';
    const people=$('peopleList');people.replaceChildren();for(const item of entries) { const profile=profileCache.get(item.id) || {name:item.local?($('name').value || 'You'):item.name || 'Participant',username:'',avatar:''},row=document.createElement('li');row.className='person';row.tabIndex=0;row.setAttribute('role','button');row.setAttribute('aria-haspopup','dialog');row.setAttribute('aria-label','View '+profile.name+(item.local?' (you)':'')+' profile');row.onclick=()=>openParticipantProfile(item.id,item.local);row.onkeydown=event=>{ if(event.target===row && (event.key==='Enter'||event.key===' ')) { event.preventDefault();openParticipantProfile(item.id,item.local); } };const photo=avatarElement(profile),copy=document.createElement('div'),name=document.createElement('span'),state=document.createElement('span'),dot=document.createElement('span');copy.className='person-copy';name.className='person-name';name.textContent=profile.name+(item.local?' (you)':'');state.className='person-status';state.textContent=item.tile.sharing?'Sharing a screen':item.local?'In the room':item.pc.connectionState==='connected'?'Connected':'Connecting…';dot.className='person-dot'+(item.local || item.pc.connectionState==='connected'?' online':'');copy.append(name,state);row.append(photo,copy,dot);people.append(row); }
  }

  function openParticipantProfile(id,isLocal) {
    const profile=profileCache.get(id) || {name:id===identity?.id?($('name').value||'You'):peers.get(id)?.name||'Participant',username:'',avatar:''};
    $('profileName').textContent=profile.name+(isLocal?' (you)':'');$('profileUsername').textContent=profile.username?'@'+profile.username:'';$('profileUsername').hidden=!profile.username;$('profileAvatar').src=profile.avatar||fallbackAvatar(profile.name);$('profileNote').textContent='';
    const action=$('profileFriend');action.hidden=isLocal;action.disabled=true;action.textContent='Checking friendship…';profileAddBusy=false;profileRequestId=isLocal?'':id;clearTimeout(profileRequestTimer);
    if(!isLocal) {
      if(embedded) { parentMessage({type:'vumiro-friend-status-query',id});profileRequestTimer=setTimeout(()=>{ if(profileRequestId===id) { action.hidden=true;$('profileNote').textContent='Could not check friend status. Open the Friends page to manage this person.'; } },5000); }
      else { action.hidden=false;action.disabled=false;action.textContent='Open Friends';$('profileNote').textContent='Friend requests are managed from the Vumiro Friends page.'; }
    }
    const dialog=$('profilePopover');if(!dialog.open) dialog.showModal();$('profileClose').focus();
  }
  function friendStatus(message) {
    if(message.id!==profileRequestId) return;clearTimeout(profileRequestTimer);const action=$('profileFriend'),note=$('profileNote');action.disabled=profileAddBusy;
    if(message.status==='friend') { action.hidden=false;action.disabled=true;action.textContent='Already friends';note.textContent=message.message||'You are friends.'; }
    else if(message.status==='pending') { action.hidden=false;action.disabled=true;action.textContent='Request pending';note.textContent=message.message||'A friend request is already pending.'; }
    else if(message.status==='sent') { profileAddBusy=false;action.hidden=false;action.disabled=true;action.textContent='Request sent';note.textContent=message.message||'Friend request sent.'; }
    else if(message.status==='error') { profileAddBusy=false;action.hidden=false;action.disabled=false;action.textContent='Add friend';note.textContent=message.message||'Could not send the friend request.'; }
    else { profileAddBusy=false;action.hidden=false;action.disabled=false;action.textContent='Add friend';note.textContent=''; }
  }
  $('profileClose').onclick=()=>{ clearTimeout(profileRequestTimer);profileRequestId='';$('profilePopover').close(); };
  $('profilePopover').addEventListener('click',event=>{ if(event.target===$('profilePopover')) $('profilePopover').close(); });
  $('profilePopover').addEventListener('close',()=>{ clearTimeout(profileRequestTimer);profileRequestTimer=0;profileRequestId='';profileAddBusy=false; });
  $('profileFriend').onclick=()=>{ const id=profileRequestId;if(!id||profileAddBusy) return;if(!embedded) { location.href=new URL('/friends.html',location.href).href;return; }profileAddBusy=true;$('profileFriend').disabled=true;$('profileFriend').textContent='Sending…';$('profileNote').textContent='';parentMessage({type:'vumiro-add-friend',id});profileRequestTimer=setTimeout(()=>{ if(profileRequestId===id&&profileAddBusy) { profileAddBusy=false;$('profileFriend').disabled=false;$('profileFriend').textContent='Add friend';$('profileNote').textContent='No response from Vumiro. You can try again.'; } },8000); };
  function avatarElement(profile) { const image=document.createElement('img');image.className='avatar';image.alt='';image.src=profile.avatar || fallbackAvatar(profile.name);return image; }
  function fallbackAvatar(name) { const initial=Array.from(String(name || '?').trim())[0] || '?',svg='<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#3b303a"/><text x="32" y="42" font-size="28" text-anchor="middle" fill="#f8dce1" font-family="sans-serif">'+initial.replace(/[<>&"']/g,'')+'</text></svg>';return 'data:image/svg+xml,'+encodeURIComponent(svg); }
  function updateMessageProfiles(id) { const profile=profileCache.get(id);if(!profile) return;for(const row of $('chatLog').children) if(row.dataset.sender===id) { row.querySelector('.message-avatar').src=profile.avatar || fallbackAvatar(profile.name);row.querySelector('.message-label').textContent=profile.name+(id===identity?.id?' (you)':''); } }
  function cacheProfile(id,profile) { profileCache.set(id,profile);if(profileCache.size>128) profileCache.delete(profileCache.keys().next().value);updateMessageProfiles(id); }
  const peers = new Map();
  const local = window.VumiroLocalProfile;
  let identity = null, roomNonce = '', roomFriendsRevision = 0;
  const identityReady = local.initialize().then(value => { identity = value; return value; });
  let selfId = '', socket = null, joined = false, reconnectTimer = 0, retry = 0, generation = 0;
  let profileRequestId='', profileRequestTimer=0, profileAddBusy=false;
  let screen = null, microphone = null, localTile = null, joining = false;
  let nativeAudioSupported=false,nativeAudioSession=null,nativeAudioGeneration=0,audioContext=null,audioDestination=null,nativeAudioTrack=null;
  const readSaved = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optional */ } };
  function code() { return identity.id + '_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join(''); }
  function status(message) { $('status').textContent = message; }
  const seenMessages=new Set(); let lastChatSent=0;
  function rememberMessage(key) { if(seenMessages.has(key)) return false; seenMessages.add(key); if(seenMessages.size>1000) seenMessages.delete(seenMessages.values().next().value); return true; }
  function chatLine(text, sender, timestamp=Date.now()) {
    const log=$('chatLog'), nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<70,row=document.createElement('li');
    if(sender) { const profile=profileCache.get(sender) || {name:peers.get(sender)?.name || (sender===identity?.id?'You':'Participant'),avatar:''},photo=avatarElement(profile),body=document.createElement('div'),author=document.createElement('div'),label=document.createElement('span'),time=document.createElement('span'),message=document.createElement('div');row.dataset.sender=sender;photo.classList.add('message-avatar');body.className='message-body';author.className='message-name';label.className='message-label';label.textContent=profile.name+(sender===identity?.id?' (you)':'');time.className='message-time';time.textContent=new Date(Math.abs(timestamp-Date.now())<86400000?timestamp:Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});message.textContent=text;author.append(label,time);body.append(author,message);row.append(photo,body); } else { row.className='system';row.textContent=text; }
    log.append(row);while(log.children.length>250) log.firstElementChild.remove();if(nearEnd) log.scrollTop=log.scrollHeight;
  }
  const openChannels=()=>[...peers.values()].filter(peer=>peer.pc.connectionState==='connected' && peer.channel?.readyState==='open');
  function chatControls() { const count=openChannels().length; $('chatSend').disabled=!joined || !count;$('chatText').disabled=!joined || !count;$('chatStatus').textContent=count ? `Direct chat · ${count} connected participant${count===1?'':'s'}` : 'Waiting for a direct connection.'; }
  function channelSend(peer,message) {
    if(peer.channel?.readyState!=='open' || peer.channel.bufferedAmount>131072) return false;
    const value=JSON.stringify(message),bytes=encoder.encode(value).length;if(bytes>65536 || peer.channel.bufferedAmount+bytes>131072) return false;
    try { peer.channel.send(value);return true; } catch { return false; }
  }
  function cleanProfile(value) {
    if(!value || typeof value.name!=='string') return null;
    const name=value.name.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').trim();
    if(!name || name.length>48 || (value.username!==undefined && typeof value.username!=='string') || (value.username && !/^[a-z0-9_.-]{3,24}$/.test(value.username))) return null;
    const avatar=typeof value.avatar==='string' && value.avatar.length<=32768 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatar) ? value.avatar : '';
    return {name,username:value.username || '',avatar};
  }
  function showProfile(target,profile,isLocal=false) { target.heading.textContent=profile.name+(isLocal?' (you)':'');target.avatar.hidden=false;target.avatar.src=profile.avatar || fallbackAvatar(profile.name);target.placeholderAvatar.textContent=profile.avatar?'':Array.from(profile.name)[0];target.placeholderAvatar.style.backgroundImage=profile.avatar?'url('+profile.avatar+')':'';refreshLayout(); }
  function ownProfile() { return cleanProfile(local.profile?.() || identity); }
  function announceProfile(peer) { const profile=ownProfile();if(profile) channelSend(peer,{type:'profile',profile}); }
  async function receiveProfile(peer,value) {
    const profile=cleanProfile(value);if(!profile) return;
    peer.name=profile.name;cacheProfile(peer.id,profile);showProfile(peer.tile,profile);parentMessage({type:'vumiro-peer-profile',id:peer.id,profile});
    try { if(local.updateContactProfile) await local.updateContactProfile(peer.id,profile); } catch { /* A noncontact participant need not be saved. */ }
  }
  function syncSettingsControls() { $('settingFps').value=streamSettings.fps;$('settingMbps').value=streamSettings.mbps;$('settingResolution').value=streamSettings.resolution;$('settingContent').value=streamSettings.contentHint;$('settingAudio').checked=streamSettings.audio;$('settingAudio').disabled=linuxPlatform;$('settingExcludeDiscord').checked=streamSettings.excludeDiscord;$('settingExcludeDiscordLabel').hidden=!nativeAudioSupported;$('settingExcludeDiscord').disabled=!nativeAudioSupported;$('excludeDiscordHelp').hidden=!nativeAudioSupported;$('roomAudioCapability').hidden=nativeAudioSupported;$('roomAudioCapability').textContent=linuxPlatform?'Microphone works on Linux, but system audio capture is not supported in this release.':'This device cannot filter the Discord desktop app from browser-captured audio. The capture picker may still offer system audio.'; }
  function videoConstraints() { const value={frameRate:{ideal:requestedFps,max:requestedFps}};if(streamSettings.resolution!=='native') { const height=Number.parseInt(streamSettings.resolution,10);value.height={max:height};value.width={max:Math.round(height*16/9)}; }return value; }
  function captureInfo() {
    const track=screen?.getVideoTracks()[0];if(!track) return;
    const actual=track.getSettings(),audioSelected=!!nativeAudioSession?.started||!!screen.getAudioTracks().length;$('captureInfo').textContent=`Capturing ${actual.width || '?'} × ${actual.height || '?'} · ${actual.frameRate ? Math.round(actual.frameRate) : '?'} FPS source · ${requestedFps} FPS requested · up to ${bitrateMbps} Mbps per participant. Screen audio ${audioSelected?(streamSettings.audio?'included':'paused'):'not selected'}.${nativeAudioSession?.started&&streamSettings.excludeDiscord?' Discord and Vumiro playback excluded.':''}`;
  }
  let settingsQueue=Promise.resolve();
  async function applySettings(value,notify=true) {
    const previous=streamSettings,clean=validateSettings(value);if(!clean) return;streamSettings=clean;requestedFps=clean.fps;bitrateMbps=clean.mbps;save(settingsKey,JSON.stringify(clean));syncSettingsControls();if(notify) parentMessage({type:'vumiro-stream-settings',settings:clean});
    settingsQueue=settingsQueue.then(async()=>{
      const track=screen?.getVideoTracks()[0];
      if(screen){if(nativeAudioSupported&&!linuxPlatform){screen.getAudioTracks().forEach(audio=>audio.stop());if(!streamSettings.audio)stopNativeAudioCapture();else if(!nativeAudioSession||previous.excludeDiscord!==streamSettings.excludeDiscord) { if(nativeAudioSession)stopNativeAudioCapture();startNativeAudioCapture(); }}else{screen.getAudioTracks().forEach(audio=>{audio.enabled=streamSettings.audio;});if(streamSettings.audio&&!screen.getAudioTracks().length)status('Screen audio was not selected. Stop sharing and choose a source with audio.');}}
      if(track) { track.contentHint=streamSettings.contentHint;try { await track.applyConstraints(videoConstraints()); } catch(error) { status('This capture could not apply every quality setting: '+error.message); } }
      await replaceTracks();await Promise.all([...peers.values()].map(peer=>peer.slots[0] ? tune(peer.slots[0].sender) : Promise.resolve()));captureInfo();
    }).catch(error=>status(error.message));
    await settingsQueue;
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
  function passwordEntry() { if(password) return Promise.resolve(password);$('passwordPrompt').hidden=false;$('guestPassword').focus();return new Promise(resolve=>{passwordResolve=resolve;}); }
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
    const url = new URL('/call', linuxPlatform?publicOrigin:location.href);
    // The embedded virtual host exists only on this machine. A public Worker serves the same room page.
    if (!linuxPlatform&&['screentask.local','localhost','127.0.0.1','[::1]'].includes(location.hostname) && !['localhost', '127.0.0.1', '[::1]'].includes(signal.hostname)) {
      url.protocol = signal.protocol === 'wss:' ? 'https:' : 'http:'; url.host = signal.host;
    }
    url.searchParams.set('room', roomValue($('room').value));url.searchParams.set('mode',roomMode);
    const clean = new URL(signal); clean.searchParams.delete('room'); clean.searchParams.delete('name'); clean.searchParams.delete('id');
    url.searchParams.set('signaling', clean.href); url.searchParams.set('fps', requestedFps); url.searchParams.set('mbps', bitrateMbps);
    // Grants belong to one approved identity and must never be copied into a public room link.
    return url.href;
  }
  function syncMuteControl() { const muted=!!microphone&&!microphone.getAudioTracks().some(track=>track.enabled);$('muteLabel').textContent=muted?'Unmute mic':'Mute mic';$('mute').setAttribute('aria-pressed',String(muted));$('mute').setAttribute('aria-label',muted?'Unmute microphone':'Mute microphone');$('mute').classList.toggle('active',!muted&&!!microphone);$('muteIcon').setAttribute('href',muted?'#i-mic-off':'#i-mic'); }
  function updateControls() {
    document.body.classList.toggle('in-room', joined || joining || !!localTile);
    $('join').disabled = joined || joining || !!localTile; $('leave').disabled = !joined && !joining && !localTile && !disconnected;
    for (const id of ['name', 'room', 'signaling']) $(id).disabled = joined || joining;
    $('share').disabled = !joined || !!screen; $('stopShare').disabled = !screen;
    $('mic').disabled = !joined || !!microphone; $('mute').disabled = !microphone; syncMuteControl();
    $('copyInvite').disabled = !joined;
    $('reconnect').hidden=!disconnected && ![...peers.values()].some(peer=>['failed','disconnected'].includes(peer.pc.connectionState));$('reconnect').disabled=joining;chatControls();roomState();
    $('mic').hidden=!!microphone;$('mute').hidden=!microphone;$('share').hidden=!!screen;$('stopShare').hidden=!screen;renderRoom();refreshLayout();
    if (joined) { $('invite').href = invitation(); $('invite').textContent = 'Open invitation'; }
    else { $('invite').removeAttribute('href'); $('invite').textContent = ''; }
  }
  function tile(name, local) {
    const element = document.createElement('article'); element.className = 'tile';element.tabIndex=0;element.setAttribute('aria-label','Focus '+name);
    const header = document.createElement('header'), heading = document.createElement('h2'); heading.textContent = name + (local ? ' (you)' : '');
    const avatar=document.createElement('img');avatar.className='avatar';avatar.alt='';avatar.hidden=true;const identityBox=document.createElement('div');identityBox.className='identity';identityBox.append(avatar,heading);
    const tools = document.createElement('div'), view = document.createElement('select'); view.setAttribute('aria-label', 'View ' + name);
    for (const [value, label] of [['fit','Fit'],['actual','Actual size']]) { const option = document.createElement('option'); option.value=value; option.textContent=label; view.append(option); }
    const full = document.createElement('button'); full.textContent = 'Fullscreen'; tools.append(view, full); header.append(identityBox, tools);
    const stage = document.createElement('div'); stage.className='stage';
    const video = document.createElement('video'); video.autoplay=true; video.playsInline=true; video.muted=local;
    const placeholder=document.createElement('div'); placeholder.className='placeholder'; const placeholderAvatar=document.createElement('div'),placeholderLabel=document.createElement('small');placeholderAvatar.className='placeholder-avatar';placeholderAvatar.textContent=Array.from(name)[0] || '?';placeholderLabel.textContent='Here with you · not sharing a screen';placeholder.append(placeholderAvatar,placeholderLabel);
    const stats=document.createElement('div'); stats.className='stats'; stats.textContent=local?'Your screen preview':'Waiting for direct connection…';
    stage.append(video,placeholder); element.append(header,stage,stats); $('tiles').append(element);
    view.onchange = () => { stage.classList.toggle('actual', view.value === 'actual'); resize(); };
    function resize() { if (view.value==='actual') { video.style.width=video.videoWidth+'px'; video.style.height=video.videoHeight+'px'; } else { video.style.width='';video.style.height=''; } }
    async function fullscreen() { try { if(document.fullscreenElement) await document.exitFullscreen();else await stage.requestFullscreen(); } catch(error) { status('Fullscreen: '+error.message); } }
    video.onresize=resize;full.onclick=fullscreen;stage.ondblclick=event=>{ event.preventDefault();fullscreen(); };
    const result={element,video,stats,placeholder,heading,avatar,placeholderAvatar,audios:[],sharing:false};
    result.show = sharing => { result.sharing=sharing; placeholder.hidden=sharing; video.style.visibility=sharing?'visible':'hidden';refreshLayout(); };
    element.onclick=event=>{ if(event.target.closest('button,select')) return;const found=[...peers.values()].find(peer=>peer.tile===result);focusedId=found?.id || selfId || identity?.id || '';manualFocus=true;refreshLayout(); };
    element.onkeydown=event=>{ if(event.target===element && ['Enter',' '].includes(event.key)) { event.preventDefault();element.click(); } };
    result.show(false);return result;
  }
  function play(element) { const promise=element.play(); if(promise) promise.catch(()=>{ $('enableAudio').hidden=false; }); }
  function send(message) { if(socket && socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  const relay = candidate => candidate && /\btyp\s+relay\b/i.test(typeof candidate==='string'?candidate:candidate.candidate || '');
  function validDescription(description) { return description && ['offer','answer'].includes(description.type) && typeof description.sdp==='string' && description.sdp.length<=60000 && !relay(description.sdp); }
  function currentTrack(slot) { return slot===0 ? screen?.getVideoTracks()[0] : slot===1 ? (nativeAudioSupported&&!linuxPlatform?(nativeAudioSession?.started?nativeAudioTrack:null):screen?.getAudioTracks()[0]) : microphone?.getAudioTracks()[0]; }
  async function ensureNativeAudioGraph(){if(!audioContext||audioContext.state==='closed'){const Context=window.AudioContext||window.webkitAudioContext;if(!Context)throw Error('This browser cannot play the native audio stream.');audioContext=new Context({sampleRate:48000,latencyHint:'interactive'});audioDestination=audioContext.createMediaStreamDestination();nativeAudioTrack=audioDestination.stream.getAudioTracks()[0];}if(audioContext.state!=='running')await audioContext.resume();return audioContext;}
  function stopNativeAudioCapture(notify=true){const session=nativeAudioSession;if(!session)return;nativeAudioSession=null;++nativeAudioGeneration;if(notify&&embedded)parentMessage({type:'vumiro-stream-audio',action:'stop',id:session.id});for(const source of session.sources){try{source.stop();}catch{}try{source.disconnect();}catch{}}session.sources.clear();if(nativeAudioTrack)nativeAudioTrack.enabled=false;}
  function startNativeAudioCapture(){if(linuxPlatform||!nativeAudioSupported||!embedded||!screen||!streamSettings.audio||nativeAudioSession)return;const session={id:Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join(''),generation:++nativeAudioGeneration,started:false,lastSequence:-1,nextTime:0,sources:new Set()};nativeAudioSession=session;ensureNativeAudioGraph().then(()=>{if(nativeAudioSession!==session||!screen||!streamSettings.audio)return;nativeAudioTrack.enabled=true;parentMessage({type:'vumiro-stream-audio',action:'start',id:session.id,excludeDiscord:streamSettings.excludeDiscord});}).catch(error=>{if(nativeAudioSession!==session)return;nativeAudioSession=null;status('System audio could not start: '+error.message);replaceTracks().catch(()=>{});captureInfo();});}
  function playNativeAudio(message){const session=nativeAudioSession;if(!session||session.id!==message.id||!session.started||!screen||!streamSettings.audio||message.sampleRate!==48000||message.channels!==2||message.frames!==1920||!(message.pcm instanceof ArrayBuffer)||message.pcm.byteLength!==message.frames*message.channels*4||!Number.isSafeInteger(message.sequence)||message.sequence<=session.lastSequence)return;session.lastSequence=message.sequence;if(!audioContext||audioContext.state!=='running'||session.sources.size>=5)return;const now=audioContext.currentTime;if(!session.nextTime||session.nextTime<now+0.004)session.nextTime=now+0.06;if(session.nextTime-now>0.22)return;const samples=new Float32Array(message.pcm),buffer=audioContext.createBuffer(2,message.frames,message.sampleRate),left=buffer.getChannelData(0),right=buffer.getChannelData(1);for(let i=0,j=0;i<message.frames;i++,j+=2){left[i]=samples[j];right[i]=samples[j+1];}const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioDestination);session.sources.add(source);source.onended=()=>{session.sources.delete(source);try{source.disconnect();}catch{}};source.start(session.nextTime);session.nextTime+=message.frames/message.sampleRate;}
  function receiveNativeAudio(message){if(message.action==='state'){nativeAudioSupported=message.supported===true;syncSettingsControls();if(nativeAudioSupported&&screen){screen.getAudioTracks().forEach(track=>track.stop());if(streamSettings.audio)startNativeAudioCapture();}else if(!nativeAudioSupported&&nativeAudioSession){stopNativeAudioCapture();replaceTracks().catch(()=>{});}return;}const session=nativeAudioSession;if(!session||message.id!==session.id)return;if(message.action==='started'){if(message.sampleRate!==48000||message.channels!==2)return;session.started=true;session.nextTime=0;if(nativeAudioTrack)nativeAudioTrack.enabled=streamSettings.audio;replaceTracks().then(captureInfo).catch(error=>status(error.message));}else if(message.action==='stopped'){session.started=false;}else if(message.action==='error'){stopNativeAudioCapture(false);replaceTracks().catch(()=>{});status(typeof message.message==='string'?message.message:'System audio capture stopped. Your microphone is still available.');captureInfo();}else if(message.action==='samples')playNativeAudio(message);}
  function announce(peer) { channelSend(peer,{sharing:!!screen,mic:!!microphone && microphone.getAudioTracks().some(t=>t.enabled)}); }
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
  function dataChannel(peer, channel) {
    if(peer.channel && peer.channel!==channel) { channel.close();return; }
    peer.channel=channel;peer.dataWindow=Date.now();peer.dataCount=0;peer.chatWindow=Date.now();peer.chatCount=0;
    channel.onopen=()=>{ announce(peer);announceProfile(peer);chatControls();chatLine(peer.name+' connected to direct chat.'); };
    channel.onclose=()=>{ chatControls();chatLine(peer.name+' disconnected from direct chat.'); };
    channel.onerror=()=>chatControls();
    channel.onmessage=event=>{
      if(typeof event.data!=='string' || event.data.length>65536 || encoder.encode(event.data).length>65536 || peers.get(peer.id)!==peer) return;
      const now=Date.now();if(now-peer.dataWindow>10000) { peer.dataWindow=now;peer.dataCount=0; }if(++peer.dataCount>60) return;
      try {
        const state=JSON.parse(event.data);
        if(!state || typeof state!=='object') return;
        if(state.type==='chat') {
          if(now-peer.chatWindow>10000) { peer.chatWindow=now;peer.chatCount=0; }
          if(++peer.chatCount>20 || typeof state.id!=='string' || !/^[A-Za-z0-9_-]{16,64}$/.test(state.id) || typeof state.text!=='string' || !state.text.trim() || state.text.length>2000 || !Number.isSafeInteger(state.timestamp)) return;
          if(rememberMessage(peer.id+':'+state.id)) chatLine(state.text,peer.id,state.timestamp);
        } else if(state.type==='profile') {
          if(!peer.profileWindow || now-peer.profileWindow>10000) { peer.profileWindow=now;peer.profileCount=0; }if(++peer.profileCount<=10) receiveProfile(peer,state.profile);
        } else if(typeof state.sharing==='boolean') peer.tile.show(state.sharing);
      } catch { /* Ignore malformed direct metadata. */ }
    };
  }
  function peerError(peer, error) { if(peers.get(peer.id)===peer) { peer.tile.stats.textContent='Connection issue: '+error.message; } }
  function createPeer(id, name) {
    if(typeof id!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(id) || id===selfId) return null;
    if(peers.has(id)) return peers.get(id);
    name=typeof name==='string'?name.slice(0,48):'Guest';
    if(peers.size>=7) return null;
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],bundlePolicy:'max-bundle'});
    const peer={id,name:name || 'Guest',pc,tile:tile(name || 'Guest',false),polite:selfId.localeCompare(id)>0,initiator:selfId.localeCompare(id)<0,makingOffer:false,ignoreOffer:false,settingAnswer:false,pending:[],queue:Promise.resolve(),lastStats:null,channel:null};
    peers.set(id,peer);const cached=profileCache.get(id);if(cached) showProfile(peer.tile,cached);else local.listFriends().then(friends=>{ const friend=friends.find(item=>item.id===id);if(friend && !profileCache.has(id)) { const profile=cleanProfile(friend);if(profile) { cacheProfile(id,profile);if(peers.get(id)===peer) showProfile(peer.tile,profile); } } }).catch(()=>{});refreshLayout();
    // Only the initial offerer creates transceivers. Pre-creating them on the answerer
    // can duplicate media sections during rollback, leaving stale ICE generations.
    peer.slots=peer.initiator ? ['video','audio','audio'].map((kind,index)=>pc.addTransceiver(currentTrack(index) || kind,{direction:'sendrecv'})) : [];
    // Ordered, reliable direct channel carries bounded display state, profiles and room chat.
    if(peer.initiator) dataChannel(peer,pc.createDataChannel('room-state'));
    pc.ondatachannel=event=>dataChannel(peer,event.channel);
    pc.ontrack=event=>{
      const index=pc.getTransceivers().indexOf(event.transceiver), track=event.track;
      try {
        if('jitterBufferTarget' in event.receiver) event.receiver.jitterBufferTarget=50;
        else if('playoutDelayHint' in event.receiver) event.receiver.playoutDelayHint=0.05;
      } catch { /* Optional browser latency controls. */ }
      if(track.kind==='video') { peer.tile.video.srcObject=new MediaStream([track]); play(peer.tile.video); track.onunmute=()=>{ if(!peer.channel || peer.channel.readyState!=='open') peer.tile.show(true); }; }
      else { const audio=document.createElement('audio'); audio.autoplay=true; audio.srcObject=new MediaStream([track]); peer.tile.element.append(audio);peer.tile.audios.push(audio); play(audio); }
      track.onended=()=>{ if(index===0) peer.tile.show(false); };
    };
    pc.onicecandidate=event=>{ if(!relay(event.candidate)) send({type:'signal',to:id,candidate:event.candidate?.toJSON() ?? null}); };
    pc.onnegotiationneeded=()=>{
      peer.queue=peer.queue.then(async()=>{
        if(pc.signalingState!=='stable' || (!pc.remoteDescription && !peer.initiator)) return;
        try { peer.makingOffer=true; await pc.setLocalDescription(); send({type:'signal',to:id,description:pc.localDescription}); }
        finally { peer.makingOffer=false; }
      }).catch(error=>peerError(peer,error));
    };
    pc.onconnectionstatechange=()=>{
      updateControls();
      if(pc.connectionState==='connected') { peer.tile.stats.textContent='Direct connected · measuring video…'; for(const transceiver of peer.slots) tune(transceiver.sender); announce(peer); }
      if(pc.connectionState==='failed') peer.tile.stats.textContent='Direct connection failed. Your networks may require a media relay.';
      if(pc.connectionState==='disconnected') peer.tile.stats.textContent='Connection interrupted · waiting to recover…';
    };
    return peer;
  }
  function receiveSignal(message) {
    const peer=peers.get(message.from); if(!peer) return;
    peer.queue=peer.queue.then(async()=>{
      const pc=peer.pc; if(pc.signalingState==='closed') return;
      if(message.description) {
        const description=message.description; if(!validDescription(description)) throw Error('Invalid direct connection offer.');
        const ready=!peer.makingOffer && (pc.signalingState==='stable' || peer.settingAnswer);
        const collision=description.type==='offer' && !ready;
        peer.ignoreOffer=!peer.polite && collision; if(peer.ignoreOffer) return;
        peer.settingAnswer=description.type==='answer';
        try { await pc.setRemoteDescription(description); } finally { peer.settingAnswer=false; }
        if(!peer.slots.length) {
          peer.slots=pc.getTransceivers().slice(0,3);
          for(let slot=0;slot<peer.slots.length;slot++) {
            peer.slots[slot].direction='sendrecv';
            await peer.slots[slot].sender.replaceTrack(currentTrack(slot) || null);
          }
        }
        for(const candidate of peer.pending.splice(0)) await pc.addIceCandidate(candidate);
        if(description.type==='offer') { await pc.setLocalDescription();send({type:'signal',to:peer.id,description:pc.localDescription}); }
      } else if('candidate' in message) {
        if(peer.ignoreOffer || relay(message.candidate)) return;
        if(pc.remoteDescription) await pc.addIceCandidate(message.candidate); else if(peer.pending.length<256) peer.pending.push(message.candidate);
      }
    }).catch(error=>peerError(peer,error));
  }
  function removePeer(id) { const peer=peers.get(id); if(!peer) return; peers.delete(id); peer.pc.close(); peer.tile.element.remove();chatControls();refreshLayout(); }
  function clearPeers() { for(const id of [...peers.keys()]) removePeer(id); }
  async function replaceTracks() {
    await Promise.all([...peers.values()].map(async peer=>{
      for(let slot=0;slot<peer.slots.length;slot++) await peer.slots[slot].sender.replaceTrack(currentTrack(slot) || null);
      if(peer.slots[0]) await tune(peer.slots[0].sender); announce(peer);
    }));
  }
  async function stopShare() {
    const previous=screen; screen=null; stopNativeAudioCapture();if(previous) for(const track of previous.getTracks()) track.stop();
    if(localTile) { localTile.show(false); localTile.video.srcObject=null; }
    try { await replaceTracks(); } catch(error) { status(error.message); }
    if(audioContext?.state==='running')audioContext.suspend().catch(()=>{});
    updateControls();
  }
  async function share() {
    $('share').disabled=true; const thisGeneration=generation;
    try {
      const nativeWanted=nativeAudioSupported&&!linuxPlatform&&streamSettings.audio;if(embedded&&!linuxPlatform&&streamSettings.audio)ensureNativeAudioGraph().catch(error=>status('System audio could not start: '+error.message));
      const options={video:videoConstraints(),audio:streamSettings.audio&&!nativeWanted};if(streamSettings.audio&&!nativeWanted&&!linuxPlatform)options.systemAudio='include';
      const capture=await navigator.mediaDevices.getDisplayMedia(options);
      if(!joined || generation!==thisGeneration) { capture.getTracks().forEach(t=>t.stop()); return; }
      const track=capture.getVideoTracks()[0]; if(!track) { capture.getTracks().forEach(t=>t.stop()); throw Error('No screen video was selected.'); }
      track.contentHint=streamSettings.contentHint; screen=capture; track.onended=()=>{ if(screen===capture) stopShare(); };
      if(nativeAudioSupported&&streamSettings.audio)startNativeAudioCapture();
      localTile.video.srcObject=new MediaStream([track]);localTile.show(true);play(localTile.video);
      await replaceTracks();
      captureInfo();
      status('Sharing your screen. Everyone can share at the same time.');
    } catch(error) { status(error.name==='NotAllowedError'?'Screen sharing was cancelled or denied.':error.message); }
    finally { if(!screen&&audioContext?.state==='running')audioContext.suspend().catch(()=>{});updateControls(); }
  }
  async function enableMic() {
    $('mic').disabled=true; const thisGeneration=generation;
    try {
      const capture=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(!joined || generation!==thisGeneration) { capture.getTracks().forEach(t=>t.stop());return; }
      microphone=capture;
      for(const track of capture.getAudioTracks()) track.onended=()=>{
        if(microphone!==capture) return;microphone=null;syncMuteControl();
        replaceTracks().catch(error=>status(error.message));updateControls();status('Microphone disconnected. You can enable another microphone.');
      };
      await replaceTracks();status('Microphone enabled.');
    } catch(error) { status('Microphone: '+error.message); }
    finally { updateControls(); }
  }
  function openSocket() {
    const thisGeneration=generation; roomNonce=''; roomFriendsRevision=0; joining=true;updateControls();
    let connection; try { connection=new WebSocket(signalUrl()); } catch(error) { joining=false;status(error.message);updateControls();return; }
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
          if(!localTile) localTile=tile($('name').value.trim() || 'Guest',true);
          const profile=ownProfile();if(profile) { cacheProfile(identity.id,profile);showProfile(localTile,profile,true); }
          if(screen) { localTile.video.srcObject=new MediaStream(screen.getVideoTracks());localTile.show(true);play(localTile.video); }
          for(const peer of message.peers || []) createPeer(peer.id,peer.name);
          status('In the room · '+(peers.size+1)+' participant'+(peers.size?'s':'')+'.');updateControls();
          updateRoomFriends().catch(error=>status(error.message));
        } else if(message.type==='peer-joined' && joined) { createPeer(message.id,message.name);status('A participant joined · '+(peers.size+1)+' in the room.'); }
        else if(message.type==='peer-left') { removePeer(message.id);status('A participant left · '+(peers.size+1)+' in the room.'); }
        else if(message.type==='room-policy' && joined) { displayPolicy(message.policy,message.policyRevision);if(policyAck?.revision===message.policyRevision) policyAck.resolve();roomState(); }
        else if(message.type==='signal' && joined) receiveSignal(message);
        else if(message.type==='error') { if(policyAck) policyAck.reject(Error(message.message || 'Room access was rejected.'));status(message.message || 'Signaling service rejected a request.'); }
      } catch(error) { status('Signaling error: '+error.message); }
    };
    connection.onerror=()=>{ if(generation===thisGeneration) status('Cannot reach the signaling service. Check its address and that it is running.'); };
    connection.onclose=event=>{
      if(generation!==thisGeneration || socket!==connection) return;
      socket=null;joined=false;joining=false;disconnected=true;if(policyAck) policyAck.reject(Error('Connection interrupted before room access was confirmed.'));clearPeers();updateControls();chatLine('Room connection lost. Reconnect is available.');
      if(passwordResolve) { passwordResolve('');passwordResolve=null; }if(serverPolicy.mode==='private' && !ownsRoom() && [1008,4003].includes(event.code)) { password='';$('passwordPrompt').hidden=false;$('passwordError').textContent=event.reason || 'Check your room password and try again.'; }
      if([1008,4001,4003,4008].includes(event.code)) { status(event.reason || 'Room unavailable or full. Try another room.');return; }
      const seconds=Math.min(10,2**retry++);status(event.code===4004 ? 'Waiting for the room owner. Trying again in '+seconds+' seconds…' : 'Signaling disconnected. Rejoining in '+seconds+' seconds…');
      reconnectTimer=setTimeout(()=>{ if(generation===thisGeneration) openSocket(); },seconds*1000);
    };
  }
  async function join() {
    if(joined || joining) return;
    try { await identityReady; } catch(error) { status(error.message); return; }
    if(!identity) { status('Create a local profile from Friends before joining a room.'); return; }
    let raw=$('room').value.trim();
    try {
      const pasted=new URL(raw); raw=pasted.searchParams.get('room') || '';
      roomGrant=grantValue(pasted.searchParams.get('grant'));grantRoom=raw;if(['public','friends','private'].includes(pasted.searchParams.get('mode'))) roomMode=pasted.searchParams.get('mode');
      if(pasted.searchParams.get('signaling')) $('signaling').value=canonicalSignalInput(pasted.searchParams.get('signaling'));
      else if(['http:','https:'].includes(pasted.protocol)) $('signaling').value=canonicalSignalInput((pasted.protocol==='https:'?'wss:':'ws:')+'//'+pasted.host+'/call-signaling');
    } catch { /* plain room code */ }
    if(!validRoom(raw)) { status('Use a new private-room invitation. Older anonymous room links are no longer supported.');return; }
    if(raw!==grantRoom) roomGrant=null;grantRoom=raw;
    $('room').value=raw;
    try { const normalized=signalUrl();normalized.searchParams.delete('room');normalized.searchParams.delete('name');normalized.searchParams.delete('id');$('signaling').value=normalized.href; } catch(error) { status(error.message);return; }
    clearTimeout(reconnectTimer);generation++;save('call-name',$('name').value.trim());save('call-signaling',$('signaling').value.trim());
    const url=new URL(location.href);url.searchParams.set('room',raw);if(roomGrant) url.searchParams.set('grant',JSON.stringify(roomGrant));else url.searchParams.delete('grant');history.replaceState(null,'',url);status('Joining room…');openSocket();
  }
  async function leave() {
    generation++;disconnected=false;if(policyAck) policyAck.reject(Error('You left the room.'));password='';if(passwordResolve) { passwordResolve('');passwordResolve=null; }clearTimeout(reconnectTimer);const old=socket;socket=null;joined=false;joining=false;if(old) old.close(1000,'Left room');
    clearPeers();await stopShare();if(microphone) microphone.getTracks().forEach(t=>t.stop());microphone=null;if(audioContext){try{await audioContext.close();}catch{}audioContext=null;audioDestination=null;nativeAudioTrack=null;}
    if(localTile) localTile.element.remove();localTile=null;selfId='';syncMuteControl();updateControls();status('You left the room.');chatLine('You left the room.');
    if(embedded) parent.postMessage({type:'vumiro-call-ended'}, location.origin);
  }
  $('name').value=query.get('name')?.slice(0,48) || readSaved('call-name') || 'Guest';$('room').value=query.get('room') || '';
  const savedSignal=readSaved('call-signaling'),querySignal=query.get('signaling');
  $('signaling').value=canonicalSignalInput(querySignal || savedSignal || (location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/call-signaling');
  if(!querySignal&&savedSignal&&savedSignal!==$('signaling').value)save('call-signaling',$('signaling').value);
  $('join').onclick=join;$('reconnect').onclick=reconnect;$('leave').onclick=leave;$('share').onclick=share;$('stopShare').onclick=stopShare;$('mic').onclick=enableMic;
  $('mute').onclick=()=>{ if(microphone) { const enabled=!microphone.getAudioTracks().some(track=>track.enabled);microphone.getAudioTracks().forEach(track=>track.enabled=enabled);syncMuteControl();for(const peer of peers.values()) announce(peer); } };
  $('copyInvite').onclick=async()=>{ try { await navigator.clipboard.writeText(invitation());status(roomMode==='private'?'Room link copied. Share the password separately.':roomMode==='public'?'Room link copied. Anyone with a profile can join.':'Room link copied. Mutual friends can join.'); } catch { status('Copy this invitation: '+invitation()); } };
  $('enableAudio').onclick=()=>{ $('enableAudio').hidden=true;for(const peer of peers.values()) { play(peer.tile.video);for(const audio of peer.tile.audios) play(audio); } };
  addEventListener('beforeunload',()=>{ generation++;stopNativeAudioCapture();if(socket) socket.close();for(const stream of [screen,microphone]) stream?.getTracks().forEach(t=>t.stop());clearPeers(); });
  addEventListener('message',event=>{
    if(!embedded || event.origin!==location.origin || event.source!==parent) return;
    if(event.data?.type==='vumiro-friend-status') friendStatus(event.data);
    else if(event.data?.type==='vumiro-friends-changed') { if(profileRequestId) parentMessage({type:'vumiro-friend-status-query',id:profileRequestId});updateRoomFriends().catch(error=>status(error.message)); }
    else if(event.data?.type==='vumiro-call-leave') leave();
    else if(event.data?.type==='vumiro-call-reconnect') reconnect();
    else if(event.data?.type==='vumiro-stream-settings') applySettings(event.data.settings,false);
    else if(event.data?.type==='vumiro-stream-audio') receiveNativeAudio(event.data);
    else if(event.data?.type==='vumiro-profile') refreshProfile();
    else if(event.data?.type==='vumiro-room-access' && event.data.room===roomValue($('room').value) && ['public','friends','private'].includes(event.data.mode)) {
      if(accessReceived) return;accessReceived=true;roomMode=event.data.mode;ownerPolicy={mode:roomMode};if(typeof event.data.name==='string') roomName=event.data.name.trim().slice(0,60) || roomName;if(typeof event.data.password==='string' && event.data.password.length<=128) password=event.data.password;renderRoom();accessResolve?.();
    }
  });
  addEventListener('vumiro-friends-changed',()=>{ if(profileRequestId) parentMessage({type:'vumiro-friend-status-query',id:profileRequestId});updateRoomFriends().catch(error=>status(error.message)); });
  function reconnect() { clearTimeout(reconnectTimer);generation++;if(policyAck) policyAck.reject(Error('Reconnecting before room access was confirmed.'));const old=socket;socket=null;if(old) old.close(1000,'Reconnecting');joined=false;joining=false;disconnected=true;clearPeers();status('Reconnecting to the room…');join(); }
  async function refreshProfile() { try { const current=await local.initialize();if(!current) return;identity=current; } catch { return; }const profile=ownProfile();if(!profile) return;$('name').value=profile.name;cacheProfile(identity.id,profile);if(localTile) showProfile(localTile,profile,true);for(const peer of peers.values()) announceProfile(peer); }
  for(const id of ['settingFps','settingMbps','settingResolution','settingContent','settingAudio','settingExcludeDiscord']) $(id).onchange=()=>{ const value={fps:Number($('settingFps').value),mbps:Number($('settingMbps').value),resolution:$('settingResolution').value,contentHint:$('settingContent').value,audio:$('settingAudio').checked,excludeDiscord:$('settingExcludeDiscord').checked};if(validateSettings(value)){if(nativeAudioSupported&&screen&&value.audio)ensureNativeAudioGraph().catch(error=>status('System audio could not start: '+error.message));applySettings(value);}else { syncSettingsControls();status('Choose 1–120 FPS and 1–100 Mbps.'); } };
  $('chatForm').onsubmit=event=>{
    event.preventDefault();const text=$('chatText').value.trim(),now=Date.now();if(!joined || !text || text.length>2000 || !openChannels().length) return;
    if(now-lastChatSent<500) { $('chatStatus').textContent='Wait a moment before sending another message.';return; }
    const message={type:'chat',id:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),text,timestamp:now};
    let sent=0;for(const peer of openChannels()) if(channelSend(peer,message)) sent++;
    if(!sent) { $('chatStatus').textContent='Connection busy. Try sending again in a moment.';return; }
    lastChatSent=now;rememberMessage(selfId+':'+message.id);chatLine(text,identity.id,now);$('chatText').value='';$('chatText').style.height='';chatControls();
    if(sent<openChannels().length) $('chatStatus').textContent='Sent to '+sent+' participants. Another connection is busy.';
  };
  addEventListener('storage',event=>{ if(event.key===settingsKey) { try { applySettings(JSON.parse(event.newValue),false); } catch { /* Ignore malformed settings. */ } } });
  addEventListener('vumiro-profile-changed',refreshProfile);
  $('passwordForm').onsubmit=event=>{ event.preventDefault();const value=$('guestPassword').value;if(value.length<6 || value.length>128) { $('passwordError').textContent='Enter a password of 6–128 characters.';return; }password=value;$('guestPassword').value='';$('passwordError').textContent='';$('passwordPrompt').hidden=true;if(passwordResolve) { const resolve=passwordResolve;passwordResolve=null;resolve(value); }else reconnect(); };
  function policyFields() { const mode=$('policyVisibility').value;$('policyPasswordLabel').hidden=mode!=='private';$('policyHelp').textContent=mode==='private'?'Anyone with the password can join. Changing the password disconnects guests.':mode==='public'?'People with a profile can discover and join this room.':'Only mutual friends can discover and join this room.'; }
  $('roomPolicyOpen').onclick=()=>{ if(!ownsRoom()) return;$('policyName').value=roomName;$('policyVisibility').value=roomMode;$('policyPassword').value='';$('policyError').textContent='';$('roomPolicyDialog').hidden=false;$('streamSettings').hidden=true;policyFields();$('policyName').focus(); };
  $('roomPolicyClose').onclick=()=>{$('roomPolicyDialog').hidden=true;$('roomPolicyOpen').focus();};$('policyVisibility').onchange=policyFields;
  $('roomPolicyForm').onsubmit=async event=>{ event.preventDefault();if(policyBusy) return;policyBusy=true;$('policySave').disabled=true;$('policyError').textContent='';try { await updatePolicy($('policyVisibility').value,$('policyPassword').value,$('policyName').value);$('policyPassword').value='';$('roomPolicyDialog').hidden=true;status('Room access updated.'); } catch(error) { $('policyError').textContent=error.message; }finally { policyBusy=false;$('policySave').disabled=false; } };
  $('chatTab').onclick=()=>pane(false);$('peopleTab').onclick=()=>pane(true);function pane(people) { $('peopleView').hidden=!people;$('chatView').hidden=people;$('peopleTab').classList.toggle('active',people);$('chatTab').classList.toggle('active',!people);$('peopleTab').setAttribute('aria-pressed',String(people));$('chatTab').setAttribute('aria-pressed',String(!people)); }
  $('qualityOpen').onclick=()=>{ $('streamSettings').hidden=!$('streamSettings').hidden;$('roomPolicyDialog').hidden=true;if(!$('streamSettings').hidden) $('settingFps').focus(); };$('settingsClose').onclick=()=>{$('streamSettings').hidden=true;$('qualityOpen').focus();};
  addEventListener('keydown',event=>{ if(event.key==='Escape') { if(!$('streamSettings').hidden) $('qualityOpen').focus();else if(!$('roomPolicyDialog').hidden) $('roomPolicyOpen').focus();$('streamSettings').hidden=true;$('roomPolicyDialog').hidden=true; } });
  $('chatText').oninput=()=>{ $('chatText').style.height='auto';$('chatText').style.height=Math.min(110,$('chatText').scrollHeight)+'px'; };
  $('chatText').onkeydown=event=>{ if(event.key==='Enter' && !event.shiftKey) { event.preventDefault();$('chatForm').requestSubmit(); } };
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
      const old=peer.lastStats;peer.lastStats={frames,bytes,timestamp};
      let text=path+' · '+(peer.tile.sharing?'waiting for video':'not sharing');
      if(peer.tile.sharing && old && timestamp>old.timestamp) text=path+' · '+Math.max(0,(frames-old.frames)*1000/(timestamp-old.timestamp)).toFixed(1)+' decoded FPS · '+Math.max(0,(bytes-old.bytes)*8/(timestamp-old.timestamp)/1000).toFixed(2)+' Mbps';
      peer.tile.stats.textContent=text;
    })); } catch { /* A departing peer may close during sampling. */ } finally { sampling=false; }
  },2000);
  updateControls();
  identityReady.then(value=>{
    if(!value) {
      const home=new URL('/friends.html',location.href);home.search=location.search;home.searchParams.delete('autojoin');home.searchParams.delete('embedded');location.replace(home.href);return;
    }
    if(!query.get('name')) $('name').value=value.name;
    if(!$('room').value) $('room').value=code();if(roomName==='Your room' && !ownsRoom()) roomName='Vumiro room';renderRoom();
    if(query.get('autojoin')==='1') join();
  }).catch(error=>status(error.message));
})();
