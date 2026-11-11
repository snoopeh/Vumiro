import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const sourceUrl=new URL('../Vumiro.Client/WebServer/chat-storage.js',import.meta.url);
function harness(extra={}){const app={URL,URLSearchParams,crypto:webcrypto,TextEncoder,TextDecoder,AbortSignal,Map,JSON,btoa,atob,...extra};app.window=app;vm.createContext(app);vm.runInContext(fs.readFileSync(sourceUrl,'utf8'),app);return app.VumiroChatStorage;}
const key=message=>message.author.id+':'+message.id;
const compare=(a,b)=>a.timestamp-b.timestamp||(key(a)<key(b)?-1:key(a)>key(b)?1:0);
const cursor=message=>Buffer.from(JSON.stringify([message.timestamp,key(message)])).toString('base64url');
function message(patch={}){return {type:'chat',version:2,id:'m'.repeat(32),room:'room',timestamp:100,text:'Message',author:{id:'A'.repeat(43),key:'public-key',name:'Author'},signature:'signed-envelope',...patch};}
function memory(){const messages=new Map();return {messages,async append(owner,room,value){messages.set([owner,room,key(value)].join('|'),value);},async history(owner,room,{before,limit=200}={}){const all=[...messages.entries()].filter(([entry])=>entry.startsWith(owner+'|'+room+'|')).map(([,value])=>value).filter(value=>!before||value.timestamp<before[0]||value.timestamp===before[0]&&key(value)<before[1]).sort(compare),page=all.slice(-limit);return {messages:page,before:all.length>limit?cursor(page[0]):null};},async saveServer(){},async listServers(){return [];}};}
const config=()=>({mode:'private',endpoint:'https://archive.example',token:'secret'});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function indexedFixture(){
  const records=new Map(),compareTuple=(first,second)=>{for(let index=0;index<first.length;index++){if(first[index]<second[index])return -1;if(first[index]>second[index])return 1;}return 0;};
  const db={close(){},transaction(){
    const tx={};tx.objectStore=()=>({
      put(record){records.set(JSON.stringify([record.owner,record.room,record.id]),record);setImmediate(()=>tx.oncomplete?.());return {result:record.id};},
      index(){return {openCursor(range){
        const tuple=record=>[record.owner,record.room,record.timestamp,record.id],rows=[...records.values()].filter(record=>compareTuple(tuple(record),range.lower)>=0&&(range.upperOpen?compareTuple(tuple(record),range.upper)<0:compareTuple(tuple(record),range.upper)<=0)).sort((a,b)=>compareTuple(tuple(b),tuple(a)));let index=0;const cursor={};
        function next(){let continued=false;const value=rows[index++];cursor.result=value?{value,continue(){continued=true;setImmediate(next);}}:null;cursor.onsuccess();if(!continued)setImmediate(()=>tx.oncomplete?.());}setImmediate(next);return cursor;
      }};}
    });return tx;
  }};
  return {records,indexedDB:{open(){const request={result:db};setImmediate(()=>request.onsuccess());return request;}},IDBKeyRange:{bound:(lower,upper,lowerOpen,upperOpen)=>({lower,upper,lowerOpen,upperOpen})}};
}
test('archive writes locally before attempting private backup and reports backup failure',async()=>{
  const local=memory(),api=harness();let called=0;
  const archive=api.create({owner:'alice',local,configuration:()=>({mode:'private',endpoint:'https://archive.example',token:'secret'}),fetch:async()=>{called++;assert.equal(local.messages.size,1);throw Error('offline');}});
  const entry=message({room:'signed room',text:'keep me'});
  await assert.rejects(archive.append('signed room',entry),error=>/kept locally/.test(error.message)&&error.localSaved===true);assert.equal(called,1);assert.equal(local.messages.size,1);
});
test('local mode is the default and owner archives cannot read each other',async()=>{
  const local=memory(),api=harness(),first=api.create({owner:'alice',local,configuration:()=>({mode:'local'})}),other=api.create({owner:'bob',local,configuration:()=>({mode:'local'})});
  await first.append('room',message({text:'private'}));
  assert.equal((await first.history('room')).messages.length,1);assert.equal((await other.history('room')).messages.length,0);
});

test('private pagination forwards the requested limit and composite cursor to both repositories',async()=>{
  const local=memory(),seen=[],entries=[1,2,3,4].map(timestamp=>message({timestamp,id:String(timestamp).repeat(32)}));for(const entry of entries)await local.append('alice','room',entry);
  const original=local.history;local.history=async(...args)=>{seen.push(args[2]);return original(...args);};
  const archive=harness().create({owner:'alice',local,configuration:config,fetch:async url=>{const target=new URL(url);assert.equal(target.searchParams.get('limit'),'2');assert.equal(target.searchParams.get('before'),cursor(entries[3]));return json({messages:[entries[1],entries[2]],before:cursor(entries[1])});}});
  const page=await archive.history('room',{limit:2,before:[4,key(entries[3])]});assert.deepEqual(Array.from(page.messages,value=>value.timestamp),[2,3]);assert.deepEqual(Array.from(seen[0].before),[4,key(entries[3])]);assert.equal(seen[0].limit,2);assert.equal(page.before,cursor(entries[1]));assert.equal(page.warning,undefined);
  const older=await harness().create({owner:'alice',local,configuration:()=>({mode:'local'})}).history('room',{limit:2,before:page.before});assert.deepEqual(Array.from(older.messages,value=>value.timestamp),[1]);assert.equal(older.before,null);
});

