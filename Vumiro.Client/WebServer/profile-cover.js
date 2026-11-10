/* Bounded high-resolution rendered covers. Original files never enter shared manifests. */
(() => {
  'use strict';
  const MAX_BYTES=1024*1024, MAX_WIDTH=3840, MAX_HEIGHT=1280;
  const types=new Set(['image/png','image/jpeg','image/webp']);
  const digestPattern=/^[A-Za-z0-9_-]{43}$/;
  const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const digest=async value=>base64(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):await value.arrayBuffer()));
  function validateManifest(value) {
    const keys=['version','revision','digest','mime','width','height','bytes','thumbnailDigest'];
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.version!==1||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.revision||'')||!digestPattern.test(value.digest||'')||!digestPattern.test(value.thumbnailDigest||'')||!types.has(value.mime)||
      !Number.isInteger(value.width)||value.width<1||value.width>MAX_WIDTH||!Number.isInteger(value.height)||value.height<1||value.height>MAX_HEIGHT||
      value.width!==value.height*3||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>MAX_BYTES)throw Error('This high-resolution cover is invalid.');
    return Object.freeze({...value});
  }
  function rasterSize(bytes,mime) {
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), ascii=(offset,text)=>[...text].every((c,i)=>bytes[offset+i]===c.charCodeAt(0));
    if(mime==='image/png'&&bytes.length>=24&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)&&ascii(12,'IHDR'))return {width:view.getUint32(16),height:view.getUint32(20)};
    if(mime==='image/jpeg'&&bytes[0]===255&&bytes[1]===216){
      let offset=2;
      while(offset+4<=bytes.length){
        if(bytes[offset++]!==255)return null;
        while(bytes[offset]===255)offset++;
        const marker=bytes[offset++];if(marker===217||marker===218)return null;
        if(marker===1||(marker>=208&&marker<=215))continue;
        if(offset+2>bytes.length)return null;const length=view.getUint16(offset);if(length<2||offset+length>bytes.length)return null;
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7)return {width:view.getUint16(offset+5),height:view.getUint16(offset+3)};
        offset+=length;
      }
    }
    if(mime==='image/webp'&&bytes.length>=25&&ascii(0,'RIFF')&&ascii(8,'WEBP')&&view.getUint32(4,true)+8===bytes.length){
      const u24=offset=>bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16;
      if(bytes.length>=30&&ascii(12,'VP8X')&&!(bytes[20]&2))return {width:1+u24(24),height:1+u24(27)};
      if(bytes.length>=30&&ascii(12,'VP8 ')&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42)return {width:view.getUint16(26,true)&16383,height:view.getUint16(28,true)&16383};
      if(ascii(12,'VP8L')&&bytes[20]===47)return {width:1+bytes[21]+((bytes[22]&63)<<8),height:1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10)};
    }
    return null;
  }
  async function validateBlob(manifest,blob,banner) {
    const m=validateManifest(manifest);
    if(!(blob instanceof Blob)||blob.size!==m.bytes||blob.type!==m.mime)throw Error('The cover file does not match its manifest.');
    const bytes=new Uint8Array(await blob.arrayBuffer()),size=rasterSize(bytes,m.mime);
    if(!size||size.width!==m.width||size.height!==m.height)throw Error('The cover image dimensions or format are invalid.');
    if(await digest(blob)!==m.digest||(banner!==undefined&&await digest(banner)!==m.thumbnailDigest))throw Error('The cover changed or its contents are invalid.');
    const bitmap=await createImageBitmap(blob);
    try{if(bitmap.width!==m.width||bitmap.height!==m.height)throw Error('The cover image could not be verified.');}finally{bitmap.close();}
    return m;
  }
  async function render(source,rect,size,{thumbnailer,isCurrent=()=>true}={}) {
    const check=()=>{if(!isCurrent())throw Error('Cover selection changed.');};check();
    if(!(source instanceof Blob)||!types.has(source.type)||source.size>10*1024*1024)throw Error('Choose a PNG, JPEG or WebP image under 10 MiB.');
    const header=rasterSize(new Uint8Array(await source.arrayBuffer()),source.type);if(header&&header.width*header.height>25000000)throw Error('Choose an image smaller than 25 megapixels.');check();
    const bitmap=await createImageBitmap(source);let canvas;
    try {
      check();if(bitmap.width*bitmap.height>25000000)throw Error('Choose an image smaller than 25 megapixels.');
      if(!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isFinite)||rect.x<0||rect.y<0||rect.width<=0||rect.height<=0||rect.x+rect.width>bitmap.width+.01||rect.y+rect.height>bitmap.height+.01)throw Error('The selected crop is invalid.');
      if(Math.abs(rect.width/rect.height-3)>.00001)throw Error('The cover crop must be three times as wide as it is tall.');
      if(!size||size.width!==size.height*3||![size.width,size.height].every(Number.isInteger)||size.width<1||size.height<1||size.width>MAX_WIDTH||size.height>MAX_HEIGHT||size.width>rect.width||size.height>rect.height)throw Error('The cover output size is invalid.');
      canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
      const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('This device could not prepare the cover.');
      context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(bitmap,rect.x,rect.y,rect.width,rect.height,0,0,size.width,size.height);
      let blob=null;
      const encode=async(type,quality)=>{check();const value=await new Promise(resolve=>canvas.toBlob(resolve,type,quality));check();return value?.type===type&&value.size<=MAX_BYTES?value:null;};
      blob=await encode('image/png');
      if(!blob)for(const quality of [.92,.88]){blob=await encode('image/webp',quality);if(blob)break;}
      if(!blob){
        const pixels=context.getImageData(0,0,size.width,size.height).data;let opaque=true;
        for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255){opaque=false;break;}
        if(opaque)for(const quality of [.92,.88]){blob=await encode('image/jpeg',quality);if(blob)break;}
      }
      if(!blob)throw Error('This crop exceeds the 1 MiB high-quality cover limit. Zoom in or choose a less detailed image.');
      // The old banner is only a compatibility preview; it never constrains this Blob.
      const banner=await thumbnailer(blob);check();
      const manifest={version:1,revision:crypto.randomUUID(),digest:await digest(blob),mime:blob.type,width:size.width,height:size.height,bytes:blob.size,thumbnailDigest:await digest(banner)};
      check();await validateBlob(manifest,blob,banner);check();
      return {manifest,blob,banner,source,crop:{...rect}};
    }finally{bitmap.close();if(canvas)canvas.width=canvas.height=0;}
  }
  const displayTokens=new WeakMap(),displayUrls=new WeakMap();
  async function display(image,id,banner,local,draft=null) {
    const token={};displayTokens.set(image,token);const old=displayUrls.get(image);if(old){URL.revokeObjectURL(old);displayUrls.delete(image);}
    if(!banner){image.removeAttribute('src');image.hidden=true;return;}
    image.src=local.validateBanner(banner);image.hidden=false;
    try{const record=draft || await local.getCover(id,banner);if(displayTokens.get(image)!==token||!record)return;const url=URL.createObjectURL(record.blob);displayUrls.set(image,url);image.src=url;}catch{/* Keep the compatible preview if storage is unavailable. */}
  }
  function release(image){displayTokens.delete(image);const url=displayUrls.get(image);if(url)URL.revokeObjectURL(url);displayUrls.delete(image);}
  globalThis.VumiroCoverMedia=Object.freeze({MAX_BYTES,MAX_WIDTH,MAX_HEIGHT,digest,validateManifest,validateBlob,rasterSize,render,display,release});
})();