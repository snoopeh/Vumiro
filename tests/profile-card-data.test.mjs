import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, randomUUID } from 'node:crypto';
import { validateSnapshot } from '../cloudflare/accounts.js';

const source = fs.readFileSync(new URL('../Vumiro.Client/WebServer/local-profile.js', import.meta.url), 'utf8').split('/* Local voice preferences')[0];
const picture = 'data:image/png;base64,AA==';
const links = [{provider:'github',url:'https://github.com/snoopeh'}, {provider:'twitch',url:'https://www.twitch.tv/snoopeh'}];

// Asynchronous request/transaction fixture; all profile validation, signing,
// patch merging and snapshot construction run through production code.
function memoryDatabase() {
  const stores = new Map();
  const db = {
    createObjectStore(name) { stores.set(name, new Map()); },
    transaction(names) {
      const selected = Array.isArray(names) ? names : [names];
      const staged = new Map(selected.map(name => [name, new Map(stores.get(name))]));
      let pending = 0, completed = false, aborted = false;
      const tx = {
        abort() { aborted = true; tx.error = Object.assign(Error('Aborted'), {name:'AbortError'}); setImmediate(() => tx.onabort?.()); },
        objectStore(name) {
          const data = staged.get(name);
          const request = action => {
            const result = {}; pending++;
            setImmediate(() => {
              if (aborted) return;
              try { result.result = structuredClone(action()); result.onsuccess?.(); }
              catch (error) { tx.error = error; tx.abort(); }
              finally { pending--; settle(); }
            });
            return result;
          };
          return {
            transaction:tx,
            get:key=>request(()=>data.get(key)), getAll:()=>request(()=>[...data.values()]), count:()=>request(()=>data.size),
            put:(value,key)=>request(()=>{ data.set(key ?? value.id, structuredClone(value)); return key ?? value.id; }),
            clear:()=>request(()=>data.clear()), delete:key=>request(()=>data.delete(key))
          };
        }
      };
      function settle() {
        setImmediate(() => {
          if (!pending && !completed && !aborted) {
            completed = true; for (const [name,data] of staged) stores.set(name,data); tx.oncomplete?.();
          }
        });
      }
      settle(); return tx;
    }
  };
  return {open() { const request = {result:db}; setImmediate(() => { request.onupgradeneeded?.(); request.onsuccess?.(); }); return request; }};
}

function local() {
  const indexedDB = memoryDatabase();
  const sandbox = {
    window:{isSecureContext:true,indexedDB}, indexedDB,
    crypto:{subtle:webcrypto.subtle,randomUUID,getRandomValues:bytes=>webcrypto.getRandomValues(bytes)},
    TextEncoder,TextDecoder,URL,Event,performance,dispatchEvent(){},
    btoa:value=>Buffer.from(value,'binary').toString('base64'), atob:value=>Buffer.from(value,'base64').toString('binary')
  };
  vm.runInNewContext(source,sandbox);
  return sandbox.window.VumiroLocalProfile;
}
const plain = value => JSON.parse(JSON.stringify(value));
const withNotice = value => ({...plain(value),privacyNoticeVersion:'2026-11-03',privacyNoticeAcceptedAt:'2026-11-03T12:00:00.000Z'});

test('card validators bound media, bio and provider profile links', () => {
  const api = local();
  assert.equal(api.validateBio('  Hello\nworld  '),'Hello\nworld');
  assert.equal(api.validateBanner(picture),picture);
  assert.throws(()=>api.validateBio('x'.repeat(241)),/240/);
  for (const value of [null, 'https://example.com/banner.png', 'data:image/svg+xml;base64,AA==', picture + 'A'.repeat(16384)]) assert.throws(()=>api.validateBanner(value));
  assert.deepEqual(plain(api.validateConnections(links)),links);
  assert.equal(api.validateConnections([{provider:'twitch',url:'https://twitch.tv/snoopeh'}])[0].url,'https://www.twitch.tv/snoopeh');
  for (const url of ['javascript:alert(1)','http://github.com/snoopeh','https://github.com.evil.example/snoopeh','https://github.com@evil.example/snoopeh','https://snoopeh@github.com/snoopeh','https://github.com/snoopeh?token=secret','https://github.com/snoopeh#secret','https://github.com/snoopeh/repos','https://github.com/a%2fb','https://github.com:444/snoopeh']) assert.throws(()=>api.validateConnections([{provider:'github',url}]));
  assert.throws(()=>api.validateConnections([...links,...links]));
  assert.throws(()=>api.validateConnections([{provider:'github',url:links[0].url,verified:true}]));
  assert.throws(()=>api.validateConnections(Array.from({length:6},()=>links[0])));
});

