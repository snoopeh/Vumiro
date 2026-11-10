import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../Vumiro.Client/WebServer/friends-client.js', import.meta.url), 'utf8');
const encoder = source.slice(source.indexOf('async function resizeBanner('), source.indexOf("$('bannerFile').onchange"));
assert.ok(encoder.startsWith('async function resizeBanner('));
const input = {type:'image/png',size:1000};
function harness({width=3840,height=1280,encode=()=>({size:1000}),decodeError,contextMissing=false}={}) {
  const calls=[], draws=[]; let closed=0, decodes=0, validates=0;
  const context={drawImage(...args){draws.push(args.slice(1));}};
  const canvas={width:0,height:0,getContext(){return contextMissing?null:context;},toBlob(callback,type,quality){
    const call={width:this.width,height:this.height,type,quality}; calls.push(call);
    const result=encode(call,calls.length);
    if (result === null) { queueMicrotask(()=>callback(null)); return; }
    const value={type:result.type||type,size:result.size,arrayBuffer:async()=>new Uint8Array(result.size).buffer};
    queueMicrotask(()=>callback(value));
  }};
  const sandbox={Uint8Array,Set,Math,Promise,btoa:value=>Buffer.from(value,'binary').toString('base64'),
    document:{createElement:()=>canvas},async createImageBitmap(){decodes++;if(decodeError)throw decodeError;return {width,height,close(){closed++;}};},
    local:{validateBanner(value){validates++;assert.ok(value.length<=16384);assert.match(value,/^data:image\/(png|jpeg|webp);base64,/);return value;}}
  };
  vm.createContext(sandbox);vm.runInContext(encoder,sandbox);
  return {resize:sandbox.resizeBanner,calls,draws,canvas,context,counts:()=>({closed,decodes,validates})};
}

test('flat artwork retains 1920x640 lossless pixels within the existing wire budget',async()=>{
  const h=harness(),value=await h.resize(input);
  assert.match(value,/^data:image\/png/);assert.deepEqual(h.calls,[{width:1920,height:640,type:'image/png',quality:undefined}]);
  assert.deepEqual(h.draws[0],[0,0,3840,1280,0,0,1920,640]);
  assert.equal(h.context.imageSmoothingQuality,'high');assert.equal(h.counts().closed,1);assert.equal(h.canvas.width,0);
});

test('photographs use WebP without unnecessarily shrinking first',async()=>{
  const h=harness({encode:({type})=>({size:type==='image/png'?100000:10000})});
  assert.match(await h.resize(input),/^data:image\/webp/);assert.equal(h.calls.length,2);assert.equal(h.calls[1].width,1920);assert.equal(h.calls[1].quality,.9);
});

test('unavailable WebP encoders fall back to JPEG and are not retried',async()=>{
  const h=harness({encode:({type,width})=>type==='image/webp'?{type:'image/png',size:20000}:{size:type==='image/jpeg'&&width<=1280?10000:20000}});
  assert.match(await h.resize(input),/^data:image\/jpeg/);assert.equal(h.calls.filter(c=>c.type==='image/webp').length,1);assert.equal(h.calls.at(-1).width,1280);
});

test('reduce resolution before destructive low quality and still bound detailed photos',async()=>{
  const h=harness({encode:({width,type,quality})=>({size:width<=480&&type==='image/webp'&&quality<=.7?10000:50000})});
  await h.resize(input);assert.equal(h.calls.at(-1).width,480);assert.equal(h.calls.at(-1).quality,.7);
  assert.ok(h.calls.every(c=>c.quality===undefined||c.quality>=.6));
});

test('the base64 prefix and padding count toward the exact 16384-character budget',async()=>{
  const h=harness({encode:({type})=>({size:type==='image/png'?12271:12270})});
  const value=await h.resize(input);assert.equal(h.calls[0].type,'image/png');assert.equal(h.calls[1].type,'image/webp');assert.equal(value.length,16383);
});

test('small, portrait and thin sources are center-cropped without upscaling',async()=>{
  for(const [width,height,expectedWidth,expectedHeight] of [[300,100,300,100],[1000,2000,1000,333],[4000,100,300,100],[1,1,1,1]]){
    const h=harness({width,height});await h.resize(input);
    assert.equal(h.calls[0].width,expectedWidth);assert.equal(h.calls[0].height,expectedHeight);
    const [x,y,sw,sh,,,dw,dh]=h.draws[0];assert.ok(dw<=sw&&dh<=sh);assert.equal(x,(width-sw)/2);assert.equal(y,(height-sh)/2);
  }
});

test('invalid formats and oversized files never decode',async()=>{
  const h=harness();for(const file of [{type:'image/svg+xml',size:1},{type:'image/png',size:10*1024*1024+1}])await assert.rejects(h.resize(file),/Choose a PNG/);
  assert.equal(h.counts().decodes,0);
});

test('input byte/pixel limits accept the boundary and reject excess or empty dimensions',async()=>{
  const good=harness({width:5000,height:5000});await good.resize({...input,size:10*1024*1024});
  for(const dimensions of [{width:5001,height:5000},{width:0,height:10}]){const h=harness(dimensions);await assert.rejects(h.resize(input),/25 megapixels/);assert.equal(h.counts().closed,1);assert.equal(h.calls.length,0);}
});

test('decode, missing canvas, and unencodable content fail clearly with cleanup',async()=>{
  const bad=harness({decodeError:Error('Corrupt input')});await assert.rejects(bad.resize(input),/Corrupt input/);assert.equal(bad.counts().closed,0);
  const missing=harness({contextMissing:true});await assert.rejects(missing.resize(input),/could not prepare/);assert.equal(missing.counts().closed,1);
  const detailed=harness({encode:()=>({size:50000})});await assert.rejects(detailed.resize(input),/too detailed/);assert.equal(detailed.counts().closed,1);assert.equal(detailed.canvas.width,0);
  const noEncoder=harness({encode:()=>null});await assert.rejects(noEncoder.resize(input),/too detailed/);assert.equal(noEncoder.counts().closed,1);assert.ok(noEncoder.calls.length<=81);
});

test('new selection, removal, or dismissal cancels in-flight encoding and releases memory',async()=>{
  let current=true;const h=harness({encode:()=>{current=false;return {size:1000};}});
  await assert.rejects(h.resize(input,()=>current),/selection changed/);assert.equal(h.counts().validates,0);assert.equal(h.counts().closed,1);assert.equal(h.calls.length,1);
  const stale=harness();await assert.rejects(stale.resize(input,()=>false),/selection changed/);assert.equal(stale.counts().decodes,0);
  assert.match(source,/thumbnailer:blob=>resizeBanner\(blob,isCurrent\),isCurrent/);
});
test('a transient encoding failure at large size does not disable smaller attempts',async()=>{
  const h=harness({encode:({width,type})=>width>960?null:{size:type==='image/png'?1000:20000}});
  assert.match(await h.resize(input),/^data:image\/png/);assert.equal(h.calls.at(-1).width,960);assert.equal(h.counts().closed,1);
});