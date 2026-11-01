/* Vumiro room: signaling-only server, direct WebRTC media. No TURN configuration. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), query = new URLSearchParams(location.search);
  const embedded = query.get('embedded') === '1' && parent !== window;
  document.body.classList.toggle('embedded', embedded);
  const settingsKey='vumiro-stream-settings', encoder=new TextEncoder();
  const defaultSettings={fps:Math.min(120,Math.max(1,Number(query.get('fps')) || 60)),mbps:Math.min(100,Math.max(1,Number(query.get('mbps')) || 20)),resolution:'native',contentHint:'detail',audio:true};
  function validateSettings(value) {
    if(!value || typeof value!=='object' || !Number.isFinite(value.fps) || !Number.isFinite(value.mbps) || value.fps<1 || value.fps>120 || value.mbps<1 || value.mbps>100 || !['native','720p','1080p','1440p','2160p'].includes(value.resolution) || !['detail','motion'].includes(value.contentHint) || typeof value.audio!=='boolean') return null;
    return {fps:Math.round(value.fps),mbps:Math.round(value.mbps),resolution:value.resolution,contentHint:value.contentHint,audio:value.audio};
  }
  let streamSettings={...defaultSettings};
  try { streamSettings=validateSettings(JSON.parse(localStorage.getItem(settingsKey))) || streamSettings; } catch { /* Use migrated query defaults. */ }
  let requestedFps=streamSettings.fps, bitrateMbps=streamSettings.mbps, roomGrant=null, disconnected=false;
  function grantValue(raw) {
    if(typeof raw!=='string' || raw.length>1024) return null;
    try { const value=JSON.parse(raw); return value && /^[A-Za-z0-9_-]{16,64}$/.test(value.nonce || '') && Number.isSafeInteger(value.expires) && value.expires>Date.now() && value.expires<=Date.now()+86400000 && /^[A-Za-z0-9_-]{86}$/.test(value.signature || '') ? {nonce:value.nonce,expires:value.expires,signature:value.signature} : null; } catch { return null; }
  }
  roomGrant=grantValue(query.get('grant'));
  let grantRoom=query.get('room') || '';
  const parentMessage=message=>{ if(embedded) parent.postMessage(message,location.origin); };
  const roomState=()=>parentMessage({type:'vumiro-room-state',room:roomValue($('room').value),joined,sharing:!!screen});
  const peers = new Map();
  const local = window.ScreenTaskLocalProfile;
  let identity = null, roomNonce = '', roomFriendsRevision = 0;
  const identityReady = local.initialize().then(value => { identity = value; return value; });
  let selfId = '', socket = null, joined = false, reconnectTimer = 0, retry = 0, generation = 0;
  let screen = null, microphone = null, localTile = null, joining = false;
  const readSaved = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* optional */ } };
  function code() { return identity.id + '_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join(''); }
  function status(message) { $('status').textContent = message; }
  const seenMessages=new Set(); let lastChatSent=0;
  function rememberMessage(key) { if(seenMessages.has(key)) return false; seenMessages.add(key); if(seenMessages.size>1000) seenMessages.delete(seenMessages.values().next().value); return true; }
  function chatLine(text, name) {
    const log=$('chatLog'), nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<60, row=document.createElement('li');
    if(name) { const author=document.createElement('strong');author.textContent=name;row.append(author,document.createTextNode(text)); } else { row.className='system';row.textContent=text; }
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
  function showProfile(target,profile,isLocal=false) { target.heading.textContent=profile.name+(isLocal?' (you)':'');target.avatar.hidden=!profile.avatar;if(profile.avatar) target.avatar.src=profile.avatar;else target.avatar.removeAttribute('src'); }
  function ownProfile() { return cleanProfile(local.profile?.() || identity); }
  function announceProfile(peer) { const profile=ownProfile();if(profile) channelSend(peer,{type:'profile',profile}); }
  async function receiveProfile(peer,value) {
    const profile=cleanProfile(value);if(!profile) return;
    peer.name=profile.name;showProfile(peer.tile,profile);parentMessage({type:'vumiro-peer-profile',id:peer.id,profile});
    try { if(local.updateContactProfile) await local.updateContactProfile(peer.id,profile); } catch { /* A noncontact participant need not be saved. */ }
  }
  function syncSettingsControls() { $('settingFps').value=streamSettings.fps;$('settingMbps').value=streamSettings.mbps;$('settingResolution').value=streamSettings.resolution;$('settingContent').value=streamSettings.contentHint;$('settingAudio').checked=streamSettings.audio; }
  function videoConstraints() { const value={frameRate:{ideal:requestedFps,max:requestedFps}};if(streamSettings.resolution!=='native') { const height=Number.parseInt(streamSettings.resolution,10);value.height={max:height};value.width={max:Math.round(height*16/9)}; }return value; }
  function captureInfo() {
    const track=screen?.getVideoTracks()[0];if(!track) return;
    const actual=track.getSettings();$('captureInfo').textContent=`Capturing ${actual.width || '?'} × ${actual.height || '?'} · ${actual.frameRate ? Math.round(actual.frameRate) : '?'} FPS source · ${requestedFps} FPS requested · up to ${bitrateMbps} Mbps per participant. Screen audio ${screen.getAudioTracks().length?(streamSettings.audio?'included':'paused'):'not selected'}.`;
  }
  let settingsQueue=Promise.resolve();
  async function applySettings(value,notify=true) {
    const clean=validateSettings(value);if(!clean) return;streamSettings=clean;requestedFps=clean.fps;bitrateMbps=clean.mbps;save(settingsKey,JSON.stringify(clean));syncSettingsControls();if(notify) parentMessage({type:'vumiro-stream-settings',settings:clean});
    settingsQueue=settingsQueue.then(async()=>{
      const track=screen?.getVideoTracks()[0];
      screen?.getAudioTracks().forEach(audio=>{ audio.enabled=streamSettings.audio; });
      if(track) { track.contentHint=streamSettings.contentHint;try { await track.applyConstraints(videoConstraints()); } catch(error) { status('This capture could not apply every quality setting: '+error.message); } }
      await Promise.all([...peers.values()].map(peer=>peer.slots[0] ? tune(peer.slots[0].sender) : Promise.resolve()));captureInfo();
    }).catch(error=>status(error.message));
    await settingsQueue;
  }
  function roomValue(raw) { try { return new URL(raw).searchParams.get('room') || ''; } catch { return raw.trim(); } }
  const validRoom = value => /^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(value);
  const friendIds = async () => (await local.listFriends()).map(friend => friend.id).filter(id => id !== identity.id).sort();
  async function updateRoomFriends() {
    if (!joined || !roomNonce) return;
    const connection=socket, nonce=roomNonce, room=roomValue($('room').value), thisGeneration=generation, revision=++roomFriendsRevision, friends=await friendIds();
    const signature=await local.sign(`screentask-room-friends-v1\n${room}\n${identity.id}\n${nonce}\n${revision}\n${friends.join(',')}`);
    if (joined && socket===connection && generation===thisGeneration && nonce===roomNonce && revision===roomFriendsRevision) send({type:'room-friends',friends,revision,signature});
  }
  function signalUrl() {
    const url = new URL($('signaling').value.trim());
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
    const url = new URL('/call', location.href);
    // The embedded virtual host exists only on this machine. A public Worker serves the same room page.
    if (['screentask.local','localhost','127.0.0.1','[::1]'].includes(location.hostname) && !['localhost', '127.0.0.1', '[::1]'].includes(signal.hostname)) {
      url.protocol = signal.protocol === 'wss:' ? 'https:' : 'http:'; url.host = signal.host;
    }
    url.searchParams.set('room', roomValue($('room').value));
    const clean = new URL(signal); clean.searchParams.delete('room'); clean.searchParams.delete('name'); clean.searchParams.delete('id');
    url.searchParams.set('signaling', clean.href); url.searchParams.set('fps', requestedFps); url.searchParams.set('mbps', bitrateMbps);
    // Grants belong to one approved identity and must never be copied into a public room link.
    return url.href;
  }
  function updateControls() {
    document.body.classList.toggle('in-room', joined || joining || !!localTile);
    $('join').disabled = joined || joining || !!localTile; $('leave').disabled = !joined && !joining && !localTile;
    for (const id of ['name', 'room', 'signaling']) $(id).disabled = joined || joining;
    $('share').disabled = !joined || !!screen; $('stopShare').disabled = !screen;
    $('mic').disabled = !joined || !!microphone; $('mute').disabled = !microphone;
    $('copyInvite').disabled = !joined;
    $('reconnect').hidden=!disconnected;$('reconnect').disabled=joined || joining;chatControls();roomState();
    $('empty').hidden = !!localTile;
    if (joined) { $('invite').href = invitation(); $('invite').textContent = 'Open invitation'; }
    else { $('invite').removeAttribute('href'); $('invite').textContent = ''; }
  }
  function tile(name, local) {
    const element = document.createElement('article'); element.className = 'tile';
    const header = document.createElement('header'), heading = document.createElement('h2'); heading.textContent = name + (local ? ' (you)' : '');
    const avatar=document.createElement('img');avatar.className='avatar';avatar.alt='';avatar.hidden=true;const identityBox=document.createElement('div');identityBox.className='identity';identityBox.append(avatar,heading);
    const tools = document.createElement('div'), view = document.createElement('select'); view.setAttribute('aria-label', 'View ' + name);
    for (const [value, label] of [['fit','Fit'],['actual','Actual size']]) { const option = document.createElement('option'); option.value=value; option.textContent=label; view.append(option); }
    const full = document.createElement('button'); full.textContent = 'Fullscreen'; tools.append(view, full); header.append(identityBox, tools);
    const stage = document.createElement('div'); stage.className='stage';
    const video = document.createElement('video'); video.autoplay=true; video.playsInline=true; video.muted=local;
    const placeholder=document.createElement('div'); placeholder.className='placeholder'; placeholder.textContent='In the room · not sharing a screen';
    const stats=document.createElement('div'); stats.className='stats'; stats.textContent=local?'Your screen preview':'Waiting for direct connection…';
    stage.append(video,placeholder); element.append(header,stage,stats); $('tiles').append(element);
    view.onchange = () => { stage.classList.toggle('actual', view.value === 'actual'); resize(); };
    function resize() { if (view.value==='actual') { video.style.width=video.videoWidth+'px'; video.style.height=video.videoHeight+'px'; } else { video.style.width='';video.style.height=''; } }
    async function fullscreen() { try { if(document.fullscreenElement) await document.exitFullscreen();else await stage.requestFullscreen(); } catch(error) { status('Fullscreen: '+error.message); } }
    video.onresize=resize;full.onclick=fullscreen;stage.ondblclick=event=>{ event.preventDefault();fullscreen(); };
    const result={element,video,stats,placeholder,heading,avatar,audios:[],sharing:false};
    result.show = sharing => { result.sharing=sharing; placeholder.hidden=sharing; video.style.visibility=sharing?'visible':'hidden'; };
    result.show(false); return result;
  }
  function play(element) { const promise=element.play(); if(promise) promise.catch(()=>{ $('enableAudio').hidden=false; }); }
  function send(message) { if(socket && socket.readyState===WebSocket.OPEN) socket.send(JSON.stringify(message)); }
  const relay = candidate => candidate && /\btyp\s+relay\b/i.test(typeof candidate==='string'?candidate:candidate.candidate || '');
  function validDescription(description) { return description && ['offer','answer'].includes(description.type) && typeof description.sdp==='string' && description.sdp.length<=60000 && !relay(description.sdp); }
  function currentTrack(slot) { return slot===0 ? screen?.getVideoTracks()[0] : slot===1 ? screen?.getAudioTracks()[0] : microphone?.getAudioTracks()[0]; }
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
          if(rememberMessage(peer.id+':'+state.id)) chatLine(state.text,peer.name);
        } else if(state.type==='profile') {
          if(!peer.lastProfileAt || now-peer.lastProfileAt>=1000) { peer.lastProfileAt=now;receiveProfile(peer,state.profile); }
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
    peers.set(id,peer);
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
      chatControls();
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
  function removePeer(id) { const peer=peers.get(id); if(!peer) return; peers.delete(id); peer.pc.close(); peer.tile.element.remove();chatControls(); }
  function clearPeers() { for(const id of [...peers.keys()]) removePeer(id); }
  async function replaceTracks() {
    await Promise.all([...peers.values()].map(async peer=>{
      for(let slot=0;slot<peer.slots.length;slot++) await peer.slots[slot].sender.replaceTrack(currentTrack(slot) || null);
      if(peer.slots[0]) await tune(peer.slots[0].sender); announce(peer);
    }));
  }
  async function stopShare() {
    const previous=screen; screen=null; if(previous) for(const track of previous.getTracks()) track.stop();
    if(localTile) { localTile.show(false); localTile.video.srcObject=null; }
    try { await replaceTracks(); } catch(error) { status(error.message); }
    updateControls();
  }
  async function share() {
    $('share').disabled=true; const thisGeneration=generation;
    try {
      const capture=await navigator.mediaDevices.getDisplayMedia({video:videoConstraints(),audio:streamSettings.audio});
      if(!joined || generation!==thisGeneration) { capture.getTracks().forEach(t=>t.stop()); return; }
      const track=capture.getVideoTracks()[0]; if(!track) { capture.getTracks().forEach(t=>t.stop()); throw Error('No screen video was selected.'); }
      track.contentHint=streamSettings.contentHint; screen=capture; track.onended=()=>{ if(screen===capture) stopShare(); };
      localTile.video.srcObject=new MediaStream([track]);localTile.show(true);play(localTile.video);
      await replaceTracks();
      captureInfo();
      status('Sharing your screen. Everyone can share at the same time.');
    } catch(error) { status(error.name==='NotAllowedError'?'Screen sharing was cancelled or denied.':error.message); }
    finally { updateControls(); }
  }
  async function enableMic() {
    $('mic').disabled=true; const thisGeneration=generation;
    try {
      const capture=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      if(!joined || generation!==thisGeneration) { capture.getTracks().forEach(t=>t.stop());return; }
      microphone=capture;
      for(const track of capture.getAudioTracks()) track.onended=()=>{
        if(microphone!==capture) return;microphone=null;$('mute').textContent='Mute microphone';
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
      if(generation!==thisGeneration || socket!==connection) return;
      try {
        const message=JSON.parse(event.data);
        if(message.type==='room-challenge') {
          const room=roomValue($('room').value);
          if(message.id!==identity.id || message.room!==room || !/^[A-Za-z0-9_-]{43}$/.test(message.nonce || '')) throw Error('Invalid room identity challenge.');
          roomNonce=message.nonce;
          const friends=await friendIds();
          const signature=await local.sign(`screentask-room-v1\n${room}\n${identity.id}\n${roomNonce}\n${friends.join(',')}`);
          if(generation===thisGeneration && socket===connection && connection.readyState===WebSocket.OPEN) connection.send(JSON.stringify({type:'room-authenticate',key:identity.key,signature,friends,...(roomGrant && grantValue(JSON.stringify(roomGrant))?{grant:roomGrant}:{})}));
        } else if(message.type==='welcome') {
          if(message.id!==identity.id) throw Error('Room identity does not match your local profile.');
          selfId=message.id;joined=true;joining=false;retry=0;disconnected=false;chatLine('Joined the room. Chat is sent directly to connected participants.');
          if(!localTile) localTile=tile($('name').value.trim() || 'Guest',true);
          const profile=ownProfile();if(profile) showProfile(localTile,profile,true);
          if(screen) { localTile.video.srcObject=new MediaStream(screen.getVideoTracks());localTile.show(true);play(localTile.video); }
          for(const peer of message.peers || []) createPeer(peer.id,peer.name);
          status('In the room · '+(peers.size+1)+' participant'+(peers.size?'s':'')+'.');updateControls();
          updateRoomFriends().catch(error=>status(error.message));
        } else if(message.type==='peer-joined' && joined) { createPeer(message.id,message.name);status('A participant joined · '+(peers.size+1)+' in the room.'); }
        else if(message.type==='peer-left') { removePeer(message.id);status('A participant left · '+(peers.size+1)+' in the room.'); }
        else if(message.type==='signal' && joined) receiveSignal(message);
        else if(message.type==='error') status(message.message || 'Signaling service rejected a request.');
      } catch(error) { status('Signaling error: '+error.message); }
    };
    connection.onerror=()=>{ if(generation===thisGeneration) status('Cannot reach the signaling service. Check its address and that it is running.'); };
    connection.onclose=event=>{
      if(generation!==thisGeneration || socket!==connection) return;
      socket=null;joined=false;joining=false;disconnected=true;clearPeers();updateControls();chatLine('Room connection lost. Reconnect is available.');
      if([1008,4001,4003,4008].includes(event.code)) { status(event.reason || 'Room unavailable or full. Try another room.');return; }
      const seconds=Math.min(10,2**retry++);status(event.code===4004 ? 'Waiting for the room owner. Trying again in '+seconds+' seconds…' : 'Signaling disconnected. Rejoining in '+seconds+' seconds…');
      reconnectTimer=setTimeout(()=>{ if(generation===thisGeneration) openSocket(); },seconds*1000);
    };
  }
  async function join() {
    if(joined || joining) return;
    try { await identityReady; } catch(error) { status(error.message); return; }
    if(!identity) { status('Create a local profile from Friends before joining a private room.'); return; }
    let raw=$('room').value.trim();
    try {
      const pasted=new URL(raw); raw=pasted.searchParams.get('room') || '';
      roomGrant=grantValue(pasted.searchParams.get('grant'));grantRoom=raw;
      if(pasted.searchParams.get('signaling')) $('signaling').value=pasted.searchParams.get('signaling');
      else if(['http:','https:'].includes(pasted.protocol)) $('signaling').value=(pasted.protocol==='https:'?'wss:':'ws:')+'//'+pasted.host+'/call-signaling';
    } catch { /* plain room code */ }
    if(!validRoom(raw)) { status('Use a new private-room invitation. Older anonymous room links are no longer supported.');return; }
    if(raw!==grantRoom) roomGrant=null;grantRoom=raw;
    $('room').value=raw;
    try { const normalized=signalUrl();normalized.searchParams.delete('room');normalized.searchParams.delete('name');normalized.searchParams.delete('id');$('signaling').value=normalized.href; } catch(error) { status(error.message);return; }
    clearTimeout(reconnectTimer);generation++;save('call-name',$('name').value.trim());save('call-signaling',$('signaling').value.trim());
    const url=new URL(location.href);url.searchParams.set('room',raw);if(roomGrant) url.searchParams.set('grant',JSON.stringify(roomGrant));else url.searchParams.delete('grant');history.replaceState(null,'',url);status('Joining room…');openSocket();
  }
  async function leave() {
    generation++;disconnected=false;clearTimeout(reconnectTimer);const old=socket;socket=null;joined=false;joining=false;if(old) old.close(1000,'Left room');
    clearPeers();await stopShare();if(microphone) microphone.getTracks().forEach(t=>t.stop());microphone=null;
    if(localTile) localTile.element.remove();localTile=null;selfId='';$('mute').textContent='Mute microphone';updateControls();status('You left the room.');chatLine('You left the room.');
    if(embedded) parent.postMessage({type:'screentask-call-ended'}, location.origin);
  }
  $('name').value=query.get('name')?.slice(0,48) || readSaved('call-name') || 'Guest';$('room').value=query.get('room') || '';
  $('signaling').value=query.get('signaling') || readSaved('call-signaling') || (location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/call-signaling';
  $('join').onclick=join;$('reconnect').onclick=reconnect;$('leave').onclick=leave;$('share').onclick=share;$('stopShare').onclick=stopShare;$('mic').onclick=enableMic;
  $('mute').onclick=()=>{ if(microphone) { const enabled=!microphone.getAudioTracks()[0].enabled;microphone.getAudioTracks().forEach(t=>t.enabled=enabled);$('mute').textContent=enabled?'Mute microphone':'Unmute microphone';for(const peer of peers.values()) announce(peer); } };
  $('copyInvite').onclick=async()=>{ try { await navigator.clipboard.writeText(invitation());status("Room link copied. Guests also need the owner’s approval from Friends."); } catch { status('Copy this invitation: '+invitation()); } };
  $('enableAudio').onclick=()=>{ $('enableAudio').hidden=true;for(const peer of peers.values()) { play(peer.tile.video);for(const audio of peer.tile.audios) play(audio); } };
  addEventListener('beforeunload',()=>{ generation++;if(socket) socket.close();for(const stream of [screen,microphone]) stream?.getTracks().forEach(t=>t.stop());clearPeers(); });
  addEventListener('message',event=>{
    if(!embedded || event.origin!==location.origin || event.source!==parent) return;
    if(event.data?.type==='screentask-call-leave') leave();
    else if(event.data?.type==='vumiro-call-reconnect') reconnect();
    else if(event.data?.type==='vumiro-stream-settings') applySettings(event.data.settings,false);
    else if(event.data?.type==='vumiro-profile') refreshProfile();
  });
  addEventListener('screentask-friends-changed',()=>updateRoomFriends().catch(error=>status(error.message)));
  function reconnect() { if(joined) return;clearTimeout(reconnectTimer);generation++;const old=socket;socket=null;if(old) old.close(1000,'Reconnecting');joining=false;clearPeers();status('Reconnecting to the room…');join(); }
  async function refreshProfile() { try { const current=await local.initialize();if(!current) return;identity=current; } catch { return; }const profile=ownProfile();if(!profile) return;$('name').value=profile.name;if(localTile) showProfile(localTile,profile,true);for(const peer of peers.values()) announceProfile(peer); }
  for(const id of ['settingFps','settingMbps','settingResolution','settingContent','settingAudio']) $(id).onchange=()=>{ const value={fps:Number($('settingFps').value),mbps:Number($('settingMbps').value),resolution:$('settingResolution').value,contentHint:$('settingContent').value,audio:$('settingAudio').checked};if(validateSettings(value)) applySettings(value);else { syncSettingsControls();status('Choose 1–120 FPS and 1–100 Mbps.'); } };
  $('chatForm').onsubmit=event=>{
    event.preventDefault();const text=$('chatText').value.trim(),now=Date.now();if(!joined || !text || text.length>2000 || !openChannels().length) return;
    if(now-lastChatSent<500) { $('chatStatus').textContent='Wait a moment before sending another message.';return; }
    const message={type:'chat',id:Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join(''),text,timestamp:now};
    let sent=0;for(const peer of openChannels()) if(channelSend(peer,message)) sent++;
    if(!sent) { $('chatStatus').textContent='Connection busy. Try sending again in a moment.';return; }
    lastChatSent=now;rememberMessage(selfId+':'+message.id);chatLine(text,(ownProfile()?.name || 'You')+' (you)');$('chatText').value='';chatControls();
    if(sent<openChannels().length) $('chatStatus').textContent='Sent to '+sent+' participants. Another connection is busy.';
  };
  addEventListener('storage',event=>{ if(event.key===settingsKey) { try { applySettings(JSON.parse(event.newValue),false); } catch { /* Ignore malformed settings. */ } } });
  addEventListener('vumiro-profile-changed',refreshProfile);
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
    if(!$('room').value) $('room').value=code();
    if(query.get('autojoin')==='1') join();
  }).catch(error=>status(error.message));
})();
