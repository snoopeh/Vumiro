import { authenticate } from './accounts.js';
import { validateMarketplacePackage, validateMarketplaceOverrides, digestPackage, kindScopes } from './marketplace-package.js';
import { recordMarketplaceMetric, readMarketplaceMetrics } from './marketplace-metrics.js';
import { handleMarketplacePersonalRequest } from './marketplace-personal.js';

const PREFIX = '/api/v1/marketplace';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GRACE_MS = 86400000;
const MAX_BODY = 2*1024*1024+16384;
const PERSONAL_KINDS = new Set(['profile-card','avatar-frame','profile-effect']);
const json = (body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail = (status,code)=>{throw Object.assign(new Error(code),{status,code});};
const text = (v,min,max)=>typeof v==='string' && v.length>=min && v.length<=max && v===v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const first=(db,sql,...values)=>statement(db,sql,...values).first();
const all=async(db,sql,...values)=>(await statement(db,sql,...values).all()).results;
function withCapabilities(row){
  if(!row)return row;const {summary_json,...value}=row;
  const summary=JSON.parse(summary_json||'{}');
  return summary.kind?{...value,summary,kind:summary.kind,slots:summary.slots,scopes:summary.scopes,compatibility:{engine:summary.engine}}:value;
}
const capabilityRows=async(db,sql,...values)=>(await all(db,sql,...values)).map(withCapabilities);
function packageCapabilities(pkg){
  // The shared validator has already restricted every selector to an engine slot.
  const slots=new Set(Object.keys(pkg.components));
  for(const match of pkg.css.matchAll(/\[data-community-slot="([a-z-]+)"\]/g))slots.add(match[1]);
  return {kind:pkg.kind||'theme',engine:pkg.compatibility.engine,slots:[...slots].sort(),scopes:kindScopes(pkg.kind)};
}
const aesthetic=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(value);
const audit=(db,actor,action,target,detail={},now=Date.now())=>statement(db,'INSERT INTO marketplace_audit(id,actor_id,action,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?)',crypto.randomUUID(),actor,action,target,JSON.stringify(detail),now);
async function metric(db,event,itemId){try{await recordMarketplaceMetric(db,event,itemId);}catch{/* Aggregates must never change licensing or payment outcomes. */}}
async function body(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||'')) fail(415,'json-required');
  if (Number(request.headers.get('Content-Length')||0)>MAX_BODY) fail(413,'body-too-large');
  const reader=request.body?.getReader(); if(!reader) return {};
  let size=0;const chunks=[];
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BODY){await reader.cancel();fail(413,'body-too-large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try {const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid-json');return value;}catch(error){if(error.status)throw error;fail(400,'invalid-json');}
}
async function storedPackage(env,version){
  const asset=await env.MARKETPLACE_ASSETS?.get(version.asset_key);if(!asset)fail(503,'package-storage-unavailable');let pkg;
  try{pkg=await body(new Response(asset.body,{headers:{'Content-Type':'application/json'}}));}catch{fail(503,'invalid-stored-package');}
  const checked=validateMarketplacePackage(pkg);if(!checked.valid)fail(503,'invalid-stored-package');
  if(await digestPackage(checked.package)!==version.digest)fail(503,'package-integrity-failed');return checked.package;
}
function adminAccount(env,id){return String(env.MARKETPLACE_ADMIN_ACCOUNTS||'').split(',').map(v=>v.trim()).includes(id);}
async function internal(request,env) {
  const secret=env.MARKETPLACE_INTERNAL_SECRET;
  if(typeof secret!=='string'||secret.length<32) return false;
  const supplied=request.headers.get('Authorization')||'';
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(supplied)),crypto.subtle.digest('SHA-256',encoder.encode(`Bearer ${secret}`))]);
  const x=new Uint8Array(a),y=new Uint8Array(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
async function authority(env,accountId,hubId,scopeId=hubId,scopeKind='hub') {
  if(!ID.test(hubId||''))fail(400,'invalid-hub');
  if(!ID.test(scopeId||'')||!['hub','space','text','voice'].includes(scopeKind))fail(400,'invalid-scope');
  if(!env.MARKETPLACE_HUBS||typeof env.MARKETPLACE_INTERNAL_SECRET!=='string'||env.MARKETPLACE_INTERNAL_SECRET.length<32)fail(503,'hub-authority-unavailable');
  let response;
  try{response=await env.MARKETPLACE_HUBS.fetch(new Request('https://hub-authority.internal/internal/marketplace/authorize',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.MARKETPLACE_INTERNAL_SECRET}`},body:JSON.stringify({accountId,hubId,scopeId,scopeKind})}));}catch{fail(503,'hub-authority-unavailable');}
  if(!response.ok)fail(response.status===403?403:503,'hub-authority-unavailable');
  let result;try{result=await response.json();}catch{fail(503,'invalid-hub-authority');}
  if(!ID.test(result?.rootHubId||'')||typeof result.member!=='boolean'||typeof result.canManage!=='boolean')fail(503,'invalid-hub-authority');
  if(!result.member)fail(403,'hub-membership-required');
  return result;
}
async function activeBinding(db,rootHubId,now,scopeId=rootHubId) {
  now=Math.max(now,Date.now());
  return first(db,`SELECT b.* FROM marketplace_theme_bindings b JOIN marketplace_listings l ON l.id=b.item_id JOIN marketplace_versions v ON v.id=b.version_id
    WHERE b.hub_id=? AND b.scope_id=? AND l.status<>'disabled' AND v.status='approved' AND v.item_id=b.item_id AND COALESCE(json_extract(v.summary_json,'$.kind'),'theme') NOT IN ('profile-card','avatar-frame','profile-effect') AND EXISTS (
      SELECT 1 FROM marketplace_grants g JOIN marketplace_entitlements e ON e.account_id=g.account_id AND e.item_id=g.item_id
      WHERE g.hub_id=b.hub_id AND g.item_id=b.item_id AND e.status='active' AND (g.status='active' OR(g.status='grace' AND g.grace_until>?)))`,rootHubId,scopeId,now);
}
export async function revokeMarketplaceEntitlement(db,entitlementId,reason,now=Date.now()) {
  await db.batch([
    statement(db,"UPDATE marketplace_grants SET status='revoked',grace_until=NULL,updated_at=? WHERE (account_id,item_id) IN (SELECT account_id,item_id FROM marketplace_entitlements WHERE id=?)",now,entitlementId),
    statement(db,"UPDATE marketplace_entitlements SET status='revoked',revoked_at=? WHERE id=?",now,entitlementId),
    audit(db,'system','entitlement.revoked',entitlementId,{reason},now)
  ]);
}
async function membershipEvent(request,env,db,now) {
  if(!await internal(request,env))fail(401,'internal-auth-required');
  const event=await body(request);
  if(!ID.test(event.eventId||'')||!ID.test(event.rootHubId||'')||!UUID.test(event.accountId||'')||!Number.isSafeInteger(event.sequence)||event.sequence<1||typeof event.member!=='boolean'||!Number.isSafeInteger(event.occurredAt)||event.occurredAt<0||event.occurredAt>now+60000)fail(400,'invalid-membership-event');
  // Event receipt, ordered state transition and audit run in one D1 transaction.
  const accepted=`EXISTS(SELECT 1 FROM marketplace_membership_events WHERE event_id=? AND received_at=?) AND NOT EXISTS(SELECT 1 FROM marketplace_membership_events WHERE root_hub_id=? AND account_id=? AND sequence>?)`;
  const args=[event.eventId,now,event.rootHubId,event.accountId,event.sequence];
  const until=event.occurredAt+GRACE_MS;
  // Source time determines whether a rejoin canceled grace, even if delivery or
  // cleanup ran later. Explicit withdrawals and refund revocations never revive.
  // The slot-update trigger still rejects a correction that would exceed five;
  // its transaction rolls back the receipt so durable reconciliation cannot
  // advance past that unresolved event or authorize a stale licensing snapshot.
  const update=event.member
    ? statement(db,`UPDATE marketplace_grants SET status='active',grace_until=NULL,updated_at=? WHERE hub_id=? AND account_id=? AND status IN ('grace','expired') AND grace_until>? AND grace_until-?<=? AND EXISTS(SELECT 1 FROM marketplace_entitlements e WHERE e.account_id=marketplace_grants.account_id AND e.item_id=marketplace_grants.item_id AND e.status='active') AND ${accepted}`,now,event.rootHubId,event.accountId,event.occurredAt,GRACE_MS,event.occurredAt,...args)
    : statement(db,`UPDATE marketplace_grants SET status='grace',grace_until=?,updated_at=? WHERE hub_id=? AND account_id=? AND status='active' AND ${accepted}`,until,now,event.rootHubId,event.accountId,...args);
  // receipt ID deduplicates replay; stale sequence receipts do not mutate grants.
  const old=await first(db,'SELECT event_id FROM marketplace_membership_events WHERE event_id=?',event.eventId);
  if(old)return json({accepted:true});
  await db.batch([
    statement(db,'INSERT OR IGNORE INTO marketplace_membership_events(event_id,root_hub_id,account_id,sequence,member,occurred_at,received_at) VALUES(?,?,?,?,?,?,?)',event.eventId,event.rootHubId,event.accountId,event.sequence,event.member?1:0,event.occurredAt,now),update,
    audit(db,'hub-service','membership.event',event.rootHubId,{eventId:event.eventId,sequence:event.sequence,member:event.member},now)
  ]);
  return json({accepted:true});
}
async function reconcileMembershipEvents(env,db) {
  if(!env.MARKETPLACE_HUBS||typeof env.MARKETPLACE_INTERNAL_SECRET!=='string'||env.MARKETPLACE_INTERNAL_SECRET.length<32)fail(503,'hub-reconciliation-unavailable');
  // Pull durable source events through a confirmed source high-watermark before licensing.
  // Receipt deduplication makes replay after a failed cursor advance safe.
  for(let page=0;page<8;page++){
    const current=await first(db,'SELECT cursor FROM marketplace_reconciliation WHERE id=1');
    const cursor=current?.cursor||'';
    let response,feed;
    try{response=await env.MARKETPLACE_HUBS.fetch(new Request(`https://hub-authority.internal/internal/marketplace/events?cursor=${encodeURIComponent(cursor)}&limit=100`,{headers:{Authorization:`Bearer ${env.MARKETPLACE_INTERNAL_SECRET}`}}));if(response.ok)feed=await response.json();}catch{fail(503,'hub-reconciliation-unavailable');}
    if(!response?.ok||!feed||!Array.isArray(feed.events)||feed.events.length>100||typeof feed.cursor!=='string'||feed.cursor.length>256||typeof feed.hasMore!=='boolean'||feed.hasMore&&feed.cursor===cursor)fail(503,'hub-reconciliation-unavailable');
    for(const event of feed.events){
      try{await membershipEvent(new Request('https://marketplace.internal',{method:'POST',headers:{Authorization:`Bearer ${env.MARKETPLACE_INTERNAL_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(event)}),env,db,Date.now());}catch{fail(503,'invalid-source-membership-event');}
    }
    const advanced=await statement(db,'UPDATE marketplace_reconciliation SET cursor=?,updated_at=? WHERE id=1 AND cursor=?',feed.cursor,Date.now(),cursor).run();
    if(advanced.meta.changes&&!feed.hasMore)return;
  }
  fail(503,'hub-reconciliation-backlog');
}
async function reconcileMembership(env,db){try{await reconcileMembershipEvents(env,db);}catch(error){await metric(db,'reconciliation-failure','all');throw error;}}
export async function handleMarketplaceRequest(request,env) {
  const url=new URL(request.url);if(url.pathname!==PREFIX&&!url.pathname.startsWith(`${PREFIX}/`))return null;
  try {
    const db=env.MARKETPLACE_DB;if(!db)fail(503,'marketplace-unavailable');
    const path=url.pathname.slice(PREFIX.length)||'/',method=request.method,now=Date.now();
    if(path==='/internal/events'&&method==='POST')return await membershipEvent(request,env,db,now);
    if(path.startsWith('/profiles/'))return await handleMarketplacePersonalRequest(request,env,{path,method,now,body,storedPackage});
    const user=await authenticate(request,env);if(!user)fail(401,'account-auth-required');const accountId=user.id;
    if(path.startsWith('/profile/')){const personal=await handleMarketplacePersonalRequest(request,env,{path,method,accountId,now,body,storedPackage});if(personal)return personal;}
    if(path==='/catalog'&&method==='GET')return json({items:await capabilityRows(db,"SELECT l.id,l.creator_id,c.display_name AS creator_name,l.title,l.description,l.aesthetic,l.price_minor,l.currency,l.latest_version_id,l.updated_at,v.summary_json FROM marketplace_listings l JOIN marketplace_creators c ON c.account_id=l.creator_id LEFT JOIN marketplace_versions v ON v.id=l.latest_version_id WHERE l.status='published' ORDER BY l.updated_at DESC LIMIT 100")});
    if(path==='/library'&&method==='GET')return json({entitlements:await all(db,'SELECT * FROM marketplace_entitlements WHERE account_id=? ORDER BY created_at DESC LIMIT 500',accountId),items:await capabilityRows(db,'SELECT l.*,v.summary_json FROM marketplace_listings l JOIN marketplace_entitlements e ON e.item_id=l.id LEFT JOIN marketplace_versions v ON v.id=l.latest_version_id WHERE e.account_id=? ORDER BY e.created_at DESC LIMIT 500',accountId),versions:await capabilityRows(db,'SELECT v.id,v.item_id,v.version,v.digest,v.status,v.created_at,v.summary_json FROM marketplace_versions v JOIN marketplace_entitlements e ON e.item_id=v.item_id WHERE e.account_id=? ORDER BY v.created_at DESC LIMIT 2500',accountId),grants:await all(db,"SELECT *,CASE WHEN status='grace' AND grace_until<=? THEN 'expired' ELSE status END AS effective_status FROM marketplace_grants WHERE account_id=? ORDER BY updated_at DESC LIMIT 2500",now,accountId)});
    if(path==='/creators/enroll'&&method==='POST'){
      const input=await body(request);if(!text(input.displayName,1,64)||input.rightsAccepted!==true)fail(400,'rights-acceptance-required');
      const existing=await first(db,'SELECT * FROM marketplace_creators WHERE account_id=?',accountId);if(existing)return json({creator:existing});
      await db.batch([statement(db,'INSERT OR IGNORE INTO marketplace_creators(account_id,display_name,rights_accepted_at,created_at) VALUES(?,?,?,?)',accountId,input.displayName,now,now),audit(db,accountId,'creator.enrolled',accountId,{},now)]);
      return json({creator:await first(db,'SELECT * FROM marketplace_creators WHERE account_id=?',accountId)},201);
    }
    if(path==='/creator/items'&&method==='GET')return json({creator:await first(db,'SELECT * FROM marketplace_creators WHERE account_id=?',accountId),items:await capabilityRows(db,'SELECT l.*,v.summary_json FROM marketplace_listings l LEFT JOIN marketplace_versions v ON v.id=l.latest_version_id WHERE l.creator_id=? ORDER BY l.updated_at DESC LIMIT 500',accountId)});
    if(path==='/items'&&method==='POST'){
      if(!await first(db,'SELECT account_id FROM marketplace_creators WHERE account_id=?',accountId))fail(403,'creator-enrollment-required');
      const input=await body(request);if(!text(input.title,1,100)||!text(input.description,1,2000)||!Number.isSafeInteger(input.priceMinor??0)||(input.priceMinor??0)<0||(input.priceMinor??0)>100000000||!/^[A-Z]{3}$/.test(input.currency||'BRL'))fail(400,'invalid-listing');
      if(input.aesthetic!==undefined&&!aesthetic(input.aesthetic))fail(400,'invalid-aesthetic');
      const id=crypto.randomUUID();await db.batch([statement(db,"INSERT INTO marketplace_listings(id,creator_id,title,description,status,price_minor,currency,aesthetic,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?,?,?,?)",id,accountId,input.title,input.description,input.priceMinor||0,input.currency||'BRL',input.aesthetic||'community',now,now),audit(db,accountId,'listing.created',id,{},now)]);
      return json({item:await first(db,'SELECT * FROM marketplace_listings WHERE id=?',id)},201);
    }
    let match;
    if((match=/^\/items\/([A-Za-z0-9_-]{1,160})$/.exec(path))&&method==='GET'){
      const item=withCapabilities(await first(db,'SELECT l.*,v.summary_json FROM marketplace_listings l LEFT JOIN marketplace_versions v ON v.id=l.latest_version_id WHERE l.id=?',match[1]));if(!item||(item.status!=='published'&&item.creator_id!==accountId&&!adminAccount(env,accountId)))fail(404,'item-not-found');
      const owned=item.creator_id===accountId||adminAccount(env,accountId);
      return json({item,versions:await capabilityRows(db,`SELECT id,item_id,version,digest,status,created_at,reviewed_at,review_reason,summary_json FROM marketplace_versions WHERE item_id=? ${owned?'':"AND status='approved'"} ORDER BY created_at DESC LIMIT 100`,item.id),...(owned?{revisions:await all(db,'SELECT * FROM marketplace_listing_revisions WHERE item_id=? ORDER BY created_at DESC LIMIT 100',item.id)}:{})});
    }
    if((match=/^\/items\/([A-Za-z0-9_-]{1,160})\/revisions$/.exec(path))&&method==='POST'){
      const item=await first(db,'SELECT id,status,aesthetic FROM marketplace_listings WHERE id=? AND creator_id=?',match[1],accountId);if(!item)fail(404,'item-not-found');if(item.status==='disabled')fail(403,'item-disabled');
      const input=await body(request);if(!text(input.title,1,100)||!text(input.description,1,2000)||!Number.isSafeInteger(input.priceMinor)||input.priceMinor<0||input.priceMinor>100000000||!/^[A-Z]{3}$/.test(input.currency||''))fail(400,'invalid-listing');
      if(input.aesthetic!==undefined&&!aesthetic(input.aesthetic))fail(400,'invalid-aesthetic');
      const id=crypto.randomUUID();await db.batch([statement(db,"INSERT INTO marketplace_listing_revisions(id,item_id,creator_id,title,description,price_minor,currency,aesthetic,status,created_at) VALUES(?,?,?,?,?,?,?,?,'submitted',?)",id,item.id,accountId,input.title,input.description,input.priceMinor,input.currency,input.aesthetic||item.aesthetic,now),audit(db,accountId,'listing.revision-submitted',id,{itemId:item.id},now)]);return json({revision:await first(db,'SELECT * FROM marketplace_listing_revisions WHERE id=?',id)},201);
    }
    if((match=/^\/items\/([A-Za-z0-9_-]{1,160})\/versions$/.exec(path))&&method==='POST'){
      const item=await first(db,'SELECT * FROM marketplace_listings WHERE id=? AND creator_id=?',match[1],accountId);if(!item)fail(404,'item-not-found');if(item.status==='disabled')fail(403,'item-disabled');
      const input=await body(request),rights=input.rights;
      if(rights?.ownsOrLicensed!==true||rights.permitsRedistribution!==true||!text(rights.declaration,10,2000))fail(400,'rights-declaration-required');
      const checked=validateMarketplacePackage(input.package);if(!checked.valid) return json({error:'invalid-package',errors:checked.errors},400);
      if(!env.MARKETPLACE_ASSETS)fail(503,'asset-storage-unavailable');
      const pkg=checked.package,id=crypto.randomUUID(),digest=await digestPackage(pkg),key=`packages/${item.id}/${id}/${digest}.json`;
      const packageVersion=pkg.version || pkg.manifest?.version;if(!text(packageVersion,1,64))fail(400,'invalid-package-version');
      if(await first(db,'SELECT id FROM marketplace_versions WHERE item_id=? AND version=?',item.id,packageVersion))fail(409,'version-exists');
      await env.MARKETPLACE_ASSETS.put(key,JSON.stringify(pkg),{httpMetadata:{contentType:'application/json'}});
      await db.batch([statement(db,"INSERT INTO marketplace_versions(id,item_id,version,asset_key,digest,status,rights_json,summary_json,created_at) VALUES(?,?,?,?,?,'submitted',?,?,?)",id,item.id,packageVersion,key,digest,JSON.stringify(rights),JSON.stringify(packageCapabilities(pkg)),now),audit(db,accountId,'version.submitted',id,{itemId:item.id,digest},now)]);
      return json({version:withCapabilities(await first(db,'SELECT id,item_id,version,digest,status,created_at,summary_json FROM marketplace_versions WHERE id=?',id))},201);
    }
    if((match=/^\/items\/([A-Za-z0-9_-]{1,160})\/claim$/.exec(path))&&method==='POST'){
      const existing=await first(db,'SELECT * FROM marketplace_entitlements WHERE account_id=? AND item_id=?',accountId,match[1]);
      if(existing){if(existing.status!=='active')fail(403,'entitlement-revoked');return json({entitlement:existing});}
      const id=crypto.randomUUID();
      await db.batch([statement(db,`INSERT OR IGNORE INTO marketplace_entitlements(id,account_id,item_id,status,source,created_at) SELECT ?,?,id,'active','free',? FROM marketplace_listings WHERE id=? AND status='published' AND price_minor=0 AND EXISTS(SELECT 1 FROM marketplace_versions WHERE id=latest_version_id AND status='approved')`,id,accountId,now,match[1]),audit(db,accountId,'entitlement.claim-attempt',match[1],{},now)]);
      const entitlement=await first(db,'SELECT * FROM marketplace_entitlements WHERE account_id=? AND item_id=?',accountId,match[1]);if(!entitlement)fail(409,'free-claim-unavailable');if(entitlement.id===id)await metric(db,'acquisition',match[1]);return json({entitlement},entitlement.id===id?201:200);
    }
    if((match=/^\/items\/([A-Za-z0-9_-]{1,160})\/grants$/.exec(path))&&method==='POST'){
      const latest=await first(db,"SELECT v.asset_key,v.digest FROM marketplace_listings l JOIN marketplace_versions v ON v.id=l.latest_version_id AND v.item_id=l.id WHERE l.id=? AND v.status='approved'",match[1]);
      if(latest&&PERSONAL_KINDS.has((await storedPackage(env,latest)).kind))fail(400,'personal-item-not-shareable');
      const input=await body(request),auth=await authority(env,accountId,input.hubId),hubId=auth.rootHubId;
      await reconcileMembership(env,db);
      const entitlement=await first(db,"SELECT e.id FROM marketplace_entitlements e JOIN marketplace_listings l ON l.id=e.item_id WHERE e.account_id=? AND e.item_id=? AND e.status='active' AND l.status<>'disabled'",accountId,match[1]);if(!entitlement)fail(403,'entitlement-required');
      const existing=await first(db,'SELECT * FROM marketplace_grants WHERE account_id=? AND item_id=? AND hub_id=?',accountId,match[1],hubId);
      if(existing&&(existing.status==='active'||existing.status==='grace'&&existing.grace_until>now))return json({grant:existing});
      const id=existing?.id||crypto.randomUUID();
      const exists="EXISTS(SELECT 1 FROM marketplace_entitlements e JOIN marketplace_listings l ON l.id=e.item_id WHERE e.account_id=? AND e.item_id=? AND e.status='active' AND l.status<>'disabled')";
      const query=existing?statement(db,`UPDATE marketplace_grants SET status='active',grace_until=NULL,updated_at=? WHERE id=? AND ${exists}`,now,id,accountId,match[1]):statement(db,`INSERT INTO marketplace_grants(id,account_id,item_id,hub_id,status,created_at,updated_at) SELECT ?,?,?,?,'active',?,? WHERE ${exists}`,id,accountId,match[1],hubId,now,now,accountId,match[1]);
      try{await db.batch([query,audit(db,accountId,'grant.sponsored',id,{hubId,itemId:match[1]},now)]);}catch(error){if(String(error.message).includes('marketplace-slot-limit'))await metric(db,'slot-failure',match[1]);throw error;}
      const grant=await first(db,'SELECT * FROM marketplace_grants WHERE id=?',id);if(!grant||grant.status!=='active')fail(403,'entitlement-required');return json({grant},201);
    }
    if((match=/^\/grants\/([A-Za-z0-9_-]{1,160})$/.exec(path))&&method==='DELETE'){
      if(!await first(db,'SELECT id FROM marketplace_grants WHERE id=? AND account_id=?',match[1],accountId))fail(404,'grant-not-found');
      await db.batch([statement(db,"UPDATE marketplace_grants SET status='withdrawn',grace_until=NULL,updated_at=? WHERE id=? AND account_id=?",now,match[1],accountId),audit(db,accountId,'grant.withdrawn',match[1],{},now)]);return json({withdrawn:true});
    }
    if((match=/^\/hubs\/([A-Za-z0-9_-]{1,160})\/theme(\/undo)?$/.exec(path))){
      const input=['PUT','POST'].includes(method)?await body(request):{};
      const scopeId=input.scopeId||url.searchParams.get('scopeId')||match[1];
      const scopeKind=input.scopeKind||url.searchParams.get('scopeKind')||(scopeId===match[1]?'hub':'space');
      const auth=await authority(env,accountId,match[1],scopeId,scopeKind);
      await reconcileMembership(env,db);
      const configuration=()=>first(db,'SELECT * FROM marketplace_theme_bindings WHERE hub_id=? AND scope_id=?',auth.rootHubId,scopeId);
      const resolved=async()=>({binding:await activeBinding(db,auth.rootHubId,now,scopeId),configuration:await configuration()});
      if(method==='GET'&&!match[2]){const result=await resolved();if(result.configuration&&!result.binding)await metric(db,'expiration-fallback',result.configuration.item_id);return json(result);}
      if(!auth.canManage)fail(403,'theme-manager-required');
      if(method==='POST'&&match[2]){
        const current=await configuration();
        if(!current){const reset=await first(db,'SELECT configuration_json FROM marketplace_theme_reset_undo WHERE hub_id=? AND scope_id=?',auth.rootHubId,scopeId);if(!reset)fail(409,'no-previous-binding');const previous=JSON.parse(reset.configuration_json);await db.batch([statement(db,'INSERT INTO marketplace_theme_bindings(hub_id,scope_id,scope_kind,item_id,version_id,overrides_json,previous_json,applied_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',auth.rootHubId,scopeId,previous.scope_kind,previous.item_id,previous.version_id,previous.overrides_json,previous.previous_json,accountId,now),statement(db,'DELETE FROM marketplace_theme_reset_undo WHERE hub_id=? AND scope_id=?',auth.rootHubId,scopeId),audit(db,accountId,'theme.undo-reset',scopeId,{},now)]);return json(await resolved());}
        if(!current.previous_json){await db.batch([statement(db,'DELETE FROM marketplace_theme_bindings WHERE hub_id=? AND scope_id=?',auth.rootHubId,scopeId),audit(db,accountId,'theme.undo-default',scopeId,{},now)]);return json({binding:null,configuration:null});}
        const previous=JSON.parse(current.previous_json);
        await db.batch([statement(db,'UPDATE marketplace_theme_bindings SET item_id=?,version_id=?,scope_kind=?,overrides_json=?,previous_json=?,applied_by=?,updated_at=? WHERE hub_id=? AND scope_id=?',previous.item_id,previous.version_id,previous.scope_kind,previous.overrides_json,JSON.stringify({...current,previous_json:null}),accountId,now,auth.rootHubId,scopeId),audit(db,accountId,'theme.undo',scopeId,{},now)]);return json(await resolved());
      }
      if(method==='DELETE'&&!match[2]){await db.batch([statement(db,`INSERT INTO marketplace_theme_reset_undo(hub_id,scope_id,configuration_json) SELECT hub_id,scope_id,json_object('scope_kind',scope_kind,'item_id',item_id,'version_id',version_id,'overrides_json',overrides_json,'previous_json',previous_json) FROM marketplace_theme_bindings WHERE hub_id=? AND scope_id=? ON CONFLICT(hub_id,scope_id) DO UPDATE SET configuration_json=excluded.configuration_json`,auth.rootHubId,scopeId),statement(db,'DELETE FROM marketplace_theme_bindings WHERE hub_id=? AND scope_id=?',auth.rootHubId,scopeId),audit(db,accountId,'theme.reset',scopeId,{},now)]);return json({binding:null,configuration:null});}
      if(method==='PUT'&&!match[2]){
        if(!ID.test(input.itemId||'')||!ID.test(input.versionId||''))fail(400,'invalid-binding');
        const overrides=input.overrides||{};
        const version=await first(db,"SELECT asset_key,digest FROM marketplace_versions WHERE id=? AND item_id=? AND status='approved'",input.versionId,input.itemId);if(!version)fail(403,'package-unavailable');
        const pkg=await storedPackage(env,version);if(PERSONAL_KINDS.has(pkg.kind))fail(400,'personal-item-not-shareable');
        if(Object.keys(overrides).length){
          const checked=validateMarketplaceOverrides(pkg,overrides);if(!checked.valid)return json({error:'invalid-overrides',errors:checked.errors},400);
        }
        const result=await statement(db,`INSERT INTO marketplace_theme_bindings(hub_id,scope_id,scope_kind,item_id,version_id,overrides_json,applied_by,updated_at)
          SELECT ?,?,?,l.id,v.id,?,?,? FROM marketplace_listings l JOIN marketplace_versions v ON v.item_id=l.id
          WHERE l.id=? AND v.id=? AND l.status<>'disabled' AND v.status='approved' AND EXISTS(SELECT 1 FROM marketplace_grants g JOIN marketplace_entitlements e ON e.account_id=g.account_id AND e.item_id=g.item_id WHERE g.hub_id=? AND g.item_id=l.id AND e.status='active' AND(g.status='active' OR(g.status='grace' AND g.grace_until>?)))
          ON CONFLICT(hub_id,scope_id) DO UPDATE SET previous_json=json_object('item_id',item_id,'version_id',version_id,'scope_kind',scope_kind,'overrides_json',overrides_json),item_id=excluded.item_id,version_id=excluded.version_id,overrides_json=excluded.overrides_json,scope_kind=excluded.scope_kind,applied_by=excluded.applied_by,updated_at=excluded.updated_at`,auth.rootHubId,scopeId,scopeKind,JSON.stringify(overrides),accountId,now,input.itemId,input.versionId,auth.rootHubId,now).run();
        if(!result.meta.changes)fail(403,'hub-license-required');await audit(db,accountId,'theme.applied',scopeId,input,now).run();await metric(db,'application',input.itemId);return json(await resolved());
      }
    }
    if((match=/^\/versions\/([A-Za-z0-9_-]{1,160})\/preview$/.exec(path))&&method==='GET'){
      const version=await first(db,"SELECT v.asset_key,v.item_id,v.digest FROM marketplace_versions v JOIN marketplace_listings l ON l.id=v.item_id WHERE v.id=? AND v.status='approved' AND l.status='published'",match[1]);if(!version)fail(404,'preview-unavailable');
      const pkg=await storedPackage(env,version);
      await metric(db,'preview',version.item_id);return json({package:pkg,previewOnly:true,licenseNotice:'Preview access does not grant installation, sponsorship, redistribution, or resale rights. Acquire this item to install it. Free items remain subject to their creator license.'});
    }
    if((match=/^\/versions\/([A-Za-z0-9_-]{1,160})\/download$/.exec(path))&&method==='GET'){
      const version=await first(db,"SELECT v.* FROM marketplace_versions v JOIN marketplace_listings l ON l.id=v.item_id WHERE v.id=? AND v.status='approved' AND l.status<>'disabled'",match[1]);if(!version)fail(403,'package-unavailable');
      let entitled=!!await first(db,"SELECT id FROM marketplace_entitlements WHERE account_id=? AND item_id=? AND status='active'",accountId,version.item_id);
      if(!entitled&&url.searchParams.has('hubId')){if(PERSONAL_KINDS.has((await storedPackage(env,version)).kind))fail(403,'entitlement-required');const hubId=url.searchParams.get('hubId'),scopeId=url.searchParams.get('scopeId')||hubId;const auth=await authority(env,accountId,hubId,scopeId,url.searchParams.get('scopeKind')||(scopeId===hubId?'hub':'space'));await reconcileMembership(env,db);const binding=await activeBinding(db,auth.rootHubId,now,scopeId);entitled=binding?.version_id===version.id;if(!entitled&&auth.canManage)entitled=!!await first(db,"SELECT g.id FROM marketplace_grants g JOIN marketplace_entitlements e ON e.account_id=g.account_id AND e.item_id=g.item_id WHERE g.hub_id=? AND g.item_id=? AND e.status='active' AND (g.status='active' OR (g.status='grace' AND g.grace_until>?)) LIMIT 1",auth.rootHubId,version.item_id,now);}
      if(!entitled)fail(403,'entitlement-required');
      const pkg=await storedPackage(env,version);
      return new Response(JSON.stringify(pkg),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${version.id}.json"`,'X-Vumiro-Package-Digest':version.digest}});
    }
    if(path==='/reports'&&method==='POST'){
      const input=await body(request);if(!ID.test(input.itemId||'')||!text(input.reason,5,2000))fail(400,'invalid-report');if(!await first(db,'SELECT id FROM marketplace_listings WHERE id=?',input.itemId))fail(404,'item-not-found');
      const id=crypto.randomUUID();await db.batch([statement(db,'INSERT INTO marketplace_reports(id,account_id,item_id,reason,created_at) VALUES(?,?,?,?,?)',id,accountId,input.itemId,input.reason,now),audit(db,accountId,'report.created',id,{itemId:input.itemId},now)]);return json({id,status:'open'},201);
    }
    if((match=/^\/items\/([A-Za-z0-9_-]{1,160})\/appeals$/.exec(path))&&method==='POST'){
      if(!await first(db,'SELECT id FROM marketplace_listings WHERE id=? AND creator_id=?',match[1],accountId))fail(403,'creator-required');const input=await body(request);if(!text(input.reason,5,2000))fail(400,'invalid-appeal');const id=crypto.randomUUID();await db.batch([statement(db,'INSERT INTO marketplace_appeals(id,account_id,item_id,reason,created_at) VALUES(?,?,?,?,?)',id,accountId,match[1],input.reason,now),audit(db,accountId,'appeal.created',id,{},now)]);return json({id,status:'open'},201);
    }
    if(path.startsWith('/admin/')){
      if(!adminAccount(env,accountId))fail(403,'moderator-required');
      if(path==='/admin/metrics'&&method==='GET')return json({metrics:await readMarketplaceMetrics(db),publicationLeadTime:await all(db,"SELECT date(created_at/1000,'unixepoch') AS day,count(*) AS versions,CAST(avg(reviewed_at-created_at) AS INTEGER) AS average_ms FROM marketplace_versions WHERE status='approved' AND reviewed_at IS NOT NULL GROUP BY day ORDER BY day DESC LIMIT 90")});
      if((match=/^\/admin\/versions\/([A-Za-z0-9_-]{1,160})\/package$/.exec(path))&&method==='GET'){
        const version=await first(db,'SELECT asset_key,digest FROM marketplace_versions WHERE id=?',match[1]);if(!version)fail(404,'version-not-found');return json({package:await storedPackage(env,version)});
      }
      if(path==='/admin/queue'&&method==='GET')return json({versions:await all(db,"SELECT id,item_id,version,digest,rights_json,created_at FROM marketplace_versions WHERE status='submitted' ORDER BY created_at LIMIT 100"),revisions:await all(db,"SELECT * FROM marketplace_listing_revisions WHERE status='submitted' ORDER BY created_at LIMIT 100"),reports:await all(db,"SELECT * FROM marketplace_reports WHERE status='open' ORDER BY created_at LIMIT 100"),appeals:await all(db,"SELECT * FROM marketplace_appeals WHERE status='open' ORDER BY created_at LIMIT 100")});
      if((match=/^\/admin\/revisions\/([A-Za-z0-9_-]{1,160})$/.exec(path))&&method==='POST'){
        const input=await body(request);if(!['approve','reject'].includes(input.action)||!text(input.reason,3,2000))fail(400,'invalid-decision');const revision=await first(db,'SELECT r.*,l.status AS listing_status FROM marketplace_listing_revisions r JOIN marketplace_listings l ON l.id=r.item_id WHERE r.id=?',match[1]);if(!revision)fail(404,'revision-not-found');if(revision.status!=='submitted')fail(409,'revision-not-pending');if(revision.listing_status==='disabled')fail(403,'item-disabled');
        if(input.action==='approve'&&revision.price_minor>0){const {assertCreatorCanSell}=await import('./marketplace-commerce.js');if(!await assertCreatorCanSell(db,revision.creator_id))fail(409,'creator-payout-onboarding-required');}
        const updates=[statement(db,'UPDATE marketplace_listing_revisions SET status=?,reviewed_at=?,review_reason=? WHERE id=?',input.action==='approve'?'approved':'rejected',now,input.reason,revision.id),audit(db,accountId,`listing.revision-${input.action}`,revision.id,{reason:input.reason},now)];if(input.action==='approve')updates.push(statement(db,"UPDATE marketplace_listings SET title=?,description=?,price_minor=?,currency=?,aesthetic=?,updated_at=? WHERE id=? AND status<>'disabled'",revision.title,revision.description,revision.price_minor,revision.currency,revision.aesthetic,now,revision.item_id));await db.batch(updates);return json({updated:true});
      }
      if((match=/^\/admin\/items\/([A-Za-z0-9_-]{1,160})$/.exec(path))&&method==='POST'){
        const input=await body(request);if(!['delist','disable'].includes(input.action)||!text(input.reason,3,2000))fail(400,'invalid-decision');
        if(!await first(db,'SELECT id FROM marketplace_listings WHERE id=?',match[1]))fail(404,'item-not-found');await db.batch([statement(db,'UPDATE marketplace_listings SET status=?,updated_at=? WHERE id=?',input.action==='disable'?'disabled':'delisted',now,match[1]),audit(db,accountId,`listing.${input.action}`,match[1],{reason:input.reason},now)]);return json({updated:true});
      }
      if((match=/^\/admin\/versions\/([A-Za-z0-9_-]{1,160})$/.exec(path))&&method==='POST'){
        const input=await body(request);if(!['approve','reject','disable'].includes(input.action)||!text(input.reason,3,2000))fail(400,'invalid-decision');
        const version=await first(db,'SELECT v.*,l.price_minor,l.creator_id,l.status AS listing_status FROM marketplace_versions v JOIN marketplace_listings l ON l.id=v.item_id WHERE v.id=?',match[1]);if(!version)fail(404,'version-not-found');
        if(input.action==='approve'&&version.status!=='submitted')fail(409,'version-not-pending');
        if(input.action==='approve'&&version.listing_status==='disabled')fail(403,'item-disabled');
        // Paid publication is integrated with verified commerce onboarding by the worker.
        if(input.action==='approve'&&version.price_minor>0){const {assertCreatorCanSell}=await import('./marketplace-commerce.js');if(!await assertCreatorCanSell(db,version.creator_id))fail(409,'creator-payout-onboarding-required');}
        const updates=[statement(db,'UPDATE marketplace_versions SET status=?,reviewed_at=?,review_reason=? WHERE id=?',({approve:'approved',reject:'rejected',disable:'disabled'})[input.action],now,input.reason,version.id),audit(db,accountId,`version.${input.action}`,version.id,{reason:input.reason},now)];
        if(input.action==='approve')updates.push(statement(db,"UPDATE marketplace_listings SET latest_version_id=?,status='published',updated_at=? WHERE id=? AND status<>'disabled'",version.id,now,version.item_id));await db.batch(updates);if(input.action==='approve')await metric(db,'publication',version.item_id);return json({updated:true});
      }
      if((match=/^\/admin\/(reports|appeals)\/([A-Za-z0-9_-]{1,160})$/.exec(path))&&method==='POST'){
        const input=await body(request);if(!['resolved','dismissed'].includes(input.status)||!text(input.reason,3,2000))fail(400,'invalid-decision');const table=match[1]==='reports'?'marketplace_reports':'marketplace_appeals';if(!await first(db,`SELECT id FROM ${table} WHERE id=?`,match[2]))fail(404,'case-not-found');await db.batch([statement(db,`UPDATE ${table} SET status=? WHERE id=?`,input.status,match[2]),audit(db,accountId,`${match[1]}.${input.status}`,match[2],{reason:input.reason},now)]);return json({updated:true});
      }
    }
    return json({error:'route-not-found'},404);
  } catch(error) {
    if(String(error.message).includes('marketplace-slot-limit'))return json({error:'hub-slot-limit',limit:5},409);
    if(error.status)return json({error:error.code},error.status);
    console.error('marketplace request failed',error?.name||'Error');return json({error:'marketplace-operation-failed'},500);
  }
}
export async function runMarketplaceMaintenance(env) {
  if(!env.MARKETPLACE_DB)return;
  await reconcileMembership(env,env.MARKETPLACE_DB);
  const now=Date.now();await statement(env.MARKETPLACE_DB,"UPDATE marketplace_grants SET status='expired',updated_at=? WHERE status='grace' AND grace_until<=?",now,now).run();
}
