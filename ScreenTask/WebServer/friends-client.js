/* Local contacts, signed invitations and one lightweight presence socket.
   The existing room owns all WebRTC/media and is created only when joining. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), local = window.ScreenTaskLocalProfile;
  const query = new URLSearchParams(location.search), online = new Set(), seen = new Map();
  let profile = null, friends = [], selected = '', filter = 'all', socket = null, ready = false;
  let reconnectTimer = 0, retry = 0, stopped = false, pending = null, frame = null, leaveTimer = 0;
  let connectionGeneration = 0, messages = Promise.resolve(), serviceUrl = '';
  let updateAvailable = false, updateBusy = false;
  const updateHost = window.chrome?.webview;
  function requestUpdate(action) {
    if(action==='install' && (frame || pending)) { status('Leave your room or finish the call invitation before installing an update.'); return; }
    if(updateHost) updateHost.postMessage({type:'updates',action});
    else $('updateStatus').textContent='This browser client updates when you reload. Desktop downloads are available from the ScreenTask GitHub releases.';
  }
  const readSaved = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  let fps = Math.min(120, Math.max(1, Number(readSaved('st-friends-fps') || query.get('fps')) || 60));
  let mbps = Math.min(100, Math.max(1, Number(readSaved('st-friends-mbps') || query.get('mbps')) || 20));
  const friendById = id => friends.find(friend => friend.id === id);
  const newRoomCode = () => profile.id + '_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || '').join('').toUpperCase();
  const status = text => { $('status').textContent = text; };
  function normalizeService(raw) {
    const url = new URL(raw);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw Error('Use a valid wss:// connection service URL.');
    if (url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Use wss:// for a connection service outside this device.');
    url.pathname = '/call-signaling'; url.search = ''; url.hash = '';
    return url.href;
  }
  function serviceState(text, connected = false) {
    $('serviceStatus').textContent = text; $('serviceDot').classList.toggle('online', connected);
  }
  function send(message) {
    if (!socket || socket.readyState !== WebSocket.OPEN || !ready) throw Error('The presence service is reconnecting. Try again when you are online.');
    // The directory supplies trusted `from`; it must never come from the wire.
    const {from, ...wire} = message;
    socket.send(JSON.stringify(wire));
  }
  function watch() { if (ready) send({type: 'watch', ids: friends.map(friend => friend.id)}); }
  function renderProfile() {
    $('selfName').textContent = profile.name; $('selfAvatar').textContent = initials(profile.name);
    $('profileName').value = profile.name; $('ownCode').value = local.ownCode(); $('signaling').value = serviceUrl;
    $('roomFps').value = fps; $('roomMbps').value = mbps;
  }
  function openDialog(id) {
    if (!profile && id !== 'setupDialog') return;
    const dialog = $(id); if (!dialog.open) dialog.showModal();
  }
  function showProfile() { renderProfile(); $('profileError').textContent = ''; openDialog('profileDialog'); }
  function canCall(friend) { return ready && online.has(friend.id) && !pending && !frame; }
  function renderDetails() {
    const friend = friendById(selected);
    $('contactEmpty').hidden = !!friend; $('contactDetails').hidden = !friend;
    if (!friend) return;
    $('contactAvatar').textContent = initials(friend.nickname); $('contactName').textContent = friend.nickname;
    $('contactStatus').textContent = (online.has(friend.id) ? 'Online · ready to connect' : 'Offline · not currently connected') + (friend.name !== friend.nickname ? '\n' + friend.name : '');
    if (document.activeElement !== $('nickname')) $('nickname').value = friend.nickname;
    $('contactIdentity').textContent = 'PUBLIC IDENTITY\n' + friend.id;
    $('contactCall').disabled = !canCall(friend);
  }
  function renderFriends() {
    $('createRoom').disabled = $('createRoomFromDialog').disabled = !profile || !!pending || !!frame;
    $('installUpdate').disabled = !updateAvailable || updateBusy || !!frame || !!pending;
    $('sidebarCount').textContent = friends.length; $('onlineCount').textContent = online.size;
    const search = $('search').value.trim().toLocaleLowerCase();
    const visible = friends.filter(friend => (filter !== 'online' || online.has(friend.id)) && (friend.nickname + ' ' + friend.name).toLocaleLowerCase().includes(search));
    visible.sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.nickname.localeCompare(b.nickname));
    const list = $('friendsList'); list.replaceChildren();
    for (const friend of visible) {
      const row = document.createElement('div'); row.className = 'friend' + (friend.id === selected ? ' selected' : '');
      row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', 'View ' + friend.nickname);
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = initials(friend.nickname);
      const info = document.createElement('span'); info.className = 'friendInfo truncate';
      const name = document.createElement('span'); name.className = 'friendName truncate'; name.textContent = friend.nickname;
      const state = document.createElement('span'); state.className = 'friendState';
      const dot = document.createElement('i'); dot.className = 'dot' + (online.has(friend.id) ? ' online' : '');
      state.append(dot, document.createTextNode(online.has(friend.id) ? 'Online' : 'Offline')); info.append(name, state);
      const call = document.createElement('button'); call.className = 'callAction'; call.textContent = 'Call'; call.disabled = !canCall(friend);
      call.setAttribute('aria-label', 'Call ' + friend.nickname); call.setAttribute('aria-disabled', String(call.disabled));
      call.onclick = event => { event.stopPropagation(); invite(friend).catch(error => status(error.message)); };
      row.onclick = () => { selected = friend.id; renderFriends(); };
      row.onkeydown = event => { if (event.target === row && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selected = friend.id; renderFriends(); } };
      row.append(avatar, info, call); list.append(row);
    }
    $('listHeading').textContent = (filter === 'online' ? 'Online' : 'Your people') + ' · ' + visible.length;
    $('emptyState').hidden = friends.length > 0; $('noResults').hidden = !friends.length || visible.length > 0;
    $('filterAll').setAttribute('aria-pressed', String(filter === 'all')); $('filterOnline').setAttribute('aria-pressed', String(filter === 'online'));
    renderDetails();
  }
  async function reloadFriends() {
    friends = await local.listFriends();
    for (const id of online) if (!friendById(id)) online.delete(id);
    if (!friendById(selected)) selected = friends[0]?.id || '';
    watch(); renderFriends();
  }
  addEventListener('screentask-friends-changed',()=>{ if(profile) reloadFriends().catch(error=>status(error.message)); });
  function showRoomInvitation() {
    if(!query.get('room')) return;
    $('roomInvitation').value=location.href;
    $('roomError').textContent='You and the room owner must add each other before joining.';
    openDialog('roomDialog');query.delete('room');
  }
  function clearPending(message) {
    if (pending) clearTimeout(pending.timer);
    pending = null; $('invitation').hidden = true;
    if (message) status(message); renderFriends();
  }
  function renderPending() {
    if (!pending) return;
    const name = friendById(pending.friend)?.nickname || 'Your friend', incoming = pending.direction === 'incoming';
    $('invitation').hidden = false;
    $('invitationTitle').textContent = incoming ? name + ' is calling' : 'Calling ' + name + '…';
    $('invitationText').textContent = (incoming ? 'Join a room together. ' : 'Waiting for them to accept. ') + Math.max(0, Math.ceil((pending.expires - Date.now()) / 1000)) + 's remaining';
    $('acceptInvite').hidden = !incoming; $('declineInvite').hidden = !incoming; $('cancelInvite').hidden = incoming;
  }
  function setPending(value) {
    pending = value; renderPending(); renderFriends();
    function tick() {
      if (pending !== value) return;
      if (Date.now() >= value.expires) { clearPending('The call invitation expired. You can try again.'); return; }
      renderPending(); value.timer = setTimeout(tick, 1000);
    }
    value.timer = setTimeout(tick, 1000);
  }
  const inviteText = message => `screentask-invite-v1\n${message.from}\n${message.to}\n${message.room}\n${message.nonce}\n${message.expires}`;
  const answerText = message => `screentask-answer-v1\n${message.from}\n${message.to}\n${message.room}\n${message.nonce}\n${message.accepted}\n${message.expires}`;
  async function answer(value, accepted) {
    const message = {type: 'answer', from: profile.id, to: value.friend, room: value.room, nonce: value.nonce, accepted, expires: value.expires};
    message.signature = await local.sign(answerText(message));
    if (accepted && (pending !== value || value.expires <= Date.now() || !(await local.listFriends()).some(friend=>friend.id===value.friend))) throw Error('This invitation is no longer available from a saved friend.');
    send(message);
  }
  async function invite(friend) {
    if (!canCall(friend)) throw Error('Wait until you and your friend are online and free to call.');
    const value = {direction: 'outgoing', friend: friend.id, room: newRoomCode(), nonce: crypto.randomUUID(), expires: Date.now() + 60000};
    setPending(value);
    try {
      const message = {type: 'invite', from: profile.id, to: friend.id, room: value.room, nonce: value.nonce, expires: value.expires};
      message.signature = await local.sign(inviteText(message));
      if (pending !== value) return;
      send(message); status('Calling ' + friend.nickname + '. Your microphone and screen stay off until you enable them in the room.');
    } catch (error) { if (pending === value) clearPending(error.message); }
  }
  function validEnvelope(message) {
    return message.to === profile.id && /^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(message.room || '') && (message.type !== 'invite' || message.room.slice(0,43) === message.from) && typeof message.nonce === 'string' && /^[A-Za-z0-9_-]{16,100}$/.test(message.nonce) && Number.isSafeInteger(message.expires) && message.expires > Date.now() && message.expires <= Date.now() + 65000;
  }
  async function receive(message, current, generation) {
    const active = () => socket === current && connectionGeneration === generation && !stopped;
    if (!active()) return;
    if (message.type === 'challenge') {
      if (typeof message.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,160}$/.test(message.nonce)) throw Error('The presence service sent an invalid challenge.');
      const signature = await local.sign(`screentask-directory-v1\n${profile.id}\n${message.nonce}`);
      if (active() && current.readyState === WebSocket.OPEN) current.send(JSON.stringify({type: 'authenticate', key: profile.key, signature}));
      return;
    }
    if (message.type === 'ready') {
      if (message.id !== profile.id) { current.close(1008, 'Identity mismatch'); return; }
      ready = true; retry = 0; serviceState('Online', true); watch(); renderFriends();
      status(frame ? 'Your room is open. Presence reconnected.' : friends.length ? 'Online. Exchange contact codes both ways so your friends can call you.' : 'Your profile is ready. Add a friend to get started.'); return;
    }
    if (!ready) return;
    if (message.type === 'presence' && friendById(message.id) && typeof message.online === 'boolean') {
      if (message.online) online.add(message.id); else online.delete(message.id);
      renderFriends(); return;
    }
    if (message.type === 'unavailable') {
      if (pending?.direction === 'outgoing' && pending.friend === message.to && pending.nonce === message.nonce) clearPending('Your friend is unavailable. Exchange contact codes both ways and try again when they are online.');
      return;
    }
    if (message.type === 'error') { status(typeof message.message === 'string' ? message.message : 'The presence service could not complete that request.'); return; }
    if (!['invite', 'answer'].includes(message.type) || !validEnvelope(message)) return;
    const friend = friendById(message.from); if (!friend) return;
    if (message.type === 'answer' && typeof message.accepted !== 'boolean') return;
    if (!await local.verify(friend, message.type === 'invite' ? inviteText(message) : answerText(message), message.signature) || !active()) return;
    if (!(await local.listFriends()).some(saved=>saved.id===message.from) || !active() || message.expires <= Date.now()) return;
    if (message.type === 'invite') {
      for (const [key, expires] of seen) if (expires <= Date.now()) seen.delete(key);
      const replay = message.from + ':' + message.nonce; if (seen.has(replay)) return;
      seen.set(replay, message.expires); while (seen.size > 256) seen.delete(seen.keys().next().value);
      const value = {direction: 'incoming', friend: friend.id, room: message.room, nonce: message.nonce, expires: message.expires};
      if (pending || frame) { await answer(value, false); return; }
      setPending(value); status(friend.nickname + ' is calling. Accept to open your shared room.');
    } else if (pending && pending.friend === friend.id && pending.nonce === message.nonce && pending.room === message.room && pending.expires === message.expires) {
      if (!message.accepted) { clearPending(pending.direction === 'incoming' ? friend.nickname + ' cancelled the call.' : friend.nickname + ' declined the call.'); return; }
      if (pending.direction !== 'outgoing') return;
      const value = pending; clearPending(); openRoom(value.room, serviceUrl, friend.nickname);
    }
  }
  function connect() {
    clearTimeout(reconnectTimer);
    if (stopped || !profile) return;
    const generation = ++connectionGeneration;
    ready = false; serviceState('Connecting…');
    const previous = socket; socket = null; previous?.close();
    try {
      const url = new URL(serviceUrl); url.pathname = '/friends-signaling'; url.searchParams.set('id', profile.id);
      const current = socket = new WebSocket(url); messages = Promise.resolve();
      let authTimeout = setTimeout(() => { if (socket === current && !ready) current.close(4000, 'Authentication timed out'); }, 12000);
      current.onmessage = event => {
        if (socket !== current || connectionGeneration !== generation || typeof event.data !== 'string' || event.data.length > 8192) return;
        messages = messages.then(async () => {
          const message = JSON.parse(event.data); await receive(message, current, generation);
          if (ready) { clearTimeout(authTimeout); authTimeout = 0; }
        }).catch(error => status(error.message));
      };
      current.onerror = () => { if (socket === current) serviceState('Reconnecting…'); };
      current.onclose = event => {
        clearTimeout(authTimeout); if (socket !== current || connectionGeneration !== generation || stopped) return;
        socket = null; ready = false; online.clear(); clearPending(); serviceState('Reconnecting…'); renderFriends();
        if (event.code === 4001) {
          serviceState('Open in another window');
          status('This local profile connected from another ScreenTask window. Use that window for presence and calls.');
          return;
        }
        status(frame ? 'Presence disconnected. Your open room can keep running.' : 'Presence disconnected. Reconnecting automatically…');
        reconnectTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)) + Math.random() * 350);
      };
    } catch (error) { serviceState('Not connected'); status(error.message); }
  }
  function openRoom(room, signaling, name = 'Your room') {
    if (frame) throw Error('Leave your current room before opening another one.');
    const url = new URL('/call.html', location.href);
    url.searchParams.set('room', room); url.searchParams.set('signaling', normalizeService(signaling));
    url.searchParams.set('name', profile.name); url.searchParams.set('fps', fps); url.searchParams.set('mbps', mbps);
    url.searchParams.set('autojoin', '1'); url.searchParams.set('embedded', '1');
    frame = document.createElement('iframe'); frame.title = 'ScreenTask call'; frame.allow = 'display-capture; microphone; autoplay; fullscreen'; frame.allowFullscreen = true;
    frame.src = url.href; $('callFrameSlot').append(frame); $('callTitle').textContent = name === 'Your room' ? name : 'Room with ' + name;
    $('friendsBody').hidden = true; $('callArea').hidden = false; renderFriends();
    status('Your room is open. Enable your microphone or share a screen when you are ready.');
  }
  function finishRoom() {
    clearTimeout(leaveTimer); frame?.remove(); frame = null;
    $('callArea').hidden = true; $('friendsBody').hidden = false; renderFriends(); status('You left the room.');
  }
  function leaveRoom() {
    if (!frame) return;
    frame.contentWindow.postMessage({type: 'screentask-call-leave'}, location.origin);
    clearTimeout(leaveTimer); leaveTimer = setTimeout(finishRoom, 1200);
  }
  addEventListener('message', event => {
    if (frame && event.source === frame.contentWindow && event.origin === location.origin && event.data?.type === 'screentask-call-ended') finishRoom();
  });
  $('acceptInvite').onclick = async () => {
    const value = pending; if (!value || value.direction !== 'incoming') return;
    $('acceptInvite').disabled = true;
    try {
      if (Date.now() >= value.expires) throw Error('This call invitation expired.');
      await answer(value, true);
      if (pending !== value) return;
      const name = friendById(value.friend)?.nickname || 'Your friend'; clearPending(); openRoom(value.room, serviceUrl, name);
    } catch (error) { status(error.message); }
    finally { $('acceptInvite').disabled = false; }
  };
  async function dismissInvite() {
    const value = pending; if (!value) return;
    try { if (Date.now() < value.expires) await answer(value, false); }
    catch (error) { status(error.message); }
    if (pending === value) clearPending(value.direction === 'incoming' ? 'Call declined.' : 'Call cancelled.');
  }
  $('declineInvite').onclick = dismissInvite; $('cancelInvite').onclick = dismissInvite;
  $('leaveCall').onclick = leaveRoom;
  $('addFriend').onclick = $('emptyAdd').onclick = () => { $('addError').textContent = ''; openDialog('addDialog'); };
  $('profileNav').onclick = $('selfProfile').onclick = showProfile;
  $('updatesNav').onclick = () => { showProfile(); $('updateDetails').open=true; $('updateDetails').scrollIntoView({block:'nearest'}); requestUpdate('state'); };
  $('checkUpdate').onclick = () => requestUpdate('check');
  $('installUpdate').onclick = () => requestUpdate('install');
  if(updateHost) updateHost.addEventListener('message',event=>{
    const state=event.data;if(state?.type!=='updates') return;
    updateAvailable=state.available===true; updateBusy=state.busy===true;
    $('updateStatus').textContent=typeof state.message==='string' ? state.message : '';
    $('clientVersion').textContent=typeof state.current==='string' ? 'ScreenTask '+state.current : '';
    $('checkUpdate').disabled=updateBusy;
    $('installUpdate').disabled=!updateAvailable || updateBusy || !!frame || !!pending;
    $('updateBadge').hidden=!updateAvailable;
    $('updateProgress').hidden=!updateBusy;
    $('updateProgress').value=Number(state.progress) || 0;
  });
  $('shareMyCode').onclick = () => { $('addDialog').close(); showProfile(); };
  $('createRoom').onclick = $('createRoomFromDialog').onclick = () => {
    if (!profile) { openDialog('setupDialog'); return; }
    if (pending || frame) { status('Finish your current call or invitation before creating another room.'); return; }
    try {
      openRoom(newRoomCode(), serviceUrl);
      if ($('roomDialog').open) $('roomDialog').close();
      status('Your room is open. Use Copy invitation in the room to invite people, or share your screen now.');
    } catch (error) { status(error.message); }
  };
  $('manualRoom').onclick = $('roomNav').onclick = () => { if (frame) { status('Leave your current room before joining another.'); return; } $('roomError').textContent = ''; openDialog('roomDialog'); };
  $('friendsNav').onclick = () => { if (frame) status('Your room is open. Leave it to return to your friends.'); else $('search').focus(); };
  $('search').oninput = renderFriends;
  $('filterAll').onclick = () => { filter = 'all'; renderFriends(); };
  $('filterOnline').onclick = () => { filter = 'online'; renderFriends(); };
  document.querySelectorAll('[data-close]').forEach(button => { button.onclick = () => $(button.dataset.close).close(); });
  $('setupDialog').addEventListener('cancel', event => event.preventDefault());
  $('setupForm').onsubmit = async event => {
    event.preventDefault(); $('createProfile').disabled = true; $('setupError').textContent = '';
    try { profile = await local.createProfile($('setupName').value); $('setupDialog').close(); renderProfile(); await reloadFriends(); connect(); showRoomInvitation(); }
    catch (error) { $('setupError').textContent = error.message; }
    finally { $('createProfile').disabled = false; }
  };
  $('profileForm').onsubmit = async event => {
    event.preventDefault(); $('profileError').textContent = '';
    try { profile = await local.updateName($('profileName').value); renderProfile(); status('Your local display name was saved. Existing contact codes still identify you.'); }
    catch (error) { $('profileError').textContent = error.message; }
  };
  $('addForm').onsubmit = async event => {
    event.preventDefault(); $('saveFriend').disabled = true; $('addError').textContent = '';
    try {
      selected = await local.addFriend($('friendCode').value, $('friendNickname').value); await reloadFriends(); $('addDialog').close(); $('addForm').reset();
      status('Friend saved on this device. Send them your contact code too so calls work both ways.');
    } catch (error) { $('addError').textContent = error.message; }
    finally { $('saveFriend').disabled = false; }
  };
  $('nicknameForm').onsubmit = async event => {
    event.preventDefault(); if (!selected) return;
    try { await local.renameFriend(selected, $('nickname').value); await reloadFriends(); status('Nickname saved in your local friend book.'); }
    catch (error) { status(error.message); }
  };
  $('removeFriend').onclick = async () => {
    const friend = friendById(selected); if (!friend) return;
    try { if (pending?.friend === friend.id) await dismissInvite(); await local.removeFriend(friend.id); online.delete(friend.id); await reloadFriends(); status(friend.nickname + ' was removed from your local friend book.'); }
    catch (error) { status(error.message); }
  };
  $('contactCall').onclick = () => { const friend = friendById(selected); if (friend) invite(friend).catch(error => status(error.message)); };
  $('copyCode').onclick = async () => {
    try { await navigator.clipboard.writeText(local.ownCode()); status('Contact code copied. Ask your friend to send theirs back.'); }
    catch { $('ownCode').focus(); $('ownCode').select(); status('Select and copy your contact code from the profile panel.'); }
  };
  $('exportCode').onclick = () => {
    const url = URL.createObjectURL(new Blob([local.ownCode() + '\n'], {type: 'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = 'ScreenTask-contact.txt'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status('Your public contact code was saved. The private identity key stays on this device.');
  };
  $('saveSignaling').onclick = () => {
    try { serviceUrl = normalizeService($('signaling').value.trim()); save('st-friends-signaling', serviceUrl); $('profileError').textContent = ''; $('signaling').value = serviceUrl; clearPending(); connect(); }
    catch (error) { $('profileError').textContent = error.message; }
  };
  $('saveRoomSettings').onclick = () => {
    const nextFps = Number($('roomFps').value), nextMbps = Number($('roomMbps').value);
    if (!Number.isInteger(nextFps) || nextFps < 1 || nextFps > 120 || !Number.isFinite(nextMbps) || nextMbps < 1 || nextMbps > 100) {
      $('profileError').textContent = 'Choose 1–120 FPS and 1–100 Mbps per participant.'; return;
    }
    fps = nextFps; mbps = nextMbps; save('st-friends-fps', String(fps)); save('st-friends-mbps', String(mbps));
    $('profileError').textContent = ''; status('Room settings saved on this device. They apply to the next room you open.');
  };
  $('roomForm').onsubmit = event => {
    event.preventDefault(); $('roomError').textContent = '';
    try {
      const raw = $('roomInvitation').value.trim(); let room = raw, signaling = serviceUrl;
      try {
        const invitation = new URL(raw);
        if (!['https:', 'http:'].includes(invitation.protocol) || invitation.username || invitation.password) throw Error('Use a ScreenTask room invitation.');
        room = invitation.searchParams.get('room') || '';
        signaling = invitation.searchParams.get('signaling') || invitation.origin;
      } catch (error) { if (/^[a-z]+:/i.test(raw)) throw error; }
      if (!/^[A-Za-z0-9_-]{43}_[a-f0-9]{48}$/.test(room)) throw Error('Paste a new private-room invitation. Older room links are no longer supported.');
      if (pending) throw Error('Accept, decline or cancel the current call invitation first.');
      openRoom(room, signaling); $('roomDialog').close(); $('roomForm').reset();
    } catch (error) { $('roomError').textContent = error.message; }
  };
  addEventListener('beforeunload', () => {
    stopped = true; ++connectionGeneration; clearTimeout(reconnectTimer); clearTimeout(leaveTimer); if (pending) clearTimeout(pending.timer);
    const previous = socket; socket = null; previous?.close();
    frame?.contentWindow.postMessage({type: 'screentask-call-leave'}, location.origin);
  });
  (async () => {
    try {
      serviceUrl = normalizeService(readSaved('st-friends-signaling') || query.get('signaling') || location.origin);
      profile = await local.initialize();
      if (!profile) { serviceState('Profile needed'); status('Create your local profile to get started.'); openDialog('setupDialog'); return; }
      renderProfile(); await reloadFriends(); connect(); showRoomInvitation();
    } catch (error) { serviceState('Not connected'); status(error.message); $('setupError').textContent = error.message; }
  })();
})();
