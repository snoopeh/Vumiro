import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

test('private SQLite archive survives restart, isolates owners and paginates duplicate timestamps', async () => {
  const {createStorageServer} = await import('../storage/server.mjs');
  const root=await mkdtemp(path.join(tmpdir(),'vumiro-archive-'));
  const options={file:path.join(root,'archive.sqlite'),tokens:{alice:'alice-secret',bob:'bob-secret'},origins:['https://screentask.local']};
  let service;
  const start=async()=>{service=createStorageServer(options);await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));};
  const request=async(route,{token='alice-secret',method='GET',body,origin='https://screentask.local'}={})=>fetch(`http://127.0.0.1:${service.server.address().port}${route.replace('/rooms/room-one/','/rooms/'+createHash('sha256').update('room-one').digest('hex')+'/')}`,{method,headers:{Authorization:`Bearer ${token}`,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const message=id=>({id,room:'room-one',timestamp:100,text:id,author:{id:'alice'},signature:'signed',version:2,type:'chat'});
  try {
    await start();
    assert.equal((await request('/v1/owners/alice/rooms/room-one/messages',{method:'POST',body:message('a')})).status,201);
    assert.equal((await request('/v1/owners/alice/rooms/room-one/messages',{method:'POST',body:message('a')})).status,200);
    assert.equal((await request('/v1/owners/alice/rooms/room-one/messages',{method:'POST',body:{...message('a'),text:'overwrite'}})).status,409);
    await request('/v1/owners/alice/rooms/room-one/messages',{method:'POST',body:message('b')});
    await request('/v1/owners/alice/rooms/room-one/messages',{method:'POST',body:message('c')});
    const page=await (await request('/v1/owners/alice/rooms/room-one/messages?limit=2')).json();
    assert.deepEqual(page.messages.map(x=>x.id),['b','c']);assert.ok(page.before);
    const older=await (await request('/v1/owners/alice/rooms/room-one/messages?limit=2&before='+encodeURIComponent(page.before))).json();
    assert.deepEqual(older.messages.map(x=>x.id),['a']);
    assert.equal((await request('/v1/owners/bob/rooms/room-one/messages')).status,403);
    assert.equal((await request('/v1/owners/alice/rooms/room-one/messages',{token:'wrong'})).status,403);
    assert.equal((await request('/v1/owners/toString/servers',{token:String(Object.prototype.toString)})).status,403);
    assert.equal((await request('/v1/owners/alice/rooms/room-one/messages',{origin:'https://evil.example'})).status,403);
    assert.equal((await request('/v1/owners/alice/rooms/room-one/messages?limit=NaN')).status,400);
    assert.equal((await request('/v1/owners/alice/rooms/other/messages',{method:'POST',body:message('d')})).status,400);
    const server={id:'community',name:'Friends',channels:[{id:'general',name:'general',type:'text'}]};
    assert.equal((await request('/v1/owners/alice/servers',{method:'PUT',body:server})).status,200);
    await service.close();await start();
    assert.equal((await (await request('/v1/owners/alice/rooms/room-one/messages')).json()).messages.length,3);
    assert.deepEqual((await (await request('/v1/owners/bob/rooms/room-one/messages',{token:'bob-secret'})).json()).messages,[]);
    assert.equal((await (await request('/v1/owners/alice/servers')).json()).servers[0].name,'Friends');
  } finally {await service?.close();await rm(root,{recursive:true,force:true});}
});
