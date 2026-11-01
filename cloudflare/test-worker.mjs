import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
const directory=fileURLToPath(new URL('.',import.meta.url));
const origin=process.env.SCREENTASK_WORKER_ORIGIN || 'http://127.0.0.1:17883';
let server=null;
const clients=[];
async function connect(origin,room,name='Tester') {
  const url=new URL('/call-signaling',origin);url.protocol='ws:';url.searchParams.set('room',room);url.searchParams.set('name',name);
  const socket=new WebSocket(url);clients.push(socket);const messages=[],waiters=[];
  socket.addEventListener('message',event=>{ const value=JSON.parse(event.data);const waiter=waiters.find(w=>w.type===value.type);if(waiter) {waiters.splice(waiters.indexOf(waiter),1);clearTimeout(waiter.timer);waiter.resolve(value);} else messages.push(value); });
  const next=type=>{const index=messages.findIndex(m=>m.type===type);if(index>=0) return Promise.resolve(messages.splice(index,1)[0]);return new Promise((resolve,reject)=>{const waiter={type,resolve,timer:setTimeout(()=>reject(Error('Timed out waiting for '+type)),6000)};waiters.push(waiter);});};
  const closed=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  return {socket,next,messages,closed,welcome:await Promise.race([next('welcome'),closed.then(event=>{throw Error('Room rejected: '+event.reason);})])};
}
const room='a'.repeat(48),other='b'.repeat(48);
try {
  if(!process.env.SCREENTASK_WORKER_ORIGIN) {
    const prepare=spawnSync(process.execPath,['prepare-assets.mjs'],{cwd:directory,encoding:'utf8'});assert.equal(prepare.status,0,prepare.stderr);
    server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--ip','127.0.0.1','--port','17883'],{cwd:directory,windowsHide:true,stdio:'pipe'});
    let logs='';server.stdout.on('data',chunk=>{logs+=chunk;});server.stderr.on('data',chunk=>{logs+=chunk;});
    let ready=false;for(let attempt=0;attempt<100;attempt++) {try {if((await fetch(origin)).ok) {ready=true;break;}} catch { /* starting */ }await new Promise(resolve=>setTimeout(resolve,200));}
    assert(ready,'Worker failed to start: '+logs);
  }
  assert.equal((await fetch(new URL('/call-signaling?room=short',origin))).status,400);
  assert.equal((await fetch(new URL('/call-signaling?room='+room,origin),{headers:{Origin:'https://untrusted.example'}})).status,403);
  const a=await connect(origin,room,'Alice'),b=await connect(origin,room,'Bob'),c=await connect(origin,other,'Other');
  assert.deepEqual(b.welcome.peers,[{id:a.welcome.id,name:'Alice'}]);assert.equal(c.welcome.peers.length,0);
  assert.equal((await a.next('peer-joined')).id,b.welcome.id);
  a.socket.send(JSON.stringify({type:'signal',to:b.welcome.id,from:c.welcome.id,description:{type:'offer',sdp:'v=0\r\n'},secret:'discard'}));
  assert.deepEqual(await b.next('signal'),{type:'signal',from:a.welcome.id,description:{type:'offer',sdp:'v=0\r\n'}});
  a.socket.send(JSON.stringify({type:'signal',to:c.welcome.id,candidate:null}));
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(c.messages.length,0,'Cross-room signal leaked');
  b.socket.close(1000);await b.closed;assert.equal((await a.next('peer-left')).id,b.welcome.id);
  console.log('PASS: membership, trusted sender, same-room routing and leave');
  const relay=await connect(origin,room);relay.socket.send(JSON.stringify({type:'signal',to:a.welcome.id,candidate:{candidate:'candidate:1 1 udp 1 1.2.3.4 1234 typ relay'}}));assert.equal((await relay.closed).code,1008);
  const oversize=await connect(origin,room);oversize.socket.send('x'.repeat(65537));assert.equal((await oversize.closed).code,1009);
  const invalid=await connect(origin,room);invalid.socket.send(JSON.stringify({type:'screen-frame',data:'forbidden'}));assert.equal((await invalid.closed).code,1008);
  console.log('PASS: relay candidates, media messages and oversized payloads rejected');
  const capacityRoom='capacity'+room;
  for(let i=0;i<8;i++) {const client=await connect(origin,capacityRoom);assert.equal(client.welcome.peers.length,i);}
  await assert.rejects(connect(origin,capacityRoom),/already has 8 participants/);
  console.log('PASS: 8 participant room capacity');
} finally {
  for(const socket of clients) { try {socket.close();} catch { /* closed */ } }
  if(server) {
    if(process.platform==='win32') spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else server.kill('SIGTERM');
  }
}
