const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const runtimeRequire=process.env.SCREENTASK_NODE_MODULES ? createRequire(process.env.SCREENTASK_NODE_MODULES+'/package.json') : require;
const {chromium}=runtimeRequire('playwright');
const origin=process.env.SCREENTASK_TEST_ORIGIN || 'http://localhost:17871';
async function syntheticCapture() {
  window.__peerConnections=[];const Peer=window.RTCPeerConnection;window.RTCPeerConnection=class extends Peer {constructor(...args) {super(...args);window.__peerConnections.push(this);}};
  window.__roomSockets=[];const Socket=window.WebSocket;window.WebSocket=class extends Socket {constructor(...args) {super(...args);window.__roomSockets.push(this);}};
  window.__audioContexts=[];
  const audio=()=>{const context=new AudioContext(),oscillator=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();gain.gain.value=0.001;oscillator.connect(gain).connect(destination);oscillator.start();context.resume();window.__audioContexts.push(context);return destination.stream.getAudioTracks()[0];};
  navigator.mediaDevices.getUserMedia=async()=>new MediaStream([audio()]);
  window.__captureRequests=[];
  navigator.mediaDevices.getDisplayMedia=async options=>{
    window.__captureRequests.push(options);
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const context=canvas.getContext('2d');let n=0;
    const timer=setInterval(()=>{context.fillStyle=`hsl(${n++%360},70%,35%)`;context.fillRect(0,0,640,360);context.fillStyle='white';context.font='28px sans-serif';context.fillText('ScreenTask room '+n,30,90);},16);
    const stream=canvas.captureStream(60);stream.addTrack(audio());stream.getVideoTracks()[0].addEventListener('ended',()=>clearInterval(timer));return stream;
  };
}
async function join(page,room,name) {await page.goto(origin+'/call?room='+room+'&fps=60');await page.fill('#name',name);await page.click('#join');await page.waitForFunction(()=>!document.getElementById('share').disabled,null,{timeout:15000});}
async function remoteVideos(page,count) {await page.waitForFunction(expected=>[...document.querySelectorAll('.tile video')].filter(v=>!v.muted && v.style.visibility==='visible' && v.videoWidth>0 && v.readyState>=2).length===expected,count,{timeout:30000});}
async function main() {
  const browsers=[];const pages=[];const errors=[];
  try {
    const chrome=await chromium.launch({channel:'chrome',headless:true});browsers.push(chrome);const edge=await chromium.launch({channel:'msedge',headless:true});browsers.push(edge);
    const a=await chrome.newPage(),b=await edge.newPage(),c=await chrome.newPage();pages.push(a,b,c);
    for(const page of pages) {page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(syntheticCapture);}
    const room='roomtest'+Date.now().toString(16).padEnd(40,'0');
    await join(a,room,'Alice');await join(b,room,'Bob');await join(c,room,'Carol');
    for(const page of pages) await page.waitForFunction(()=>document.querySelectorAll('.tile').length===3);
    console.log('PASS: Chrome/Edge/Chrome join one room before any screen share');
    await Promise.all(pages.map(page=>page.click('#share')));
    await Promise.all(pages.map(page=>remoteVideos(page,2)));
    for(const page of pages) {assert.equal(await page.evaluate(()=>window.__captureRequests[0].video.frameRate.max),60);assert.deepEqual(await page.evaluate(()=>window.__peerConnections.filter(pc=>pc.connectionState!=='closed').map(pc=>pc.getTransceivers().length)),[3,3]);await page.waitForFunction(()=>[...document.querySelectorAll('.tile .stats')].filter(el=>el.textContent.includes('decoded FPS')).length===2,null,{timeout:15000});}
    console.log('PASS: all three participants share simultaneously; all six incoming video paths decode; 60 FPS capture request preserved');
    await a.click('#mic');await a.waitForFunction(()=>!document.getElementById('mute').disabled);
    await b.waitForFunction(async()=>{
      for(const pc of window.__peerConnections.filter(pc=>pc.connectionState==='connected')) {const report=await pc.getStats();if([...report.values()].filter(s=>s.type==='inbound-rtp' && s.kind==='audio' && s.bytesReceived>0).length===2) return true;}return false;
    },null,{timeout:15000});
    await a.click('#mute');assert.equal(await a.evaluate(()=>window.__peerConnections.filter(pc=>pc.connectionState==='connected').every(pc=>!pc.getTransceivers()[2].sender.track.enabled)),true);await a.click('#mute');
    console.log('PASS: received screen audio plus independent microphone audio; microphone mute/unmute');
    const remote=a.locator('.tile').filter({has:a.locator('h2',{hasText:'Bob'})});
    await remote.locator('select').selectOption('actual');const actual=await remote.locator('video').evaluate(v=>[v.clientWidth,v.clientHeight,v.videoWidth,v.videoHeight]);assert.deepEqual(actual.slice(0,2),actual.slice(2));
    await remote.locator('button').click();await a.waitForFunction(()=>!!document.fullscreenElement);await a.evaluate(()=>document.exitFullscreen());
    await b.click('#stopShare');await remoteVideos(a,1);await remoteVideos(c,1);assert.equal(await b.locator('.tile').count(),3);assert.equal(await b.locator('#leave').isEnabled(),true);
    await b.click('#share');await remoteVideos(a,2);await remoteVideos(c,2);
    console.log('PASS: Actual size/fullscreen; stop/restart preserves membership and other streams');
    const isolated=await edge.newPage();await isolated.addInitScript(syntheticCapture);await join(isolated,room+'isolation','Isolated');assert.equal(await isolated.locator('.tile').count(),1);await isolated.close();
    await c.click('#leave');await a.waitForFunction(()=>document.querySelectorAll('.tile').length===2);await c.click('#join');await c.waitForFunction(()=>document.querySelectorAll('.tile').length===3);await remoteVideos(c,2);await c.click('#share');await remoteVideos(a,2);await remoteVideos(b,2);
    console.log('PASS: room isolation and leave/rejoin with simultaneous screen sharing');
    const beforeCapture=await b.evaluate(()=>window.__captureRequests.length);await b.evaluate(()=>window.__roomSockets.at(-1).close(4001,'Simulated signaling interruption'));
    await b.waitForFunction(()=>document.querySelectorAll('.tile').length===3 && document.getElementById('status').textContent.includes('In the room'),null,{timeout:15000});
    await Promise.all(pages.map(page=>remoteVideos(page,2)));assert.equal(await b.evaluate(()=>window.__captureRequests.length),beforeCapture);
    console.log('PASS: signaling interruption automatically rejoins and preserves current screen capture');
    await a.screenshot({path:__dirname+'/artifacts/call-room.png',fullPage:true});assert.deepEqual(errors,[],'Uncaught browser errors');
  } catch(error) {
    for(const page of pages) {
      const diagnostic=await page.evaluate(()=>({
        status:document.getElementById('status')?.textContent,
        tiles:[...document.querySelectorAll('.tile')].map(el=>el.innerText),
        peers:window.__peerConnections.map(pc=>({state:pc.connectionState,ice:pc.iceConnectionState,signaling:pc.signalingState,
          slots:pc.getTransceivers().map(t=>({mid:t.mid,direction:t.direction,current:t.currentDirection,track:t.sender.track?.kind,receiver:t.receiver.track?.muted}))}))
      }));
      console.error(JSON.stringify(diagnostic,null,2));
    }
    throw error;
  } finally {for(const browser of browsers) await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
