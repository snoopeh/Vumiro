/* Cloudflare Realtime SFU media; authorization and secrets stay on the hub. */
(() => {
  'use strict';
  function create(options={}) {
    const live=options.live,devices=options.mediaDevices||window.navigator?.mediaDevices;
    let pc=null,stream=null,sessionId=null,channelId=null,hubTarget=null,themeContext=null,heartbeat=null,generation=0,phase='idle',muted=false,queue=Promise.resolve();
    const received=new Set(),audio=new Map();
    const state=()=>({phase,sessionId,channelId,muted,themeContext:themeContext?JSON.parse(JSON.stringify(themeContext)):null});
    function changed(){options.onState?.(state());}
    function check(epoch){if(epoch!==generation)throw Error('Community voice connection changed.');}
    async function ice(connection){if(connection.iceGatheringState==='complete')return;await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{connection.removeEventListener?.('icegatheringstatechange',update);reject(Error('Community voice ICE gathering timed out.'));},10000);function update(){if(connection.iceGatheringState==='complete'){clearTimeout(timer);connection.removeEventListener?.('icegatheringstatechange',update);resolve();}}connection.addEventListener?.('icegatheringstatechange',update);update();});}
    async function description(result,epoch){check(epoch);const connection=pc,ownedSession=sessionId;if(result.errorCode||result.tracks?.some(t=>t.errorCode))throw Error('Community media negotiation failed.');if(!result.sessionDescription)return;await connection.setRemoteDescription(result.sessionDescription);check(epoch);if(result.sessionDescription.type==='offer'){await connection.setLocalDescription(await connection.createAnswer());check(epoch);await ice(connection);check(epoch);await live.request('voice-answer',{sessionId:ownedSession,sessionDescription:{type:connection.localDescription.type,sdp:connection.localDescription.sdp}});check(epoch);}}
    function serial(fn){const next=queue.catch(()=>{}).then(fn);queue=next;return next;}
    async function refresh(epoch=generation){if(!sessionId||phase!=='connected')return;check(epoch);const result=await live.request('voice-participants',{sessionId});check(epoch);const tracks=(result.participants||[]).filter(p=>p.sessionId!==sessionId).flatMap(p=>p.tracks||[]).filter(t=>!received.has(t.sessionId+':'+t.trackName));if(tracks.length){const answer=await live.request('voice-subscribe',{sessionId,tracks});check(epoch);await description(answer,epoch);for(const t of tracks)received.add(t.sessionId+':'+t.trackName);}options.onParticipants?.(result.participants||[]);}
    async function cleanup(ownedSession,ownedHub){if(!ownedSession)return;try{await live.request('voice-leave',{sessionId:ownedSession},{hubId:ownedHub});}catch(error){options.onError?.(error);window.VumiroDiagnostics?.record('community-media-cleanup-pending',{name:error.name});}}
    async function clearCurrent(){clearInterval(heartbeat);heartbeat=null;queue=Promise.resolve();const oldSession=sessionId,oldHub=hubTarget;sessionId=null;hubTarget=null;phase='idle';channelId=null;themeContext=null;for(const track of stream?.getTracks?.()||[])track.stop();stream=null;try{pc?.close();}catch{}pc=null;for(const element of audio.values()){try{element.pause();element.srcObject=null;element.remove();}catch{}}audio.clear();received.clear();changed();await cleanup(oldSession,oldHub);}
    async function leave(){generation++;await clearCurrent();}
    async function join(target,settings={}){
      // Reserve before the first await: simultaneous joins must never share an epoch.
      const epoch=++generation,ownedHub=live?.state?.().hubId||null;let allocatedSession=null,connection=null,captured=null;
      try{
        await clearCurrent();check(epoch);phase='connecting';channelId=target;hubTarget=ownedHub;themeContext=settings.themeContext?JSON.parse(JSON.stringify(settings.themeContext)):null;changed();
        if(!live?.request||!devices?.getUserMedia)throw Error('Community audio capture is unavailable.');
        const session=await live.request('voice-join',{channelId:target});allocatedSession=session.sessionId;check(epoch);sessionId=allocatedSession;
        connection=options.createPeerConnection?options.createPeerConnection():new window.RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],bundlePolicy:'max-bundle'});pc=connection;
        connection.ontrack=event=>{if(epoch!==generation)return;if(options.onTrack){options.onTrack(event);return;}const element=window.document?.createElement('audio');if(!element)return;element.autoplay=true;element.srcObject=event.streams?.[0]||new window.MediaStream([event.track]);audio.set(event.track.id,element);element.play?.().catch(()=>options.onError?.(Error('Click to enable community audio playback.')));event.track.onended=()=>{element.srcObject=null;if(epoch===generation)audio.delete(event.track.id);};};
        connection.onconnectionstatechange=()=>{if(epoch!==generation)return;if(['failed','closed','disconnected'].includes(connection.connectionState))void leave();};
        captured=await devices.getUserMedia({audio:true,video:false});check(epoch);stream=captured;for(const track of captured.getAudioTracks()){track.enabled=!muted;connection.addTransceiver(track,{direction:'sendrecv',streams:[captured]});}
        await connection.setLocalDescription(await connection.createOffer());check(epoch);await ice(connection);check(epoch);
        const transceiver=connection.getTransceivers?.().find(t=>t.sender?.track?.kind==='audio'),mid=transceiver?.mid||'0',result=await live.request('voice-publish',{sessionId:allocatedSession,tracks:[{mid}],sessionDescription:{type:connection.localDescription.type,sdp:connection.localDescription.sdp}});
        await description(result,epoch);check(epoch);phase='connected';changed();await serial(()=>refresh(epoch));check(epoch);
        heartbeat=setInterval(()=>{serial(()=>refresh(epoch)).catch(error=>{if(epoch!==generation)return;options.onError?.(error);void leave();});},30000);return state();
      }catch(error){if(epoch===generation)await leave();else{for(const track of captured?.getTracks?.()||[])track.stop();try{connection?.close();}catch{}await cleanup(allocatedSession,ownedHub);}throw error;}
    }
    const off=live?.on?.(event=>{if(event.type==='community-revoked'||event.type==='community-connection'&&['offline','reconnecting','failed'].includes(event.state))return leave();if(phase==='connected'&&['community-voice-changed','community-changed'].includes(event.type)){const epoch=generation;return serial(()=>refresh(epoch)).catch(error=>{if(epoch!==generation)return;options.onError?.(error);return leave();});}});
    return Object.freeze({join,leave,state,refresh:()=>serial(()=>refresh()),setMuted(value){muted=!!value;for(const track of stream?.getAudioTracks?.()||[])track.enabled=!muted;changed();return muted;},async dispose(){off?.();await leave();}});
  }
  window.VumiroCommunityVoice=Object.freeze({create});
})();
