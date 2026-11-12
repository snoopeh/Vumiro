import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../Vumiro.Android/Web/android-host.js',import.meta.url),'utf8');
function host({native=true,capture=async()=>({getTracks:()=>[]}),media=[],frames=[]}={}){
 const requests=[],timers=new Map(),events=new Map();let serial=0;
 const bridge={postMessage:value=>requests.push(JSON.parse(value))},window={...(native?{vumiroAndroid:bridge}:{})};
 const context={window,navigator:{mediaDevices:{getUserMedia:capture}},document:{querySelectorAll:selector=>selector==='audio,video'?media:selector==='iframe'?frames:[]},location:{origin:'https://vumiro.local'},parent:{},crypto:{randomUUID:()=>String(++serial)},setTimeout:fn=>{timers.set(serial,fn);return serial;},clearTimeout:id=>timers.delete(id),addEventListener:(type,fn)=>events.set(type,fn),Event,CustomEvent,console};
 vm.runInNewContext(source,context);return {window,requests,timers,events,context,reply:value=>bridge.onmessage({data:JSON.stringify(value)})};
}
test('Android bridge correlates independent replies and preserves sanitized host errors',async()=>{
 const h=host(),get=h.window.vumiroDesktop.secureStore.get(),status=h.window.vumiroDesktop.secureStore.status();
 assert.equal(h.requests[0].method,'secureStore.get');h.reply({id:h.requests[1].id,ok:true,result:{available:true}});assert.equal((await status).available,true);
 h.reply({id:h.requests[0].id,ok:false,error:{code:'SECURE_STORAGE_READ_FAILED',message:'Protected storage failed.'}});await assert.rejects(get,error=>error.code==='SECURE_STORAGE_READ_FAILED');assert.equal(h.timers.size,0);
});
test('Android bridge rejects missing native storage and bounded request timeouts without secret fallback',async()=>{
 const absent=host({native:false});await assert.rejects(absent.window.vumiroDesktop.secureStore.set('secret'),/WebView/);assert.equal(absent.requests.length,0);
 const h=host(),get=h.window.vumiroDesktop.secureStore.get();h.timers.values().next().value();await assert.rejects(get,/time/);h.reply({id:h.requests[0].id,ok:true,result:'late-secret'});
});
test('Android foreground lifecycle stops streams and rejects capture that resolves after background',async()=>{
 let resolve,stopped=0;const stream={getTracks:()=>[{stop(){stopped++;}}]},h=host({capture:()=>new Promise(done=>resolve=done)});
 const capture=h.context.navigator.mediaDevices.getUserMedia({audio:true});h.window.VumiroAndroidHost.background();resolve(stream);
 await assert.rejects(capture,/background|foreground/i);assert.equal(stopped,1);
 await assert.rejects(h.context.navigator.mediaDevices.getUserMedia({audio:true}),/background|foreground/i);
 h.window.VumiroAndroidHost.foreground();const retry=h.context.navigator.mediaDevices.getUserMedia({audio:true});resolve(stream);await retry;h.window.VumiroAndroidHost.background();assert.equal(stopped,2);
});
test('Android host advertises unavailable native capabilities and dispatches host events',()=>{
 const h=host(),received=[];h.window.vumiroDesktop.addEventListener('message',event=>received.push(event.data));h.window.VumiroAndroidHost.receive({type:'updates',available:false});assert.equal(received.length,1);assert.equal(h.window.vumiroDesktop.platform,'android');
 for(const capability of ['oauth','screenCapture','backgroundCalls','systemAudio','gaming'])assert.equal(h.window.vumiroDesktop.capabilities[capability],false);
});
test('background capture termination informs existing owners and remote playback resumes in foreground',async()=>{
 const track=new EventTarget();let ended=0,stopped=0,plays=0;track.stop=()=>{stopped++;};track.addEventListener('ended',()=>ended++);
 const media={paused:false,pause(){this.paused=true;},async play(){this.paused=false;plays++;}},h=host({media:[media],capture:async()=>({getTracks:()=>[track]})});
 await h.context.navigator.mediaDevices.getUserMedia({audio:true});h.window.VumiroAndroidHost.background();assert.equal(stopped,1);assert.equal(ended,1,'existing call handlers must clear their stopped microphone reference');assert.equal(media.paused,true);
 h.window.VumiroAndroidHost.foreground();await Promise.resolve();assert.equal(plays,1);assert.equal(media.paused,false);
});
test('first microphone grant survives the native permission prompt pause but waits for foreground',async()=>{
 let resolve,stopped=0;const stream={getTracks:()=>[{stop(){stopped++;}}]},h=host({capture:()=>new Promise(done=>resolve=done)});
 const first=h.context.navigator.mediaDevices.getUserMedia({audio:true});h.window.VumiroAndroidHost.background(true);h.window.VumiroAndroidHost.foreground();resolve(stream);
 assert.equal(await first,stream,'resumed native permission grant completes the original user action');assert.equal(stopped,0);
 const next=h.context.navigator.mediaDevices.getUserMedia({audio:true});h.window.VumiroAndroidHost.background(true);resolve(stream);await assert.rejects(next,/background/i);
});
test('same-origin call iframe lifecycle completes before the native foreground callback may grant capture',()=>{
 const events=[],child={background(preserve){events.push(['background',preserve]);},foreground(){events.push(['foreground']);}},h=host({frames:[{contentWindow:{VumiroAndroidHost:child,postMessage(){events.push(['queued-message']);}}}]});
 h.window.VumiroAndroidHost.background(true);assert.deepEqual(events,[['background',true]],'background reaches call frame synchronously once');
 h.window.VumiroAndroidHost.foreground();assert.deepEqual(events,[['background',true],['foreground']],'call frame is foreground before native grant proceeds');
});
