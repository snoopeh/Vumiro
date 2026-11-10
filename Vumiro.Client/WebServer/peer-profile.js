/* Short-lived, signed WebRTC exchanges for local friend profile caches.
   The directory relays only SDP/ICE and refresh requests. Photos use SCTP. */
(() => {
  'use strict';
  const encoder = new TextEncoder();
  const serverNow=()=>window.VumiroServerClock?.now()??Date.now();
  const noncePattern = /^[A-Za-z0-9_-]{16,64}$/;
  const signalText = value => `vumiro-profile-signal-v1\n${value.from}\n${value.to}\n${value.nonce}\n${value.expires}\n${JSON.stringify(value.payload)}`;
  const profileText = (from,to,value) => `vumiro-peer-profile-v1\n${from}\n${to}\n${value.nonce}\n${value.expires}\n${JSON.stringify(value.profile)}`;
  function create({local,send,getFriend,onProfile}) {
    const online = new Set(), peers = new Map(), waiting = new Set(), deferred = new Set(), seen = new Map(), early = new Map();
    let epoch = 0, scheduling = false, wire = Promise.resolve(), nextSignalAt = 0, queuedSignals = 0;
    const identity = () => local.profile();
    const known = id => online.has(id) && !!getFriend(id) && !!identity();
    const active = peer => peers.get(peer.id) === peer && peer.epoch === epoch && known(peer.id);
    function close(peer) {
      if (peers.get(peer.id) !== peer) return;
      const refresh = peer.refreshRequested && known(peer.id) && identity().id < peer.id;
      peers.delete(peer.id); peer.cover?.dispose(); clearTimeout(peer.timeout); clearTimeout(peer.finish);
      peer.channel?.close(); peer.pc.onicecandidate = peer.pc.ondatachannel = peer.pc.onconnectionstatechange = null; peer.pc.close();
      if (refresh) waiting.add(peer.id);
      pump();
    }
    function reset() {
      epoch++; nextSignalAt=0; waiting.clear(); deferred.clear(); early.clear(); seen.clear(); online.clear();
      for (const peer of [...peers.values()]) close(peer);
    }
    function signal(id,payload,peer) {
      const version = epoch;
      if (queuedSignals >= 512) return Promise.reject(Error('Profile signaling queue is full.'));
      queuedSignals++;
      wire = wire.catch(() => {}).then(async () => {
        const delay = Math.max(0,nextSignalAt-serverNow());
        if (delay) await new Promise(resolve => setTimeout(resolve,delay));
        const own = identity();
        if (!own || epoch !== version || !known(id) || (peer && !active(peer))) return;
        nextSignalAt = serverNow()+45;
        const value = {type:'profile-signal',from:own.id,to:id,nonce:crypto.randomUUID(),expires:serverNow()+14000,payload};
        value.signature = await local.sign(signalText(value));
        if (epoch === version && known(id) && (!peer || active(peer))) send(value);
      }).finally(() => { queuedSignals--; });
      return wire;
    }
    function sendSignal(peer,payload) {
      peer.signals = peer.signals.then(() => signal(peer.id,payload,peer)).catch(() => { if (active(peer)) close(peer); });
      return peer.signals;
    }
    function channelSend(peer,value) {
      if (!active(peer) || peer.channel?.readyState !== 'open') return false;
      const text = JSON.stringify(value), bytes = encoder.encode(text).length;
      if (bytes > 65536 || peer.channel.bufferedAmount + bytes > 131072) return false;
      try { peer.channel.send(text); return true; } catch { return false; }
    }
    function ownProfile(peer) {
      // A pending signature must cancel the previous exchange's close timer
      // immediately, before yielding to WebCrypto or an earlier queued send.
      const ticket = ++peer.profileRequested; clearTimeout(peer.finish); peer.finish = 0;
      peer.profiles = peer.profiles.then(async () => {
        const own = identity(); if (!own || !active(peer)) return;
        const value = {type:'profile',id:own.id,key:own.key,nonce:crypto.randomUUID(),expires:serverNow()+60000,profile:{name:own.name,username:own.username||'',avatar:own.avatar||'',bio:own.bio||'',banner:own.banner||'',connections:own.connections||[]}};
        value.signature = await local.sign(profileText(own.id,peer.id,value));
        if (!active(peer)) return;
        if (channelSend(peer,value)) { peer.sent = value.nonce; peer.acknowledged = false; peer.profileSent = ticket; clearTimeout(peer.finish); peer.finish = 0; void peer.cover?.announce(); }
      });
      return peer.profiles;
    }
    function finish(peer) {
      if (!peer.cover?.busy() && peer.received && peer.acknowledged && peer.profileSent === peer.profileRequested && !peer.finish) peer.finish = setTimeout(() => { if (active(peer)) close(peer); },250);
    }
    async function data(peer,text) {
      if (!active(peer) || typeof text !== 'string' || encoder.encode(text).length > 65536) return;
      const value = JSON.parse(text);
      if (peer.cover?.receive(value)) return;
      if (value?.type === 'received' && value.nonce === peer.sent) { peer.acknowledged = true; finish(peer); return; }
      const friend = getFriend(peer.id), own = identity();
      if (value?.type !== 'profile' || value.id !== peer.id || value.key !== friend?.key || !noncePattern.test(value.nonce||'') || !Number.isSafeInteger(value.expires) || value.expires <= serverNow() || value.expires > serverNow()+60000 || !value.profile || typeof value.profile !== 'object' || Array.isArray(value.profile)) return;
      const profile = value.profile;
      if (Object.keys(profile).some(key => !['name','username','avatar','bio','banner','connections'].includes(key))) return;
      if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 48 || typeof profile.username !== 'string' || (profile.username && !/^[a-z0-9_.-]{3,24}$/.test(profile.username)) || typeof profile.avatar !== 'string') return;
      local.validateAvatar(profile.avatar);
      const bio = local.validateBio(profile.bio), banner = local.validateBanner(profile.banner), connections = local.validateConnections(profile.connections);
      if (!await local.verify(friend,profileText(peer.id,own.id,value),value.signature) || !active(peer) || getFriend(peer.id)?.key !== friend.key || value.expires <= serverNow()) return;
      await onProfile(peer.id,{name:profile.name,username:profile.username,avatar:profile.avatar,bio,banner,connections});
      if (!active(peer)) return;
      await peer.cover?.profileReceived(banner);
      if (!active(peer)) return;
      peer.received = true; channelSend(peer,{type:'received',nonce:value.nonce}); finish(peer);
    }
    function channel(peer,value) {
      if (peer.channel || value.label !== 'vumiro-profile') { value.close(); return; }
      peer.channel = value;
      peer.cover = window.VumiroCoverTransfer?.create({local,own:identity,remoteId:peer.id,friend:()=>getFriend(peer.id),send:message=>channelSend(peer,message),active:()=>active(peer)&&value.readyState==='open',buffered:()=>value.bufferedAmount,onBusy:busy=>{if(busy){clearTimeout(peer.finish);peer.finish=0;if(!peer.coverTimeout){peer.coverTimeout=true;clearTimeout(peer.timeout);peer.timeout=setTimeout(()=>close(peer),35000);}}else if(active(peer))finish(peer);}});
      value.onopen = () => { peer.cover?.start(); ownProfile(peer).catch(() => close(peer)); };
      peer.dataPending=0;peer.dataWindow=Date.now();peer.dataCount=0;
      value.onmessage = event => {
        if(!active(peer)||typeof event.data!=='string'||event.data.length>65536||encoder.encode(event.data).length>65536)return;
        const now=Date.now();if(now-peer.dataWindow>10000){peer.dataWindow=now;peer.dataCount=0;}
        if(++peer.dataCount>260||peer.dataPending>=100){close(peer);return;}
        peer.dataPending++;peer.data=peer.data.then(()=>data(peer,event.data)).catch(()=>close(peer)).finally(()=>{peer.dataPending--;});
      };
      value.onclose = () => { if (active(peer)) close(peer); };
      value.onerror = () => { if (active(peer)) close(peer); };
    }
    function make(id,initiator) {
      if (!known(id) || peers.size >= 6) return null;
      const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],bundlePolicy:'max-bundle'});
      const peer = {id,pc,epoch,signals:Promise.resolve(),data:Promise.resolve(),profiles:Promise.resolve(),candidates:early.get(id)||[],localCandidates:[],descriptionSent:false,channel:null,received:false,acknowledged:false,sent:'',finish:0,profileRequested:0,profileSent:0,refreshRequested:false};
      early.delete(id); peers.set(id,peer); peer.timeout = setTimeout(() => close(peer),15000);
      pc.onicecandidate = event => {
        if (!active(peer)) return;
        const payload = {candidate:event.candidate?.toJSON() ?? null};
        if (!peer.descriptionSent) { if (peer.localCandidates.length < 32) peer.localCandidates.push(payload); }
        else sendSignal(peer,payload);
      };
      pc.onconnectionstatechange = () => { if (['failed','closed'].includes(pc.connectionState)) close(peer); };
      if (initiator) channel(peer,pc.createDataChannel('vumiro-profile'));
      else pc.ondatachannel = event => channel(peer,event.channel);
      return peer;
    }
    async function description(peer,type) {
      const value = type === 'offer' ? await peer.pc.createOffer() : await peer.pc.createAnswer();
      if (!active(peer)) return;
      await peer.pc.setLocalDescription(value); if (!active(peer)) return;
      await sendSignal(peer,{description:{type:peer.pc.localDescription.type,sdp:peer.pc.localDescription.sdp}});
      if (!active(peer)) return;
      peer.descriptionSent = true;
      for (const payload of peer.localCandidates.splice(0)) await sendSignal(peer,payload);
    }
    function queue(id) {
      if (!known(id) || peers.has(id) || waiting.has(id)) return;
      if (identity().id < id) waiting.add(id);
      else signal(id,{refresh:true}).catch(() => {});
      pump();
    }
    function pump() {
      if (scheduling) return; scheduling = true;
      queueMicrotask(() => {
        scheduling = false;
        if (!identity()) return;
        while (peers.size < 4 && waiting.size) {
          const id = waiting.values().next().value; waiting.delete(id);
          if (!known(id) || peers.has(id)) continue;
          const peer = make(id,true); if (peer) description(peer,'offer').catch(() => close(peer));
        }
        let refreshed = 0;
        while (peers.size + refreshed < 6 && deferred.size) {
          const id = deferred.values().next().value; deferred.delete(id);
          if (known(id)) { refreshed++; signal(id,{refresh:true}).catch(() => {}); }
        }
      });
    }
    function presence(id,isOnline) {
      if (!isOnline) { online.delete(id); waiting.delete(id); deferred.delete(id); early.delete(id); const peer=peers.get(id); if (peer) close(peer); return; }
      const wasOnline = online.has(id); online.add(id);
      if (!wasOnline) queue(id);
    }
    function ownChanged() {
      for (const id of online) { const peer=peers.get(id); if (peer?.channel?.readyState === 'open') ownProfile(peer).catch(() => close(peer)); else if (!peer) queue(id); }
    }
    function syncContacts() {
      for (const id of [...online]) if (!getFriend(id)) presence(id,false);
    }
    async function addCandidate(peer,candidate) {
      if (!active(peer) || !candidate) return;
      // Follow-up profile exchanges use a fresh ICE generation. Delayed
      // candidates from the previous exchange must not abort the new answer.
      const ufrag=candidate.usernameFragment || /\bufrag\s+(\S+)/.exec(candidate.candidate||'')?.[1];
      const current=[...peer.pc.remoteDescription.sdp.matchAll(/^a=ice-ufrag:([^\r\n]+)/gm)].map(value=>value[1]);
      if (ufrag && current.length && !current.includes(ufrag)) return;
      try { await peer.pc.addIceCandidate(candidate); } catch { /* Try the remaining current-generation candidates. */ }
    }
    async function receive(value) {
      const own=identity(), friend=getFriend(value.from), version=epoch;
      if (!own || !friend || !known(value.from) || value.to!==own.id || !noncePattern.test(value.nonce||'') || !Number.isSafeInteger(value.expires) || value.expires<=serverNow() || value.expires>serverNow()+15000 || !value.payload || typeof value.payload!=='object' || Array.isArray(value.payload)) return;
      for (const [key,expires] of seen) if (expires<=serverNow()) seen.delete(key);
      const replay=value.from+':'+value.nonce; if (seen.has(replay)) return;
      if (!await local.verify(friend,signalText(value),value.signature) || epoch!==version || !known(value.from) || getFriend(value.from)?.key!==friend.key || value.expires<=serverNow()) return;
      seen.set(replay,value.expires); while (seen.size>4096) seen.delete(seen.keys().next().value);
      const payload=value.payload, keys=Object.keys(payload);
      if (keys.length!==1) return;
      if (payload.refresh===true) {
        if (own.id>value.from) return;
        const existing=peers.get(value.from);
        if (existing) {
          // Presence and a refresh can race the same offer. Finish the current
          // exchange first, then make one fresh attempt; never churn active SDP.
          existing.refreshRequested=true;
          return;
        }
        waiting.add(value.from); pump(); return;
      }
      if ('candidate' in payload) {
        const candidate=payload.candidate;
        if (candidate!==null && (!candidate || typeof candidate!=='object' || typeof candidate.candidate!=='string' || candidate.candidate.length>4096)) return;
        const peer=peers.get(value.from);
        if (peer?.pc.remoteDescription) await addCandidate(peer,candidate);
        else if (peer) { if (peer.candidates.length<32) peer.candidates.push(candidate); }
        else { const candidates=early.get(value.from)||[]; if (candidates.length<32) candidates.push(candidate); early.set(value.from,candidates); }
        return;
      }
      const remote=payload.description;
      if (!remote || !['offer','answer'].includes(remote.type) || typeof remote.sdp!=='string' || remote.sdp.length>12000) return;
      let peer=peers.get(value.from);
      if (remote.type==='offer') {
        if (own.id<value.from) return;
        if (peer) close(peer);
        peer=make(value.from,false);
        if (!peer) { deferred.add(value.from); return; }
      } else if (!peer || peer.pc.signalingState!=='have-local-offer') return;
      await peer.pc.setRemoteDescription(remote); if (!active(peer)) return;
      for (const candidate of peer.candidates.splice(0)) await addCandidate(peer,candidate);
      if (remote.type==='offer') await description(peer,'answer');
    }
    return {presence,ownChanged,syncContacts,receive,reset};
  }
  window.VumiroPeerProfiles={create};
})();
