// Current server authority for account-bound profile decoration. Display access
// deliberately grants neither acquisition nor shared community sponsorship.
const KINDS=['profile-card','avatar-frame','profile-effect'];
const PEER=/^[A-Za-z0-9_-]{43}$/;
const ID=/^[A-Za-z0-9_-]{1,160}$/;
const NOTICE='Authorized for profile display only. Display access does not grant ownership, installation, sponsorship, redistribution, or resale rights; the creator license still applies.';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const first=(db,sql,...values)=>statement(db,sql,...values).first();
const all=async(db,sql,...values)=>(await statement(db,sql,...values).all()).results;
const blank=()=>Object.fromEntries(KINDS.map(kind=>[kind,null]));
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decode(value,max){
  if(typeof value!=='string'||!value.length||value.length>max||!/^[A-Za-z0-9_-]+$/.test(value))fail(400,'invalid-identity-proof');
  let bytes;try{bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}catch{fail(400,'invalid-identity-proof');}
  if(encode(bytes)!==value)fail(400,'invalid-identity-proof');return bytes;
}
async function input(request,readBody){
  if(Number(request.headers.get('Content-Length')||0)>4096)fail(413,'body-too-large');
  // The common reader bounds streamed input before this tighter personal limit.
  const value=await readBody(request);if(JSON.stringify(value).length>4096)fail(413,'body-too-large');return value;
}
async function identityKey(peerId,key){
  if(!PEER.test(peerId||''))fail(400,'invalid-peer-identity');
  const bytes=decode(key,256);if(encode(await crypto.subtle.digest('SHA-256',bytes))!==peerId)fail(400,'identity-key-mismatch');
  try{return await crypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);}catch{fail(400,'invalid-peer-key');}
}
async function challenge(request,db,accountId,now,readBody){
  const value=await input(request,readBody);await identityKey(value.peerId,value.key);
  const challengeId=crypto.randomUUID(),expires=now+60000,nonce=encode(crypto.getRandomValues(new Uint8Array(32)));
  const text=JSON.stringify(['vumiro-profile-cosmetics-v1',accountId,value.peerId,value.key,nonce,expires]);
  // Prune expired receipts and cap all issues per minute in SQL so completing
  // proofs cannot bypass the bound and parallel issue requests remain bounded.
  const result=await db.batch([
    statement(db,'DELETE FROM marketplace_profile_challenges WHERE expires_at<=?',now),
    statement(db,`INSERT INTO marketplace_profile_challenges(id,account_id,peer_id,public_key,challenge_text,created_at,expires_at)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM marketplace_profile_challenges WHERE account_id=? AND expires_at>?)<8`,challengeId,accountId,value.peerId,value.key,text,now,expires,accountId,now)
  ]);
  if(!result[1].meta.changes)fail(429,'identity-challenge-limit');return json({challengeId,text,expires},201);
}
async function verify(request,db,accountId,now,readBody){
  const value=await input(request,readBody);if(!ID.test(value.challengeId||''))fail(400,'invalid-identity-proof');
  const signature=decode(value.signature,128);if(signature.length!==64)fail(400,'invalid-identity-proof');
  const saved=await first(db,'SELECT * FROM marketplace_profile_challenges WHERE id=?',value.challengeId);
  if(!saved)fail(409,'identity-challenge-unavailable');if(saved.account_id!==accountId)fail(403,'identity-account-mismatch');
  if(saved.used_token||saved.expires_at<=now||saved.created_at>now||saved.expires_at-saved.created_at>60000)fail(409,'identity-challenge-unavailable');
  const key=await identityKey(saved.peer_id,saved.public_key);
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,new TextEncoder().encode(saved.challenge_text)))fail(403,'identity-signature-invalid');
  const token=crypto.randomUUID(),finished=Date.now();
  // The random claim token is checked by the insert in the same transaction.
  // A second verifier, even in the same millisecond, cannot reuse a receipt.
  const result=await db.batch([
    statement(db,'UPDATE marketplace_profile_challenges SET used_token=? WHERE id=? AND account_id=? AND used_token IS NULL AND expires_at>? AND created_at<=? AND expires_at-created_at<=60000',token,saved.id,accountId,finished,finished),
    statement(db,`INSERT OR IGNORE INTO marketplace_profile_identities(peer_id,account_id,public_key,linked_at)
      SELECT peer_id,account_id,public_key,? FROM marketplace_profile_challenges WHERE id=? AND account_id=? AND used_token=?`,finished,saved.id,accountId,token)
  ]);
  if(!result[0].meta.changes)fail(409,'identity-challenge-unavailable');
  const linked=await first(db,'SELECT account_id FROM marketplace_profile_identities WHERE peer_id=?',saved.peer_id);
  if(linked?.account_id!==accountId)fail(409,'identity-already-linked');return json({linked:true,peerId:saved.peer_id});
}
async function appearance(env,db,accountId,storedPackage,privateView=false){
  const result={appearance:blank(),...(privateView?{configuration:blank()}:{}),licenseNotice:NOTICE};
  if(!accountId)return result;
  if(privateView){
    const configured=await all(db,'SELECT kind,item_id,version_id,updated_at FROM marketplace_profile_bindings WHERE account_id=? AND item_id IS NOT NULL LIMIT 3',accountId);
    for(const row of configured)if(KINDS.includes(row.kind))result.configuration[row.kind]={itemId:row.item_id,versionId:row.version_id,updatedAt:row.updated_at};
  }
  const active=await all(db,`SELECT b.kind,b.item_id,b.version_id,v.asset_key,v.digest FROM marketplace_profile_bindings b
    JOIN marketplace_listings l ON l.id=b.item_id JOIN marketplace_versions v ON v.id=b.version_id AND v.item_id=b.item_id
    JOIN marketplace_entitlements e ON e.account_id=b.account_id AND e.item_id=b.item_id
    WHERE b.account_id=? AND e.status='active' AND l.status<>'disabled' AND v.status='approved' LIMIT 3`,accountId);
  for(const row of active){
    if(!KINDS.includes(row.kind))continue;
    try{
      const pkg=await storedPackage(env,row);if(pkg.kind!==row.kind)continue;
      // Object storage is asynchronous: recheck current authority after loading
      // the package, including any concurrent reset, revocation or moderation.
      if(!await first(db,`SELECT 1 FROM marketplace_profile_bindings b JOIN marketplace_entitlements e ON e.account_id=b.account_id AND e.item_id=b.item_id
        JOIN marketplace_listings l ON l.id=b.item_id JOIN marketplace_versions v ON v.id=b.version_id AND v.item_id=b.item_id
        WHERE b.account_id=? AND b.kind=? AND b.item_id=? AND b.version_id=? AND e.status='active' AND l.status<>'disabled' AND v.status='approved'`,accountId,row.kind,row.item_id,row.version_id))continue;
      result.appearance[row.kind]={kind:row.kind,itemId:row.item_id,versionId:row.version_id,digest:row.digest,package:pkg};
    }catch{/* Missing, invalid or tampered packages fall back independently. */}
  }
  return result;
}
export async function handleMarketplacePersonalRequest(request,env,{path,method,accountId,now,body,storedPackage}){
  const db=env.MARKETPLACE_DB;
  if(path.startsWith('/profiles/')){
    const match=/^\/profiles\/([A-Za-z0-9_-]{43})\/appearance$/.exec(path);
    if(!match||method!=='GET')return json({error:'route-not-found'},404);
    const link=await first(db,'SELECT account_id FROM marketplace_profile_identities WHERE peer_id=?',match[1]);
    return json(await appearance(env,db,link?.account_id,storedPackage));
  }
  if(path==='/profile/identity/challenge'&&method==='POST')return challenge(request,db,accountId,now,body);
  if(path==='/profile/identity/verify'&&method==='POST')return verify(request,db,accountId,now,body);
  if(path==='/profile/appearance'&&method==='GET')return json(await appearance(env,db,accountId,storedPackage,true));
  const match=/^\/profile\/appearance\/(profile-card|avatar-frame|profile-effect)(\/undo)?$/.exec(path);
  if(match){
    const kind=match[1],resolved=async()=>json(await appearance(env,db,accountId,storedPackage,true));
    if(method==='PUT'&&!match[2]){
      const value=await input(request,body);if(!ID.test(value.itemId||'')||!ID.test(value.versionId||''))fail(400,'invalid-personal-binding');
      const version=await first(db,`SELECT v.asset_key,v.digest FROM marketplace_versions v JOIN marketplace_listings l ON l.id=v.item_id
        JOIN marketplace_entitlements e ON e.item_id=v.item_id AND e.account_id=?
        WHERE v.id=? AND v.item_id=? AND v.status='approved' AND l.status<>'disabled' AND e.status='active'`,accountId,value.versionId,value.itemId);
      if(!version)fail(403,'personal-entitlement-required');
      const pkg=await storedPackage(env,version);if(pkg.kind!==kind)fail(400,'personal-kind-mismatch');
      const applied=await statement(db,`INSERT INTO marketplace_profile_bindings(account_id,kind,item_id,version_id,previous_json,updated_at)
        SELECT ?,?,v.item_id,v.id,json_object('itemId',NULL,'versionId',NULL),? FROM marketplace_versions v
        JOIN marketplace_listings l ON l.id=v.item_id JOIN marketplace_entitlements e ON e.item_id=v.item_id AND e.account_id=?
        WHERE v.id=? AND v.item_id=? AND v.status='approved' AND l.status<>'disabled' AND e.status='active'
        ON CONFLICT(account_id,kind) DO UPDATE SET previous_json=json_object('itemId',marketplace_profile_bindings.item_id,'versionId',marketplace_profile_bindings.version_id),
        item_id=excluded.item_id,version_id=excluded.version_id,updated_at=excluded.updated_at`,accountId,kind,now,accountId,value.versionId,value.itemId).run();
      if(!applied.meta.changes)fail(403,'personal-entitlement-required');return resolved();
    }
    if(method==='DELETE'&&!match[2]){
      await statement(db,`UPDATE marketplace_profile_bindings SET previous_json=json_object('itemId',item_id,'versionId',version_id),item_id=NULL,version_id=NULL,updated_at=?
        WHERE account_id=? AND kind=? AND item_id IS NOT NULL`,now,accountId,kind).run();return resolved();
    }
    if(method==='POST'&&match[2]){
      await input(request,body);
      const changed=await statement(db,`UPDATE marketplace_profile_bindings SET
        item_id=json_extract(previous_json,'$.itemId'),version_id=json_extract(previous_json,'$.versionId'),
        previous_json=json_object('itemId',item_id,'versionId',version_id),updated_at=?
        WHERE account_id=? AND kind=? AND previous_json IS NOT NULL`,now,accountId,kind).run();
      if(!changed.meta.changes)fail(409,'no-previous-personal-binding');return resolved();
    }
  }
  return null;
}
