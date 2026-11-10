import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto as crypto} from 'node:crypto';
const source=fs.readFileSync(new URL('../Vumiro.Client/WebServer/cover-transfer.js',import.meta.url),'utf8');
const bytes64=bytes=>Buffer.from(bytes).toString('base64url');
const hash=async bytes=>bytes64(await crypto.subtle.digest('SHA-256',bytes));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<600;i++){if(check())return;await pause(5);}throw Error('Condition did not settle');}
function raster(size=40000,width=1920,height=640){const bytes=new Uint8Array(size);bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);const view=new DataView(bytes.buffer);view.setUint32(16,width);view.setUint32(20,height);return new Blob([bytes],{type:'image/png'});}
async function fixture({mutate=()=>{},blocked=()=>false,deadline=false}={}){
  const timers=new Set(),messages=[],stored=[],displayed=[];let decoded=0,closed=0;
  const setTimer=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},deadline&&ms>=8000?40:ms);timers.add(id);return id;};
  const sandbox={window:{},TextEncoder,Uint8Array,Blob,Set,Math,Date,Promise,crypto,atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout:setTimer,clearTimeout:id=>{timers.delete(id);clearTimeout(id);},createImageBitmap:async blob=>{decoded++;const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer);return {width:view.getUint32(16),height:view.getUint32(20),close(){closed++;}};}};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);const api=sandbox.window.VumiroCoverTransfer;
  const participants=[];
  for(let index=0;index<2;index++){
    const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']),key=bytes64(await crypto.subtle.exportKey('spki',pair.publicKey)),id=await hash(Buffer.from(key,'base64url'));
    const banner='data:image/png;base64,'+Buffer.from('thumbnail'+index).toString('base64'),blob=raster(),manifest={version:1,revision:crypto.randomUUID(),digest:await hash(await blob.arrayBuffer()),mime:blob.type,width:1920,height:640,bytes:blob.size,thumbnailDigest:await hash(new TextEncoder().encode(banner))};
    participants.push({id,key,pair,banner,blob,manifest,alive:true});
  }
  for(let index=0;index<2;index++){
    const own=participants[index],remote=participants[1-index];
    const local={coverManifest:async()=>own.manifest,coverBlob:async digest=>digest===own.manifest?.digest?own.blob:null,
      receiveCover:async(id,manifest,blob)=>{stored.push({index,id,manifest,blob});},removeCachedCover:async()=>{},
      sign:async text=>bytes64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},own.pair.privateKey,new TextEncoder().encode(text))),
      validateContact:async contact=>{if(contact.id!==await hash(Buffer.from(contact.key,'base64url')))throw Error('Wrong identity');return contact;},
      verify:async(contact,text,signature)=>{const key=await crypto.subtle.importKey('spki',Buffer.from(contact.key,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,Buffer.from(signature,'base64url'),new TextEncoder().encode(text));}};
    own.local=local;own.session=api.create({local,own:()=>own,remoteId:remote.id,friend:()=>remote,active:()=>own.alive,buffered:()=>blocked(index)?65536:0,onCover:(manifest,blob)=>displayed.push({index,manifest,blob}),send:value=>{const wire=JSON.parse(JSON.stringify(value));mutate(wire,index,participants);messages.push({index,value:wire});setImmediate(()=>remote.session.receive(wire));return true;}});
  }
  return {api,participants,messages,stored,displayed,counts:()=>({decoded,closed}),async start({profiles=true}={}){if(profiles)for(let i=0;i<2;i++)await participants[i].session.profileReceived(participants[1-i].banner);for(const p of participants)p.session.start();},close(){for(const p of participants){p.alive=false;p.session.dispose();}for(const id of timers)clearTimeout(id);}};
}

test('signed cover negotiation preserves full rendered blob and validates before display',async()=>{
  const f=await fixture();try{
    // Distinguish own and remote content so the receiver cannot use its own cache.
    const p=f.participants[1];p.blob=raster(50000);p.manifest={...p.manifest,bytes:p.blob.size,digest:await hash(await p.blob.arrayBuffer())};
    await f.start();await until(()=>f.stored.length===2&&!f.participants.some(p=>p.session.busy()));
    assert.equal(f.displayed.length,2);assert.deepEqual(f.counts(),{decoded:2,closed:2});
    assert.ok(f.messages.some(m=>m.value.type==='cover-chunk'));assert.ok(f.messages.every(m=>Buffer.byteLength(JSON.stringify(m.value))<65536));
    for(const item of f.stored)assert.equal(await hash(await item.blob.arrayBuffer()),item.manifest.digest);
  }finally{f.close();}
});