test('profile metadata survives local storage and account restore; friend caches stay local', async () => {
  const owner = local(), friend = local();
  await owner.initialize(); await friend.initialize();
  await owner.createProfile('Owner'); await friend.createProfile('Friend');
  await owner.updateProfile({bio:'Owner bio',banner:picture,connections:links});
  await owner.updateName('Owner renamed');
  assert.equal((await owner.initialize()).bio,'Owner bio');
  assert.deepEqual(plain(owner.profile().connections),links);
  const exposed = owner.profile(); exposed.connections[0].url='https://github.com/changed';
  assert.deepEqual(plain(owner.profile().connections),links);
  await friend.updateProfile({avatar:picture,bio:'Friend bio',banner:picture,connections:links});
  await owner.addContact(friend.profile());
  assert.equal((await owner.listFriends())[0].banner,picture);
  await owner.updateContactProfile(friend.profile().id,{bio:'Updated friend bio'});
  assert.equal((await owner.listFriends())[0].banner,picture);
  const backup = withNotice(await owner.accountSnapshot());
  assert.equal(await validateSnapshot(backup),true);
  assert.equal(backup.profile.bio,'Owner bio');
  assert.equal(backup.friends[0].avatar,'');
  for (const field of ['bio','banner','connections']) assert.equal(Object.hasOwn(backup.friends[0],field),false);
  await owner.updateProfile({bio:'Changed',banner:'',connections:[]});
  await owner.applyAccountSnapshot(backup);
  assert.equal(owner.profile().bio,'Owner bio');
  assert.equal(owner.profile().banner,picture);
  assert.deepEqual(plain(owner.profile().connections),links);
  assert.equal((await owner.listFriends())[0].banner,'');
});

test('legacy backups still restore, malformed card metadata leaves profile untouched', async () => {
  const api = local(); await api.initialize(); await api.createProfile('Owner');
  const backup = withNotice(await api.accountSnapshot());
  for (const field of ['bio','banner','connections']) delete backup.profile[field];
  assert.equal(await validateSnapshot(backup),true);
  await api.applyAccountSnapshot(backup);
  assert.equal(api.profile().banner,'');
  const bad = structuredClone(backup); bad.profile.connections=[{provider:'github',url:'javascript:alert(1)'}];
  await assert.rejects(api.applyAccountSnapshot(bad));
  assert.equal(api.profile().name,'Owner');
  assert.equal(await validateSnapshot(bad),false);
  const unknown = structuredClone(backup); unknown.profile.oauthToken='secret';
  await assert.rejects(api.applyAccountSnapshot(unknown));
  assert.equal(await validateSnapshot(unknown),false);
});

test('backend card schema rejects malformed links, extra claims, oversize media and cached friend metadata', async () => {
  const api = local(); await api.initialize(); await api.createProfile('Owner');
  const value = withNotice(await api.accountSnapshot());
  const invalid = [
    {bio:'x'.repeat(241)}, {banner:'data:image/svg+xml;base64,AA=='}, {banner:picture+'A'.repeat(16384)},
    {connections:[{provider:'github',url:'javascript:alert(1)'}]}, {connections:[{provider:'github',url:links[0].url,verified:true}]},
    {connections:[links[0],links[0]]}, {connections:[{provider:'github',url:'https://github.com/a?tracking=1'}]}
  ];
  for (const patch of invalid) assert.equal(await validateSnapshot({...value,profile:{...value.profile,...patch}}),false,JSON.stringify(patch).slice(0,120));
  const friend = local(); await friend.initialize(); await friend.createProfile('Friend'); await api.addContact(friend.profile());
  const friendBackup = withNotice(await api.accountSnapshot()); friendBackup.friends[0].bio='Cached';
  assert.equal(await validateSnapshot(friendBackup),false);
});

