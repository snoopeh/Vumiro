/* Versioned, bounded cover exchange. Original edit sources never enter this protocol. */
(() => {
  'use strict';
  const MAX_BYTES=1048576, CHUNK=12288, MAX_WIDTH=3840, MAX_HEIGHT=1280;
  const encoder=new TextEncoder(), hashPattern=/^[A-Za-z0-9_-]{43}$/, uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let incomingCount=0;
  const b64=bytes=>btoa(String.fromCharCode(...bytes));
  const digest=async bytes=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const now=()=>window.VumiroServerClock?.now()??Date.now();
  const signatureText=value=>`vumiro-cover-manifest-v1\n${value.from}\n${value.to}\n${value.key}\n${value.nonce}\n${value.expires}\n${JSON.stringify(value.manifest)}`;
  function validManifest(value) {
    return !!value && !Array.isArray(value) && Object.keys(value).sort().join(',')==='bytes,digest,height,mime,revision,thumbnailDigest,version,width' && value.version===1 && uuidPattern.test(value.revision) && hashPattern.test(value.digest) && hashPattern.test(value.thumbnailDigest) && ['image/png','image/jpeg','image/webp'].includes(value.mime) && Number.isSafeInteger(value.bytes) && value.bytes>0 && value.bytes<=MAX_BYTES && Number.isSafeInteger(value.width) && value.width>0 && value.width<=MAX_WIDTH && Number.isSafeInteger(value.height) && value.height>0 && value.height<=MAX_HEIGHT && value.width===value.height*3;
  }
  // Inspect dimensions before invoking an image decoder on untrusted compressed data.
  function dimensions(bytes,mime) {
    const n=bytes.length, be=i=>bytes[i]*16777216+bytes[i+1]*65536+bytes[i+2]*256+bytes[i+3], le=i=>bytes[i]+bytes[i+1]*256+bytes[i+2]*65536, text=(i,s)=>[...s].every((c,j)=>bytes[i+j]===c.charCodeAt(0));
    if(mime==='image/png' && n>=33 && [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) && be(8)===13 && text(12,'IHDR')) return [be(16),be(20)];
    if(mime==='image/jpeg' && n>=4 && bytes[0]===255 && bytes[1]===216) {
      for(let i=2;i+3<n;) {
        if(bytes[i++]!==255)return null;while(i<n&&bytes[i]===255)i++;
        const marker=bytes[i++];if(marker===217||marker===218)return null;if(marker===1||marker>=208&&marker<=215)continue;
        const length=bytes[i]*256+bytes[i+1];if(length<2||i+length>n)return null;
        if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return length>=8?[bytes[i+5]*256+bytes[i+6],bytes[i+3]*256+bytes[i+4]]:null;
        i+=length;
      }
    }
    if(mime==='image/webp' && n>=25 && text(0,'RIFF') && text(8,'WEBP') && bytes[4]+bytes[5]*256+bytes[6]*65536+bytes[7]*16777216+8===n) {
      if(n>=30&&text(12,'VP8X'))return bytes[20]&2?null:[1+le(24),1+le(27)]; // No animated covers.
      if(n>=30&&text(12,'VP8 ') && bytes[23]===157 && bytes[24]===1 && bytes[25]===42)return [(bytes[26]+bytes[27]*256)&16383,(bytes[28]+bytes[29]*256)&16383];
      if(text(12,'VP8L') && bytes[20]===47)return [1+((bytes[21]+bytes[22]*256)&16383),1+(((bytes[22]>>6)+(bytes[23]<<2)+(bytes[24]<<10))&16383)];
    }
    return null;
  }
  function create({local,own,remoteId,friend=()=>null,send,active,buffered=()=>0,onBusy=()=>{},onCover=()=>{}}) {
    let disposed=false, enabled=false, pendingRemote=false, pendingLocal=false, outgoing=null, incoming=null, remoteBanner=null, pendingManifest=null, incomingNonce='', manifestOperation=0, operation=0, timer=null, idleTimer=null, queue=Promise.resolve(), queued=0, windowStart=0, messages=0, manifests=0, sending=null;
    const live=()=>!disposed&&active();
    const busy=()=>live()&&(pendingRemote||pendingLocal||!!outgoing||!!incoming||!!sending);
    function changed(){if(!busy()){clearTimeout(timer);timer=null;}onBusy(busy());}
    function release(){if(incoming){incomingCount--;incoming.parts=[];incoming=null;}clearTimeout(idleTimer);idleTimer=null;}
    function dispose(){if(disposed)return;disposed=true;operation++;release();outgoing=null;pendingManifest=null;clearTimeout(timer);pendingRemote=pendingLocal=sending=false;onBusy(false);}
    function touch(){clearTimeout(idleTimer);idleTimer=setTimeout(dispose,8000);}
    function arm(){if(!timer)timer=setTimeout(dispose,30000);}
    async function reliable(value,token=null){const start=Date.now();while(live()&&(token===null||token===operation)&&Date.now()-start<8000){if(buffered()<=32768&&send(value))return true;await new Promise(resolve=>setTimeout(resolve,20));}return false;}
    function start(){if(live())send({type:'cover-hello',version:1});}
    async function announce(){
      if(!enabled||!live())return;
      const token=++operation;pendingLocal=true;outgoing=null;changed();arm();
      try {
        const identity=own(), manifest=await local.coverManifest();
        if(!live()||token!==operation||own()?.id!==identity?.id)return;
        if(manifest!==null&&!validManifest(manifest))throw Error('Invalid local cover');
        const value={type:'cover-manifest',from:identity.id,to:remoteId,key:identity.key,nonce:crypto.randomUUID(),expires:now()+30000,manifest};
        value.signature=await local.sign(signatureText(value));
        if(!live()||token!==operation||own()?.id!==identity.id)return;
        outgoing={nonce:value.nonce,manifest,token};pendingLocal=false;
        if(!await reliable(value,token)){if(token===operation)dispose();}else changed();
      }catch{dispose();}
    }
    async function profileReceived(banner){
      if(!live())return;remoteBanner=typeof banner==='string'?banner:'';
      if(incoming&&incoming.banner!==remoteBanner){const nonce=incoming.nonce;release();send({type:'cover-done',nonce});changed();}
      if(local.removeCachedCover)await local.removeCachedCover(remoteId,remoteBanner);
      if(!live())return;
      if(pendingManifest){const value=pendingManifest;pendingManifest=null;await acceptManifest(value);}
    }
    async function acceptManifest(value){
      const manifestToken=++manifestOperation, identity=own(), known=friend();
      if(!enabled||!live()||value.from!==remoteId||value.to!==identity?.id||!uuidPattern.test(value.nonce)||typeof value.key!=='string'||value.key.length>256||typeof value.signature!=='string'||value.signature.length>256||!Number.isSafeInteger(value.expires)||value.expires<=now()||value.expires>now()+30000||(value.manifest!==null&&!validManifest(value.manifest))||known&&known.key!==value.key)return;
      const contact=await local.validateContact({id:remoteId,key:value.key,name:'Cover sender'});
      if(!await local.verify(contact,signatureText(value),value.signature)||manifestToken!==manifestOperation||!live()||own()?.id!==identity.id||friend()?.key!==known?.key||value.expires<=now())return;
      release();incomingNonce=value.nonce;
      if(remoteBanner===null){pendingManifest=value;return;}
      const manifest=value.manifest;
      if(manifest===null){pendingRemote=false;send({type:'cover-done',nonce:value.nonce});changed();return;}
      const banner=remoteBanner, thumbnail=await digest(encoder.encode(banner));
      if(!live()||manifestToken!==manifestOperation||incomingNonce!==value.nonce||remoteBanner!==banner)return;
      if(thumbnail!==manifest.thumbnailDigest){pendingRemote=false;send({type:'cover-done',nonce:value.nonce});changed();return;}
      const record=await local.getCover?.(remoteId,banner);
      const cached=record?.manifest?.digest===manifest.digest?record.blob:await local.coverBlob(manifest.digest);
      if(!live()||incomingNonce!==value.nonce||remoteBanner!==banner)return;
      if(cached){await local.receiveCover(remoteId,manifest,cached);if(!live()||incomingNonce!==value.nonce||remoteBanner!==banner)return;onCover(manifest,cached,banner);pendingRemote=false;send({type:'cover-done',nonce:value.nonce});changed();return;}
      if(incomingCount>=2){pendingRemote=false;send({type:'cover-done',nonce:value.nonce});changed();return;}
      incomingCount++;incoming={nonce:value.nonce,manifest,banner,parts:[],bytes:0,index:0};pendingRemote=false;touch();changed();
      if(!await reliable({type:'cover-request',nonce:value.nonce}))dispose();
    }
    async function transmit(value){
      const offer=outgoing;if(!offer||offer.nonce!==value.nonce||!offer.manifest||sending===offer)return;
      sending=offer;changed();
      try {
        const blob=await local.coverBlob(offer.manifest.digest);
        if(!blob||blob.size!==offer.manifest.bytes||blob.type!==offer.manifest.mime)throw Error('Missing cover');
        for(let offset=0,index=0;offset<blob.size;offset+=CHUNK,index++){
          if(!live()||outgoing!==offer||operation!==offer.token)return;
          const bytes=new Uint8Array(await blob.slice(offset,offset+CHUNK).arrayBuffer());
          if(!live()||outgoing!==offer||operation!==offer.token)return;
          if(!await reliable({type:'cover-chunk',nonce:offer.nonce,index,data:b64(bytes)},offer.token))throw Error('Busy channel');
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(!await reliable({type:'cover-complete',nonce:offer.nonce},offer.token))throw Error('Busy channel');
      }catch{if(operation===offer.token)dispose();}finally{if(sending===offer)sending=null;changed();}
    }
    async function handle(value){
      if(!live())return;
      if(value.type==='cover-hello') {if(value.version===1&&!enabled){enabled=true;pendingRemote=true;arm();changed();await announce();}return;}
      if(!enabled)return;
      if(value.type==='cover-manifest'){pendingManifest=null;if(++manifests>10){dispose();return;}pendingRemote=true;arm();changed();await acceptManifest(value);return;}
      if(value.type==='cover-request'){void transmit(value);return;}
      if(value.type==='cover-done'){if(value.nonce===outgoing?.nonce){outgoing=null;changed();}return;}
      const transfer=incoming;if(!transfer||value.nonce!==transfer.nonce)return;
      if(value.type==='cover-chunk'){
        if(!Number.isSafeInteger(value.index)||value.index!==transfer.index||typeof value.data!=='string'||value.data.length>CHUNK*4/3||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)){dispose();return;}
        const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)),expected=Math.min(CHUNK,transfer.manifest.bytes-transfer.bytes);
        if(!bytes.length||bytes.length!==expected||b64(bytes)!==value.data){dispose();return;}
        transfer.parts.push(bytes);transfer.bytes+=bytes.length;transfer.index++;touch();return;
      }
      if(value.type!=='cover-complete')return;
      if(transfer.bytes!==transfer.manifest.bytes){dispose();return;}
      const blob=new Blob(transfer.parts,{type:transfer.manifest.mime}),bytes=new Uint8Array(await blob.arrayBuffer()),size=dimensions(bytes,transfer.manifest.mime);
      if(!size||size[0]!==transfer.manifest.width||size[1]!==transfer.manifest.height||await digest(bytes)!==transfer.manifest.digest){dispose();return;}
      if(!live()||incoming!==transfer||remoteBanner!==transfer.banner)return;
      const image=await createImageBitmap(blob);
      try{if(image.width!==size[0]||image.height!==size[1])throw Error('Invalid dimensions');}finally{image.close();}
      if(!live()||incoming!==transfer||remoteBanner!==transfer.banner)return;
      await local.receiveCover(remoteId,transfer.manifest,blob);
      if(!live()||incoming!==transfer)return;
      onCover(transfer.manifest,blob,transfer.banner);release();send({type:'cover-done',nonce:transfer.nonce});changed();
    }
    function receive(value){
      if(!value||typeof value.type!=='string'||!value.type.startsWith('cover-'))return false;
      if(!live())return true;
      if(encoder.encode(JSON.stringify(value)).length>18000){dispose();return true;}
      const time=Date.now();if(time-windowStart>10000){windowStart=time;messages=0;manifests=0;}if(++messages>240||queued>=100){dispose();return true;}
      queued++;queue=queue.then(()=>handle(value)).catch(dispose).finally(()=>{queued--;});return true;
    }
    return {start,announce,receive,profileReceived,dispose,busy};
  }
  window.VumiroCoverTransfer=Object.freeze({create,validManifest,dimensions,signatureText});
})();