test('manifest schema rejects oversized, unbounded and unknown fields',async()=>{
  const f=await fixture();try{const m=f.participants[0].manifest;assert.equal(f.api.validManifest(m),true);
    for(const patch of [{bytes:1048577},{width:3841},{height:1281},{mime:'image/svg+xml'},{revision:'stale'},{digest:'bad'},{extra:1},{bytes:1.2}])assert.equal(f.api.validManifest({...m,...patch}),false);
  }finally{f.close();}
});

test('cached rendered content is attached without retransmitting chunks',async()=>{
  const f=await fixture();try{await f.start();await until(()=>f.stored.length===2&&!f.participants.some(p=>p.session.busy()));assert.equal(f.messages.filter(m=>m.value.type==='cover-chunk').length,0);assert.equal(f.counts().decoded,0);}finally{f.close();}
});

test('legacy peer receives only an ignored capability hello, no cover payload without opt in',async()=>{
  const f=await fixture();try{f.participants[1].session.dispose();f.participants[0].session.start();await pause(30);assert.deepEqual(f.messages.map(m=>m.value.type),['cover-hello']);assert.equal(f.participants[0].session.busy(),false);}finally{f.close();}
});

test('manifest waits for legacy thumbnail and rejects mismatch',async()=>{
  const f=await fixture();try{await f.start({profiles:false});await until(()=>f.messages.filter(m=>m.value.type==='cover-manifest').length===2);await pause(20);assert.equal(f.stored.length,0);
    await f.participants[0].session.profileReceived('different');await f.participants[1].session.profileReceived('different');await until(()=>!f.participants.some(p=>p.session.busy()));assert.equal(f.stored.length,0);
  }finally{f.close();}
});

test('signed envelope rejects wrong recipient, sender key and modified manifest',async()=>{
  for(const change of [m=>m.to='x'.repeat(43),m=>m.key='bad',m=>m.manifest.width=100]){
    const f=await fixture({mutate:(m,index)=>{if(index===0&&m.type==='cover-manifest')change(m);}});try{await f.start();await pause(100);assert.equal(f.stored.filter(s=>s.index===1).length,0);}finally{f.close();}
  }
});

test('wrong chunk index or bytes fails closed without persistence',async()=>{
  for(const change of [m=>m.index++,m=>m.data='AAAA',m=>m.data='!']){
    const f=await fixture({mutate:(m,index)=>{if(index===0&&m.type==='cover-chunk')change(m);}});try{const p=f.participants[0];p.blob=raster(50000);p.manifest={...p.manifest,bytes:50000,digest:await hash(await p.blob.arrayBuffer())};await f.start();await pause(140);assert.equal(f.stored.filter(s=>s.index===1).length,0);}finally{f.close();}
  }
});

test('digest mismatch and declared image dimensions are checked before decoding',async()=>{
  for(const badDimensions of [false,true]){
    const f=await fixture({mutate:(m,index)=>{if(!badDimensions&&index===0&&m.type==='cover-chunk'&&m.index===1){const b=Buffer.from(m.data,'base64');b[0]^=1;m.data=b.toString('base64');}}});try{
      const p=f.participants[0];p.blob=raster(50000);p.manifest={...p.manifest,bytes:50000,digest:await hash(await p.blob.arrayBuffer()),...(badDimensions?{width:100}: {})};await f.start();await pause(160);assert.equal(f.stored.filter(s=>s.index===1).length,0);assert.ok(f.counts().decoded<=1);
    }finally{f.close();}
  }
});

test('disconnect cancels pending verification and display',async()=>{
  const f=await fixture();try{await f.start();f.participants[1].alive=false;f.participants[1].session.dispose();await pause(60);assert.equal(f.stored.filter(s=>s.index===1).length,0);}finally{f.close();}
});

