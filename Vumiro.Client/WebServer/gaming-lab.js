/* On-demand local diagnostics. Browser transport checks never call the native bridge. */
(function(root){
  'use strict';
  const assetBase=root.document?.currentScript?.src||root.location?.href;
  const cancelled=()=>Object.assign(Error('Test cancelled. Temporary media and connections were closed.'),{cancelled:true});
  const unavailable=detail=>Object.assign(Error(detail),{unavailable:true});
  const check=(id,label,status,detail)=>({id,label,status,detail:String(detail||'')});
  function create(options={}) {
    let active=null,disposed=false;
    const timeoutMs=Number.isFinite(options.timeoutMs)&&options.timeoutMs>0?Math.min(options.timeoutMs,120000):20000;
    const nativeTimeoutMs=Number.isFinite(options.timeoutMs)&&options.timeoutMs>0?timeoutMs:360000;
    const progress=value=>{try{options.onProgress?.({...value});}catch{/* A diagnostics view must not interrupt cleanup. */}};
    const simple=(id,detail)=>({passed:false,cancelled:false,checks:[check(id,'Test availability','unavailable',detail)]});
    function start(kind,work) {
      if(disposed)return Promise.resolve(simple('lab-disposed','This test lab is closed. Open a new test lab to run checks.'));
      if(active)return Promise.resolve(simple('lab-busy','Another test is running. Cancel it before starting another.'));
      const run={kind,checks:[],cleanups:[],timers:new Set(),aborted:false,closed:false,step:{id:kind,label:kind==='transport'?'Local browser transport':kind==='capture'?'Selected-window capture':'Native '+kind+' self-test'}};
      run.abort=new Promise((_,reject)=>{run.abortReject=reject;});run.abort.catch(()=>{});
      run.alive=()=>active===run&&!run.aborted&&!run.closed;
      run.own=cleanup=>run.cleanups.push(cleanup);
      run.guard=()=>{if(!run.alive())throw cancelled();};
      run.await=(promise,label=run.step.label,limit=timeoutMs)=>{
        let timer;
        const deadline=new Promise((_,reject)=>{timer=root.setTimeout(()=>{run.timers.delete(timer);reject(Error(label+' timed out. Retry after checking the browser and Windows gaming status.'));},limit);run.timers.add(timer);});
        return Promise.race([Promise.resolve(promise),run.abort,deadline]).finally(()=>{root.clearTimeout(timer);run.timers.delete(timer);});
      };
      run.delay=ms=>run.await(new Promise(resolve=>{const timer=root.setTimeout(()=>{run.timers.delete(timer);resolve();},ms);run.timers.add(timer);}));
      run.wait=async(predicate,label)=>{const deadline=Date.now()+timeoutMs;while(!predicate()){run.guard();if(Date.now()>=deadline)throw Error(label+' timed out.');await run.delay(25);}run.guard();};
      run.begin=(id,label)=>{run.guard();run.step={id,label};};
      run.report=(id,label,status,detail)=>{run.guard();const value=check(id,label,status,detail);run.checks.push(value);progress(value);};
      run.pass=detail=>run.report(run.step.id,run.step.label,'passed',detail);
      active=run;
      // Invoke work immediately: testCapture must reach getDisplayMedia in the click's task.
      let task;try{task=work(run);}catch(error){task=Promise.reject(error);}
      return (async()=>{
        try{await Promise.race([task,run.abort]);}
        catch(error){const value=check(run.step.id,run.step.label,error.unavailable?'unavailable':'failed',error.message||String(error));run.checks.push(value);progress(value);}
        finally {
          run.closed=true;
          for(const timer of run.timers)root.clearTimeout(timer);run.timers.clear();
          for(const cleanup of run.cleanups.reverse())try{await cleanup();}catch(error){const value=check('cleanup','Temporary resource cleanup','failed',error.message||String(error));run.checks.push(value);progress(value);}
          if(active===run)active=null;
        }
        return {passed:run.checks.length>0&&run.checks.every(value=>value.status==='passed'),cancelled:run.aborted,kind,checks:run.checks};
      })();
    }
    async function sandbox(run) {
      if(options.createSandbox) {
        const pending=Promise.resolve(options.createSandbox());
        pending.then(value=>{if(!run.alive())value?.dispose?.();}).catch(()=>{});
        const value=await run.await(pending,'Test browser setup');run.guard();run.own(()=>value.dispose?.());return value.realm;
      }
      if(!root.document?.body||!root.RTCPeerConnection||!root.crypto?.subtle)throw unavailable('Real WebRTC, secure browser cryptography and a document are required. Open this test inside the Vumiro desktop app.');
      const iframe=root.document.createElement('iframe');iframe.title='Temporary Vumiro test environment';iframe.setAttribute('aria-hidden','true');iframe.tabIndex=-1;
      iframe.style.cssText='position:fixed;left:-10000px;top:0;width:640px;height:360px;pointer-events:none';root.document.body.append(iframe);run.own(()=>iframe.remove());
      const realm=iframe.contentWindow;
      const load=filename=>run.await(new Promise((resolve,reject)=>{const script=realm.document.createElement('script');script.onload=resolve;script.onerror=()=>reject(unavailable('The bundled '+filename+' test dependency could not load. Reload Vumiro and retry.'));script.src=new root.URL(filename,assetBase).href;realm.document.head.append(script);}),filename+' loading');
      // Releases fold these modules into the frozen local-profile asset. Loading
      // it defines APIs; the empty sandbox has no Gaming navigation to initialize.
      await load('local-profile.js');
      if(!realm.VumiroControllerMapping)await load('controller-mapping.js');
      if(!realm.VumiroGamingSession)await load('gaming-session.js');
      return realm;
    }
    async function transportContext(run) {
      const realm=await sandbox(run);run.guard();
      if(!realm?.VumiroGamingSession||!realm.RTCPeerConnection||!realm.crypto?.subtle||!realm.document||!realm.navigator?.mediaDevices)throw unavailable('This browser is missing WebRTC, the session engine or secure media APIs. No transport checks were simulated.');
      const peers=[],nodes=new Map(),frames=[],errors=[];
      const OriginalPeer=realm.RTCPeerConnection,originalCapture=realm.navigator.mediaDevices.getDisplayMedia,originalGamepads=realm.navigator.getGamepads;
      realm.RTCPeerConnection=class extends OriginalPeer{constructor(config){super(config);peers.push(this);}};
      run.own(()=>{realm.RTCPeerConnection=OriginalPeer;realm.navigator.mediaDevices.getDisplayMedia=originalCapture;realm.navigator.getGamepads=originalGamepads;for(const pc of peers)pc.close();});
      const encoder=new realm.TextEncoder(),encode=buffer=>realm.btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const decode=value=>Uint8Array.from(realm.atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
      const video=realm.document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;realm.document.body.append(video);run.own(()=>{video.pause();video.srcObject=null;video.remove();});
      async function identity(name) {
        const keys=await realm.crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
        const spki=await realm.crypto.subtle.exportKey('spki',keys.publicKey),profile={id:encode(await realm.crypto.subtle.digest('SHA-256',spki)),key:encode(spki),name};return {keys,profile};
      }
      const identities=await run.await(Promise.all(['Test host','Test guest one','Test guest two'].map(identity)),'Ephemeral signing identities');run.guard();
      for(const identity of identities) {
        const node={identity,packets:[],invitation:null,engine:null};nodes.set(identity.profile.id,node);
        const local={profile:()=>identity.profile,
          sign:async text=>encode(await realm.crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.keys.privateKey,encoder.encode(text))),
          validateContact:async contact=>{if(encode(await realm.crypto.subtle.digest('SHA-256',decode(contact.key)))!==contact.id)throw Error('The ephemeral contact key does not match its fingerprint.');return contact;},
          verify:async(contact,text,signature)=>realm.crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await realm.crypto.subtle.importKey('spki',decode(contact.key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']),decode(signature),encoder.encode(text))};
        node.engine=realm.VumiroGamingSession.create({local,iceServers:[],getFriend:id=>nodes.get(id)?.identity.profile||null,
          send:envelope=>{if(!run.alive())return;const timer=root.setTimeout(()=>{run.timers.delete(timer);if(run.alive())nodes.get(envelope.to)?.engine.receive(JSON.parse(JSON.stringify(envelope))).catch(error=>errors.push(error.message));},0);run.timers.add(timer);},
          requestNative:async(action,fields)=>{if(!run.alive()&&!action.endsWith('-stop'))return {ok:false,error:'Test cancelled.'};if(action==='remote-controller-frame')frames.push(fields);if(action==='lan-packet')node.packets.push(fields.packet);return {ok:true,lan:{state:'active'},controller:{active:true}};},
          onInvitation:value=>node.invitation=value,
          onTrack:value=>{if(node!==[...nodes.values()][1]||!run.alive()||!value.stream||video.srcObject===value.stream)return;video.srcObject=value.stream;video.play().catch(error=>{if(run.alive())errors.push(error.message);});}});
        run.own(()=>node.engine.stop());
      }
      return {realm,peers,nodes:[...nodes.values()],frames,errors,video};
    }
    async function syntheticMedia(run,context) {
      const {realm}=context,canvas=realm.document.createElement('canvas');canvas.width=640;canvas.height=360;
      if(!canvas.captureStream||!realm.AudioContext)throw unavailable('Canvas video capture and browser audio are required for the local media transport test.');
      realm.document.body.append(canvas);run.own(()=>canvas.remove());const paint=canvas.getContext('2d');let frame=0;
      const draw=()=>{paint.fillStyle=frame++%2?'#9fdb67':'#293c32';paint.fillRect(0,0,640,360);paint.fillStyle='white';paint.font='24px sans-serif';paint.fillText('Vumiro local test '+frame,24,100);};draw();
      const interval=realm.setInterval(draw,33);run.own(()=>realm.clearInterval(interval));
      const stream=canvas.captureStream(30);run.own(()=>stream.getTracks().forEach(track=>track.stop()));
      const audio=new realm.AudioContext();run.own(()=>audio.close());await run.await(audio.resume(),'Synthetic test audio startup');
      const oscillator=audio.createOscillator(),destination=audio.createMediaStreamDestination();oscillator.frequency.value=440;oscillator.connect(destination);oscillator.start();
      run.own(()=>{try{oscillator.stop();}catch{}oscillator.disconnect();destination.disconnect();});for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
      return stream;
    }
    async function together(run,context,stream,selected=false) {
      const {realm,nodes:[host,guest],frames,video}=context;
      realm.navigator.mediaDevices.getDisplayMedia=async()=>stream;
      run.begin('signed-session','Ephemeral signed session and explicit acceptance');
      await run.await(host.engine.invite(guest.identity.profile.id,'together'));await run.wait(()=>guest.invitation,'Signed invitation delivery');
      if(guest.engine.snapshot().accepted)throw Error('An invitation was accepted without the explicit test acceptance.');
      await run.await(guest.engine.accept(guest.invitation.id));await run.wait(()=>host.engine.snapshot().state==='connected'&&guest.engine.snapshot().state==='connected','Local RTC data connection');
      run.pass('Real P-256 signatures and real local WebRTC channels. No account identity or signaling server was used.');
      run.begin(selected?'capture-video':'video-transport',selected?'Selected-window video through WebRTC':'Decoded video transport from a synthetic canvas');
      await run.await(host.engine.startSharing({frameRate:30,bitrateMbps:8}));await run.wait(()=>video.readyState>=2&&video.videoWidth>0,'Video decode');
      let decoded=0;for(const pc of context.peers){const stats=await run.await(pc.getStats());for(const value of stats.values())if(value.type==='inbound-rtp'&&value.kind==='video')decoded+=value.framesDecoded||0;}
      if(decoded<1)throw Error('The remote video did not decode a frame.');run.pass(video.videoWidth+' × '+video.videoHeight+' video decoded; '+decoded+' frame(s) measured.');
      run.begin(selected?'capture-audio':'audio-transport',selected?'Selected-window audio track through WebRTC':'Decoded audio transport from a synthetic tone');
      if(!stream.getAudioTracks().length)run.report(run.step.id,run.step.label,'unavailable','The chosen capture contains no audio track. Select a source with Share audio enabled to test game sound.');
      else {
        await run.wait(()=>video.srcObject?.getAudioTracks().length>0,'Remote audio track');
        const audio=new realm.AudioContext();run.own(()=>audio.close());await run.await(audio.resume(),'Audio decoder measurement');
        const source=audio.createMediaStreamSource(video.srcObject),meter=audio.createAnalyser();meter.fftSize=2048;source.connect(meter);run.own(()=>{source.disconnect();meter.disconnect();});let rms=0;
        for(let i=0;i<12;i++){await run.delay(25);const values=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(values);rms=Math.max(rms,Math.sqrt(values.reduce((sum,n)=>sum+n*n,0)/values.length));}
        if(selected&&rms<=.001)run.report(run.step.id,run.step.label,'unavailable','An audio track arrived but the selected source was silent. Play game sound and retry to verify audible audio.');
        else if(rms<=.001)throw Error('The synthetic audio tone did not decode.');else run.pass('Decoded audio measured locally (peak RMS '+rms.toFixed(4)+'). No sound was played through your speakers.');
      }
      if(!selected) {
        run.begin('mapped-input','Focused keyboard mapping through the input channel');
        const bindings=run.bindings||realm.VumiroControllerMapping.DEFAULT_BINDINGS,code=Object.values(bindings).find(value=>typeof value==='string'&&value);
        if(!code)throw unavailable('This mapping has no bound keys. Bind a control before testing keyboard conversion.');
        const expected=realm.VumiroControllerMapping.frameFromKeys(bindings,new Set([code]));guest.engine.setBindings(bindings);
        const count=frames.length;guest.engine.setKey(code,true);await run.delay(80);
        // setBindings deliberately releases previous input; that neutral frame
        // may arrive during this window and must not count as an input grant.
        if(frames.slice(count).some(call=>Object.values(call.frame).some(value=>value!==0)))throw Error('Unfocused keyboard input was transmitted.');
        guest.engine.setInputFocused(true);guest.engine.setKey(code,true);await run.wait(()=>frames.slice(count).some(call=>Object.keys(expected).every(key=>call.frame[key]===expected[key])),'Selected mapping frame');run.pass('The selected mapping’s '+code+' key produced its expected controller values through the real channel. The native controller bridge was intercepted.');
        run.begin('neutral-input','Neutral input when focus is released');const offset=frames.length;guest.engine.releaseInput();await run.wait(()=>frames.slice(offset).some(call=>Object.values(call.frame).every(value=>value===0)),'Neutral release frame');run.pass('All stick, trigger and button values returned to zero.');
        run.begin('physical-input','Standard gamepad transport with synthetic gamepad input');
        const buttons=Array.from({length:17},()=>({pressed:false,value:0}));buttons[1].pressed=true;buttons[6].value=.5;
        realm.navigator.getGamepads=()=>[{connected:true,mapping:'standard',axes:[.5,-.5,0,0],buttons}];guest.engine.setInputMode('physical');guest.engine.setInputFocused(true);
        await run.wait(()=>frames.some(call=>call.frame.buttons===8192&&call.frame.leftX===16384&&call.frame.leftTrigger===128),'Standard gamepad frame');guest.engine.releaseInput();run.pass('Synthetic B-button, half stick and half trigger values traversed the real channel. This checks the gamepad conversion path, not attached controller hardware.');
      }
      await run.await(host.engine.stop());await run.await(guest.engine.stop());guest.invitation=null;
    }
    const encodePacket=(realm,from,to)=>{
      const bytes=new Uint8Array(28);bytes[0]=0x45;bytes[3]=28;bytes[8]=64;bytes[9]=17;bytes.set(from.split('.').map(Number),12);bytes.set(to.split('.').map(Number),16);
      let sum=0;for(let i=0;i<20;i+=2)sum+=(bytes[i]<<8)|bytes[i+1];while(sum>>>16)sum=(sum&65535)+(sum>>>16);sum=(~sum)&65535;bytes[10]=sum>>>8;bytes[11]=sum&255;return realm.btoa(String.fromCharCode(...bytes));
    };
    async function lan(run,context) {
      const {realm,nodes:[host,first,second]}=context;
      run.begin('lan-unicast','LAN packets between two guests through the host');
      await run.await(host.engine.invite(first.identity.profile.id,'lan'));await run.await(host.engine.invite(second.identity.profile.id,'lan'));
      await run.wait(()=>first.invitation&&second.invitation,'LAN invitations');await run.await(first.engine.accept(first.invitation.id));await run.await(second.engine.accept(second.invitation.id));
      await run.wait(()=>host.engine.snapshot().participants.length===2&&host.engine.snapshot().participants.every(peer=>peer.state==='connected')&&first.engine.snapshot().state==='connected'&&second.engine.snapshot().state==='connected','LAN RTC channels');await run.delay(100);
      const from=first.engine.snapshot().lanAddress,to=second.engine.snapshot().lanAddress,sessionId=first.engine.snapshot().sessionId;
      const send=(source,destination)=>first.engine.handleNativePacket({type:'gaming-lan-packet',sessionId,packet:encodePacket(realm,source,destination)});
      if(!send(from,to))throw Error('A valid LAN packet could not enter the RTC channel.');await run.wait(()=>second.packets.length===1,'Unicast packet arrival');if(first.packets.length)throw Error('The LAN packet reflected to its sender.');run.pass('A real binary RTC packet traveled guest → host → other guest. Native adapters were intercepted.');
      run.begin('lan-broadcast','LAN broadcast delivery without reflection');send(from,'255.255.255.255');await run.wait(()=>second.packets.length===2&&host.packets.length===1,'Broadcast packet delivery');if(first.packets.length)throw Error('A broadcast reflected to its sender.');run.pass('The host and other guest received the broadcast; its sender did not.');
      run.begin('lan-spoofing','Spoofed LAN source address rejection');send(to,'255.255.255.255');await run.delay(150);if(second.packets.length!==2||host.packets.length!==1)throw Error('A spoofed source packet crossed the LAN boundary.');run.pass('The host rejected a guest packet claiming another guest’s address.');
    }
    function runTransport() {
      return start('transport',async run=>{
        if(options.getBindings) {
          run.begin('mapping-validation','Selected controller mapping');
          if(!root.VumiroControllerMapping)throw unavailable('The controller mapping module is unavailable. Reload Vumiro and retry.');
          const result=root.VumiroControllerMapping.validateBindings(options.getBindings());if(!result.valid)throw Error('Invalid mapping bindings: '+result.errors.join(' '));run.bindings={...result.bindings};
        }
        const context=await transportContext(run),stream=await syntheticMedia(run,context);await together(run,context,stream);await lan(run,context);if(context.errors.length)throw Error(context.errors.join('; '));
      });
    }
    function testCapture() {
      return start('capture',async run=>{
        run.begin('capture-permission','Choose a window for a local capture test');
        if(!root.navigator?.mediaDevices?.getDisplayMedia)throw unavailable('This browser cannot capture a window. Open Vumiro’s Windows desktop app to test game capture.');
        let pending;try{pending=Promise.resolve(root.navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30}},audio:true,systemAudio:'include'}));}catch(error){throw error;}
        pending.then(stream=>{if(!run.alive())stream.getTracks().forEach(track=>track.stop());}).catch(()=>{});
        let stream;try{stream=await run.await(pending,'Window selection');}catch(error){if(error.name==='NotAllowedError'||error.name==='AbortError')throw unavailable('Screen selection was cancelled or permission was denied. No capture test passed.');throw error;}
        run.guard();run.own(()=>stream.getTracks().forEach(track=>track.stop()));if(!stream.getVideoTracks().length)throw unavailable('The chosen capture has no video track. Choose a game window and retry.');
        run.pass('Capture permission was granted for this test only. The stream will close when the test finishes.');const context=await transportContext(run);await together(run,context,stream,true);if(context.errors.length)throw Error(context.errors.join('; '));
      });
    }
    async function runNative(kind) {
      if(!['lan','controller'].includes(kind))throw Error('Choose native kind lan or controller.');
      return start(kind,async run=>{
        if(typeof options.requestNative!=='function')throw unavailable('Native self-tests require the Vumiro Windows desktop app.');
        const reply=await run.await(options.requestNative('self-test',{kind}),'Native '+kind+' self-test',nativeTimeoutMs),report=reply?.test||reply?.selfTest||reply;
        if(reply?.ok===false)throw Error(reply.error||'The native self-test was rejected.');
        if(!report||typeof report.passed!=='boolean'||!Array.isArray(report.checks)||!report.checks.length)throw Error('The native helper returned no verified test results. Refresh the app and retry.');
        for(const value of report.checks) {
          if(!value||typeof value.id!=='string'||typeof value.label!=='string'||!['passed','failed','unavailable'].includes(value.status)||typeof value.detail!=='string')throw Error('The native helper returned an invalid test result.');
          run.report(value.id,value.label,value.status,value.detail);
        }
        if(!report.passed&&report.checks.every(value=>value.status==='passed'))throw Error('The native helper reported an overall failure.');
      });
    }
    function cancel(){if(active&&!active.aborted){active.aborted=true;active.abortReject(cancelled());}}
    function dispose(){disposed=true;cancel();}
    return Object.freeze({runTransport,runNative,testCapture,cancel,dispose});
  }
  root.VumiroGamingLab=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
