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
  chrome.webview.postMessage('PASS '+JSON.stringify(results));
})().catch(error=>chrome.webview.postMessage('FAIL '+error.stack));