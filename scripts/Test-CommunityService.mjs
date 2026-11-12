#!/usr/bin/env node
// Bounded LOCAL QA against Wrangler; keys exist only in this process. No real profiles are read.
import assert from 'node:assert/strict';
import {webcrypto, randomUUID} from 'node:crypto';
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';

const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('Usage: node scripts/Test-CommunityService.mjs [--url http://127.0.0.1:8787] [--report dist/community-service-qa.json]\nCreates an ephemeral QA community in the selected service. Default target is loopback. Explicit --url selects a different target. No SFU or external service calls are made by this script.');
  process.exit(0);
}
function option(name,fallback){const index=args.indexOf(name);if(index<0)return fallback;if(!args[index+1]||args[index+1].startsWith('--'))throw Error('Missing value for '+name);return args[index+1];}
for(let i=0;i<args.length;i+=2)if(!['--url','--report'].includes(args[i]))throw Error('Unknown argument: '+args[i]);
const base=new URL(option('--url','http://127.0.0.1:8787'));
if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('Service URL must be an HTTP(S) origin without credentials, query or fragment.');
if(!args.includes('--url')&&!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('Default QA target must be loopback.');
base.pathname='/';
const reportPath=path.resolve(option('--report','dist/community-service-qa.json'));
const startedAt=new Date().toISOString(),checks=[],requests=[],sockets=new Set();
const runId=randomUUID();let hubId;
const crypto=webcrypto;
async function identity(label){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const spki=await crypto.subtle.exportKey('spki',pair.publicKey);
  return {label,id:Buffer.from(await crypto.subtle.digest('SHA-256',spki)).toString('base64url'),key:Buffer.from(spki).toString('base64url'),async sign(value){return Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(value))).toString('base64url');}};
}
const canonical=(user,nonce,action,payload)=>JSON.stringify(['vumiro-community-v1',hubId,user.id,nonce,action,payload]);
function endpoint(action){return new URL(`api/community/${encodeURIComponent(hubId)}/${action}`,base);}
async function responseData(response){return response.headers.get('content-type')?.includes('application/json')?response.json():Buffer.from(await response.arrayBuffer());}
async function request(user,action,payload={},settings={}){
  const challengeUrl=endpoint('challenge');challengeUrl.searchParams.set('id',user.id);
  const challengeResponse=await fetch(challengeUrl,{signal:AbortSignal.timeout(10000),redirect:'error'});
  const challenge=await responseData(challengeResponse);
  requests.push({actor:user.label,method:'GET',action:'challenge',status:challengeResponse.status,code:challenge.error?.code});
  assert.equal(challengeResponse.status,200,`GET ${challengeUrl.pathname} for ${user.label}: HTTP ${challengeResponse.status} ${challenge.error?.code??''}`);
  const proof={id:user.id,key:user.key,nonce:challenge.nonce,payload,signature:await user.sign(canonical(user,challenge.nonce,settings.signedAction??action,payload))};
  const response=await fetch(endpoint(action),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(proof),signal:AbortSignal.timeout(15000),redirect:'error'});
  const data=await responseData(response);
  requests.push({actor:user.label,method:'POST',action,status:response.status,code:data.error?.code});
  if(settings.expected!==undefined)assert.equal(response.status,settings.expected,`POST ${endpoint(action).pathname} for ${user.label}: expected HTTP ${settings.expected}, got HTTP ${response.status} ${data.error?.code??''}`);
  return {status:response.status,data,headers:response.headers,proof};
}
async function ok(user,action,payload={}){return (await request(user,action,payload,{expected:200})).data;}
async function check(name,fn){
  const start=Date.now();try{await fn();checks.push({name,passed:true,durationMs:Date.now()-start});console.log('PASS '+name);return true;}
  catch(error){checks.push({name,passed:false,durationMs:Date.now()-start,error:error.message});console.error('FAIL '+name+': '+error.message);return false;}
}
function socketSession(user,channelId=null){
  const url=endpoint('events');url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('id',user.id);
  const socket=new WebSocket(url),events=[],waiters=new Set();sockets.add(socket);
  function emit(event){events.push(event);for(const waiter of [...waiters])if(waiter.predicate(event)){clearTimeout(waiter.timer);waiters.delete(waiter);waiter.resolve(event);}}
  function wait(predicate,timeout=8000){const seen=events.find(predicate);if(seen)return Promise.resolve(seen);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,timer:setTimeout(()=>{waiters.delete(waiter);reject(Error('WebSocket /events timeout for '+user.label+'; observed '+events.map(e=>e.type).join(', ')));},timeout)};waiters.add(waiter);});}
  socket.addEventListener('message',event=>{void(async()=>{const value=JSON.parse(event.data);emit(value);if(value.type==='community-challenge'){const payload={channelId};const proof={type:'authenticate',id:user.id,key:user.key,nonce:value.nonce,payload,signature:await user.sign(canonical(user,value.nonce,'subscribe',payload))};if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(proof));}})().catch(error=>emit({type:'qa-error',message:error.message}));});
  socket.addEventListener('close',event=>{sockets.delete(socket);emit({type:'qa-close',code:event.code});});
  socket.addEventListener('error',()=>emit({type:'qa-error',message:'Transport failed.'}));
  return {socket,events,wait,async welcome(){return wait(e=>e.type==='community-welcome');},close(){if(socket.readyState===WebSocket.OPEN)socket.close(1000,'QA complete');}};
}
async function main(){
  const [owner,member,peer,outsider]=await Promise.all(['owner','member','peer','outsider'].map(identity));
  hubId=owner.id+'_'+runId;
  console.log(`LOCAL COMMUNITY SERVICE QA ${base.origin}\nEphemeral hub: ${hubId}`);
  const publishPayload={hub:{id:hubId,name:'Ephemeral service QA',description:'Local integration test; safe to remove local Wrangler state.',home:{preset:'compact'},themeBinding:{mode:'inherit'}},nodes:[
    {id:'qa-text',kind:'text',name:'QA text',parentId:hubId},
    {id:'qa-other',kind:'text',name:'QA other',parentId:hubId},
    {id:'qa-voice',kind:'voice',name:'QA voice',parentId:hubId},
    {id:'qa-private',kind:'space',name:'Private ancestor',parentId:hubId,access:{mode:'restricted',memberIds:[owner.id]}},
    {id:'qa-private-text',kind:'text',name:'Private text',parentId:'qa-private',access:{mode:'all'}}
  ]};
  if(!await check('publish only hub structure with signed P-256 proof',async()=>{
    const result=await ok(owner,'publish',publishPayload);assert.equal(result.hubId,hubId);assert.equal(result.revision,1);assert.equal(result.nodes.filter(n=>n.kind==='text').length,3);assert.equal(result.members.length,1);assert.ok(!('messages'in result));assert.ok(!('drafts'in result));
  }))return;
  await check('publish retry returns existing community without duplication',async()=>{const result=await ok(owner,'publish',publishPayload);assert.equal(result.alreadyPublished,true);assert.equal(result.revision,1);});
  await check('HTTP challenge replay and action tampering reject',async()=>{
    const first=await request(owner,'snapshot',{}, {expected:200});
    const replay=await fetch(endpoint('snapshot'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(first.proof),signal:AbortSignal.timeout(10000),redirect:'error'});const data=await responseData(replay);requests.push({actor:owner.label,method:'POST',action:'snapshot(replay)',status:replay.status,code:data.error?.code});assert.equal(replay.status,401);
    await request(owner,'audit',{}, {expected:401,signedAction:'snapshot'});
  });
  await check('identity-bound invite rejects another identity and allows intended join',async()=>{
    const invitation=await ok(owner,'invite',{memberId:member.id});await request(outsider,'join',{token:invitation.token,name:'Wrong identity'},{expected:403});await ok(member,'join',{token:invitation.token,name:'QA member'});
    const peerInvite=await ok(owner,'invite',{memberId:peer.id});await ok(peer,'join',{token:peerInvite.token,name:'QA peer'});
    const state=await ok(owner,'snapshot');assert.equal(state.members.length,3);
  });
  async function mutate(operations){const snapshot=await ok(owner,'snapshot');return ok(owner,'mutate',{expectedRevision:snapshot.revision,operations});}
  let memberSocket;
  await check('real WebSocket challenge authenticates a watched text subscription',async()=>{memberSocket=socketSession(member,'qa-text');const welcome=await memberSocket.welcome();assert.equal(welcome.snapshot.hubId,hubId);assert.equal(welcome.snapshot.members.length,1);});
  let sent;
  await check('durable message acknowledgement broadcasts over actual WebSocket',async()=>{
    sent=await ok(peer,'send',{channelId:'qa-text',id:randomUUID(),text:'Ephemeral integration message'});
    assert.equal(sent.duplicate,false);assert.ok(Number.isSafeInteger(sent.message.sequence));assert.equal(sent.message.authorId,peer.id);
    assert.ok(memberSocket,'WebSocket prerequisite failed');const event=await memberSocket.wait(e=>e.type==='community-message'&&e.message.id===sent.message.id);assert.equal(event.message.sequence,sent.message.sequence);
  });
  await check('author-scoped send retries deduplicate and content/channel conflicts return 409',async()=>{
    assert.ok(sent,'Message prerequisite failed');const payload={channelId:'qa-text',id:sent.message.id,text:sent.message.text};const retry=await ok(peer,'send',payload);assert.equal(retry.duplicate,true);assert.equal(retry.message.sequence,sent.message.sequence);
    await request(peer,'send',{...payload,text:'Conflicting text'},{expected:409});await request(peer,'send',{...payload,channelId:'qa-other'},{expected:409});
    const history=await ok(member,'history',{channelId:'qa-text',after:0,limit:100});assert.equal(history.messages.filter(m=>m.id===sent.message.id).length,1);
  });
  await check('unauthorized history and restricted ancestor remain hidden',async()=>{
    await request(outsider,'history',{channelId:'qa-text'},{expected:403});await request(member,'history',{channelId:'qa-private-text'},{expected:403});
    const visible=await ok(member,'snapshot');assert.ok(!visible.nodes.some(n=>['qa-private','qa-private-text'].includes(n.id)));
    const events=await ok(member,'events',{after:0});assert.ok(!events.events.some(e=>e.message?.channelId==='qa-private-text'));
  });
  await check('structure revision conflict retains winning mutation',async()=>{
    const before=await ok(owner,'snapshot'),winner=await ok(owner,'mutate',{expectedRevision:before.revision,operations:[{type:'theme',id:'qa-other',binding:{mode:'inherit'}}]});assert.equal(winner.revision,before.revision+1);
    const conflict=await request(owner,'mutate',{expectedRevision:before.revision,operations:[]},{expected:409});assert.equal(conflict.data.error.code,'community-revision-conflict');
  });
  await check('roles assign configurable equal authority and protect owner moderation',async()=>{
    await mutate([{type:'role.set',role:{id:'QAMod',name:'QA moderators',authority:50,permissions:['view','post','voice','speak','moderate']}},{type:'member.set',member:{id:member.id,roles:['QAMod']}},{type:'member.set',member:{id:peer.id,roles:['QAMod']}}]);
    const target=await ok(peer,'send',{channelId:'qa-text',id:randomUUID(),text:'Equal authority moderation target'});await request(member,'moderate',{sequence:target.message.sequence},{expected:403});
    await mutate([{type:'settings',equalAuthorityModeration:true}]);await ok(member,'moderate',{sequence:target.message.sequence});const history=await ok(peer,'history',{channelId:'qa-text'});assert.equal(history.messages.find(m=>m.sequence===target.message.sequence).text,'');
    const protectedMessage=await ok(owner,'send',{channelId:'qa-text',id:randomUUID(),text:'Protected owner post'});await request(member,'moderate',{sequence:protectedMessage.message.sequence},{expected:403});
    const events=await ok(peer,'events',{after:0});assert.ok(!JSON.stringify(events).includes('Equal authority moderation target'));
  });
  await check('scope managers edit their branch and cannot edit siblings or access policy',async()=>{
    await mutate([{type:'node.upsert',node:{id:'qa-managed',kind:'space',name:'Managed branch',parentId:hubId,managerIds:[member.id]}}]);
    let snapshot=await ok(owner,'snapshot');await ok(member,'mutate',{expectedRevision:snapshot.revision,operations:[{type:'node.upsert',node:{id:'qa-managed-child',kind:'text',name:'Scoped child',parentId:'qa-managed'}}]});
    snapshot=await ok(owner,'snapshot');await request(member,'mutate',{expectedRevision:snapshot.revision,operations:[{type:'node.upsert',node:{id:'qa-sibling-child',kind:'text',name:'Forbidden sibling',parentId:hubId}}]},{expected:403});
    const managed=snapshot.nodes.find(n=>n.id==='qa-managed');await request(member,'mutate',{expectedRevision:snapshot.revision,operations:[{type:'node.upsert',node:{...managed,access:{mode:'restricted',memberIds:[member.id]}}}]},{expected:403});
  });
  let privateSocket,assetId;
  await check('private scope admission permits authenticated PNG R2 upload/read',async()=>{
    await mutate([{type:'node.upsert',node:{id:'qa-private',kind:'space',name:'Private ancestor',parentId:hubId,access:{mode:'restricted',memberIds:[owner.id,member.id]}}}]);
    privateSocket=socketSession(member,'qa-private-text');await privateSocket.welcome();await ok(owner,'send',{channelId:'qa-private-text',id:randomUUID(),text:'Private ephemeral message'});
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=','base64');
    const asset=await ok(owner,'asset-upload',{scopeId:'qa-private',contentType:'image/png',data:png.toString('base64url')});assetId=asset.assetId;
    const read=await request(member,'asset-read',{assetId},{expected:200});assert.ok(Buffer.isBuffer(read.data));assert.deepEqual(read.data,png);assert.equal(read.headers.get('content-type'),'image/png');assert.equal(read.headers.get('cache-control'),'private, no-store');assert.equal(read.headers.get('x-content-type-options'),'nosniff');
  });
  await check('ancestor permission revocation closes watched socket and denies history/assets/events',async()=>{
    assert.ok(privateSocket&&assetId,'Private R2/socket prerequisite failed');await mutate([{type:'node.upsert',node:{id:'qa-private',kind:'space',name:'Private ancestor',parentId:hubId,access:{mode:'restricted',memberIds:[owner.id]}}}]);
    await privateSocket.wait(e=>e.type==='community-revoked');const closed=await privateSocket.wait(e=>e.type==='qa-close');assert.equal(closed.code,4003);
    await request(member,'history',{channelId:'qa-private-text'},{expected:403});await request(member,'asset-read',{assetId},{expected:403});
    const events=await ok(member,'events',{after:0});assert.ok(!JSON.stringify(events).includes('Private ephemeral message'));assert.ok(!(await ok(member,'snapshot')).nodes.some(n=>n.id==='qa-private-text'));
  });
  await check('full membership revocation closes public subscription and old invite cannot restore access',async()=>{
    assert.ok(memberSocket,'Public socket prerequisite failed');const unused=await ok(owner,'invite',{memberId:member.id});await mutate([{type:'member.remove',id:member.id}]);
    await memberSocket.wait(e=>e.type==='community-revoked');const close=await memberSocket.wait(e=>e.type==='qa-close');assert.equal(close.code,4003);
    await request(member,'history',{channelId:'qa-text'},{expected:403});await request(member,'snapshot',{}, {expected:403});if(assetId)await request(member,'asset-read',{assetId},{expected:403});await request(member,'join',{token:unused.token,name:'Rejected rejoin'},{expected:403});
  });
  await check('outsider WebSocket cannot authenticate membership',async()=>{const denied=socketSession(outsider,'qa-text');const event=await denied.wait(e=>e.type==='community-error');assert.equal(event.code,'community-forbidden');assert.equal((await denied.wait(e=>e.type==='qa-close')).code,1008);});
  await check('audit metadata excludes conversation bodies and records revocation',async()=>{const audit=await ok(owner,'audit');assert.ok(audit.records.some(r=>r.action==='member.remove'));for(const body of ['Private ephemeral message','Ephemeral integration message','Protected owner post'])assert.ok(!JSON.stringify(audit).includes(body));});
}
try{await main();}catch(error){checks.push({name:'runtime setup',passed:false,error:error.message});console.error('FAIL runtime setup: '+error.message);}
finally{
  for(const socket of sockets)try{socket.close(1000,'QA complete');}catch{}
  const passed=checks.filter(c=>c.passed).length,failed=checks.length-passed;
  await mkdir(path.dirname(reportPath),{recursive:true});
  await writeFile(reportPath,JSON.stringify({version:1,mode:'local-qa',baseUrl:base.origin,hubId,startedAt,finishedAt:new Date().toISOString(),passed,failed,checks,requests,limits:['Ephemeral identity material is not saved.','The QA hub and assets remain in the selected Wrangler local data store.','No SFU/media, load-capacity, external network or multi-device QA is performed.']},null,2)+'\n');
  console.log(`${passed}/${checks.length} checks passed; ${failed} failed. Report: ${reportPath}`);
  if(failed)process.exitCode=1;
}
