(async () => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const local = {validateBanner(value) { assert(value.length <= 16384, 'Wire budget exceeded'); return value; }};
  // resizeBanner resolves this global just as it does in friends-client.js.
  window.local = local;
  const blobOf = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  async function details(value) {
    const blob = await (await fetch(value)).blob(), bitmap = await createImageBitmap(blob);
    const result = {width:bitmap.width,height:bitmap.height,bytes:blob.size,characters:value.length,type:blob.type};
    bitmap.close(); return result;
  }
  async function legacy(file) {
    const bitmap=await createImageBitmap(file);
    try {
      for(const width of [480,360,240]) {
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=width/3;
        const context=canvas.getContext('2d'),scale=Math.max(width/bitmap.width,canvas.height/bitmap.height),sw=width/scale,sh=canvas.height/scale;
        context.drawImage(bitmap,(bitmap.width-sw)/2,(bitmap.height-sh)/2,sw,sh,0,0,width,canvas.height);
        for(const quality of [.8,.65,.5,.35,.2]) { const value=canvas.toDataURL('image/jpeg',quality);if(value.length<=16384)return value; }
      }
      throw Error('Legacy encoder failed');
    } finally { bitmap.close(); }
  }
  const results=[];
  for(const kind of ['artwork','transparent','photo-like','noise','small']) {
    const canvas=document.createElement('canvas');canvas.width=kind==='small'?300:1920;canvas.height=kind==='small'?100:640;
    const context=canvas.getContext('2d');
    if(kind==='artwork'||kind==='transparent'||kind==='small') {
      if(kind!=='transparent'){context.fillStyle='#153b75';context.fillRect(0,0,canvas.width,canvas.height);}
      context.fillStyle='white';
      for(const cx of [canvas.width*.3,canvas.width*.7]) {
        const cy=canvas.height/2,r=canvas.height*.3;context.beginPath();
        for(let i=0;i<10;i++){const angle=i*Math.PI/5-Math.PI/2,rad=i%2?r*.4:r;context.lineTo(cx+Math.cos(angle)*rad,cy+Math.sin(angle)*rad);}
        context.closePath();context.fill();
      }
    } else {
      let seed=9;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      if(kind==='noise') {
        const pixels=context.createImageData(canvas.width,canvas.height);
        for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=random()*256;pixels.data[i+1]=random()*256;pixels.data[i+2]=random()*256;pixels.data[i+3]=255;}
        context.putImageData(pixels,0,0);
      } else {
        const sky=context.createLinearGradient(0,0,0,640);sky.addColorStop(0,'#23528c');sky.addColorStop(1,'#e6c9a2');context.fillStyle=sky;context.fillRect(0,0,1920,640);
        for(let layer=0;layer<4;layer++){context.fillStyle=['#718c81','#476c57','#244f39','#143c26'][layer];context.beginPath();context.moveTo(0,640);for(let x=0;x<=1920;x+=8)context.lineTo(x,180+layer*90+Math.sin(x/110+layer)*60+random()*45);context.lineTo(1920,640);context.fill();}
        for(let i=0;i<14000;i++){context.fillStyle=`rgba(${Math.floor(random()*255)},${Math.floor(random()*255)},${Math.floor(random()*255)},.14)`;context.fillRect(random()*1920,random()*640,2+random()*4,2+random()*4);}
      }
    }
    const file=await blobOf(canvas),start=performance.now(),value=await resizeBanner(file),current=await details(value),before=await details(await legacy(file));
    assert(current.characters<=16384,'Oversize '+kind);
    if(kind==='artwork')assert(current.width>480,'Flat art should retain higher resolution than the legacy 480px cap');
    if(kind==='small')assert(current.width===300,'Small image was upscaled');
    if(kind==='transparent') {
      const bitmap=await createImageBitmap(await (await fetch(value)).blob()),probe=document.createElement('canvas');probe.width=probe.height=1;
      const ctx=probe.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();assert(ctx.getImageData(0,0,1,1).data[3]===0,'Transparent corner became opaque');
    }
    if(kind==='artwork') {
      const comparison=document.createElement('canvas');comparison.width=960;comparison.height=744;
      const ctx=comparison.getContext('2d');ctx.fillStyle='#111';ctx.fillRect(0,0,960,744);ctx.font='18px Segoe UI';ctx.fillStyle='white';
      const beforeBitmap=await createImageBitmap(await (await fetch(await legacy(file))).blob()),afterBitmap=await createImageBitmap(await (await fetch(value)).blob());
      for(const [index,label,bitmap] of [[0,'Previous encoder: 480 × 160 JPEG',beforeBitmap],[1,`Current encoder: ${current.width} × ${current.height} ${current.type}`,afterBitmap]]) {
        const y=index*372;ctx.fillStyle='white';ctx.fillText(label,12,y+28);ctx.drawImage(bitmap,0,y+44,960,320);bitmap.close();
      }
      chrome.webview.postMessage('IMAGE '+comparison.toDataURL('image/png').split(',')[1]);
    }
    results.push({kind,current,legacy:before,milliseconds:Math.round(performance.now()-start)});
  }
  const sourceCanvas=document.createElement('canvas');sourceCanvas.width=3840;sourceCanvas.height=1280;
  const sourceContext=sourceCanvas.getContext('2d'),gradient=sourceContext.createLinearGradient(0,0,3840,1280);gradient.addColorStop(0,'#1f528c');gradient.addColorStop(1,'#e8b075');sourceContext.fillStyle=gradient;sourceContext.fillRect(0,0,3840,1280);
  sourceContext.fillStyle='white';sourceContext.font='100px Segoe UI';sourceContext.fillText('High-resolution cover • readable detail',180,350);
  for(let x=0;x<3840;x+=11){sourceContext.fillStyle=`hsl(${x%360} 55% 35%)`;sourceContext.fillRect(x,800,3,400);}
  const original=await blobOf(sourceCanvas),tools=window.VumiroCoverMedia;
  const full=await tools.render(original,{x:0,y:0,width:3840,height:1280},{width:3840,height:1280},{thumbnailer:resizeBanner});
  assert(full.manifest.width===3840&&full.manifest.height===1280,'High resolution was reduced');assert(full.blob.size>16384,'Test fixture must exercise separate media budget');
  const api=window.VumiroLocalProfile;await api.initialize();await api.createProfile('Cover QA');await api.updateProfile({banner:full.banner,coverMedia:full});
  const own=api.profile(),record=await api.getCover(own.id,own.banner),backup=await api.accountSnapshot();
  assert(record.source.size===original.size,'Original was not retained locally');assert(record.blob.size===full.blob.size,'Finished cover was not saved');assert(backup.profile.cover.digest===full.manifest.digest,'Backup manifest missing');assert(!JSON.stringify(backup).includes('source')&&!JSON.stringify(backup).includes('crop'),'Backup exposes original or framing metadata');
  await api.updateName('Renamed');assert((await api.coverManifest()).digest===full.manifest.digest,'Disjoint name edit erased cover');
  await api.applyAccountSnapshot(backup,{manifest:full.manifest,blob:full.blob,banner:full.banner,source:null,crop:null});assert((await api.getCover(own.id,full.banner)).source.size===original.size,'Same-image restore erased this device original');
  const earlyCancel=window.VumiroCoverEditor.open({source:original});window.VumiroCoverEditor.cancel();assert(await earlyCancel===null,'Cancel during decoding reopened the editor');
  // A cover-only write must not pair old pixels with a concurrently changed preview.
  const media=window.VumiroCoverMedia;let releaseValidation,validationStarted;
  const started=new Promise(resolve=>validationStarted=resolve),gate=new Promise(resolve=>releaseValidation=resolve);
  window.VumiroCoverMedia={...media,async validateBlob(...args){const value=await media.validateBlob(...args);validationStarted();await gate;return value;}};
  const staleSave=api.updateProfile({coverMedia:full}).then(()=>false,()=>true);
  await started;await api.updateProfile({banner:'data:image/png;base64,AA=='});releaseValidation();
  assert(await staleSave,'Stale cover-only write committed against a new banner');window.VumiroCoverMedia=media;
  await api.updateProfile({banner:full.banner,coverMedia:full});
  // Exercise the real browser dialog, keyboard controls, Use and Cancel without touching saved state.
  const pending=window.VumiroCoverEditor.open({source:original});
  for(let i=0;i<100&&!document.querySelector('.coverCropViewport');i++)await new Promise(resolve=>setTimeout(resolve,10));
  const viewport=document.querySelector('.coverCropViewport');assert(viewport,'Crop dialog did not open');
  viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'+',bubbles:true}));viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  document.querySelector('[data-use]').click();const framing=await pending;assert(framing.rect.width<3840,'Zoom did not change source crop');assert(framing.size.width===framing.size.height*3,'Crop output lost aspect');
  const cancelEdit=window.VumiroCoverEditor.open({source:original,crop:framing.rect});for(let i=0;i<100&&!document.querySelector('.coverCropViewport');i++)await new Promise(resolve=>setTimeout(resolve,10));window.VumiroCoverEditor.cancel();assert(await cancelEdit===null,'Cancel must discard draft');assert((await api.coverManifest()).digest===full.manifest.digest,'Cancel mutated saved cover');
  await api.updateProfile({banner:'',coverMedia:null});assert(await api.coverManifest()===null,'Removal retained active cover');
  results.push({kind:'full-resolution-render-storage-editor',current:full.manifest,originalBytes:original.size,backupBytes:JSON.stringify(backup).length,passed:['render3840','originalLocalOnly','atomicSave','staleCoverWriteRejected','renamePreserves','restorePreservesLocalOriginal','keyboardZoom','cancelDuringDecode','cancel','remove']});
  chrome.webview.postMessage('PASS '+JSON.stringify(results));
})().catch(error=>chrome.webview.postMessage('FAIL '+error.stack));