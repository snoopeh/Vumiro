import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { digestPackage } from './marketplace-package.js';
import * as module from './marketplace.js';

const handle = module.handleMarketplaceRequest;
const account = crypto.randomUUID(), other = crypto.randomUUID(), admin = crypto.randomUUID();
const item = 'test-item', version = 'test-version';
function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('./marketplace-migrations/', import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`./marketplace-migrations/${name}`, import.meta.url),'utf8'));
  const prepare = (sql,values=[])=>({ bind(...v){return prepare(sql,v);}, run(){const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}, first(){const r=sqlite.prepare(sql).get(...values);return r?{...r}:null;}, all(){return {success:true,results:sqlite.prepare(sql).all(...values).map(r=>({...r}))};} });
  return {sqlite,prepare,batch(statements){sqlite.exec('BEGIN');try{const r=statements.map(s=>s.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
async function fixture(t) {
  assert.equal(typeof handle,'function','marketplace request handler must be implemented');
  const db=d1(); t.after(()=>db.sqlite.close());
  const now=Date.now();
  db.prepare('INSERT INTO marketplace_creators(account_id,display_name,rights_accepted_at,created_at) VALUES(?,?,?,?)').bind(account,'Creator',now,now).run();
  db.prepare('INSERT INTO marketplace_listings(id,creator_id,title,description,status,price_minor,currency,latest_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(item,account,'Theme','A theme','published',0,'BRL',version,now,now).run();
  db.prepare('INSERT INTO marketplace_versions(id,item_id,version,asset_key,digest,status,rights_json,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(version,item,'1.0.0','private/package',await digestPackage(globalThis.VumiroCommunityThemes.builtins[0]),'approved','{}',now).run();
  const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',key.publicKey);Object.assign(jwk,{kid:crypto.randomUUID(),use:'sig',alg:'ES256'});
  const base=`https://marketplace-${crypto.randomUUID()}.supabase.co`;
  t.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),`${base}/auth/v1/.well-known/jwks.json`);return Response.json({keys:[jwk]});});
  const permissions=new Map();
  const assets=new Map(),events=[];
  const env={MARKETPLACE_DB:db,SUPABASE_URL:base,MARKETPLACE_ADMIN_ACCOUNTS:admin,MARKETPLACE_INTERNAL_SECRET:'test-internal-secret-at-least-32-characters',MARKETPLACE_ASSETS:{async put(key,value){assets.set(key,value);},async get(key){return {body:assets.get(key)||JSON.stringify(globalThis.VumiroCommunityThemes.builtins[0])};}},MARKETPLACE_HUBS:{async fetch(req){assert.equal(req.headers.get('Authorization'),`Bearer ${env.MARKETPLACE_INTERNAL_SECRET}`);if(req.method==='GET'){const cursor=Number(new URL(req.url).searchParams.get('cursor')||0);return Response.json({events:events.slice(cursor),cursor:String(events.length),hasMore:false});}const p=await req.json();return Response.json(permissions.get(`${p.accountId}:${p.scopeId||p.hubId}`)||{rootHubId:p.hubId,member:true,canManage:true});}}};
  async function token(id){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const n=Math.floor(Date.now()/1000),h=enc({alg:'ES256',kid:jwk.kid}),p=enc({iss:`${base}/auth/v1`,aud:'authenticated',sub:id,role:'authenticated',iat:n-10,exp:n+600});const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(`${h}.${p}`));return `${h}.${p}.${Buffer.from(sig).toString('base64url')}`;}
  async function request(path,method='GET',body,id=account,internal=false){const headers={'Content-Type':'application/json',Authorization:internal?`Bearer ${env.MARKETPLACE_INTERNAL_SECRET}`:`Bearer ${await token(id)}`};const r=await handle(new Request(`https://market.example/api/v1/marketplace${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return {status:r.status,body:await r.json()};}
  async function claim(id=account){const r=await request(`/items/${item}/claim`,'POST',{},id);assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.body;}
  async function sponsor(hubId,id=account){return request(`/items/${item}/grants`,'POST',{hubId},id);}
  return {db,env,permissions,events,request,claim,sponsor};
}

async function signingIdentity(){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const spki=await crypto.subtle.exportKey('spki',pair.publicKey);
  return {key:Buffer.from(spki).toString('base64url'),peerId:Buffer.from(await crypto.subtle.digest('SHA-256',spki)).toString('base64url'),sign:async text=>Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(text))).toString('base64url')};
}
async function publicAppearance(f,peerId){const response=await handle(new Request(`https://market.example/api/v1/marketplace/profiles/${peerId}/appearance`),f.env);return {status:response.status,body:await response.json()};}
async function proveIdentity(f,identity,id=account){const challenge=await f.request('/profile/identity/challenge','POST',{peerId:identity.peerId,key:identity.key},id);assert.equal(challenge.status,201,JSON.stringify(challenge));return f.request('/profile/identity/verify','POST',{challengeId:challenge.body.challengeId,signature:await identity.sign(challenge.body.text)},id);}
async function personalItem(f,kind='profile-card',suffix='one'){
  const now=Date.now(),itemId=`personal-${kind}-${suffix}`,versionId=`version-${kind}-${suffix}`;
  const pkg={...structuredClone(globalThis.VumiroCommunityThemes.builtins[0]),id:itemId,name:'Original personal artwork',kind,tokens:{},layouts:{},components:{[kind]:{borderColor:'#123456'}},css:'',motion:'none'};
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(pkg)))).toString('hex');
  f.db.prepare('INSERT INTO marketplace_listings(id,creator_id,title,description,status,price_minor,currency,latest_version_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(itemId,account,'Personal artwork','Original personal cosmetics','published',0,'BRL',versionId,now,now).run();
  f.db.prepare('INSERT INTO marketplace_versions(id,item_id,version,asset_key,digest,status,rights_json,summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(versionId,itemId,'1.0.0',`private/${versionId}`,digest,'approved','{}',JSON.stringify({kind,engine:1,slots:[kind],scopes:[kind==='profile-card'?'profile-card':kind==='avatar-frame'?'avatar':'profile']}),now).run();
  await f.env.MARKETPLACE_ASSETS.put(`private/${versionId}`,JSON.stringify(pkg));
  return {itemId,versionId,pkg};
}

test('personal identity linking requires a fresh account-bound signing proof and one-use challenge',async t=>{
  const f=await fixture(t),identity=await signingIdentity(),foreign=await signingIdentity();
  const challenge=await f.request('/profile/identity/challenge','POST',{peerId:identity.peerId,key:identity.key,accountId:other});
  assert.equal(challenge.status,201);
  const canonical=JSON.parse(challenge.body.text);assert.equal(canonical[0],'vumiro-profile-cosmetics-v1');assert.equal(canonical[1],account);assert.equal(canonical[2],identity.peerId);assert.equal(canonical[3],identity.key);assert.ok(canonical[4].length>=32);assert.equal(canonical[5],challenge.body.expires);assert.ok(canonical[5]<=Date.now()+60000);
  const proof={challengeId:challenge.body.challengeId,signature:await identity.sign(challenge.body.text)};
  assert.equal((await f.request('/profile/identity/verify','POST',proof,other)).status,403);
  assert.equal((await f.request('/profile/identity/verify','POST',{...proof,signature:await foreign.sign(challenge.body.text)})).status,403);
  assert.equal((await f.request('/profile/identity/verify','POST',proof)).status,200);
  assert.equal((await f.request('/profile/identity/verify','POST',proof)).status,409);
  assert.equal((await proveIdentity(f,identity,other)).status,409,'a peer identity cannot move to a different account');
  assert.equal((await proveIdentity(f,await signingIdentity())).status,200,'an account can link another own identity');
});

test('identity challenges reject mismatched keys, malformed proof and expired challenges',async t=>{
  const f=await fixture(t),a=await signingIdentity(),b=await signingIdentity();
  assert.equal((await f.request('/profile/identity/challenge','POST',{peerId:a.peerId,key:b.key})).status,400);
  assert.equal((await f.request('/profile/identity/challenge','POST',{peerId:a.peerId,key:'A'.repeat(257)})).status,400);
  const challenge=await f.request('/profile/identity/challenge','POST',{peerId:a.peerId,key:a.key});assert.equal(challenge.status,201);
  assert.equal((await f.request('/profile/identity/verify','POST',{challengeId:challenge.body.challengeId,signature:'AAAA'})).status,400);
  f.db.prepare('UPDATE marketplace_profile_challenges SET expires_at=? WHERE id=?').bind(Date.now()-1,challenge.body.challengeId).run();
  assert.equal((await f.request('/profile/identity/verify','POST',{challengeId:challenge.body.challengeId,signature:await a.sign(challenge.body.text)})).status,409);
});

test('public unlinked appearance is bounded baseline without authentication or private data',async t=>{
  const f=await fixture(t),identity=await signingIdentity();await f.claim();
  const result=await publicAppearance(f,identity.peerId);assert.equal(result.status,200);assert.deepEqual(Object.keys(result.body).sort(),['appearance','licenseNotice']);
  assert.deepEqual(result.body.appearance,{'profile-card':null,'avatar-frame':null,'profile-effect':null});assert.match(result.body.licenseNotice,/display/i);
  assert.equal((await f.request('/profile/appearance','GET',undefined,other)).status,200);
  assert.equal((await publicAppearance(f,'invalid')).status,404);
});

test('personal cosmetics claim free, equip by account and kind, replace, undo, reset and restore',async t=>{
  const f=await fixture(t),one=await personalItem(f),two=await personalItem(f,'profile-card','two');
  assert.equal((await f.request('/profile/appearance/profile-card','PUT',one)).status,403);
  assert.equal((await f.request(`/items/${one.itemId}/claim`,'POST',{})).status,201);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM marketplace_orders').first().n,0);
  let result=await f.request('/profile/appearance/profile-card','PUT',one);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.body.appearance['profile-card'].versionId,one.versionId);
  assert.equal((await f.request('/profile/appearance','GET',undefined,other)).body.appearance['profile-card'],null);
  assert.equal((await f.request('/profile/appearance/profile-card','PUT',one,other)).status,403);
  assert.equal((await f.request('/profile/appearance/avatar-frame','PUT',one)).status,400);
  assert.equal((await f.request(`/items/${two.itemId}/claim`,'POST',{})).status,201);
  assert.equal((await f.request('/profile/appearance/profile-card','PUT',two)).body.appearance['profile-card'].itemId,two.itemId);
  assert.equal((await f.request('/profile/appearance/profile-card/undo','POST',{})).body.appearance['profile-card'].itemId,one.itemId);
  result=await f.request('/profile/appearance/profile-card','DELETE');assert.equal(result.status,200);assert.equal(result.body.appearance['profile-card'],null);assert.equal(result.body.configuration['profile-card'],null);
  assert.equal((await f.request('/profile/appearance/profile-card/undo','POST',{})).body.appearance['profile-card'].itemId,one.itemId);
  assert.equal((await f.request('/profile/appearance')).body.configuration['profile-card'].versionId,one.versionId);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM marketplace_grants').first().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM marketplace_profile_bindings WHERE item_id IS NOT NULL').first().n,1);
});

test('personal cosmetics cannot sponsor hubs or enter community bindings and community packages cannot equip personally',async t=>{
  const f=await fixture(t),personal=await personalItem(f);await f.request(`/items/${personal.itemId}/claim`,'POST',{});await f.claim();
  assert.equal((await f.request(`/items/${personal.itemId}/grants`,'POST',{hubId:'root'})).status,400);
  // Even a legacy/manual grant must not permit a personal package on a hub.
  const now=Date.now();f.db.prepare("INSERT INTO marketplace_grants(id,account_id,item_id,hub_id,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").bind(crypto.randomUUID(),account,personal.itemId,'root',now,now).run();
  assert.equal((await f.request('/hubs/root/theme','PUT',personal)).status,400);
  assert.equal((await f.request('/profile/appearance/profile-card','PUT',{itemId:item,versionId:version})).status,400);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM marketplace_theme_bindings').first().n,0);
});

test('public proven profile exposes only active validated display cosmetics and never confers acquisition',async t=>{
  const f=await fixture(t),identity=await signingIdentity();assert.equal((await proveIdentity(f,identity)).status,200);
  const card=await personalItem(f),frame=await personalItem(f,'avatar-frame'),effect=await personalItem(f,'profile-effect');
  for(const cosmetic of [card,frame,effect]){await f.request(`/items/${cosmetic.itemId}/claim`,'POST',{});const r=await f.request(`/profile/appearance/${cosmetic.pkg.kind}`,'PUT',cosmetic);assert.equal(r.status,200,JSON.stringify(r));}
  const result=await publicAppearance(f,identity.peerId);assert.equal(result.status,200);assert.deepEqual(Object.keys(result.body).sort(),['appearance','licenseNotice']);
  for(const cosmetic of [card,frame,effect]){const entry=result.body.appearance[cosmetic.pkg.kind];assert.deepEqual(Object.keys(entry).sort(),['digest','itemId','kind','package','versionId']);assert.deepEqual(entry.package,cosmetic.pkg);}
  const encoded=JSON.stringify(result.body);for(const secret of [account,other,'account_id','order_id','entitlements','Authorization','configuration'])assert.equal(encoded.includes(secret),false,secret);
  assert.equal((await f.request(`/versions/${card.versionId}/download`,'GET',undefined,other)).status,403);
  assert.equal((await f.request('/profile/appearance/profile-card','PUT',card,other)).status,403);
  const linkedOther=await signingIdentity();assert.equal((await proveIdentity(f,linkedOther,other)).status,200);assert.equal((await publicAppearance(f,linkedOther.peerId)).body.appearance['profile-card'],null);
});

test('personal catalog summaries derive kind scopes from the reviewed package',async t=>{
  const f=await fixture(t);
  for(const [kind,scopes] of [['profile-card',['profile-card']],['avatar-frame',['avatar']],['profile-effect',['profile']]]){
    const pkg={...structuredClone(globalThis.VumiroCommunityThemes.builtins[0]),id:`original-${kind}`,name:'Original personal artwork',kind,tokens:{},layouts:{},components:{[kind]:{borderColor:'#123456'}},css:'',motion:'none'};
    const created=await f.request('/items','POST',{title:kind,description:'Original personal cosmetics',priceMinor:0,currency:'BRL'}),id=created.body.item.id;
    const submitted=await f.request(`/items/${id}/versions`,'POST',{package:pkg,rights:{ownsOrLicensed:true,permitsRedistribution:true,declaration:'I own this original artwork and permit licensed redistribution.'}});assert.equal(submitted.status,201,JSON.stringify(submitted));
    assert.deepEqual(submitted.body.version.summary.scopes,scopes);assert.equal(submitted.body.version.kind,kind);
    assert.equal((await f.request(`/items/${id}/claim`,'POST',{})).status,409);
    assert.equal((await f.request(`/admin/versions/${submitted.body.version.id}`,'POST',{action:'approve',reason:'Artwork and rights verified'},admin)).status,200);
    const catalog=(await f.request('/catalog','GET',undefined,other)).body.items.find(value=>value.id===id);assert.deepEqual(catalog.scopes,scopes);assert.deepEqual(catalog.slots,[kind]);
    assert.equal((await f.request(`/items/${id}/claim`,'POST',{},other)).status,201);
  }
});

test('identity proof replay is atomic across simultaneous verification requests',async t=>{
  const f=await fixture(t),identity=await signingIdentity(),challenge=await f.request('/profile/identity/challenge','POST',{peerId:identity.peerId,key:identity.key});
  const proof={challengeId:challenge.body.challengeId,signature:await identity.sign(challenge.body.text)};
  const results=await Promise.all([f.request('/profile/identity/verify','POST',proof),f.request('/profile/identity/verify','POST',proof)]);
  assert.deepEqual(results.map(value=>value.status).sort(),[200,409]);assert.equal(f.db.prepare('SELECT count(*) AS n FROM marketplace_profile_identities WHERE peer_id=?').bind(identity.peerId).first().n,1);
});

test('identity challenge issuance remains bounded across successful and pending proofs',async t=>{
  const f=await fixture(t),identity=await signingIdentity();
  for(let i=0;i<8;i++)assert.equal((await proveIdentity(f,identity)).status,200);
  assert.equal((await f.request('/profile/identity/challenge','POST',{peerId:identity.peerId,key:identity.key})).status,429);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM marketplace_profile_challenges').first().n,8);
});

test('ordinary personal delisting preserves existing licenses, public display and restored configuration',async t=>{
  const f=await fixture(t),identity=await signingIdentity(),card=await personalItem(f);await proveIdentity(f,identity);await f.request(`/items/${card.itemId}/claim`,'POST',{});
  assert.equal((await f.request('/profile/appearance/profile-card','PUT',card)).status,200);
  f.db.prepare("UPDATE marketplace_listings SET status='delisted' WHERE id=?").bind(card.itemId).run();
  assert.equal((await publicAppearance(f,identity.peerId)).body.appearance['profile-card'].itemId,card.itemId);
  await f.request('/profile/appearance/profile-card','DELETE');assert.equal((await f.request('/profile/appearance/profile-card','PUT',card)).status,200);
  assert.equal((await f.request(`/items/${card.itemId}/claim`,'POST',{},other)).status,409);
});

for(const loss of ['refund','lost-dispute','disabled','version-disabled','tampered','storage-unavailable'])test(`personal ${loss} immediately falls back while retaining configuration and other valid kinds`,async t=>{
  const f=await fixture(t),identity=await signingIdentity(),card=await personalItem(f),frame=await personalItem(f,'avatar-frame');await proveIdentity(f,identity);
  for(const value of [card,frame]){await f.request(`/items/${value.itemId}/claim`,'POST',{});assert.equal((await f.request(`/profile/appearance/${value.pkg.kind}`,'PUT',value)).status,200);}
  if(['refund','lost-dispute'].includes(loss)){const entitlement=f.db.prepare('SELECT id FROM marketplace_entitlements WHERE account_id=? AND item_id=?').bind(account,card.itemId).first();await module.revokeMarketplaceEntitlement(f.db,entitlement.id,loss);}
  else if(loss==='disabled')f.db.prepare("UPDATE marketplace_listings SET status='disabled' WHERE id=?").bind(card.itemId).run();
  else if(loss==='version-disabled')f.db.prepare("UPDATE marketplace_versions SET status='disabled' WHERE id=?").bind(card.versionId).run();
  else if(loss==='tampered')await f.env.MARKETPLACE_ASSETS.put(`private/${card.versionId}`,JSON.stringify({...card.pkg,name:'Overwritten object'}));
  else{const get=f.env.MARKETPLACE_ASSETS.get;f.env.MARKETPLACE_ASSETS.get=async key=>key===`private/${card.versionId}`?null:get(key);}
  const own=await f.request('/profile/appearance'),publicResult=await publicAppearance(f,identity.peerId);
  assert.equal(own.body.appearance['profile-card'],null);assert.equal(publicResult.body.appearance['profile-card'],null);assert.ok(publicResult.body.appearance['avatar-frame']);assert.equal(own.body.configuration['profile-card'].itemId,card.itemId);
  await f.request('/profile/appearance/profile-card','DELETE');assert.equal((await f.request('/profile/appearance/profile-card/undo','POST',{})).body.appearance['profile-card'],null);
  assert.equal((await f.request('/profile/appearance')).body.configuration['profile-card'].itemId,card.itemId);
});
test('handler exposes authenticated account ownership',async t=>{const f=await fixture(t);const r=await handle(new Request('https://market.example/api/v1/marketplace/library',{headers:{'X-Account-Id':account}}),f.env);assert.equal(r.status,401);await f.claim();assert.equal((await f.request('/library','GET',undefined,other)).body.entitlements.length,0);});
test('a hub manager can install an offered item before activation without acquiring it personally',async t=>{
  const f=await fixture(t);await f.claim();await f.sponsor('offered-hub');
  assert.equal((await f.request(`/versions/${version}/download?hubId=offered-hub`,'GET',undefined,other)).status,200);
  f.permissions.set(`${other}:offered-hub`,{rootHubId:'offered-hub',member:true,canManage:false});
  assert.equal((await f.request(`/versions/${version}/download?hubId=offered-hub`,'GET',undefined,other)).status,403);
  assert.equal((await f.request('/library','GET',undefined,other)).body.entitlements.length,0);
});
test('creator restoration returns enrollment even when no listing has been submitted',async t=>{
  const f=await fixture(t);await f.request('/creators/enroll','POST',{displayName:'Returning maker',rightsAccepted:true},other);
  const result=await f.request('/creator/items','GET',undefined,other);
  assert.equal(result.body.creator.display_name,'Returning maker');assert.deepEqual(result.body.items,[]);
  assert.equal((await f.request('/creator/items','GET',undefined,admin)).body.creator,null);
});
test('free claim is idempotent and survives later pricing and delisting',async t=>{const f=await fixture(t);const first=await f.claim();assert.deepEqual(await f.claim(),first);f.db.prepare("UPDATE marketplace_listings SET price_minor=100,status='delisted' WHERE id=?").bind(item).run();assert.deepEqual(await f.claim(),first);assert.equal((await f.request(`/versions/${version}/download`)).status,200);assert.equal((await f.request(`/items/${item}/claim`,'POST',{},other)).status,409);});
test('six concurrent root sponsorships allow exactly five and descendants share a slot',async t=>{const f=await fixture(t);await f.claim();const results=await Promise.all(Array.from({length:6},(_,i)=>f.sponsor(`hub-${i}`)));assert.equal(results.filter(r=>r.status===201).length,5);assert.equal(results.filter(r=>r.status===409).length,1);f.permissions.set(`${account}:child`,{rootHubId:'hub-0',member:true,canManage:false});assert.equal((await f.sponsor('child')).status,200);assert.equal(f.db.prepare("SELECT count(*) AS n FROM marketplace_grants WHERE status='active'").first().n,5);});
test('membership is server authorized and sponsorship never applies a theme',async t=>{const f=await fixture(t);await f.claim();f.permissions.set(`${account}:nope`,{rootHubId:'nope',member:false,canManage:true});assert.equal((await f.sponsor('nope')).status,403);await f.sponsor('root');assert.equal((await f.request('/hubs/root/theme')).body.binding,null);f.permissions.set(`${other}:root`,{rootHubId:'root',member:true,canManage:false});assert.equal((await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version},other)).status,403);assert.equal((await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version})).status,200);});
test('authenticated membership removal starts replay-safe grace and rejoin cancels',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');const event={eventId:'removal-1',sequence:1,rootHubId:'root',accountId:account,member:false,occurredAt:Date.now()};assert.equal((await f.request('/internal/events','POST',event)).status,401);assert.equal((await f.request('/internal/events','POST',event,account,true)).status,200);const grace=f.db.prepare('SELECT grace_until FROM marketplace_grants').first().grace_until;assert.ok(grace>=event.occurredAt+86400000);await f.request('/internal/events','POST',{...event,occurredAt:Date.now()+1000},account,true);assert.equal(f.db.prepare('SELECT grace_until FROM marketplace_grants').first().grace_until,grace);await f.request('/internal/events','POST',{...event,eventId:'rejoin',sequence:2,member:true},account,true);assert.equal(f.db.prepare('SELECT status FROM marketplace_grants').first().status,'active');await f.request('/internal/events','POST',{...event,eventId:'late-removal'},account,true);assert.equal(f.db.prepare('SELECT status FROM marketplace_grants').first().status,'active');});
test('expired grace is effective before maintenance and releases its slot',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});f.db.prepare("UPDATE marketplace_grants SET status='grace',grace_until=?").bind(Date.now()-1).run();assert.equal((await f.request('/hubs/root/theme')).body.binding,null);assert.equal((await f.sponsor('new-root')).status,201);});
test('withdrawal is immediate and another holder prevents fallback',async t=>{const f=await fixture(t);await f.claim();await f.claim(other);const a=await f.sponsor('root'),b=await f.sponsor('root',other);await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});assert.equal((await f.request(`/grants/${a.body.grant.id}`,'DELETE',undefined,other)).status,404);await f.request(`/grants/${a.body.grant.id}`,'DELETE');assert.ok((await f.request('/hubs/root/theme')).body.binding);await f.request(`/grants/${b.body.grant.id}`,'DELETE',undefined,other);assert.equal((await f.request('/hubs/root/theme')).body.binding,null);});
test('entitlement revocation disables all grants and downloads atomically',async t=>{const f=await fixture(t);const ent=await f.claim();await f.sponsor('root');await module.revokeMarketplaceEntitlement(f.db,ent.entitlement.id,'refund');assert.equal((await f.request(`/versions/${version}/download`)).status,403);assert.equal(f.db.prepare('SELECT status FROM marketplace_grants').first().status,'revoked');assert.equal((await f.request(`/items/${item}/claim`,'POST',{})).status,403);});
test('ordinary delisting preserves licensed hubs while dangerous disablement forces fallback',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});assert.equal((await f.request(`/admin/items/${item}`,'POST',{action:'delist',reason:'catalog change'},admin)).status,200);assert.ok((await f.request('/hubs/root/theme')).body.binding);await f.request(`/admin/items/${item}`,'POST',{action:'disable',reason:'malware'},admin);assert.equal((await f.request('/hubs/root/theme')).body.binding,null);assert.equal((await f.request(`/versions/${version}/download`)).status,403);});
test('creator enrollment, reports, appeals and moderation require owned records',async t=>{const f=await fixture(t);assert.equal((await f.request('/creators/enroll','POST',{displayName:'Other',rightsAccepted:true},other)).status,201);const report=await f.request('/reports','POST',{itemId:item,reason:'Copied artwork'},other);assert.equal(report.status,201);assert.equal((await f.request(`/admin/items/${item}`,'POST',{action:'disable',reason:'test'},other)).status,403);assert.equal((await f.request(`/items/${item}/appeals`,'POST',{reason:'I hold rights'},other)).status,403);assert.equal((await f.request(`/items/${item}/appeals`,'POST',{reason:'I hold rights'})).status,201);assert.ok(f.db.prepare('SELECT count(*) AS n FROM marketplace_audit').first().n>=2);});
test('missing hub authority fails closed and client supplied permission cannot sponsor',async t=>{const f=await fixture(t);await f.claim();delete f.env.MARKETPLACE_HUBS;assert.equal((await f.request(`/items/${item}/grants`,'POST',{hubId:'root',member:true,canManage:true,rootHubId:'spoof'})).status,503);});
test('manager authority loss does not withdraw an existing sponsorship',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});f.permissions.set(`${account}:root`,{rootHubId:'root',member:true,canManage:false});assert.ok((await f.request('/hubs/root/theme')).body.binding);assert.equal((await f.request('/hubs/root/theme','DELETE')).status,403);});
test('grace occupies slots and withdrawal permits an immediate replacement',async t=>{const f=await fixture(t);await f.claim();for(let i=0;i<5;i++)await f.sponsor(`root-${i}`);f.db.prepare("UPDATE marketplace_grants SET status='grace',grace_until=? WHERE hub_id='root-0'").bind(Date.now()+86400000).run();assert.equal((await f.sponsor('sixth')).status,409);const grant=f.db.prepare("SELECT id FROM marketplace_grants WHERE hub_id='root-0'").first();await f.request(`/grants/${grant.id}`,'DELETE');assert.equal((await f.sponsor('sixth')).status,201);});
test('hub downloads require active binding and server confirmed membership',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');f.permissions.set(`${other}:root`,{rootHubId:'root',member:true,canManage:false});assert.equal((await f.request(`/versions/${version}/download?hubId=root`,'GET',undefined,other)).status,403);await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});assert.equal((await f.request(`/versions/${version}/download?hubId=root`,'GET',undefined,other)).status,200);f.permissions.set(`${other}:root`,{rootHubId:'root',member:false,canManage:false});assert.equal((await f.request(`/versions/${version}/download?hubId=root`,'GET',undefined,other)).status,403);});
test('submitted packages require rights, shared validation and review; versions are immutable',async t=>{const f=await fixture(t);const pkg=structuredClone(globalThis.VumiroCommunityThemes.builtins[0]);pkg.version='2.0.0';const rights={ownsOrLicensed:true,permitsRedistribution:true,declaration:'All artwork is owned or licensed for redistribution.'};assert.equal((await f.request(`/items/${item}/versions`,'POST',{package:pkg})).status,400);assert.equal((await f.request(`/items/${item}/versions`,'POST',{package:{...pkg,css:'body{display:none}'},rights})).status,400);const submitted=await f.request(`/items/${item}/versions`,'POST',{package:pkg,rights});assert.equal(submitted.status,201);const id=submitted.body.version.id;assert.equal((await f.request(`/versions/${id}/download`)).status,403);assert.equal((await f.request(`/admin/versions/${id}`,'POST',{action:'approve',reason:'Rights and package verified'},admin)).status,200);await f.claim();assert.equal((await f.request(`/versions/${id}/download`)).status,200);assert.throws(()=>f.db.prepare('UPDATE marketplace_versions SET digest=? WHERE id=?').bind('b'.repeat(64),id).run(),/immutable-version/);assert.equal((await f.request(`/items/${item}/versions`,'POST',{package:pkg,rights})).status,409);});
test('SQL itself rejects a sixth sponsorship independent of HTTP prechecks',async t=>{const f=await fixture(t);await f.claim();for(let i=0;i<5;i++)await f.sponsor(`root-${i}`);const now=Date.now();assert.throws(()=>f.db.prepare("INSERT INTO marketplace_grants(id,account_id,item_id,hub_id,status,created_at,updated_at) VALUES(?,?,?,?,'active',?,?)").bind(crypto.randomUUID(),account,item,'sixth',now,now).run(),/marketplace-slot-limit/);});
test('duplicate membership sequence cannot override a rejoin with removal',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');const e={rootHubId:'root',accountId:account,occurredAt:Date.now()};await f.request('/internal/events','POST',{...e,eventId:'one',sequence:1,member:false},account,true);await f.request('/internal/events','POST',{...e,eventId:'two',sequence:2,member:true},account,true);await f.request('/internal/events','POST',{...e,eventId:'conflicting-two',sequence:2,member:false},account,true);assert.equal(f.db.prepare('SELECT status FROM marketplace_grants').first().status,'active');});
test('scoped bindings share root sponsorship, preserve fallback configuration and support undo',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');f.permissions.set(`${account}:text-node`,{rootHubId:'root',member:true,canManage:true});assert.equal((await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version,scopeId:'text-node',scopeKind:'text',overrides:{tokens:{'accent':'#112233'}}})).status,200);const first=(await f.request('/hubs/root/theme?scopeId=text-node')).body.configuration;assert.equal(first.scope_id,'text-node');assert.equal((await f.request('/hubs/root/theme')).body.binding,null);await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version,scopeId:'text-node',scopeKind:'text',overrides:{tokens:{'accent':'#334455'}}});assert.equal((await f.request('/hubs/root/theme/undo','POST',{scopeId:'text-node'})).status,200);assert.equal((await f.request('/hubs/root/theme?scopeId=text-node')).body.configuration.overrides_json,first.overrides_json);f.db.prepare("UPDATE marketplace_grants SET status='withdrawn'").run();const fallback=(await f.request('/hubs/root/theme?scopeId=text-node')).body;assert.equal(fallback.binding,null);assert.equal(fallback.configuration.scope_id,'text-node');assert.equal(f.db.prepare('SELECT count(*) AS n FROM marketplace_grants').first().n,1);});
test('scope permissions are checked on target and unsafe overrides use the shared validator',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');f.permissions.set(`${account}:voice-node`,{rootHubId:'root',member:true,canManage:false});assert.equal((await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version,scopeId:'voice-node',scopeKind:'voice'})).status,403);assert.equal((await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version,overrides:{css:'body{display:none}'}})).status,400);});
test('preview uses shared approved package without granting acquisition or sponsorship',async t=>{const f=await fixture(t);f.db.prepare('UPDATE marketplace_listings SET price_minor=100 WHERE id=?').bind(item).run();const preview=await f.request(`/versions/${version}/preview`,'GET',undefined,other);assert.equal(preview.status,200);assert.equal(preview.body.previewOnly,true);assert.equal(preview.body.package.format,'vumirotheme');assert.equal((await f.request(`/versions/${version}/download`,'GET',undefined,other)).status,403);assert.equal((await f.sponsor('root',other)).status,403);});
test('missed removal reconciles durably before binding reads and failed reconciliation closes access',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});f.events.push({eventId:'missed-event',sequence:1,rootHubId:'root',accountId:account,member:false,occurredAt:Date.now()-86400001});assert.equal((await f.request('/hubs/root/theme')).body.binding,null);assert.equal(f.db.prepare('SELECT cursor FROM marketplace_reconciliation').first().cursor,'1');f.env.MARKETPLACE_HUBS.fetch=async()=>new Response(null,{status:503});assert.equal((await f.request('/hubs/root/theme')).status,503);});
test('library includes metadata for delisted owned items',async t=>{const f=await fixture(t);await f.claim();f.db.prepare("UPDATE marketplace_listings SET status='delisted' WHERE id=?").bind(item).run();const library=await f.request('/library');assert.equal(library.body.items[0].id,item);assert.equal(library.body.versions[0].id,version);});
test('admin metrics expose aggregates and publication lead time, without identities',async t=>{const f=await fixture(t);await f.request(`/versions/${version}/preview`);await f.claim();await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});assert.equal((await f.request('/admin/metrics')).status,403);const r=await f.request('/admin/metrics','GET',undefined,admin);assert.equal(r.status,200);assert.equal(r.body.metrics.find(m=>m.event==='acquisition').count,1);assert.equal(r.body.metrics.find(m=>m.event==='preview').count,1);assert.ok(!JSON.stringify(r.body).includes(account));assert.ok(Array.isArray(r.body.publicationLeadTime));});
test('moderators can inspect submitted packages without making them public',async t=>{const f=await fixture(t);f.db.prepare("UPDATE marketplace_versions SET status='submitted' WHERE id=?").bind(version).run();assert.equal((await f.request(`/admin/versions/${version}/package`)).status,403);assert.equal((await f.request(`/admin/versions/${version}/package`,'GET',undefined,admin)).status,200);assert.equal((await f.request(`/versions/${version}/preview`,'GET',undefined,other)).status,404);});
test('reset can be undone without losing a scoped binding',async t=>{const f=await fixture(t);await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});await f.request('/hubs/root/theme','DELETE');assert.equal((await f.request('/hubs/root/theme')).body.binding,null);assert.equal((await f.request('/hubs/root/theme/undo','POST',{})).status,200);assert.equal((await f.request('/hubs/root/theme')).body.binding.version_id,version);});
test('creator metadata revision is immutable and requires review before changing live listing',async t=>{const f=await fixture(t);const revision=await f.request(`/items/${item}/revisions`,'POST',{title:'Revised title',description:'Reviewed description',priceMinor:0,currency:'BRL'});assert.equal(revision.status,201);assert.equal(f.db.prepare('SELECT title FROM marketplace_listings WHERE id=?').bind(item).first().title,'Theme');assert.equal((await f.request(`/admin/revisions/${revision.body.revision.id}`,'POST',{action:'approve',reason:'Metadata checked'},admin)).status,200);assert.equal(f.db.prepare('SELECT title FROM marketplace_listings WHERE id=?').bind(item).first().title,'Revised title');assert.equal((await f.request(`/items/${item}/revisions`,'POST',{title:'No',description:'No rights',priceMinor:0,currency:'BRL'},other)).status,404);});
test('immutable digest blocks overwritten valid private objects from preview and download',async t=>{const f=await fixture(t);await f.claim();const changed=structuredClone(globalThis.VumiroCommunityThemes.builtins[0]);changed.name='Changed after review';f.env.MARKETPLACE_ASSETS.get=async()=>({body:JSON.stringify(changed)});assert.equal((await f.request(`/versions/${version}/preview`)).status,503);assert.equal((await f.request(`/versions/${version}/download`)).status,503);});
for(const cleanup of [false,true])test(`delayed rejoin uses source time and restores sponsorship${cleanup?' after expiration cleanup':''}`,async t=>{
  const f=await fixture(t);await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});
  const time=Date.now(),event={rootHubId:'root',accountId:account};
  assert.equal((await f.request('/internal/events','POST',{...event,eventId:'old-removal',sequence:1,member:false,occurredAt:time-25*3600000},account,true)).status,200);
  if(cleanup)await module.runMarketplaceMaintenance(f.env);
  assert.equal((await f.request('/internal/events','POST',{...event,eventId:'delayed-rejoin',sequence:2,member:true,occurredAt:time-2*3600000},account,true)).status,200);
  assert.equal(f.db.prepare('SELECT status FROM marketplace_grants').first().status,'active');
  assert.ok((await f.request('/hubs/root/theme')).body.binding);
});
test('delayed rejoin never reverses voluntary withdrawal or rejoin after the source deadline',async t=>{
  const f=await fixture(t);await f.claim();const grant=await f.sponsor('root');const time=Date.now(),event={rootHubId:'root',accountId:account};
  await f.request('/internal/events','POST',{...event,eventId:'removed',sequence:1,member:false,occurredAt:time-25*3600000},account,true);
  await module.runMarketplaceMaintenance(f.env);
  await f.request(`/grants/${grant.body.grant.id}`,'DELETE');
  await f.request('/internal/events','POST',{...event,eventId:'returned-in-grace',sequence:2,member:true,occurredAt:time-2*3600000},account,true);
  assert.equal(f.db.prepare('SELECT status FROM marketplace_grants').first().status,'withdrawn');
  const second=await f.sponsor('second');await f.request('/internal/events','POST',{...event,rootHubId:'second',eventId:'second-removed',sequence:1,member:false,occurredAt:time-25*3600000},account,true);
  await module.runMarketplaceMaintenance(f.env);
  await f.request('/internal/events','POST',{...event,rootHubId:'second',eventId:'returned-too-late',sequence:2,member:true,occurredAt:time-30*60000},account,true);
  assert.notEqual(f.db.prepare('SELECT status FROM marketplace_grants WHERE id=?').bind(second.body.grant.id).first().status,'active');
});
test('historical rejoin cannot create a sixth slot and unresolved source correction fails closed',async t=>{
  const f=await fixture(t);await f.claim();await f.sponsor('root');await f.request('/hubs/root/theme','PUT',{itemId:item,versionId:version});const time=Date.now(),event={rootHubId:'root',accountId:account};
  await f.request('/internal/events','POST',{...event,eventId:'removed-before-cleanup',sequence:1,member:false,occurredAt:time-25*3600000},account,true);await module.runMarketplaceMaintenance(f.env);
  for(let i=0;i<5;i++)assert.equal((await f.sponsor(`replacement-${i}`)).status,201);
  f.events.push({...event,eventId:'source-correction',sequence:2,member:true,occurredAt:time-2*3600000});
  assert.equal((await f.request('/hubs/root/theme')).status,503);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM marketplace_grants WHERE status='active'").first().n,5);
  assert.equal(f.db.prepare("SELECT event_id FROM marketplace_membership_events WHERE event_id='source-correction'").first(),null);
});
test('remote decorative catalog capabilities derive from immutable validated package before acquisition',async t=>{
  const f=await fixture(t),created=await f.request('/items','POST',{title:'Badge details',description:'Original decorative badge and banner artwork',priceMinor:0,currency:'BRL',aesthetic:'organic'});assert.equal(created.status,201);const id=created.body.item.id;
  const pkg={...structuredClone(globalThis.VumiroCommunityThemes.builtins[0]),id:'badge-details',name:'Badge details',kind:'decorative-pack',tokens:{},layouts:{},components:{banner:{borderColor:'#123456'}},css:'[data-community-slot="badge"] { color:#abcdef }'};
  const submitted=await f.request(`/items/${id}/versions`,'POST',{package:pkg,rights:{ownsOrLicensed:true,permitsRedistribution:true,declaration:'I own the artwork and permit licensed redistribution.'}});assert.equal(submitted.status,201);const vid=submitted.body.version.id;
  assert.equal((await f.request(`/admin/versions/${vid}`,'POST',{action:'approve',reason:'Metadata and artwork verified'},admin)).status,200);
  const listing=(await f.request('/catalog','GET',undefined,other)).body.items.find(value=>value.id===id);
  assert.equal(listing.kind,'decorative-pack');assert.equal(listing.aesthetic,'organic');assert.deepEqual(listing.summary,{kind:'decorative-pack',engine:1,slots:['badge','banner'],scopes:['hub','space','text','voice']});assert.deepEqual(listing.compatibility,{engine:1});
  assert.equal((await f.request('/library','GET',undefined,other)).body.entitlements.length,0);
  assert.deepEqual((await f.request(`/items/${id}`,'GET',undefined,other)).body.item.summary,listing.summary);
  await f.request(`/items/${id}/claim`,'POST',{},other);assert.deepEqual((await f.request('/library','GET',undefined,other)).body.items.find(value=>value.id===id).summary,listing.summary);
  assert.throws(()=>f.db.prepare('UPDATE marketplace_versions SET summary_json=? WHERE id=?').bind('{}',vid).run(),/immutable-version/);
  const revision=await f.request(`/items/${id}/revisions`,'POST',{title:'Badge details',description:'Original decorative badge and banner artwork',priceMinor:0,currency:'BRL',aesthetic:'minimal'});assert.equal(revision.status,201);
  assert.equal((await f.request('/catalog')).body.items.find(value=>value.id===id).aesthetic,'organic');await f.request(`/admin/revisions/${revision.body.revision.id}`,'POST',{action:'approve',reason:'Aesthetic label reviewed'},admin);assert.equal((await f.request('/catalog')).body.items.find(value=>value.id===id).aesthetic,'minimal');
});
