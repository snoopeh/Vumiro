// Windows developer integration check. Launch an isolated Vumiro build with
// WEBVIEW2_USER_DATA_FOLDER and --remote-debugging-port=9373, plus a local Worker
// on port 8799. Build tests/NativeAudioSmoke first; this plays its test tone.
// Provider authentication is deliberately not exercised by this check.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const output=path.resolve('dist/native-stream-validation');await mkdir(output,{recursive:true});
const native=await chromium.connectOverCDP('http://127.0.0.1:9373');
const browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--disable-features=WebRtcHideLocalIpsWithMdns']});
const errors=[];
let tone;
try{
  const nativeContext=native.contexts()[0];
  const host=nativeContext.pages()[0]||await nativeContext.waitForEvent('page',{timeout:30000});
  assert.ok(host,'Expected isolated Vumiro WebView');
  await host.waitForURL(url=>url.hostname==='screentask.local',{timeout:30000});
  await host.waitForURL(url=>url.pathname==='/auth.html',{timeout:30000});
  await host.waitForFunction(()=>!!window.VumiroLocalProfile);
  host.on('pageerror',error=>errors.push('host: '+error.message));
  // Never modify a populated profile. The caller must isolate WebView storage.
  assert.equal(await host.evaluate(async()=>{await VumiroLocalProfile.initialize();return !!VumiroLocalProfile.profile();}),false,'Native check needs an empty isolated profile');
  await host.context().addInitScript(()=>{
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const paint=canvas.getContext('2d');
      setInterval(()=>{paint.fillStyle='#382032';paint.fillRect(0,0,640,360);paint.fillStyle='white';paint.fillText('Native shared-buffer audio check',30,70);},65);
      return canvas.captureStream(15);
    };
  });
  await host.goto('https://screentask.local/auth.html?signaling=ws%3A%2F%2F127.0.0.1%3A8799%2Fcall-signaling');
  await host.locator('#authTitlebar').waitFor({state:'visible'});
  await host.locator('#authWindowmaximize').evaluate(button=>button.click());
  await host.waitForFunction(()=>document.getElementById('authWindowmaximize').getAttribute('aria-label').includes('Restore'));
  await host.locator('#authWindowmaximize').evaluate(button=>button.click());
  await host.waitForFunction(()=>document.getElementById('authWindowmaximize').getAttribute('aria-label').includes('Maximize'));
  await host.screenshot({path:path.join(output,'native-auth.png')});
  await host.locator('#continueLocal').click();await host.locator('#setupDialog').waitFor({state:'visible'});
  await host.evaluate(async()=>{await VumiroLocalProfile.initialize();await VumiroLocalProfile.createProfile('Native audio host');localStorage.setItem('st-friends-signaling','ws://127.0.0.1:8799/call-signaling');});
  await host.reload();
  await host.locator('#createRoom').click();await host.locator('#newRoomMode').selectOption('public');await host.locator('#hostNewRoom').click();
  await host.waitForFunction(()=>!!document.querySelector('#callFrameSlot iframe'));
  await host.frameLocator('#callFrameSlot iframe').locator('#share').waitFor({state:'visible'});
  const frame=host.frames().find(frame=>frame.url().includes('/call.html?'));
  assert.ok(frame);const room=new URL(frame.url()).searchParams.get('room');
  await frame.waitForFunction(()=>!document.getElementById('share').disabled);
  const guest=await browser.newPage();guest.on('pageerror',error=>errors.push('guest: '+error.message));
  await guest.addInitScript(()=>{const Original=RTCPeerConnection;window.__peers=[];window.RTCPeerConnection=class extends Original{constructor(options){super(options);window.__peers.push(this);}};});
  await guest.goto('http://127.0.0.1:8799/friends.html?view=local');
  await guest.evaluate(async()=>{await VumiroLocalProfile.initialize();await VumiroLocalProfile.createProfile('Native audio guest');});
  await guest.goto('http://127.0.0.1:8799/call.html?'+new URLSearchParams({room,signaling:'ws://127.0.0.1:8799/call-signaling',mode:'public',autojoin:'1'}));
  await guest.waitForFunction(()=>!document.getElementById('share').disabled);
  tone=spawn(path.resolve('tests/NativeAudioSmoke/bin/Release/net48/NativeAudioSmoke.exe'),['--tone'],{windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{tone.once('spawn',resolve);tone.once('error',reject);});
  await frame.locator('#share').evaluate(button=>button.click());
  await guest.waitForFunction(()=>[...document.querySelectorAll('audio')].some(audio=>audio.srcObject?.getAudioTracks().length),null,{timeout:30000});
  const measurement=await guest.evaluate(async()=>{
    const player=[...document.querySelectorAll('audio')].find(audio=>audio.srcObject?.getAudioTracks().length);
    const context=new AudioContext({sampleRate:48000});await context.resume();const source=context.createMediaStreamSource(player.srcObject),meter=context.createAnalyser();meter.fftSize=2048;source.connect(meter);
    let maximumRms=0;for(let frame=0;frame<60;frame++){await new Promise(resolve=>setTimeout(resolve,50));const values=new Float32Array(2048);meter.getFloatTimeDomainData(values);maximumRms=Math.max(maximumRms,Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length));}
    const stats=await Promise.all(window.__peers.map(pc=>pc.getStats()));const inbound=stats.flatMap(stats=>[...stats.values()].filter(value=>value.type==='inbound-rtp'&&value.kind==='audio').map(value=>({bytesReceived:value.bytesReceived,packetsReceived:value.packetsReceived,totalAudioEnergy:value.totalAudioEnergy})));
    source.disconnect();await context.close();return {maximumRms,inbound};
  });
  assert.ok(measurement.maximumRms>0.001,'Full native bridge must decode the sibling process tone');
  assert.ok(measurement.inbound.some(track=>track.bytesReceived>1000&&track.packetsReceived>20));
  await frame.locator('#copyInvite').evaluate(button=>button.click());assert.equal(new URL(await frame.locator('#inviteLink').inputValue()).searchParams.get('room'),room);await frame.locator('#inviteClose').evaluate(button=>button.click());
  await host.screenshot({path:path.join(output,'native-host.png')});await guest.screenshot({path:path.join(output,'native-receiver.png')});
  const result={pipeline:'Windows process loopback → native WebView shared buffer → production parent/iframe bridge → WebRTC → decoded remote audio',...measurement,captionControls:'maximize and restore passed on dedicated auth page',errors};
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));assert.deepEqual(errors,[]);
}finally{tone?.kill();await browser.close();await native.close();}
