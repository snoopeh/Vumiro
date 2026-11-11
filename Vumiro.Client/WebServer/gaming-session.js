/* Vumiro's one-friend gaming protocol. No third-party streaming client is used. */
(function (root) {
  'use strict';
  const MTU = 1500, MAX_BUFFER = 262144, TTL = 60000;
  const neutral = () => ({buttons:0,leftX:0,leftY:0,rightX:0,rightY:0,leftTrigger:0,rightTrigger:0});
  const encode = bytes => root.btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const random = size => root.crypto.getRandomValues(new Uint8Array(size));
  const token = () => encode(random(18)).replace(/\+/g,'-').replace(/\//g,'_');
  const sessionToken = () => Array.from(random(16),b=>b.toString(16).padStart(2,'0')).join('');
  const signedText = envelope => ['vumiro-gaming-signal-v1',envelope.from,envelope.to,envelope.session,envelope.nonce,envelope.expires,JSON.stringify(envelope.payload)].join('\n');
  const bounded = (value,min,max) => Math.max(min,Math.min(max,Math.round(value)));
  function inputFrame(value) {
    if (!value || Array.isArray(value)) return null;
    const result = neutral();
    for (const key of Object.keys(result)) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) return null;
      result[key] = bounded(value[key],key.endsWith('Trigger')||key==='buttons'?0:-32768,key==='buttons'?65535:key.endsWith('Trigger')?255:32767);
    }
    // Reserved XUSB button flags never reach the virtual controller.
    result.buttons &= 0xf3ff;
    return result;
  }
  function physicalFrame() {
    const pad = Array.from(root.navigator?.getGamepads?.() || []).find(p=>p?.connected && p.mapping==='standard');
    if (!pad) return neutral();
    const result=neutral(),flags=[4096,8192,16384,32768,256,512,0,0,32,16,64,128,1,2,4,8];
    flags.forEach((flag,index)=>{if(pad.buttons[index]?.pressed)result.buttons|=flag;});
    // Preserve fractional axes until converting to the signed XUSB range.
    const stick=(index,invert=false)=>{const n=pad.axes[index];return typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)>.12?bounded((invert?-n:n)*32767,-32768,32767):0;};
    result.leftX=stick(0);result.leftY=stick(1,true);result.rightX=stick(2);result.rightY=stick(3,true);
    for(const [name,index] of [['leftTrigger',6],['rightTrigger',7]]) {
      const n=pad.buttons[index]?.value;result[name]=typeof n==='number'&&Number.isFinite(n)?bounded(n*255,0,255):0;
    }
    return result;
  }
  function packetBytes(data) {
    let bytes;
    if (data instanceof ArrayBuffer) bytes=new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes=new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    else return null;
    if(bytes.length<20||bytes.length>MTU||(bytes[0]>>4)!==4||(bytes[0]&15)<5||((bytes[2]<<8)|bytes[3])!==bytes.length)return null;
    return bytes;
  }
  function validPayload(value) {
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    const kind=value.kind;
    if(kind==='invite')return ['lan','together'].includes(value.mode)&&(!value.lan||value.mode==='lan'&&validAssignment(value.lan));
    if(kind==='lan-peers')return Number.isSafeInteger(value.revision)&&value.revision>0&&value.revision<=2147483647&&Array.isArray(value.addresses)&&value.addresses.length>=1&&value.addresses.length<=4&&value.addresses.every(validAddress)&&new Set(value.addresses).size===value.addresses.length;
    if(['accept','decline','end'].includes(kind))return true;
    if(kind==='offer'||kind==='answer')return value.description?.type===kind&&typeof value.description.sdp==='string'&&value.description.sdp.length<=12000&&/^v=0(?:\r?\n|$)/.test(value.description.sdp)&&!value.description.sdp.includes('\0');
    if(kind==='ice') {
      const c=value.candidate;
      return c===null || (!!c&&typeof c.candidate==='string'&&c.candidate.length<=4096&&(!c.candidate||c.candidate.startsWith('candidate:'))&&
        (c.sdpMid==null||typeof c.sdpMid==='string'&&c.sdpMid.length<=256)&&
        (c.sdpMLineIndex==null||Number.isInteger(c.sdpMLineIndex)&&c.sdpMLineIndex>=0&&c.sdpMLineIndex<=64)&&
        (c.usernameFragment==null||typeof c.usernameFragment==='string'&&c.usernameFragment.length<=256));
    }
    return false;
  }
  const validAddress=value=>typeof value==='string'&&/^10\.203\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|250)\.[1-4]$/.test(value);
  const validAssignment=value=>value&&value.prefix===24&&validAddress(value.address)&&validAddress(value.peerAddress)&&value.address.endsWith('.1')&&!value.peerAddress.endsWith('.1')&&value.address.slice(0,value.address.lastIndexOf('.'))===value.peerAddress.slice(0,value.peerAddress.lastIndexOf('.'));
  function iceConfiguration(input) {
    if(input===undefined)return [{urls:'stun:stun.cloudflare.com:3478'}];
    if(!Array.isArray(input)||input.length>8)throw Error('ICE configuration accepts up to eight STUN or TURN servers.');
    return input.map(server=>{
      const urls=typeof server?.urls==='string'?[server.urls]:server?.urls;
      if(!Array.isArray(urls)||!urls.length||urls.length>8||urls.some(url=>typeof url!=='string'||url.length>2048||!/^(?:stun|stuns|turn|turns):(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]{1,5})?(?:\?transport=(?:udp|tcp))?$/i.test(url)))throw Error('Use valid STUN or TURN URLs in the ICE configuration.');
      const result={urls:[...urls]};
      for(const name of ['username','credential'])if(server[name]!==undefined){if(typeof server[name]!=='string'||server[name].length>1024)throw Error('Invalid TURN credentials in the ICE configuration.');result[name]=server[name];}
      return result;
    });
  }
  function createPair(options) {
    const {local,send,getFriend,requestNative}=options;
    if(!local||typeof send!=='function'||typeof getFriend!=='function'||typeof requestNative!=='function')throw Error('Gaming needs a local identity, friend signaling and native bridge.');
    let current=null,generation=0,receiveQueue=Promise.resolve(),bindings={...(options.initialBindings||root.VumiroControllerMapping?.DEFAULT_BINDINGS)},inputMode=options.initialInputMode||'keyboard',lastError='';
    const seen=options.replayCache||new Map(),keys=new Set();
    const now=()=>Date.now();
    const alive=session=>current===session&&session.epoch===generation&&local.profile()?.id===session.localId;
    const snapshot=()=>({state:current?.state|| (lastError?'error':'idle'),sessionId:current?.id||null,peerId:current?.peerId||null,
      mode:current?.mode||null,role:current?.role||null,accepted:!!current?.accepted,sharing:!!current?.stream,hasAudio:!!current?.stream?.getAudioTracks?.().length,inputMode,
      inputFocused:!!current?.inputFocused,lanAddress:current?.mode==='lan'?current.address:null,peerAddress:current?.mode==='lan'?current.peerAddress:null,error:lastError});
    const changed=()=>options.onState?.(snapshot());
    function makeSession(id,peerId,mode,role,expires) {
      const subnet=(Number.parseInt(id.slice(0,8),16)%250)+1;
      const assignment=options.lan;
      return {id,peerId,mode,role,expires,epoch:generation,localId:local.profile()?.id,state:role==='host'?'inviting':'invited',accepted:false,
        address:assignment?(role==='host'?assignment.address:assignment.peerAddress):`10.203.${subnet}.${role==='host'?1:2}`,
        peerAddress:assignment?(role==='host'?assignment.peerAddress:assignment.address):`10.203.${subnet}.${role==='host'?2:1}`,
        pc:null,channel:null,stream:null,inputFocused:false,sequence:0,receivedSequence:-1,ice:[],senders:[],nativeReady:false,nativeStarting:false,nativeEpoch:0,captureEpoch:0,timers:new Set()};
    }
    async function native(action,fields) {
      const result=await requestNative(action,fields);
      if(result?.ok===false)throw Error(result.error||result.controller?.message||result.lan?.message||'The native gaming service rejected the request.');
      return result;
    }
    async function signal(session,payload,detached=false) {
      const envelope={type:'gaming-signal',from:session.localId,to:session.peerId,session:session.id,nonce:token(),expires:now()+TTL,payload};
      envelope.signature=await local.sign(signedText(envelope));
      if(!detached&&!alive(session))return false;
      if(JSON.stringify(envelope).length>16384)throw Error('Gaming signaling exceeded the server message limit.');
      await send(envelope);return detached||alive(session);
    }
    function setTimer(session,fn,delay) {
      const timer=root.setTimeout(()=>{session.timers.delete(timer);if(alive(session))fn();},delay);timer?.unref?.();session.timers.add(timer);return timer;
    }
    async function fail(session,error) {
      if(!alive(session))return;
      await stop(false,error?.message||String(error));
    }
    function background(session,work) {Promise.resolve().then(()=>alive(session)?work():undefined).catch(error=>fail(session,error));}
    async function stop(notify=true,failure='') {
      const session=current;current=null;generation++;keys.clear();lastError=failure;
      if(!session){changed();return;}
      session.inputFocused=false;
      if(session.pump)root.clearInterval(session.pump);
      if(session.trustPump)root.clearInterval(session.trustPump);
      for(const timer of session.timers)root.clearTimeout(timer);session.timers.clear();
      if(session.poll)root.clearTimeout(session.poll);
      for(const track of session.stream?.getTracks()||[])track.stop();session.stream=null;
      for(const track of session.remoteStream?.getTracks()||[])track.stop?.();session.remoteStream=null;
      if(session.channel){session.channel.onclose=null;session.channel.onmessage=null;session.channel.close();}
      if(session.pc){session.pc.onconnectionstatechange=null;session.pc.onicecandidate=null;session.pc.ontrack=null;session.pc.ondatachannel=null;session.pc.close();}
      options.onTrack?.({stream:null,track:null,local:session.role==='host'});changed();
      const tasks=[];
      if(session.nativeStarting||session.nativeReady)tasks.push(native(session.mode==='lan'?'lan-stop':'remote-controller-stop',{sessionId:session.id}).catch(()=>{}));
      if(notify)tasks.push(signal(session,{kind:'end'},true).catch(()=>{}));
      await Promise.all(tasks);
    }
    async function knownFriend(id) {
      const friend=await getFriend(id);
      if(!friend||friend.id!==id)throw Error('Choose someone in your local friend list.');
      return local.validateContact?await local.validateContact(friend):friend;
    }
    async function invite(peerId,mode) {
      if(current)throw Error('End your current gaming session first.');
      if(!['lan','together'].includes(mode))throw Error('Choose LAN or game together.');
      if(!local.profile()?.id)throw Error('Create your local profile first.');
      lastError='';const session=makeSession(options.sessionId||sessionToken(),peerId,mode,'host',now()+TTL);current=session;changed();
      try {
        const friend=await knownFriend(peerId);if(!alive(session))return null;session.friendKey=friend.key;
        await signal(session,{kind:'invite',mode,...(mode==='lan'&&options.lan?{lan:options.lan}:{})});if(!alive(session))return null;
        setTimer(session,()=>{if(!session.accepted)background(session,()=>fail(session,Error('Your gaming invitation expired. Send a new invitation.')));},TTL);
        return session.id;
      } catch(error){await fail(session,error);throw error;}
    }
    async function accept(id) {
      const session=current;
      if(!session||session.id!==id||session.role!=='guest'||session.accepted||session.expires<=now())throw Error('This invitation is no longer available.');
      try {
        const friend=await knownFriend(session.peerId);if(!alive(session))return;
        if(friend.key!==session.friendKey)throw Error('This friend’s trusted key changed. Ask them to send a new invitation.');
        session.accepted=true;session.state='connecting';openPeer(session);changed();
        await signal(session,{kind:'accept'});deadline(session);
      }catch(error){await fail(session,error);throw error;}
    }
    async function decline(id) {
      const session=current;if(!session||session.id!==id||session.accepted||session.role!=='guest')return false;
      await stop(false);await signal(session,{kind:'decline'},true);return true;
    }
    function deadline(session) {
      setTimer(session,()=>{if(session.state!=='connected')background(session,()=>fail(session,Error('A direct connection could not be established. A restrictive firewall or NAT may block this connection; Vumiro has no TURN relay configured.')));},45000);
    }
    async function startNative(session) {
      if(!alive(session)||session.nativeReady||session.nativeStarting)return;
      session.nativeStarting=true;const operation=++session.nativeEpoch,previous=session.nativeTask;
      const task=(async()=>{
      if(previous)await previous.catch(()=>{});
      if(!alive(session)||operation!==session.nativeEpoch)return;
      const action=session.mode==='lan'?'lan-start':'remote-controller-start';
      try {
        const result=await native(action,{sessionId:session.id,...(session.mode==='lan'?{address:session.address}:{})});
        if(!alive(session)||operation!==session.nativeEpoch){await native(session.mode==='lan'?'lan-stop':'remote-controller-stop',{sessionId:session.id}).catch(()=>{});return;}
        if(session.mode==='lan') {
          if(result?.lan?.state==='error')throw Error(result.lan.error||result.lan.message||'The virtual LAN adapter could not start.');
          if(result?.lan?.state!=='active') {pollLan(session);return;}
        } else if(result?.controller?.active===false)throw Error(result.controller.message||'The host virtual controller could not start.');
        session.nativeReady=true;session.nativeStarting=false;session.state='connected';changed();
      } catch(error){if(operation===session.nativeEpoch)session.nativeStarting=false;throw error;}
      })();session.nativeTask=task;return task;
    }
    function pollLan(session,attempt=0) {
      session.poll=setTimer(session,()=>background(session,async()=>{
        const result=await native('lan-status',{sessionId:session.id});if(!alive(session))return;
        if(result?.lan?.state==='active'){session.nativeReady=true;session.nativeStarting=false;session.state='connected';changed();}
        else if(result?.lan?.state==='error'||attempt>=59)throw Error(result?.lan?.error||result?.lan?.message||'The virtual LAN adapter did not become ready.');
        else pollLan(session,attempt+1);
      }),500);
    }
    function openPeer(session) {
      if(!alive(session)||!session.accepted)return;
      session.trustPump=root.setInterval(()=>checkTrust(session),1000);
      const pc=new root.RTCPeerConnection({iceServers:options.iceServers,bundlePolicy:'max-bundle'});session.pc=pc;
      pc.onicecandidate=event=>{if(alive(session)&&event.candidate)background(session,()=>signal(session,{kind:'ice',candidate:event.candidate.toJSON?event.candidate.toJSON():event.candidate}));};
      pc.onconnectionstatechange=()=>{
        if(!alive(session))return;
        if(pc.connectionState==='failed')background(session,()=>fail(session,Error('The direct gaming connection failed. Check both firewalls and try again. No TURN relay is configured.')));
        else if(pc.connectionState==='disconnected'){releaseInput();session.state='reconnecting';changed();setTimer(session,()=>{if(pc.connectionState==='disconnected')background(session,()=>fail(session,Error('The gaming connection was lost.')));},5000);}
        else if(pc.connectionState==='connected'&&(session.nativeReady||session.role==='guest'&&session.mode==='together')){session.state='connected';changed();}
      };
      pc.ontrack=event=>{
        if(!alive(session)||session.role!=='guest'||session.mode!=='together')return;
        session.remoteStream??=event.streams?.[0]||new root.MediaStream();
        if(!session.remoteStream.getTracks().includes(event.track))session.remoteStream.addTrack(event.track);
        options.onTrack?.({stream:session.remoteStream,track:event.track,local:false});
      };
      if(session.mode==='together'&&session.role==='host') {
        const stream=new root.MediaStream();
        for(const kind of ['video','audio'])session.senders.push({kind,sender:pc.addTransceiver(kind,{direction:'sendonly',streams:[stream]}).sender});
      }
      if(session.role==='host')bindChannel(session,pc.createDataChannel(session.mode==='lan'?'vumiro-lan-v1':'vumiro-input-v1',{ordered:false,maxRetransmits:0}));
      else pc.ondatachannel=event=>bindChannel(session,event.channel);
    }
    function bindChannel(session,channel) {
      if(!alive(session)||session.channel||channel.label!==(session.mode==='lan'?'vumiro-lan-v1':'vumiro-input-v1')){channel.close();return;}
      session.channel=channel;channel.binaryType='arraybuffer';
      channel.onopen=()=>{
        if(!alive(session))return;
        if(session.mode==='lan'||session.role==='host')background(session,()=>startNative(session));
        else {session.state='connected';changed();session.pump=root.setInterval(()=>pumpInput(session),1000/60);}
      };
      channel.onclose=()=>{if(alive(session))background(session,()=>fail(session,Error('The gaming data connection closed.')));};
      channel.onmessage=event=>{
        if(!alive(session)||!session.accepted||channel.readyState!=='open')return;
        if(session.mode==='lan') {
          if(!session.nativeReady)return;const bytes=packetBytes(event.data);if(!bytes)return;
          // Bounded native in-flight writes avoid an unbounded promise queue.
          if((session.pendingPackets||0)>=64)return;session.pendingPackets=(session.pendingPackets||0)+1;
          native('lan-packet',{sessionId:session.id,packet:encode(bytes)}).catch(error=>fail(session,error)).finally(()=>session.pendingPackets--);
        } else if(session.role==='host'&&session.nativeReady) {
          if(typeof event.data!=='string'||event.data.length>1024)return;let value;try{value=JSON.parse(event.data);}catch{return;}
          if(!Number.isSafeInteger(value?.sequence)||value.sequence<0||value.sequence>2147483647||value.sequence<=session.receivedSequence)return;
          const frame=inputFrame(value.frame);if(!frame)return;
          session.receivedSequence=value.sequence;
          // Keep one native write in flight; newer frames replace older pending input.
          session.pendingInput={sequence:value.sequence,frame};drainInput(session);
        }
      };
    }
    async function drainInput(session) {
      if(session.writingInput)return;session.writingInput=true;
      try {while(alive(session)&&session.nativeReady&&session.pendingInput){const value=session.pendingInput;session.pendingInput=null;await native('remote-controller-frame',{sessionId:session.id,...value});}}
      catch(error){await fail(session,error);}finally{session.writingInput=false;}
    }
    async function offer(session) {
      const pc=session.pc,description=await pc.createOffer();if(!alive(session))return;
      await pc.setLocalDescription(description);if(!alive(session))return;
      await signal(session,{kind:'offer',description:{type:pc.localDescription.type,sdp:pc.localDescription.sdp}});
    }
    async function receiveOne(envelope,epoch) {
      if(epoch!==generation)return false;
      let copy;try{if(JSON.stringify(envelope).length>16384)return false;copy=JSON.parse(JSON.stringify(envelope));}catch{return false;}
      const value=copy;
      if(value?.type!=='gaming-signal'||value.to!==local.profile()?.id||! /^[A-Za-z0-9_-]{43}$/.test(value.from||'')||
        !/^[a-f0-9]{32}$/.test(value.session||'')||!/^[A-Za-z0-9_-]{24}$/.test(value.nonce||'')||
        !Number.isSafeInteger(value.expires)||value.expires<=now()||value.expires>now()+TTL+5000||!validPayload(value.payload)||
        typeof value.signature!=='string'||value.signature.length>128)return false;
      const replay=value.from+':'+value.nonce;
      for(const [key,expires] of seen)if(expires<=now())seen.delete(key);
      if(seen.has(replay))return false;
      let friend;try{friend=await knownFriend(value.from);if(!await local.verify(friend,signedText(value),value.signature))return false;}catch{return false;}
      if(epoch!==generation||value.expires<=now()||!await getFriend(value.from))return false;
      if(epoch!==generation)return false;
      seen.set(replay,value.expires);while(seen.size>4096)seen.delete(seen.keys().next().value);
      const kind=value.payload.kind;
      if(kind==='invite') {
        if(current)return false;
        const session=makeSession(value.session,value.from,value.payload.mode,'guest',value.expires);
        if(value.payload.lan){session.address=value.payload.lan.peerAddress;session.peerAddress=value.payload.lan.address;}
        session.friendKey=friend.key;current=session;lastError='';changed();
        setTimer(session,()=>{if(!session.accepted)background(session,()=>fail(session,Error('This gaming invitation expired.')));},Math.max(1,value.expires-now()));
        options.onInvitation?.({id:session.id,sessionId:session.id,peerId:session.peerId,mode:session.mode,expires:session.expires});return true;
      }
      const session=current;if(!session||session.id!==value.session||session.peerId!==value.from)return false;
      if(kind==='end'){await stop(false);return true;}
      if(kind==='decline'&&session.role==='host'&&!session.accepted){await stop(false);return true;}
      if(kind==='lan-peers') {
        if(session.role!=='guest'||session.mode!=='lan'||!session.accepted||value.payload.revision<=(session.topologyRevision||0))return false;
        const prefix=session.address.slice(0,session.address.lastIndexOf('.'))+'.';
        if(!value.payload.addresses.includes(session.peerAddress)||!value.payload.addresses.includes(session.address)||value.payload.addresses.some(address=>!address.startsWith(prefix)))return false;
        session.topologyRevision=value.payload.revision;await options.onLanPeers?.(value.payload.addresses);return alive(session);
      }
      if(kind==='accept') {
        if(session.role!=='host'||session.accepted||session.expires<=now())return false;
        session.accepted=true;session.state='connecting';openPeer(session);changed();deadline(session);await offer(session);return alive(session);
      }
      if(!session.accepted||!session.pc)return false;
      if(kind==='offer') {
        if(session.role!=='guest'||session.pc.remoteDescription)return false;
        await session.pc.setRemoteDescription(value.payload.description);if(!alive(session))return false;
        for(const c of session.ice.splice(0)){await session.pc.addIceCandidate(c);if(!alive(session))return false;}
        const description=await session.pc.createAnswer();if(!alive(session))return false;
        await session.pc.setLocalDescription(description);if(!alive(session))return false;
        await signal(session,{kind:'answer',description:{type:session.pc.localDescription.type,sdp:session.pc.localDescription.sdp}});return alive(session);
      }
      if(kind==='answer') {
        if(session.role!=='host'||session.pc.remoteDescription)return false;
        await session.pc.setRemoteDescription(value.payload.description);if(!alive(session))return false;
        for(const c of session.ice.splice(0)){await session.pc.addIceCandidate(c);if(!alive(session))return false;}return true;
      }
      if(kind==='ice') {
        if(!session.pc.remoteDescription){if(session.ice.length>=128)return false;session.ice.push(value.payload.candidate);}
        else await session.pc.addIceCandidate(value.payload.candidate);return alive(session);
      }
      return false;
    }
    function receive(value) {
      const epoch=generation,task=receiveQueue.then(()=>receiveOne(value,epoch)).catch(async error=>{if(current&&generation===epoch)await fail(current,error);return false;});
      receiveQueue=task;return task;
    }
    function sendFrame(session,frame) {
      if(!alive(session)||session.role!=='guest'||session.mode!=='together'||session.channel?.readyState!=='open'||session.channel.bufferedAmount>8192)return;
      if(session.sequence>=2147483647){background(session,()=>fail(session,Error('The controller session reached its sequence limit. Reconnect.')));return;}
      session.channel.send(JSON.stringify({sequence:session.sequence++,frame}));
    }
    function pumpInput(session) {
      if(!alive(session)||!session.inputFocused)return;
      try{sendFrame(session,inputMode==='physical'?physicalFrame():root.VumiroControllerMapping.frameFromKeys(bindings,keys));}
      catch(error){background(session,()=>fail(session,error));}
    }
    function releaseInput() {keys.clear();if(current){current.inputFocused=false;sendFrame(current,neutral());changed();}}
    function setInputFocused(value) {
      if(!value){releaseInput();return;}
      if(current?.accepted&&current.role==='guest'&&current.mode==='together'){current.inputFocused=true;changed();}
    }
    function setKey(code,down) {if(!current?.inputFocused||inputMode!=='keyboard'||typeof code!=='string'||code.length>32)return false;if(down)keys.add(code);else keys.delete(code);return true;}
    function setBindings(value) {
      const validation=root.VumiroControllerMapping.validateBindings(value);if(!validation.valid)throw Error(validation.errors.join(' '));
      bindings={...validation.bindings};releaseInput();return {...bindings};
    }
    function setInputMode(value) {if(!['keyboard','physical'].includes(value))throw Error('Choose keyboard or physical controller input.');releaseInput();inputMode=value;changed();}
    async function startSharing(settings={}) {
      const session=current;
      if(!session?.accepted||session.role!=='host'||session.mode!=='together')throw Error('Invite a friend to game together before sharing.');
      if(session.stream||session.capturePending)return;
      if(!root.navigator?.mediaDevices?.getDisplayMedia)throw Error('Screen capture is unavailable in this browser.');
      const frameRate=settings.frameRate??60,bitrateMbps=settings.bitrateMbps??12;
      if(![30,60].includes(frameRate)||typeof bitrateMbps!=='number'||!Number.isFinite(bitrateMbps)||bitrateMbps<2||bitrateMbps>30)throw Error('Choose 30 or 60 FPS and a bitrate from 2 to 30 Mbps.');
      const captureEpoch=++session.captureEpoch;session.capturePending=captureEpoch;let stream;
      try {
        // Called synchronously from the UI gesture; no asynchronous permission work precedes capture.
        stream=await root.navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:frameRate,max:frameRate},width:{ideal:1920},height:{ideal:1080}},audio:true,systemAudio:'include'});
        if(!alive(session)||session.captureEpoch!==captureEpoch){for(const track of stream.getTracks())track.stop();return;}
        const video=stream.getVideoTracks()[0];if(!video)throw Error('No screen video was selected.');
        video.contentHint='motion';session.stream=stream;video.onended=()=>{if(alive(session))background(session,()=>stopSharing());};
        for(const {kind,sender} of session.senders){await sender.replaceTrack(stream.getTracks().find(t=>t.kind===kind)||null);if(!alive(session)||session.captureEpoch!==captureEpoch)return;}
        const sender=session.senders.find(value=>value.kind==='video')?.sender;
        if(sender?.getParameters&&sender?.setParameters) {
          const parameters=sender.getParameters();
          if(parameters.encodings?.length) {
            for(const encoding of parameters.encodings){encoding.maxBitrate=Math.round(bitrateMbps*1000000);encoding.maxFramerate=frameRate;}
            parameters.degradationPreference='maintain-framerate';
            try{await sender.setParameters(parameters);}catch{/* The negotiated codec may not expose sender tuning. Capture still has its FPS cap. */}
          }
        }
        if(!alive(session)||session.captureEpoch!==captureEpoch)return;
        if(session.channel?.readyState==='open')await startNative(session);
        if(alive(session)){options.onTrack?.({stream,track:video,local:true});changed();}
      }catch(error){if(stream)for(const track of stream.getTracks())track.stop();if(alive(session)){session.stream=null;changed();throw error;}}
      finally{if(session.capturePending===captureEpoch)session.capturePending=false;}
    }
    async function stopSharing() {
      const session=current;if(!session||session.role!=='host')return;
      session.captureEpoch++;session.capturePending=false;session.nativeEpoch++;
      const stream=session.stream;session.stream=null;for(const track of stream?.getTracks()||[])track.stop();
      options.onTrack?.({stream:null,track:null,local:true});changed();
      await Promise.all(session.senders.map(({sender})=>sender.replaceTrack(null)));
      if(session.nativeReady||session.nativeStarting){session.nativeReady=false;session.nativeStarting=false;await native('remote-controller-stop',{sessionId:session.id});}
    }
    function handleNativePacket(message) {
      const session=current,c=session?.channel;
      if(!session||!session.accepted||session.mode!=='lan'||message?.type!=='gaming-lan-packet'||message.sessionId!==session.id||!session.nativeReady||c?.readyState!=='open'||c.bufferedAmount>MAX_BUFFER)return false;
      if(typeof message.packet!=='string'||message.packet.length>2000||!/^[A-Za-z0-9+/]+={0,2}$/.test(message.packet))return false;
      let bytes;try{bytes=Uint8Array.from(root.atob(message.packet),character=>character.charCodeAt(0));}catch{return false;}
      if(!packetBytes(bytes))return false;
      try{c.send(bytes.buffer);return true;}catch(error){background(session,()=>fail(session,error));return false;}
    }
    function sendLanBytes(bytes) {
      const session=current,c=session?.channel;
      if(!alive(session)||session.mode!=='lan'||!session.accepted||!session.nativeReady||c?.readyState!=='open'||c.bufferedAmount>MAX_BUFFER||!packetBytes(bytes))return false;
      try{c.send(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));return true;}catch{return false;}
    }
    function checkTrust(session=current) {
      if(!session||current!==session||session.checkingTrust)return;
      if(local.profile()?.id!==session.localId){stop(false,'The local identity changed; gaming access ended.').catch(()=>{});return;}
      session.checkingTrust=true;
      background(session,async()=>{
        try {
          const friend=await getFriend(session.peerId);if(!alive(session))return;
          if(!friend||friend.key!==session.friendKey)throw Error('Gaming access ended because this friend was removed or their trusted key changed.');
        }finally{session.checkingTrust=false;}
      });
    }
    return Object.freeze({invite,accept,decline,receive,stop,setBindings,setInputMode,setInputFocused,setKey,releaseInput,startSharing,stopSharing,snapshot,handleNativePacket,sendLanBytes,
      checkTrust,
      sendLanPeers:(revision,addresses)=>current?.role==='host'&&current.mode==='lan'&&current.accepted?signal(current,{kind:'lan-peers',revision,addresses}):Promise.resolve(false)});
  }
  // Each authenticated peer has its own RTC lifecycle. The LAN group owns one
  // adapter and forwards packets between accepted channels as a star network.
  function create(options) {
    options={...options,iceServers:iceConfiguration(options.iceServers)};
    let group=null,latestError='',mode='keyboard',savedBindings={...root.VumiroControllerMapping?.DEFAULT_BINDINGS};
    const replayCache=new Map();
    const emit=()=>options.onState?.(snapshot());
    function snapshot() {
      const participants=group?[...group.entries.values()].map(entry=>({...entry.state,peerId:entry.peerId})):[];
      const first=participants[0];
      const state=participants.some(p=>p.state==='connected')?'connected':participants.some(p=>p.accepted)?'connecting':first?.state;
      return {...(first||{sessionId:null,peerId:null,mode:null,role:null,accepted:false,sharing:false,inputMode:mode,inputFocused:false,lanAddress:null,peerAddress:null}),
        state:state||(latestError?'error':'idle'),accepted:participants.some(peer=>peer.accepted),sessionId:group?.id||first?.sessionId||null,error:latestError||first?.error||'',participants,maxGuests:3};
    }
    function makeGroup(id,kind,role) {return {id,mode:kind,role,entries:new Map(),revision:0,acceptedKey:'',nativeStarted:false,nativeStopped:false,nativePromise:null,allowed:[],sync:Promise.resolve()};}
    async function callNative(action,fields) {
      const result=await options.requestNative(action,fields);
      if(result?.ok===false)throw Error(result.error||result.lan?.message||result.controller?.message||'The native gaming service rejected the request.');
      return result;
    }
    async function stopAdapter(owner) {
      if(owner.mode!=='lan'||!owner.nativeStarted||owner.nativeStopped)return;
      owner.nativeStopped=true;await callNative('lan-stop',{sessionId:owner.id}).catch(()=>{});
    }
    function addresses(owner) {
      const entries=[...owner.entries.values()].filter(e=>e.state.accepted);
      if(owner.role==='host')return entries.map(e=>e.state.peerAddress).filter(Boolean);
      return owner.allowed.length?owner.allowed:entries.map(e=>e.state.peerAddress).filter(Boolean);
    }
    async function syncNativePeers(owner) {
      if(group!==owner||!owner.nativeStarted||owner.nativeStopped)return;
      await callNative('lan-set-peers',{sessionId:owner.id,addresses:addresses(owner)});
    }
    function queueMembership(owner) {
      const peers=addresses(owner).sort(),key=peers.join(',');
      if(owner.acceptedKey===key)return;
      owner.acceptedKey=key;
      const revision=++owner.revision;
      owner.sync=owner.sync.then(async()=>{
        if(group!==owner)return;await syncNativePeers(owner);
        if(owner.role==='host') {
          const host=[...owner.entries.values()][0]?.state.lanAddress;
          if(host)await Promise.all([...owner.entries.values()].filter(e=>e.state.accepted).map(e=>e.engine.sendLanPeers(revision,[host,...peers])));
        }
      }).catch(error=>{if(group===owner)stop(error.message).catch(()=>{});});
    }
    function decodePacket(base64) {
      if(typeof base64!=='string'||base64.length>2000)return null;
      try{return packetBytes(Uint8Array.from(root.atob(base64),c=>c.charCodeAt(0)));}catch{return null;}
    }
    const ip=(bytes,offset)=>Array.from(bytes.slice(offset,offset+4)).join('.');
    function broadcast(bytes) {return ip(bytes,16)==='255.255.255.255'||bytes[19]===255||bytes[16]>=224&&bytes[16]<=239;}
    async function routePacket(owner,entry,fields) {
      if(group!==owner||!entry.state.accepted)return {ok:true};
      const bytes=decodePacket(fields.packet);if(!bytes)return {ok:true};
      const source=ip(bytes,12),destination=ip(bytes,16);
      if(owner.role==='host') {
        if(source!==entry.state.peerAddress)return {ok:true};
        const all=broadcast(bytes);
        for(const target of owner.entries.values())if(target!==entry&&target.state.accepted&&(all||target.state.peerAddress===destination))target.engine.sendLanBytes(bytes);
        if(all||destination===entry.state.lanAddress)return callNative('lan-packet',fields);
        return {ok:true};
      }
      // Only the authenticated host channel can route packets from other
      // accepted group members, according to its signed membership revision.
      if(!addresses(owner).includes(source))return {ok:true};
      return callNative('lan-packet',fields);
    }
    function addEntry(owner,peerId,lan) {
      const entry={peerId,state:{peerId,state:'preparing',accepted:false},engine:null};owner.entries.set(peerId,entry);
      entry.engine=createPair({...options,sessionId:owner.id,lan,replayCache,initialBindings:savedBindings,initialInputMode:mode,
        onState:state=>{
          if(group!==owner)return;entry.state=state;
          if(!state.sessionId&&state.state!=='preparing') {
            owner.entries.delete(peerId);if(state.error)latestError=state.error;
            if(!owner.entries.size){group=null;stopAdapter(owner).catch(()=>{});}else if(owner.mode==='lan')queueMembership(owner);
          } else if(owner.mode==='lan')queueMembership(owner);
          emit();
        },
        onLanPeers:async values=>{if(group!==owner)return;owner.allowed=values.filter(v=>v!==entry.state.lanAddress);await syncNativePeers(owner);},
        requestNative:async(action,fields)=>{
          if(owner.mode!=='lan')return options.requestNative(action,fields);
          if(action==='lan-stop')return {ok:true};
          if(group!==owner)throw Error('The LAN session ended.');
          if(action==='lan-start') {
            if(!owner.nativePromise) {
              owner.nativeStarted=true;
              owner.nativePromise=(async()=>{
                const result=await callNative(action,fields);
                if(group!==owner){await callNative('lan-stop',{sessionId:owner.id}).catch(()=>{});return result;}
                await syncNativePeers(owner);return result;
              })();
            }
            return owner.nativePromise;
          }
          if(action==='lan-packet')return routePacket(owner,entry,fields);
          return callNative(action,fields);
        }});
      return entry;
    }
    async function invite(peerId,kind) {
      if(group&&(kind!=='lan'||group.mode!=='lan'||group.role!=='host'))throw Error('End your current gaming session first.');
      if(!['lan','together'].includes(kind))throw Error('Choose LAN or game together.');
      if(group?.entries.has(peerId))throw Error('This friend already has an invitation or connection.');
      if(group?.entries.size>=3)throw Error('This LAN is full: invite up to three friends.');
      latestError='';const owner=group||makeGroup(sessionToken(),kind,'host');group=owner;
      const subnet=(Number.parseInt(owner.id.slice(0,8),16)%250)+1,prefix=`10.203.${subnet}.`;
      const used=new Set([...owner.entries.values()].map(e=>e.state.peerAddress));let index=2;while(used.has(prefix+index))index++;
      const entry=addEntry(owner,peerId,kind==='lan'?{address:prefix+'1',peerAddress:prefix+index,prefix:24}:undefined);
      return entry.engine.invite(peerId,kind);
    }
    async function receive(value) {
      let owner=group,entry=owner?.entries.get(value?.from),created=false;
      if(!entry) {
        if(owner||value?.payload?.kind!=='invite')return false;
        if(!['lan','together'].includes(value.payload.mode))return false;
        owner=makeGroup(value.session,value.payload.mode,'guest');group=owner;created=true;entry=addEntry(owner,value.from);
      }
      const accepted=await entry.engine.receive(value);
      if(created&&!accepted&&group===owner){owner.entries.delete(entry.peerId);group=null;emit();}
      return accepted;
    }
    async function stop(failure='') {
      const owner=group;group=null;latestError=typeof failure==='string'?failure:'';
      if(owner){await Promise.all([...owner.entries.values()].map(e=>e.engine.stop()));await stopAdapter(owner);}
      emit();
    }
    function single(method,...args) {const entry=group?.entries.values().next().value;return entry?.engine[method](...args);}
    function handleNativePacket(message) {
      const owner=group;if(!owner||owner.mode!=='lan'||message?.sessionId!==owner.id||message.type!=='gaming-lan-packet')return false;
      const bytes=decodePacket(message.packet);if(!bytes)return false;
      let sent=false;const destination=ip(bytes,16),all=broadcast(bytes);
      for(const entry of owner.entries.values())if(owner.role==='guest'||all||destination===entry.state.peerAddress)sent=entry.engine.handleNativePacket(message)||sent;
      return sent;
    }
    function setBindings(value) {const result=root.VumiroControllerMapping.validateBindings(value);if(!result.valid)throw Error(result.errors.join(' '));savedBindings={...result.bindings};for(const entry of group?.entries.values()||[])entry.engine.setBindings(savedBindings);return {...savedBindings};}
    function setInputMode(value) {if(!['keyboard','physical'].includes(value))throw Error('Choose keyboard or physical controller input.');mode=value;for(const entry of group?.entries.values()||[])entry.engine.setInputMode(value);emit();}
    function releaseInput(){for(const entry of group?.entries.values()||[])entry.engine.releaseInput();}
    root.addEventListener?.('blur',releaseInput);root.addEventListener?.('pagehide',()=>{stop().catch(()=>{});});
    root.addEventListener?.('vumiro-friends-changed',()=>{for(const entry of group?.entries.values()||[])entry.engine.checkTrust();});
    return Object.freeze({invite,receive,stop,snapshot,handleNativePacket,setBindings,setInputMode,releaseInput,
      accept:id=>single('accept',id),decline:id=>single('decline',id),setInputFocused:value=>single('setInputFocused',value),setKey:(code,down)=>single('setKey',code,down),startSharing:settings=>single('startSharing',settings),stopSharing:()=>single('stopSharing')});
  }
  root.VumiroGamingSession=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
