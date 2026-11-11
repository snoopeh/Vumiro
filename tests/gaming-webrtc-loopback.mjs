// Manual live-runtime check: run a LOCAL QA WebView2 with CDP enabled first.
// Usage: node tests/gaming-webrtc-loopback.mjs [http://127.0.0.1:9228]
// It creates an isolated iframe, ephemeral identities and synthetic test media.
// Native calls are intercepted; no account, driver, profile or network is changed.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const endpoint=process.argv[2]||'http://127.0.0.1:9228';
const output=path.resolve('dist/gaming-webrtc-loopback');
const sources={engine:await readFile(new URL('../Vumiro.Client/WebServer/gaming-session.js',import.meta.url),'utf8'),mapping:await readFile(new URL('../Vumiro.Client/WebServer/controller-mapping.js',import.meta.url),'utf8')};
const tabs=await fetch(endpoint+'/json/list').then(response=>{if(!response.ok)throw Error('WebView2 debugger is unavailable.');return response.json();});
const target=tabs.find(tab=>tab.type==='page'&&/^https?:\/\/(?:screentask\.local|127\.0\.0\.1|localhost)(?::|\/)/.test(tab.url));
assert.ok(target?.webSocketDebuggerUrl,'Open the isolated LOCAL QA WebView2 before running this check.');
const socket=new WebSocket(target.webSocketDebuggerUrl);let sequence=0;
const pending=new Map();
socket.addEventListener('message',event=>{
  const value=JSON.parse(event.data);if(!value.id)return;const entry=pending.get(value.id);if(!entry)return;
  pending.delete(value.id);clearTimeout(entry.timer);if(value.error)entry.reject(Error(value.error.message));else entry.resolve(value.result);
});
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('Cannot connect to the WebView2 debugger.')),{once:true});});
function cdp(method,params={}) {return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Debugger request timed out: '+method));},90000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}

async function liveCheck(sources) {
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async(predicate,label,timeout=15000)=>{const start=performance.now();while(!predicate()){if(performance.now()-start>timeout)throw Error('Timed out: '+label);await delay(25);}};
  const iframe=document.createElement('iframe');iframe.title='Temporary Vumiro WebRTC loopback verification';
  iframe.style.cssText='position:fixed;left:-10000px;top:0;width:640px;height:360px';document.body.append(iframe);
  const realm=iframe.contentWindow,engines=[],nodes=new Map(),relay=[],native=[],errors=[],peers=[];
  let audioContext,oscillator,paintTimer,media,video;
  const OriginalPeer=realm.RTCPeerConnection,originalCapture=realm.navigator.mediaDevices.getDisplayMedia;
  const result={runtime:navigator.userAgent,signaling:'real P-256 signatures through an in-memory asynchronous relay',network:'real RTCPeerConnection, local host ICE only',native:'intercepted test adapter/controller calls; native hardware is verified separately'};
  try {
    realm.eval(sources.mapping);realm.eval(sources.engine);
    realm.RTCPeerConnection=class extends OriginalPeer{constructor(configuration){super(configuration);peers.push(this);}};
    const encoder=new realm.TextEncoder(),base64url=buffer=>realm.btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const decode=text=>Uint8Array.from(realm.atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    async function identity(name) {
      const pair=await realm.crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
      const spki=await realm.crypto.subtle.exportKey('spki',pair.publicKey),key=base64url(spki),id=base64url(await realm.crypto.subtle.digest('SHA-256',spki));
      return {profile:{id,key,name},pair};
    }
    const identities=await Promise.all(['Host','Guest one','Guest two'].map(identity));
    function makeNode(identity) {
      const node={identity,receivedPackets:[],states:[],invitation:null,engine:null};nodes.set(identity.profile.id,node);
      const local={profile:()=>identity.profile,sign:async text=>base64url(await realm.crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.pair.privateKey,encoder.encode(text))),
        validateContact:async contact=>{assert(base64url(await realm.crypto.subtle.digest('SHA-256',decode(contact.key)))===contact.id,'Contact public key fingerprint mismatch');return contact;},
        verify:async(contact,text,signature)=>realm.crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await realm.crypto.subtle.importKey('spki',decode(contact.key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']),decode(signature),encoder.encode(text))};
      node.engine=realm.VumiroGamingSession.create({local,iceServers:[],getFriend:id=>nodes.get(id)?.identity.profile||null,
        send:envelope=>{relay.push({kind:envelope.payload.kind,from:envelope.from,to:envelope.to});realm.setTimeout(()=>{nodes.get(envelope.to)?.engine.receive(JSON.parse(JSON.stringify(envelope))).catch(error=>errors.push(error.message));},0);},
        requestNative:async(action,fields)=>{native.push({owner:identity.profile.id,action,...fields});if(action==='lan-packet')node.receivedPackets.push(fields.packet);return {ok:true,lan:{state:'active'},controller:{active:true}};},
        onState:state=>node.states.push(state.state),onInvitation:value=>node.invitation=value,
        onTrack:value=>{if(identity!==identities[1]||!value.stream||video.srcObject===value.stream)return;video.srcObject=value.stream;video.play().catch(error=>errors.push('video play: '+error.message));}});
      engines.push(node.engine);return node;
    }
    const host=makeNode(identities[0]),guest=makeNode(identities[1]),second=makeNode(identities[2]);
    video=realm.document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;realm.document.body.append(video);
    const canvas=realm.document.createElement('canvas');canvas.width=640;canvas.height=360;realm.document.body.append(canvas);const paint=canvas.getContext('2d');let frame=0;
    const paintFrame=()=>{paint.fillStyle=frame++%2?'#d63846':'#173b72';paint.fillRect(0,0,640,360);paint.fillStyle='white';paint.font='28px sans-serif';paint.fillText('Vumiro real WebRTC '+frame,20,100);};paintFrame();paintTimer=realm.setInterval(paintFrame,33);
    media=canvas.captureStream(30);audioContext=new realm.AudioContext();await audioContext.resume();oscillator=audioContext.createOscillator();oscillator.frequency.value=440;const destination=audioContext.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();for(const track of destination.stream.getAudioTracks())media.addTrack(track);
    realm.navigator.mediaDevices.getDisplayMedia=async()=>media;
    await host.engine.invite(guest.identity.profile.id,'together');await wait(()=>guest.invitation,'signed together invitation');
    assert(!guest.engine.snapshot().accepted,'Guest must explicitly accept the invitation');assert(peers.length===0,'An invitation must not allocate a peer connection');
    await guest.engine.accept(guest.invitation.id);
    await wait(()=>host.engine.snapshot().state==='connected'&&guest.engine.snapshot().state==='connected','real data channels open');
    await host.engine.startSharing({frameRate:30,bitrateMbps:8});
    await wait(()=>video.readyState>=2&&video.videoWidth===640&&video.srcObject?.getAudioTracks().length===1,'decoded video and audio tracks',20000);
    const hostId=host.identity.profile.id;
    guest.engine.setInputFocused(true);guest.engine.setKey('Space',true);
    await wait(()=>native.some(call=>call.owner===hostId&&call.action==='remote-controller-frame'&&call.frame.buttons===4096),'real controller data frame');
    guest.engine.releaseInput();await wait(()=>native.some(call=>call.owner===hostId&&call.action==='remote-controller-frame'&&Object.values(call.frame).every(value=>value===0)),'neutral focus release');
    const remoteAudio=audioContext.createMediaStreamSource(video.srcObject),analyser=audioContext.createAnalyser();analyser.fftSize=2048;remoteAudio.connect(analyser);let maximumRms=0;
    for(let sample=0;sample<10;sample++){await delay(20);const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);maximumRms=Math.max(maximumRms,Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length));}remoteAudio.disconnect();analyser.disconnect();
    assert(maximumRms>.01,'Actual WebRTC audio must decode the synthetic oscillator tone');
    const rtp=[];for(const pc of peers){const stats=await pc.getStats();for(const value of stats.values())if(value.type==='inbound-rtp')rtp.push({kind:value.kind,bytesReceived:value.bytesReceived,framesDecoded:value.framesDecoded,packetsReceived:value.packetsReceived});}
    assert(rtp.some(track=>track.kind==='video'&&track.bytesReceived>0&&track.framesDecoded>0),'Actual WebRTC video must decode');
    assert(rtp.some(track=>track.kind==='audio'&&track.bytesReceived>0),'Actual WebRTC audio RTP must arrive');
    result.together={videoWidth:video.videoWidth,videoHeight:video.videoHeight,audioTracks:video.srcObject.getAudioTracks().length,maximumAudioRms:maximumRms,rtp,controllerFrames:native.filter(call=>call.action==='remote-controller-frame').length,neutralRelease:true};
    await host.engine.stop();await guest.engine.stop();guest.invitation=null;second.invitation=null;
    await host.engine.invite(guest.identity.profile.id,'lan');await host.engine.invite(second.identity.profile.id,'lan');
    await wait(()=>guest.invitation&&second.invitation,'two signed LAN invitations');await guest.engine.accept(guest.invitation.id);await second.engine.accept(second.invitation.id);
    await wait(()=>host.engine.snapshot().participants.length===2&&host.engine.snapshot().participants.every(peer=>peer.state==='connected')&&guest.engine.snapshot().state==='connected'&&second.engine.snapshot().state==='connected','two real LAN data channels');
    await delay(150);
    const packet=(from,to)=>{const bytes=new Uint8Array(28);bytes[0]=0x45;bytes[2]=0;bytes[3]=28;bytes[8]=64;bytes[9]=17;bytes.set(from.split('.').map(Number),12);bytes.set(to.split('.').map(Number),16);let sum=0;for(let i=0;i<20;i+=2)sum+=(bytes[i]<<8)|bytes[i+1];while(sum>>>16)sum=(sum&65535)+(sum>>>16);sum=(~sum)&65535;bytes[10]=sum>>>8;bytes[11]=sum&255;return realm.btoa(String.fromCharCode(...bytes));};
    const firstAddress=guest.engine.snapshot().lanAddress,secondAddress=second.engine.snapshot().lanAddress,sessionId=guest.engine.snapshot().sessionId;
    assert(guest.engine.handleNativePacket({type:'gaming-lan-packet',sessionId,packet:packet(firstAddress,secondAddress)}),'Guest LAN packet must enter its real data channel');
    await wait(()=>second.receivedPackets.length===1,'guest-to-guest unicast through host star');
    assert(guest.receivedPackets.length===0,'Unicast must not reflect to its sender');
    guest.engine.handleNativePacket({type:'gaming-lan-packet',sessionId,packet:packet(firstAddress,'255.255.255.255')});
    await wait(()=>second.receivedPackets.length===2&&host.receivedPackets.length===1,'broadcast to host and other guest');
    const before=second.receivedPackets.length;guest.engine.handleNativePacket({type:'gaming-lan-packet',sessionId,packet:packet(secondAddress,'255.255.255.255')});await delay(150);assert(second.receivedPackets.length===before,'Host must reject spoofed guest source');
    result.lan={participants:host.engine.snapshot().participants.length,guestAddresses:[firstAddress,secondAddress],unicast:true,broadcast:true,spoofRejected:true,adaptersStarted:native.filter(call=>call.action==='lan-start').length};
    assert(!errors.length,errors.join('; '));result.signals=relay.length;result.errors=errors;return result;
  } finally {
    await Promise.all(engines.map(engine=>engine.stop().catch(()=>{})));
    for(const pc of peers)pc.close();for(const track of media?.getTracks()||[])track.stop();
    if(paintTimer)realm.clearInterval(paintTimer);try{oscillator?.stop();}catch{}await audioContext?.close().catch(()=>{});
    realm.navigator.mediaDevices.getDisplayMedia=originalCapture;realm.RTCPeerConnection=OriginalPeer;video?.remove();iframe.remove();
  }
}
try {
  const evaluated=await cdp('Runtime.evaluate',{expression:'('+liveCheck.toString()+')('+JSON.stringify(sources)+')',awaitPromise:true,returnByValue:true,userGesture:true});
  if(evaluated.exceptionDetails)throw Error(evaluated.exceptionDetails.exception?.description||evaluated.exceptionDetails.text);
  const result={checkedAt:new Date().toISOString(),target:target.url,...evaluated.result.value};
  assert.ok(result.together?.neutralRelease&&result.lan?.spoofRejected,'The live check did not finish all stages');
  await mkdir(output,{recursive:true});await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} finally {for(const entry of pending.values())clearTimeout(entry.timer);socket.close();}
