// Isolated browser integration check. Start the local Worker before running.
// Set PLAYWRIGHT_MODULE to an installed playwright module when it is not local.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const origin = process.env.VUMIRO_TEST_ORIGIN || 'http://127.0.0.1:8799';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('Run media checks only against a local test Worker.');
const output = path.resolve('dist/stream-validation');
await mkdir(output, {recursive:true});
let nativeSamples = null;
if (process.env.VUMIRO_TEST_PCM) {
  const bytes = await readFile(process.env.VUMIRO_TEST_PCM);
  assert.equal(bytes.length % 15360, 0, 'Native fixture must use complete 1920-frame stereo float blocks');
  nativeSamples = [...new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))];
  assert.ok(nativeSamples.some(value => Math.abs(value) > 0.0001), 'Native fixture must contain captured audio');
}
const browser = await chromium.launch({channel:'msedge', headless:true, args:['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns']});
const errors = [];
const contexts = [];
try {
  async function participant(name) {
    const context = await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
    await context.addInitScript(() => {
      const Original = RTCPeerConnection;
      window.__vumiroTestPeers = [];
      window.RTCPeerConnection = class extends Original {constructor(options){super(options);window.__vumiroTestPeers.push(this);}};
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
        const paint=canvas.getContext('2d');let frame=0;
        setInterval(()=>{paint.fillStyle=`hsl(${frame++%360} 70% 30%)`;paint.fillRect(0,0,640,360);paint.fillStyle='white';paint.fillText('Vumiro audio integration check',40,80);},65);
        return canvas.captureStream(15);
      };
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(`${name}: ${error.message}`));
    await page.route('https://vumiro-rooms.vumiro-signaling.workers.dev/api/v1/account/config',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Accounts are temporarily unavailable. You can continue with your local profile.',serviceEnabled:false,registrationEnabled:false})}));
    await page.goto(origin+'/friends.html');
    await page.waitForURL('**/auth.html');
    await page.locator('#accountForm').waitFor({state:'visible'});
    if(name==='Audio host') {
      assert.equal(await page.locator('#accountForm').isVisible(),true);
      assert.equal(await page.locator('#accountGoogle').isDisabled(),true);
      assert.equal(await page.locator('#accountMicrosoft').isDisabled(),true);
      await page.waitForFunction(()=>document.getElementById('accountSignIn').disabled);
      await page.screenshot({path:path.join(output,'account-signin.png')});
      await page.locator('#accountSignUpTab').click();
      assert.equal(await page.locator('#accountPasswordConfirm').isVisible(),true);
      await page.screenshot({path:path.join(output,'account-signup.png')});
      await page.locator('#accountForgotPassword').click();
      assert.equal(await page.locator('#accountResetRequestForm').isVisible(),true);
      await page.screenshot({path:path.join(output,'account-recovery.png')});
    }
    await page.locator('#continueLocal').click();
    await page.waitForURL('**/friends.html?view=local');
    await page.locator('#setupDialog').waitFor({state:'visible'});
    const profile=await page.evaluate(async name=>{await VumiroLocalProfile.initialize();return VumiroLocalProfile.createProfile(name);},name);
    return {context,page,profile};
  }
  const host=await participant('Audio host'),guest=await participant('Audio guest');
  const room=host.profile.id+'_'+'a'.repeat(48);
  async function join(person,native) {
    await person.page.route('**/audio-check.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Vumiro isolated media check</title><body style="margin:0;background:#0b0b0c"><iframe id="room" style="width:100vw;height:100vh;border:0" allow="autoplay;display-capture;microphone;fullscreen"></iframe></body>'}));
    await person.page.goto(origin+'/audio-check.html');
    await person.page.evaluate(({origin,room,native,nativeSamples})=>{
      const frame=document.getElementById('room');window.__audioCheck={sequence:0,timer:null};
      addEventListener('message',event=>{
        if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
        const data=event.data;
        if(data?.type!=='vumiro-stream-audio'||!native)return;
        if(data.action==='start'){
          frame.contentWindow.postMessage({type:'vumiro-stream-audio',action:'started',id:data.id,sampleRate:48000,channels:2},location.origin);
          let offset=0;clearInterval(window.__audioCheck.timer);
          window.__audioCheck.timer=setInterval(()=>{
            const pcm=new Float32Array(1920*2);
            for(let i=0;i<pcm.length;i+=2){const sample=nativeSamples?.length?nativeSamples[(offset*2)%nativeSamples.length]:0.18*Math.sin(2*Math.PI*523.25*offset/48000);pcm[i]=sample;pcm[i+1]=nativeSamples?.length?nativeSamples[(offset*2+1)%nativeSamples.length]:sample;offset++;}
            const message={type:'vumiro-stream-audio',action:'samples',id:data.id,sequence:++window.__audioCheck.sequence,sampleRate:48000,channels:2,frames:1920,pcm:pcm.buffer};
            frame.contentWindow.postMessage(message,location.origin,[message.pcm]);
          },40);
        }else if(data.action==='stop'){clearInterval(window.__audioCheck.timer);window.__audioCheck.timer=null;}
      });
      frame.onload=()=>{
        frame.contentWindow.postMessage({type:'vumiro-stream-audio',action:'state',supported:native},location.origin);
        if(native)frame.contentWindow.postMessage({type:'vumiro-room-access',room,mode:'public',name:'Audio validation'},location.origin);
      };
      const url=new URL('/call.html',origin);url.search=new URLSearchParams({room,signaling:origin.replace('http:','ws:')+'/call-signaling',mode:'public',autojoin:'1',embedded:'1'});frame.src=url;
    },{origin,room,native,nativeSamples});
    const locator=person.page.frameLocator('#room');
    await locator.locator('#share').waitFor({state:'visible'});
    await locator.locator('#share').waitFor({state:'attached'});
    await person.page.waitForFunction(()=>!document.querySelector('iframe').contentDocument?.getElementById('share')?.disabled);
    person.frame=person.page.frames().find(frame=>frame.url().includes('/call.html?'));
    return locator;
  }
  const hostUi=await join(host,true);
  const guestUi=await join(guest,false);
  await hostUi.locator('#share').click();
  await guest.page.waitForFunction(()=>{
    const doc=document.querySelector('iframe').contentDocument;
    return [...doc.querySelectorAll('audio')].some(audio=>audio.srcObject?.getAudioTracks().some(track=>track.readyState==='live'));
  },null,{timeout:30000});
  const measurement=await guest.frame.evaluate(async()=>{
    const audio=[...document.querySelectorAll('audio')].find(item=>item.srcObject?.getAudioTracks().length);
    const context=new AudioContext({sampleRate:48000});await context.resume();
    const source=context.createMediaStreamSource(audio.srcObject),meter=context.createAnalyser();meter.fftSize=2048;source.connect(meter);
    let maximumRms=0;
    for(let frame=0;frame<60;frame++){await new Promise(resolve=>setTimeout(resolve,50));const values=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(values);const rms=Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);maximumRms=Math.max(maximumRms,rms);}
    const stats=await Promise.all(window.__vumiroTestPeers.map(pc=>pc.getStats()));
    const inbound=stats.flatMap(stats=>[...stats.values()].filter(value=>value.type==='inbound-rtp'&&value.kind==='audio').map(value=>({bytesReceived:value.bytesReceived,packetsReceived:value.packetsReceived,totalAudioEnergy:value.totalAudioEnergy,totalSamplesReceived:value.totalSamplesReceived})));
    source.disconnect();await context.close();return {maximumRms,inbound};
  });
  assert.ok(measurement.maximumRms>0.001,`Remote stream must decode audible signal, measured RMS=${measurement.maximumRms}`);
  assert.ok(measurement.inbound.some(track=>track.bytesReceived>1000&&track.packetsReceived>20),'Remote RTP must receive actual audio packets');
  const screenVolume=guestUi.getByRole('slider',{name:'Screen volume for Audio host'});
  await screenVolume.waitFor({state:'visible'});
  await screenVolume.fill('25');
  let screenState=await guest.frame.evaluate(()=>{const player=[...document.querySelectorAll('audio')].find(audio=>audio.srcObject?.getAudioTracks().length);return {volume:player.volume,muted:player.muted};});
  assert.equal(screenState.volume,0.25);assert.equal(screenState.muted,false);
  await screenVolume.fill('0');
  screenState=await guest.frame.evaluate(()=>{const player=[...document.querySelectorAll('audio')].find(audio=>audio.srcObject?.getAudioTracks().length);return {volume:player.volume,muted:player.muted};});
  assert.equal(screenState.volume,0);assert.equal(screenState.muted,true);
  await screenVolume.fill('70');
  assert.equal(await guest.frame.evaluate(()=>[...document.querySelectorAll('audio')].find(audio=>audio.srcObject?.getAudioTracks().length).muted),false);
  await hostUi.locator('#copyInvite').click();
  await hostUi.locator('#inviteDialog').waitFor({state:'visible'});
  const invitation=await hostUi.locator('#inviteLink').inputValue();
  assert.equal(new URL(invitation).searchParams.get('room'),room);
  await hostUi.locator('#inviteClose').click();
  await host.page.screenshot({path:path.join(output,'host-room.png')});
  await guest.page.screenshot({path:path.join(output,'guest-room.png')});
  const result={source:nativeSamples?'actual native loopback PCM':'generated calibration PCM',...measurement,invitation,volumeChecks:'25 percent, mute at zero, unmute at 70 percent',accountScreens:'dedicated first-run sign in, Google/Microsoft truthful availability, create account, recovery, continue to local setup',errors};
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2));
  assert.deepEqual(errors,[],'Browser pages must have no uncaught errors');
  console.log(JSON.stringify(result,null,2));
} finally {
  for(const context of contexts)await context.close();
  await browser.close();
}
