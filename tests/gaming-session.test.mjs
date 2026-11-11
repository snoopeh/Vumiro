import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = new URL('../Vumiro.Client/WebServer/gaming-session.js', import.meta.url);
const mapping = fs.readFileSync(new URL('../Vumiro.Client/WebServer/controller-mapping.js', import.meta.url),'utf8');
const hostId='H'.repeat(43), guestId='G'.repeat(43);
const neutral={buttons:0,leftX:0,leftY:0,rightX:0,rightY:0,leftTrigger:0,rightTrigger:0};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function harness(id=hostId, options={}) {
  const sent=[],native=[],pcs=[],intervals=new Map(),listeners=new Map();let timer=0;
  class Channel {
    constructor(label){this.label=label;this.readyState='connecting';this.bufferedAmount=0;this.sent=[];}
    send(data){this.sent.push(data);} close(){this.readyState='closed';this.onclose?.();}
    open(){this.readyState='open';this.onopen?.();}
  }
  class Peer {
    constructor(config){this.config=config;this.channels=[];this.remoteDescription=null;this.senders=[];this.connectionState='new';this.signalingState='stable';pcs.push(this);}
    createDataChannel(label){const c=new Channel(label);this.channels.push(c);return c;}
    addTransceiver(kind){const sender={kind,replaceTrack:async track=>{sender.track=track;},getParameters:()=>({encodings:[{}]}),setParameters:async value=>{sender.parameters=value;}};this.senders.push(sender);return {sender};}
    async createOffer(){if(options.offer)return options.offer.promise;return {type:'offer',sdp:'v=0\r\n'};}
    async createAnswer(){return {type:'answer',sdp:'v=0\r\n'};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){this.remoteDescription=value;}
    async addIceCandidate(value){(this.ice??=[]).push(value);}
    close(){this.signalingState='closed';this.connectionState='closed';}
  }
  class Stream {constructor(tracks=[]){this.tracks=[...tracks];}getTracks(){return this.tracks;}addTrack(track){this.tracks.push(track);}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}}
  const context={console,TextEncoder,Uint8Array,ArrayBuffer,crypto:webcrypto,Date,JSON,Map,Set,Promise,RTCPeerConnection:Peer,MediaStream:Stream,
    btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
    navigator:{mediaDevices:{getDisplayMedia:async value=>{options.captureRequests?.push(value);return options.capture?.promise;}},getGamepads:()=>options.gamepads||[]},
    setInterval:fn=>{intervals.set(++timer,fn);return timer;},clearInterval:id=>intervals.delete(id),
    setTimeout,clearTimeout,addEventListener:(name,fn)=>listeners.set(name,fn)};
  context.window=context;vm.createContext(context);vm.runInContext(mapping,context);
  if(fs.existsSync(source))vm.runInContext(fs.readFileSync(source,'utf8'),context);
  assert.ok(context.VumiroGamingSession,'gaming session engine must exist');
  const peer=id===hostId?guestId:hostId, friends=options.friends||[peer];
  const api=context.VumiroGamingSession.create({local:options.local||{profile:()=>({id}),sign:async()=> 'S'.repeat(86),verify:async()=>true,validateContact:async c=>c},iceServers:options.iceServers,
    send:async value=>sent.push(value),getFriend:async value=>friends.includes(value)?{id:value,key:options.friendKeys?.[value]||'friend-key',name:'Friend'}:null,
    requestNative:async(action,fields)=>{native.push({action,...fields});if(options.native)return options.native(action,fields);return {ok:true,lan:{state:'active'},controller:{active:true}};},
    onInvitation:options.onInvitation,onTrack:options.onTrack});
  let nonce=0;
  const envelope=(kind,payload={},session=api.snapshot().sessionId||'a'.repeat(32))=>({type:'gaming-signal',from:peer,to:id,session,nonce:(++nonce).toString().padStart(24,'A'),expires:Date.now()+60000,payload:{kind,...payload},signature:'S'.repeat(86)});
  return {api,sent,native,pcs,envelope,context,intervals,listeners,Channel,tick:async()=>{for(const fn of intervals.values())fn();await new Promise(r=>setImmediate(r));}};
}
test('unknown friends, replay and SDP before explicit acceptance create no connection',async()=>{
  let invitations=0;const h=harness(guestId,{onInvitation:()=>invitations++});
  const invite=h.envelope('invite',{mode:'together'});
  assert.equal(await h.api.receive({...invite,from:'X'.repeat(43)}),false);
  assert.equal(await h.api.receive(invite),true);assert.equal(invitations,1);
  assert.equal(await h.api.receive(invite),false);assert.equal(invitations,1);
  assert.equal(await h.api.receive(h.envelope('offer',{description:{type:'offer',sdp:'v=0'}})),false);
  assert.equal(h.pcs.length,0);assert.equal(h.native.length,0);
});
test('accepted host creates channels and discards stale or malformed remote input frames',async()=>{
  const h=harness();await h.api.invite(guestId,'together');await h.api.receive(h.envelope('accept'));
  const channel=h.pcs[0].channels.find(c=>c.label==='vumiro-input-v1');channel.open();await h.tick();
  channel.onmessage({data:JSON.stringify({sequence:2,frame:{...neutral,buttons:4096,leftX:90000}})});await h.tick();
  channel.onmessage({data:JSON.stringify({sequence:1,frame:neutral})});
  channel.onmessage({data:JSON.stringify({sequence:3,frame:{...neutral,rightY:'bad'}})});await h.tick();
  const frames=h.native.filter(c=>c.action==='remote-controller-frame');
  assert.equal(frames.length,1);assert.equal(frames[0].sequence,2);assert.equal(frames[0].frame.leftX,32767);
  await h.api.stop();assert.ok(h.native.some(c=>c.action==='remote-controller-stop'));
});
test('stop during a pending offer prevents stale SDP from being sent',async()=>{
  const offer=deferred(),h=harness(hostId,{offer});await h.api.invite(guestId,'lan');
  const receiving=h.api.receive(h.envelope('accept'));await new Promise(r=>setImmediate(r));
  await h.api.stop();offer.resolve({type:'offer',sdp:'v=0'});await receiving;
  assert.equal(h.api.snapshot().state,'idle');assert.equal(h.sent.filter(e=>e.payload.kind==='offer').length,0);
  assert.equal(h.pcs[0].signalingState,'closed');
});
test('stop during pending capture immediately stops late screen tracks',async()=>{
  const capture=deferred(),h=harness(hostId,{capture});await h.api.invite(guestId,'together');await h.api.receive(h.envelope('accept'));
  const sharing=h.api.startSharing();await h.api.stop();let stopped=0;
  capture.resolve({getTracks:()=>[{kind:'video',stop:()=>stopped++}],getVideoTracks:()=>[]});await sharing;
  assert.equal(stopped,1);assert.equal(h.api.snapshot().sharing,false);
});
test('stopping sharing while the chooser is pending cancels the late capture',async()=>{
  const capture=deferred(),h=harness(hostId,{capture});await h.api.invite(guestId,'together');await h.api.receive(h.envelope('accept'));
  const pending=h.api.startSharing();await h.api.stopSharing();let stopped=0;
  const track={kind:'video',stop:()=>stopped++};capture.resolve({getTracks:()=>[track],getVideoTracks:()=>[track]});await pending;
  assert.equal(stopped,1);assert.equal(h.api.snapshot().sharing,false);await h.api.stop();
});
test('separate incoming video and audio tracks share one playback stream',async()=>{
  const received=[],h=harness(guestId,{onTrack:value=>received.push(value)}),invitation=h.envelope('invite',{mode:'together'});
  await h.api.receive(invitation);await h.api.accept(invitation.session);
  const video={kind:'video'},audio={kind:'audio'};h.pcs[0].ontrack({track:video,streams:[]});h.pcs[0].ontrack({track:audio,streams:[]});
  assert.equal(received[0].stream,received[1].stream);assert.deepEqual([...received.at(-1).stream.getTracks()],[video,audio]);await h.api.stop();
});
test('stopping sharing during native controller startup cannot regrant input',async()=>{
  const start=deferred(),h=harness(hostId,{native:async action=>action==='remote-controller-start'?start.promise:{ok:true}});
  await h.api.invite(guestId,'together');await h.api.receive(h.envelope('accept'));
  const channel=h.pcs[0].channels[0];channel.open();await h.tick();await h.api.stopSharing();
  start.resolve({ok:true,controller:{active:true}});await h.tick();
  const stops=h.native.filter(e=>e.action==='remote-controller-stop');assert.ok(stops.length>=1);
  channel.onmessage({data:JSON.stringify({sequence:1,frame:{...neutral,buttons:4096}})});await h.tick();
  assert.equal(h.native.filter(e=>e.action==='remote-controller-frame').length,0);await h.api.stop();
});
test('explicit sharing quality controls cap capture frame rate and video bitrate',async()=>{
  const capture=deferred(),captureRequests=[],h=harness(hostId,{capture,captureRequests});
  await h.api.invite(guestId,'together');await h.api.receive(h.envelope('accept'));
  const video={kind:'video',stop:()=>{}},audio={kind:'audio',stop:()=>{}};
  capture.resolve({getTracks:()=>[video,audio],getVideoTracks:()=>[video],getAudioTracks:()=>[audio]});
  await h.api.startSharing({frameRate:30,bitrateMbps:8});
  assert.equal(captureRequests[0].video.frameRate.max,30);
  assert.equal(h.pcs[0].senders[0].parameters.encodings[0].maxBitrate,8000000);
  assert.equal(h.api.snapshot().hasAudio,true);await h.api.stop();
});
test('guest input requires focused surface and blur sends neutral release',async()=>{
  const h=harness(guestId);const invite=h.envelope('invite',{mode:'together'});await h.api.receive(invite);await h.api.accept(invite.session);
  const pc=h.pcs[0],channel=new h.Channel('vumiro-input-v1');pc.ondatachannel({channel});channel.open();
  h.api.setKey('Space',true);await h.tick();assert.equal(channel.sent.length,0);
  h.api.setInputFocused(true);h.api.setKey('Space',true);await h.tick();
  assert.equal(JSON.parse(channel.sent.at(-1)).frame.buttons,4096);
  h.api.releaseInput();assert.deepEqual(JSON.parse(channel.sent.at(-1)).frame,neutral);await h.api.stop();
});
test('LAN packets obey MTU, session, and data channel backpressure limits',async()=>{
  const h=harness();await h.api.invite(guestId,'lan');await h.api.receive(h.envelope('accept'));
  const c=h.pcs[0].channels[0];c.open();await h.tick();const sessionId=h.api.snapshot().sessionId;
  // A minimal IPv4 header plus UDP payload; packet authenticity is provided by DTLS.
  const packet=Buffer.alloc(28);packet[0]=0x45;packet.writeUInt16BE(28,2);packet.set(h.api.snapshot().peerAddress.split('.').map(Number),16);
  const message={type:'gaming-lan-packet',sessionId,packet:packet.toString('base64')};
  assert.equal(h.api.handleNativePacket(message),true);assert.equal(c.sent.length,1);
  c.bufferedAmount=300000;assert.equal(h.api.handleNativePacket(message),false);
  assert.equal(h.api.handleNativePacket({...message,sessionId:'bad'}),false);
  c.onmessage({data:new Uint8Array(1501).buffer});await h.tick();assert.equal(h.native.filter(v=>v.action==='lan-packet').length,0);
  await h.api.stop();
});
test('physical controller fractional axes survive conversion and release on window blur',async()=>{
  const buttons=Array.from({length:17},()=>({pressed:false,value:0}));buttons[0].pressed=true;buttons[6].value=.5;
  const h=harness(guestId,{gamepads:[{connected:true,mapping:'standard',axes:[.5,-.5,0,.8],buttons}]});
  const invitation=h.envelope('invite',{mode:'together'});await h.api.receive(invitation);await h.api.accept(invitation.session);
  const channel=new h.Channel('vumiro-input-v1');h.pcs[0].ondatachannel({channel});channel.open();
  h.api.setInputMode('physical');h.api.setInputFocused(true);await h.tick();
  const frame=JSON.parse(channel.sent.at(-1)).frame;assert.equal(frame.leftX,16384);assert.equal(frame.leftY,16384);assert.equal(frame.leftTrigger,128);
  h.listeners.get('blur')();assert.deepEqual(JSON.parse(channel.sent.at(-1)).frame,neutral);await h.api.stop();
});
test('signed LAN topology is applied only from the host and ignores older revisions',async()=>{
  const h=harness(guestId),lan={address:'10.203.8.1',peerAddress:'10.203.8.3',prefix:24};
  const invitation=h.envelope('invite',{mode:'lan',lan});await h.api.receive(invitation);await h.api.accept(invitation.session);
  const channel=new h.Channel('vumiro-lan-v1');h.pcs[0].ondatachannel({channel});channel.open();await h.tick();
  assert.equal(h.api.snapshot().lanAddress,'10.203.8.3');
  assert.equal(await h.api.receive(h.envelope('lan-peers',{revision:2,addresses:['10.203.8.1','10.203.8.2','10.203.8.3']})),true);
  assert.equal(await h.api.receive(h.envelope('lan-peers',{revision:1,addresses:['10.203.8.1','10.203.8.3']})),false);
  assert.deepEqual([...h.native.filter(e=>e.action==='lan-set-peers').at(-1).addresses],['10.203.8.1','10.203.8.2']);
  await h.api.stop();
});
test('session authenticates actual P-256 signatures and detects signed-payload tampering',async()=>{
  const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
  const encode=value=>Buffer.from(value).toString('base64url'),encoder=new TextEncoder();
  const local={profile:()=>({id:guestId}),validateContact:async c=>c,sign:async text=>encode(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,encoder.encode(text))),
    verify:async(contact,text,signature)=>webcrypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},keys.publicKey,Buffer.from(signature,'base64url'),encoder.encode(text))};
  const h=harness(guestId,{local}),invitation=h.envelope('invite',{mode:'together'});
  const text=['vumiro-gaming-signal-v1',invitation.from,invitation.to,invitation.session,invitation.nonce,invitation.expires,JSON.stringify(invitation.payload)].join('\n');
  invitation.signature=await local.sign(text);
  assert.equal(await h.api.receive({...invitation,payload:{kind:'invite',mode:'lan'}}),false);
  assert.equal(await h.api.receive(invitation),true);assert.equal(await h.api.receive(invitation),false);await h.api.stop();
  const host=harness(hostId,{local:{...local,profile:()=>({id:hostId})}});await host.api.invite(guestId,'together');
  const outbound=host.sent[0],outboundText=['vumiro-gaming-signal-v1',outbound.from,outbound.to,outbound.session,outbound.nonce,outbound.expires,JSON.stringify(outbound.payload)].join('\n');
  assert.equal(await local.verify(null,outboundText,outbound.signature),true);assert.equal(await local.verify(null,outboundText+'tampered',outbound.signature),false);await host.api.stop();
});
test('configured standard TURN credentials reach the peer and relay ICE remains valid',async()=>{
  const iceServers=[{urls:['turns:relay.example.com:5349?transport=tcp'],username:'short-lived-user',credential:'short-lived-secret'}],h=harness(hostId,{iceServers});
  await h.api.invite(guestId,'lan');await h.api.receive(h.envelope('accept'));
  assert.equal(h.pcs[0].config.iceServers[0].urls[0],iceServers[0].urls[0]);assert.equal(h.pcs[0].config.iceServers[0].credential,'short-lived-secret');
  assert.equal(await h.api.receive(h.envelope('ice',{candidate:{candidate:'candidate:1 1 UDP 1677734911 192.0.2.4 5000 typ relay',sdpMid:'0',sdpMLineIndex:0}})),true);
  await h.api.stop();
  assert.throws(()=>harness(hostId,{iceServers:[{urls:'https://relay.example.com'}]}),/ICE|STUN|TURN/i);
});
test('LAN host assigns one subnet to three friends and creates one native adapter',async()=>{
  const friends=[guestId,'J'.repeat(43),'K'.repeat(43)],h=harness(hostId,{friends});
  await h.api.invite(friends[0],'lan');await h.api.invite(friends[1],'lan');await h.api.invite(friends[2],'lan');
  assert.equal(new Set(h.sent.map(e=>e.session)).size,1);
  const invitations=h.sent.filter(e=>e.payload.kind==='invite');
  assert.deepEqual(invitations.map(e=>e.payload.lan.peerAddress.split('.').at(-1)),['2','3','4']);
  assert.equal(h.api.snapshot().participants.length,3);
  for(const friend of friends)await h.api.receive({...h.envelope('accept'),from:friend});
  for(const pc of h.pcs)pc.channels[0].open();await h.tick();await h.tick();
  assert.equal(h.native.filter(e=>e.action==='lan-start').length,1);
  const allowed=h.native.filter(e=>e.action==='lan-set-peers').at(-1);
  assert.deepEqual([...allowed.addresses].sort(),invitations.map(e=>e.payload.lan.peerAddress).sort());
  await assert.rejects(()=>h.api.invite('L'.repeat(43),'lan'),/three|3|full/i);await h.api.stop();
  assert.equal(h.native.filter(e=>e.action==='lan-stop').length,1);
});
test('LAN host forwards accepted guest unicast and broadcast without reflecting packets or accepting spoofed source',async()=>{
  const friends=[guestId,'J'.repeat(43)],h=harness(hostId,{friends});
  for(const id of friends)await h.api.invite(id,'lan');
  for(const id of friends)await h.api.receive({...h.envelope('accept'),from:id});
  for(const pc of h.pcs)pc.channels[0].open();await h.tick();await h.tick();
  const peers=h.api.snapshot().participants,first=h.pcs[0].channels[0],second=h.pcs[1].channels[0];
  const packet=(from,to)=>{const b=Buffer.alloc(28);b[0]=0x45;b.writeUInt16BE(28,2);b.set(from.split('.').map(Number),12);b.set(to.split('.').map(Number),16);return new Uint8Array(b).buffer;};
  first.onmessage({data:packet(peers[0].peerAddress,peers[1].peerAddress)});await h.tick();
  assert.equal(second.sent.length,1);assert.equal(first.sent.length,0);
  first.onmessage({data:packet(peers[0].peerAddress,'255.255.255.255')});await h.tick();
  assert.equal(second.sent.length,2);assert.equal(first.sent.length,0);
  const count=h.native.filter(e=>e.action==='lan-packet').length;
  first.onmessage({data:packet(peers[1].peerAddress,'255.255.255.255')});await h.tick();
  assert.equal(second.sent.length,2);assert.equal(h.native.filter(e=>e.action==='lan-packet').length,count);
  await h.api.stop();
});
test('one LAN guest leaving updates the shared allowlist without stopping another guest',async()=>{
  const friends=[guestId,'J'.repeat(43)],h=harness(hostId,{friends});for(const id of friends)await h.api.invite(id,'lan');
  for(const id of friends)await h.api.receive({...h.envelope('accept'),from:id});for(const pc of h.pcs)pc.channels[0].open();await h.tick();
  const remaining=h.api.snapshot().participants[1].peerAddress;
  assert.equal(await h.api.receive(h.envelope('end')),true);await h.tick();
  assert.equal(h.api.snapshot().participants.length,1);assert.equal(h.api.snapshot().participants[0].peerId,friends[1]);
  assert.deepEqual([...h.native.filter(e=>e.action==='lan-set-peers').at(-1).addresses],[remaining]);
  assert.equal(h.native.filter(e=>e.action==='lan-stop').length,0);await h.api.stop();
});
test('aggregate accepted reflects any accepted guest when the first invitation is still pending',async()=>{
  const friends=[guestId,'J'.repeat(43)],h=harness(hostId,{friends});for(const id of friends)await h.api.invite(id,'lan');
  await h.api.receive({...h.envelope('accept'),from:friends[1]});assert.equal(h.api.snapshot().accepted,true);await h.api.stop();
});
test('removing a friend revokes an established controller and closes its peer connection',async()=>{
  const friends=[guestId],h=harness(hostId,{friends});await h.api.invite(guestId,'together');await h.api.receive(h.envelope('accept'));
  h.pcs[0].channels[0].open();await h.tick();friends.length=0;await h.tick();await h.tick();
  assert.equal(h.pcs[0].signalingState,'closed');assert.ok(h.native.some(call=>call.action==='remote-controller-stop'));
  assert.match(h.api.snapshot().error,/friend|trust|permission/i);await h.api.stop();
});
test('replacing the trusted key revokes only that LAN friend while another remains connected',async()=>{
  const friends=[guestId,'J'.repeat(43)],friendKeys={[guestId]:'friend-key'},h=harness(hostId,{friends,friendKeys});
  for(const id of friends)await h.api.invite(id,'lan');for(const id of friends)await h.api.receive({...h.envelope('accept'),from:id});for(const pc of h.pcs)pc.channels[0].open();await h.tick();
  friendKeys[guestId]='changed-key';await h.tick();await h.tick();
  assert.equal(h.pcs[0].signalingState,'closed');assert.equal(h.api.snapshot().participants.length,1);assert.equal(h.pcs[1].signalingState,'stable');await h.api.stop();
});