test('pagination uses author plus message ID for same-time boundaries and preserves owner isolation',async()=>{
  const local=memory(),first=message(),other=message({author:{id:'B'.repeat(43),key:'other-key',name:'Other'}});await local.append('alice','room',first);await local.append('bob','room',message({text:'Other owner'}));
  const archive=harness().create({owner:'alice',local,configuration:config,fetch:async url=>json(new URL(url).searchParams.has('before')?{messages:[first],before:null}:{messages:[other],before:cursor(other)})});const latest=await archive.history('room',{limit:1});assert.equal(latest.messages[0].author.id,other.author.id);assert.equal(latest.before,cursor(other));
  const older=await archive.history('room',{limit:1,before:latest.before});assert.equal(older.messages[0].author.id,first.author.id);assert.equal(older.messages[0].text,'Message');assert.equal(older.before,null);
});

test('malformed remote envelopes cannot poison merged local history or become cached',async()=>{
  const local=memory(),saved=message(),remote=message({id:'r'.repeat(32),timestamp:99,extra:'not retained'});await local.append('alice','room',saved);
  const hostile=[null,{},message({room:'other'}),message({text:'x'.repeat(2001)}),message({timestamp:'yesterday'}),message({author:{id:'bad'}}),message({signature:''})];
  const archive=harness().create({owner:'alice',local,configuration:config,fetch:async()=>json({messages:[...hostile,remote,message({text:'Overwrite local'})]})});const page=await archive.history('room');assert.deepEqual(Array.from(page.messages,value=>value.id),[remote.id,saved.id]);assert.equal(page.messages[1].text,saved.text);assert.equal(page.messages[0].extra,undefined);assert.equal(local.messages.size,1);
});

test('oversized streamed responses are canceled before further reads or whole-body allocation',async()=>{
  const local=memory();await local.append('alice','room',message());let reads=0,canceled=false,textRead=false;
  const archive=harness().create({owner:'alice',local,configuration:config,fetch:async()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:async()=>{reads++;return {done:false,value:new Uint8Array(11*1024*1024)};},cancel:async()=>{canceled=true;}})},text:async()=>{textRead=true;throw Error('must stream');}})});
  const page=await archive.history('room');assert.equal(reads,2);assert.equal(canceled,true);assert.equal(textRead,false);assert.equal(page.messages.length,1);assert.match(page.warning,/private archive unavailable/i);
});

test('local quota errors never claim that the message was retained or attempt remote writes',async()=>{
  let remote=0;const local={...memory(),append:async()=>{throw Error('QuotaExceededError');}},archive=harness().create({owner:'alice',local,configuration:config,fetch:async()=>{remote++;return json({ok:true});}});
  await assert.rejects(archive.append('room',message()),error=>/Quota/.test(error.message)&&error.localSaved!==true);assert.equal(remote,0);
});

test('default IndexedDB pages retain same-ID authors and separate owner namespaces',async()=>{
  const indexed=indexedFixture(),api=harness(indexed),alice=api.create({owner:'alice'}),bob=api.create({owner:'bob'}),first=message(),second=message({author:{id:'B'.repeat(43),key:'other-key',name:'Other'}});
  await alice.append('room',first);await alice.append('room',second);await bob.append('room',first);assert.equal(indexed.records.size,3);
  const latest=await alice.history('room',{limit:1});assert.equal(latest.messages[0].author.id,second.author.id);assert.equal(latest.before,cursor(second));const older=await alice.history('room',{limit:1,before:latest.before});assert.equal(older.messages[0].author.id,first.author.id);assert.equal(older.before,null);assert.equal((await bob.history('room')).messages.length,1);
});

test('offline private history preserves the local page and its continuation cursor',async()=>{
  const local=memory(),entries=[message({timestamp:1,id:'a'.repeat(32)}),message({timestamp:2,id:'b'.repeat(32)})];for(const entry of entries)await local.append('alice','room',entry);const archive=harness().create({owner:'alice',local,configuration:config,fetch:async()=>{throw Error('offline');}});
  const page=await archive.history('room',{limit:1});assert.equal(page.messages[0].timestamp,2);assert.equal(page.before,cursor(entries[1]));assert.match(page.warning,/Local history loaded; private archive unavailable/);
});

test('invalid history limits and cursors fail before any local or remote work',async()=>{
  let calls=0;const archive=harness().create({owner:'alice',local:{...memory(),history:async()=>{calls++;return {messages:[]};}},configuration:config,fetch:async()=>{calls++;return json({messages:[]});}});
  for(const options of [{limit:0},{limit:201},{limit:1.5},{before:'not-a-cursor'},{before:[1,'bad']},{before:[-1,'A'.repeat(43)+':'+ 'm'.repeat(32)]}])await assert.rejects(archive.history('room',options),/limit|cursor/i);assert.equal(calls,0);
});
test('private archive rejects credential URLs and cleartext remote hosts',()=>{
  const api=harness();assert.throws(()=>api.validateEndpoint('http://archive.example'),/HTTPS/);assert.throws(()=>api.validateEndpoint('https://user:password@archive.example'),/credentials/);
  assert.equal(api.validateEndpoint('http://127.0.0.1:8788/'),'http://127.0.0.1:8788');assert.equal(api.validateEndpoint('https://archive.example/'),'https://archive.example');
});