test('bounded deadline releases busy sessions even with backpressure',async()=>{
  const f=await fixture({blocked:()=>true,deadline:true});try{await f.start();await pause(110);assert.equal(f.participants.some(p=>p.session.busy()),false);assert.equal(f.stored.length,0);}finally{f.close();}
});

test('replacement may announce again after a completed exchange',async()=>{
  const f=await fixture();try{await f.start();await until(()=>f.stored.length===2&&!f.participants.some(p=>p.session.busy()));const p=f.participants[0];p.manifest={...p.manifest,revision:crypto.randomUUID()};await p.session.announce();await until(()=>f.stored.length===3&&!f.participants.some(p=>p.session.busy()));}finally{f.close();}
});

test('friends and room integrations retain legacy profile contract and clear cover resources',()=>{
  const peer=fs.readFileSync(new URL('../Vumiro.Client/WebServer/peer-profile.js',import.meta.url),'utf8'),room=fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js',import.meta.url),'utf8');
  assert.match(peer,/!peer\.cover\?\.busy\(\)/);assert.match(peer,/peer\.cover\?\.dispose\(\)/);assert.match(peer,/cover\?\.profileReceived\(banner\)/);
  assert.match(room,/URL\.revokeObjectURL\(peer\.coverImage\.url\)/);assert.match(room,/coverQueue=peer\.coverQueue\.then\(\(\)=>receiveProfile/);assert.match(room,/cover\?\.profileReceived\(profile\.banner\)/);
});


test('maximum rendered cover fits in bounded 12 KiB chunks without widening frames',async()=>{
  const f=await fixture();try{const p=f.participants[0];p.blob=raster(1048576,3840,1280);p.manifest={...p.manifest,bytes:1048576,width:3840,height:1280,digest:await hash(await p.blob.arrayBuffer())};await f.start();await until(()=>f.stored.some(s=>s.index===1)&&!f.participants.some(p=>p.session.busy()));const chunks=f.messages.filter(m=>m.index===0&&m.value.type==='cover-chunk');assert.equal(chunks.length,86);assert.ok(chunks.every(m=>Buffer.from(m.value.data,'base64').length<=12288));assert.equal(f.stored.find(s=>s.index===1).blob.size,1048576);}finally{f.close();}
});

test('null rendered cover finishes negotiation without sending source or image chunks',async()=>{
  const f=await fixture();try{for(const p of f.participants)p.manifest=null;await f.start();await until(()=>f.messages.filter(m=>m.value.type==='cover-done').length===2&&!f.participants.some(p=>p.session.busy()));assert.equal(f.stored.length,0);assert.equal(f.messages.some(m=>m.value.type==='cover-chunk'),false);}finally{f.close();}
});

test('signed expired and excessively future-dated manifests are rejected',async()=>{
  const f=await fixture();try{await f.start();await until(()=>f.stored.length===2&&!f.participants.some(p=>p.session.busy()));const from=f.participants[0],to=f.participants[1];for(const expires of [Date.now()-1,Date.now()+60000]){const value={type:'cover-manifest',from:from.id,to:to.id,key:from.key,nonce:crypto.randomUUID(),expires,manifest:from.manifest};value.signature=await from.local.sign(f.api.signatureText(value));to.session.receive(value);}await pause(70);assert.equal(f.stored.length,2);}finally{f.close();}
});

test('legacy cover removal during transfer prevents stale cover display',async()=>{
  let removed=false;const f=await fixture({mutate:(m,index,people)=>{if(index===0&&m.type==='cover-chunk'&&!removed){removed=true;void people[1].session.profileReceived('');}}});try{const p=f.participants[0];p.blob=raster(1048576);p.manifest={...p.manifest,bytes:1048576,digest:await hash(await p.blob.arrayBuffer())};await f.start();await until(()=>removed);await pause(100);assert.equal(f.stored.filter(s=>s.index===1).length,0);assert.equal(f.displayed.filter(s=>s.index===1).length,0);}finally{f.close();}
});

test('at most two incoming allocations exist, and disposal releases their slots',async()=>{
  const f=await fixture(),sessions=[],sent=[];try{const from=f.participants[0],to=f.participants[1];from.blob=raster(50000);from.manifest={...from.manifest,bytes:50000,digest:await hash(await from.blob.arrayBuffer())};
    for(let i=0;i<3;i++){const session=f.api.create({local:to.local,own:()=>to,remoteId:from.id,friend:()=>from,active:()=>true,send:value=>{sent.push({i,value});return true;}});sessions.push(session);await session.profileReceived(from.banner);session.receive({type:'cover-hello',version:1});const value={type:'cover-manifest',from:from.id,to:to.id,key:from.key,nonce:crypto.randomUUID(),expires:Date.now()+30000,manifest:from.manifest};value.signature=await from.local.sign(f.api.signatureText(value));session.receive(value);}
    await until(()=>sent.filter(m=>m.value.type==='cover-request').length===2&&sent.some(m=>m.i===2&&m.value.type==='cover-done'));
    sessions[0].dispose();const value={type:'cover-manifest',from:from.id,to:to.id,key:from.key,nonce:crypto.randomUUID(),expires:Date.now()+30000,manifest:from.manifest};value.signature=await from.local.sign(f.api.signatureText(value));sessions[2].receive(value);await until(()=>sent.some(m=>m.i===2&&m.value.type==='cover-request'));
  }finally{for(const session of sessions)session.dispose();f.close();}
});


test('cached receive awaiting storage cannot display after banner replacement',async()=>{
  const f=await fixture();let release,entered=false;try{const receiver=f.participants[1];receiver.local.receiveCover=async()=>{entered=true;await new Promise(resolve=>{release=resolve;});};await f.start();await until(()=>entered);await receiver.session.profileReceived('replacement');release();await pause(50);assert.equal(f.displayed.filter(item=>item.index===1).length,0);}finally{release?.();f.close();}
});

test('remote contact cache is reused even when the owners cover has another digest',async()=>{
  const f=await fixture();try{const sender=f.participants[0],receiver=f.participants[1];sender.blob=raster(50000);sender.manifest={...sender.manifest,bytes:50000,digest:await hash(await sender.blob.arrayBuffer())};receiver.local.getCover=async(id,banner)=>id===sender.id&&banner===sender.banner?{manifest:sender.manifest,blob:sender.blob}:null;await f.start();await until(()=>f.stored.length===2&&!f.participants.some(p=>p.session.busy()));assert.equal(f.messages.filter(m=>m.index===0&&m.value.type==='cover-chunk').length,0);}finally{f.close();}
});

test('small VP8L headers and manifest aspect ratio match the shared media contract',async()=>{
  const f=await fixture();try{assert.equal(f.api.validManifest({...f.participants[0].manifest,width:100}),false);const b=new Uint8Array(25);b.set(Buffer.from('RIFF'));new DataView(b.buffer).setUint32(4,17,true);b.set(Buffer.from('WEBPVP8L'),8);b[20]=47;b[21]=2;assert.deepEqual(Array.from(f.api.dimensions(b,'image/webp')),[3,1]);}finally{f.close();}
});


test('new manifest cannot be replaced by delayed verification of a deferred startup manifest',async()=>{
  const f=await fixture();let release;try{await f.start({profiles:false});await until(()=>f.messages.filter(m=>m.value.type==='cover-manifest').length===2);await pause(20);const sender=f.participants[0],receiver=f.participants[1],verify=receiver.local.verify;let entered=false;
    receiver.local.verify=async(...args)=>{if(!entered){entered=true;await new Promise(resolve=>{release=resolve;});}return verify(...args);};
    const deferred=receiver.session.profileReceived(sender.banner);await until(()=>entered);
    const manifest={...sender.manifest,revision:crypto.randomUUID()},value={type:'cover-manifest',from:sender.id,to:receiver.id,key:sender.key,nonce:crypto.randomUUID(),expires:Date.now()+30000,manifest};value.signature=await sender.local.sign(f.api.signatureText(value));receiver.session.receive(value);
    await until(()=>f.stored.some(item=>item.index===1&&item.manifest.revision===manifest.revision));release();await deferred;await pause(40);
    assert.equal(f.stored.filter(item=>item.index===1).length,1);assert.equal(f.displayed.filter(item=>item.index===1).length,1);
  }finally{release?.();f.close();}
});