test('signed peer exchange carries card metadata under 64 KiB and rejects tampering', async () => {
  const first=local(), second=local(); await first.initialize(); await second.initialize();
  await first.createProfile('First'); await second.createProfile('Second');
  const [owner,friend]=first.profile().id<second.profile().id?[first,second]:[second,first];
  await owner.updateProfile({avatar:'data:image/png;base64,'+'A'.repeat(32768-22),banner:'data:image/png;base64,'+'A'.repeat(16384-22),bio:'🌸'.repeat(120),connections:links});
  await friend.updateProfile({bio:'Friend bio',banner:picture,connections:links});
  let connection; const received=[], sent=[];
  class PeerConnection {
    constructor(){connection=this;}
    createDataChannel(label){return this.channel={label,readyState:'open',bufferedAmount:0,send:text=>sent.push(text),close(){this.readyState='closed';}};}
    async createOffer(){return {type:'offer',sdp:'v=0'};}
    async setLocalDescription(value){this.localDescription=value;}
    close(){}
  }
  const sandbox={window:{},RTCPeerConnection:PeerConnection,TextEncoder,Date,crypto:{randomUUID},setTimeout,clearTimeout,queueMicrotask};
  vm.runInNewContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/peer-profile.js',import.meta.url),'utf8'),sandbox);
  const profiles=sandbox.window.VumiroPeerProfiles.create({local:owner,send(){},getFriend:id=>id===friend.profile().id?friend.profile():null,onProfile:(id,value)=>received.push({id,value})});
  // WebCrypto completes on worker threads: event-loop turn counts are not a
  // time budget under parallel test load. Keep the same outcome assertions and
  // fail within a bounded deadline if the operation genuinely never completes.
  const settle=async check=>{
    const deadline=performance.now()+2000;
    while(!check()) {
      assert.ok(performance.now()<deadline,'Peer operation did not settle within 2 seconds');
      await new Promise(resolve=>setTimeout(resolve,5));
    }
  };
  try {
    profiles.presence(friend.profile().id,true); await settle(()=>connection?.channel?.onopen);
    connection.channel.onopen(); await settle(()=>sent.length);
    const outbound=JSON.parse(sent[0]);
    assert.equal(Buffer.byteLength(sent[0])<65536,true);
    assert.equal(outbound.profile.banner.length,16384);
    assert.equal(outbound.profile.bio,'🌸'.repeat(120));
    const packet=async profile=>{
      const own=friend.profile(); const value={type:'profile',id:own.id,key:own.key,nonce:randomUUID(),expires:Date.now()+59000,profile};
      value.signature=await friend.sign(`vumiro-peer-profile-v1\n${own.id}\n${owner.profile().id}\n${value.nonce}\n${value.expires}\n${JSON.stringify(profile)}`); return value;
    };
    const value=await packet({name:friend.profile().name,username:'',avatar:'',bio:'Friend bio',banner:picture,connections:links});
    connection.channel.onmessage({data:JSON.stringify(value)}); await settle(()=>received.length===1);
    assert.equal(received[0].value.banner,picture); assert.deepEqual(plain(received[0].value.connections),links);
    const tampered=await packet(value.profile); tampered.profile={...value.profile,bio:'Unsigned replacement'};
    connection.channel.onmessage({data:JSON.stringify(tampered)});
    const legacy=await packet({name:friend.profile().name,username:'',avatar:''});
    connection.channel.onmessage({data:JSON.stringify(legacy)}); await settle(()=>received.length===2);
    assert.equal(received[1].value.bio,''); assert.equal(received[1].value.banner,'');
    assert.deepEqual(plain(received[1].value.connections),[]);
  } finally { profiles.reset(); }
});

test('account restore atomically replaces an empty device identity with its recovered account identity',async()=>{
  const device=local(),owner=local();await device.createProfile('New device');await owner.createProfile('Account owner');
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const spki=await webcrypto.subtle.exportKey('spki',pair.publicKey),pkcs8=await webcrypto.subtle.exportKey('pkcs8',pair.privateKey);
  const recovered={identityId:Buffer.from(await webcrypto.subtle.digest('SHA-256',spki)).toString('base64url'),publicKey:Buffer.from(spki).toString('base64url'),privateKey:await webcrypto.subtle.importKey('pkcs8',pkcs8,{name:'ECDSA',namedCurve:'P-256'},false,['sign'])};
  await device.applyAccountSnapshot(await owner.accountSnapshot(),undefined,recovered);
  assert.equal(device.profile().id,recovered.identityId);assert.equal(device.profile().name,'Account owner');
  const signature=await device.sign('restored identity');assert.equal(await device.verify({key:recovered.publicKey},'restored identity',signature),true);
});

test('invalid account contacts cannot partially install a recovered identity',async()=>{
  const device=local();await device.createProfile('Preserved');const before=device.profile();
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const spki=await webcrypto.subtle.exportKey('spki',pair.publicKey),pkcs8=await webcrypto.subtle.exportKey('pkcs8',pair.privateKey);
  const recovered={identityId:Buffer.from(await webcrypto.subtle.digest('SHA-256',spki)).toString('base64url'),publicKey:Buffer.from(spki).toString('base64url'),privateKey:await webcrypto.subtle.importKey('pkcs8',pkcs8,{name:'ECDSA',namedCurve:'P-256'},false,['sign'])};
  const snapshot=await device.accountSnapshot();snapshot.friends=[{id:'invalid',key:'invalid',name:'Invalid'}];
  await assert.rejects(device.applyAccountSnapshot(snapshot,undefined,recovered));assert.deepEqual(device.profile(),before);
});

test('account restore can install a recovered identity on a brand new device without generating a temporary key',async()=>{
  const device=local(),owner=local();await owner.createProfile('Account owner');
  const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const spki=await webcrypto.subtle.exportKey('spki',pair.publicKey),pkcs8=await webcrypto.subtle.exportKey('pkcs8',pair.privateKey);
  const recovered={identityId:Buffer.from(await webcrypto.subtle.digest('SHA-256',spki)).toString('base64url'),publicKey:Buffer.from(spki).toString('base64url'),privateKey:await webcrypto.subtle.importKey('pkcs8',pkcs8,{name:'ECDSA',namedCurve:'P-256'},false,['sign'])};
  await device.applyAccountSnapshot(await owner.accountSnapshot(),undefined,recovered);assert.equal(device.profile().id,recovered.identityId);
});
