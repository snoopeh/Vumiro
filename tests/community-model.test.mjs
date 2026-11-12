import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = new URL('../Vumiro.Client/WebServer/community-model.js', import.meta.url);
const identity='A'.repeat(43), other='B'.repeat(43);

function sharedFixture(){return {hubId:'hub',id:'hub',ownerId:identity,equalAuthorityModeration:false,
 nodes:[{id:'hub',type:'hub',parentId:null},{id:'space',type:'space',parentId:'hub'},{id:'channel',type:'text',parentId:'space'},{id:'sibling',type:'text',parentId:'hub'}],
 members:[{id:identity,roles:[]},{id:other,roles:['Member']}],
 roles:[{id:'Member',permissions:['view','post','voice','speak'],authority:10}]};}
function serviceAccess(){
 const source=fs.readFileSync(new URL('../cloudflare/community-hub.js',import.meta.url),'utf8');
 const helpers=['list','ids','rolePermissions'].map(name=>source.match(new RegExp('^const '+name+'=.*$','m'))?.[0]);
 assert.ok(helpers.every(Boolean),'service permission dependencies remain available');
 const start=source.indexOf('export function canAccess('),end=source.indexOf('\nfunction requireAccess(',start);
 assert.ok(start>=0&&end>start,'extract the real service authorization function');
 return vm.runInNewContext(helpers.join('\n')+'\n'+source.slice(start,end).replace('export ','')+'\ncanAccess');
}
function serviceState(snapshot){return {...snapshot,id:snapshot.hubId||snapshot.id,...Object.fromEntries(['nodes','members','roles'].map(key=>[key,Object.fromEntries(snapshot[key].map(value=>[value.id,value]))]))};}

test('shared menu permissions match service authorization across scoped grants and inherited restrictions',()=>{
 const M=api(),authoritative=serviceAccess();assert.equal(typeof M.sharedAccess,'function','shared permission gating must be exported');
 const permissions=['view','post','voice','speak','moderate','structure','themes','roles'];
 const cases=[
  ['ordinary membership',()=>{}],
  ['scoped builder',s=>{s.roles.push({id:'Builder',scopeId:'space',permissions:['view','structure','themes','roles']});s.members[1].roles.push('Builder');}],
  ['boolean role permissions and voice alias',s=>{s.roles[0].permissions={view:true,joinVoice:true,structure:true,roles:false};}],
  ['member roleIds alias',s=>{s.members[1].roleIds=s.members[1].roles;delete s.members[1].roles;}],
  ['manager delegation',s=>{s.roles[0].permissions=[];s.nodes[1].managers=[other];}],
  ['managerIds alias',s=>{s.nodes[1].managerIds=[other];}],
  ['ancestor structure deny defeats descendant allow',s=>{s.nodes[0].access={permissions:{structure:{denyRoles:['Member']}}};s.nodes[2].access={permissions:{structure:{allowMembers:[other]}}};}],
  ['ancestor view deny defeats manager',s=>{s.nodes[1].managers=[other];s.nodes[0].permissions={view:false};}],
  ['ancestor permission boolean deny',s=>{s.nodes[1].access={permissions:{post:false}};s.nodes[2].access={permissions:{post:{allowRoles:['Member']}}};}],
  ['node permission deny',s=>{s.nodes[2].permissions={voice:false};}],
  ['restricted ancestor',s=>{s.nodes[1].access={mode:'restricted'};}],
  ['selected member admission',s=>{s.nodes[1].access={mode:'restricted',memberIds:[other]};}],
  ['selected role admission',s=>{s.nodes[1].access={mode:'restricted',roles:['Member']};}],
  ['explicit member deny defeats admission',s=>{s.nodes[1].access={mode:'restricted',members:[other],deniedMembers:[other]};}],
  ['explicit role deny',s=>{s.nodes[1].access={deniedRoles:['Member']};}],
  ['approval pending',s=>{s.nodes[1].access={mode:'approval'};}],
  ['approval joined',s=>{s.nodes[1].access={mode:'approval',joinedMemberIds:[other]};}],
  ['approved member',s=>{s.nodes[1].access={mode:'restricted',approvedMembers:[other]};}],
  ['invited member',s=>{s.nodes[1].access={mode:'invite',invitedMemberIds:[other]};}],
  ['joinable joined member',s=>{s.nodes[1].access={mode:'joinable',joinedMemberIds:[other]};}],
  ['joinable pending',s=>{s.nodes[1].access={mode:'joinable'};}],
  ['owner bypasses ancestor policy',s=>{s.nodes[0].access={mode:'restricted',permissions:{view:false,roles:false}};}],
  ['owner banned',s=>{s.members[0].banned=true;}],
  ['member banned',s=>{s.members[1].banned=true;}],
  ['archived ancestor',s=>{s.nodes[1].archived=true;}],
  ['missing ancestor',s=>{s.nodes=s.nodes.filter(n=>n.id!=='space');}],
  ['cycle',s=>{s.nodes[1].parentId='channel';}],
  ['missing assigned role',s=>{s.roles=[];}],
  ['own membership and roles only',s=>{s.members=[s.members[1]];}],
  ['hubId without id',s=>{delete s.id;}],
  ['id without hubId',s=>{delete s.hubId;}]
 ];
 for(const [label,change]of cases){const snapshot=sharedFixture();change(snapshot);const state=serviceState(snapshot),before=JSON.stringify(snapshot);
  for(const actor of [identity,other,'not-a-member'])for(const scope of ['hub','space','channel','sibling','missing'])for(const permission of permissions){
   assert.equal(M.sharedAccess(snapshot,actor,scope,permission),authoritative(state,actor,scope,permission),`${label}: ${actor.slice(0,3)} ${scope} ${permission}`);
  }
  assert.equal(JSON.stringify(snapshot),before,'menu gating must not mutate the snapshot');
 }
});

test('shared manager grants do not imply role, post, speak or voice authority',()=>{
 const snapshot=sharedFixture(),M=api();assert.equal(typeof M.sharedAccess,'function');snapshot.roles=[];snapshot.nodes[1].managerIds=[other];
 for(const permission of ['view','structure','themes','moderate'])assert.equal(M.sharedAccess(snapshot,other,'channel',permission),true,permission);
 for(const permission of ['roles','post','voice','speak'])assert.equal(M.sharedAccess(snapshot,other,'channel',permission),false,permission);
 assert.equal(M.sharedAccess(snapshot,other,'sibling','structure'),false,'delegation stays in its subtree');
 assert.equal(M.sharedAccess(snapshot,other,'channel'),true,'view is the default permission');
});

test('shared permission gating fails closed for omitted or malformed snapshot policy',()=>{
 const M=api();assert.equal(typeof M.sharedAccess,'function');
 for(const value of [null,{},[],{...sharedFixture(),nodes:null},{...sharedFixture(),members:null},{...sharedFixture(),roles:null},
  {...sharedFixture(),ownerId:undefined},{...sharedFixture(),nodes:[{id:'hub'},{id:'hub'}]},
  {...sharedFixture(),members:[null]},{...sharedFixture(),roles:[null]}])assert.equal(M.sharedAccess(value,other,'channel','structure'),false);
 const missing=sharedFixture();missing.nodes=missing.nodes.filter(n=>n.id!=='hub');
 assert.equal(M.sharedAccess(missing,identity,'channel','structure'),false,'even an owner needs the complete ancestor chain');
});

test('inherited theme overrides survive a binding save and reload',async()=>{
 const storage=memory(),s=await store(storage);await s.setThemeBinding('valheim',{mode:'inherit',overrides:{tokens:{accent:'#aabbcc'}}});
 const reload=await store(storage);assert.equal(reload.snapshot().nodes.find(n=>n.id==='valheim').themeBinding.overrides.tokens.accent,'#aabbcc');
 await assert.rejects(()=>s.setThemeBinding('valheim',{mode:'inherit',overrides:{script:'bad'}}),/override/i);
});
test('creating a child cannot bypass separate role and theme management permissions',async()=>{
 const s=await store();await s.updateNode('valheim',{managerIds:['demo-luca']});
 await assert.rejects(()=>s.createNode({hubId:s.snapshot().selectedHubId,parentId:'valheim',kind:'text',name:'Escalation',access:{permissions:{roles:{allowMembers:['demo-luca']}}}},{actor:'demo-luca'}),/permission/i);
 const h=s.snapshot().hubs[0];await s.setRoles(h.id,[...h.roles,{id:'Builder',name:'Builder',authority:10,permissions:{view:true,structure:true}}]);await s.setRole('demo-noor','Builder');
 await assert.rejects(()=>s.createNode({hubId:h.id,parentId:null,kind:'text',name:'Unauthorized theme',themeBinding:{packageId:'viking',version:'1.0.0'}},{actor:'demo-noor'}),/permission/i);
});
function api(){const context={window:{},console,URL};vm.createContext(context);if(fs.existsSync(file))vm.runInContext(fs.readFileSync(file,'utf8'),context);assert.ok(context.window.VumiroCommunityModel,'Community model API exists');return context.window.VumiroCommunityModel;}
function memory(){const records=new Map();return {records,async load(id){return records.has(id)?structuredClone(records.get(id)):null;},async save(id,state){records.set(id,structuredClone(state));}};}
function local(){const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem(k,v){values.set(k,v);},removeItem(k){values.delete(k);}};}
async function store(storage=memory(),id=identity){return api().createStore({identity:id,storage,now:()=>1000});}
function legacy(){return {version:1,mode:'local-demo',name:'Old workshop',description:'Kept',selectedChannel:'original',channels:[{id:'original',kind:'text',name:'Original',category:'Old category',description:'History'}],messages:{original:[{id:'old-message',authorId:identity,author:'Me',text:'Do not lose me',at:100,demo:false}]},drafts:{original:'unsent words'},members:[]};}

test('hub card art persists independently per hub and partial edits preserve existing art',async()=>{
 const storage=memory(),s=await store(storage),first=s.snapshot().selectedHubId;
 const card={banner:'https://images.example/banner.webp',icon:'data:image/png;base64,AAAA',frame:'aurora',frameColor:'#12ABef',frameImage:'https://images.example/frame.png'};
 await s.updateHub(first,{card});const next=await s.createHub({name:'Second',card:{icon:'https://images.example/second.png'}});
 await s.updateHub(first,{card:{frame:'regal'}});const reload=(await store(storage)).snapshot();
 assert.deepEqual(JSON.parse(JSON.stringify(reload.hubs.find(h=>h.id===first).card??null)),{...card,frame:'regal'});
 assert.equal(reload.hubs.find(h=>h.id===next.id).card.icon,'https://images.example/second.png');assert.equal(reload.hubs.find(h=>h.id===next.id).card.banner,'');
});

test('legacy hubs receive card defaults and normalizeCard accepts only bounded raster or HTTPS art',async()=>{
 const model=api(),old=(await store()).snapshot();delete old.hubs[0].card;
 assert.deepEqual(JSON.parse(JSON.stringify(model.validateState(old,identity).hubs[0].card??null)),{banner:'',icon:'',frame:'none',frameColor:'#8b5cf6',frameImage:''});
 for(const type of ['png','jpeg','webp','gif'])assert.equal(model.normalizeCard({banner:'data:image/'+type+';base64,AAAA'}).banner,'data:image/'+type+';base64,AAAA');
 const bounded='data:image/png;base64,'+'A'.repeat(199976);assert.equal(model.normalizeCard({banner:bounded}).banner,bounded);
 for(const source of ['javascript:alert(1)','http://example.com/a.png','data:image/svg+xml;base64,AAAA','https://user:secret@example.com/a.png','https://example.com/\\evil','https://example.com/\nimage','data:image/png;base64,%%%%','https://example.com/'+ 'a'.repeat(200000)])assert.throws(()=>model.normalizeCard({banner:source}),/card|image/i,source.slice(0,70));
 for(const card of [null,[],{frame:'custom'},{frameColor:'red'},{frameColor:'#abc'},{icon:3},{frameImage:'file:///C:/a.png'}])assert.throws(()=>model.normalizeCard(card),/card|image|frame/i);
 const large={...old,hubs:old.hubs.map(h=>({...h,card:{banner:bounded,icon:bounded,frameImage:bounded}}))};while(large.hubs.length<3)large.hubs.push({...large.hubs[0],id:'extra-'+large.hubs.length});assert.throws(()=>model.validateState(large,identity),/too large/i);
});

test('invalid card edits roll back all hub changes and retain existing structure permissions',async()=>{
 const storage=memory(),s=await store(storage),hubId=s.snapshot().selectedHubId;await s.updateHub(hubId,{card:{banner:'https://example.com/kept.png'}});const before=JSON.stringify(s.snapshot()),saved=JSON.stringify(storage.records.get(identity));
 await assert.rejects(()=>s.updateHub(hubId,{name:'Lost',card:{icon:'data:image/svg+xml;base64,AAAA'}}),/card|image/i);
 assert.equal(JSON.stringify(s.snapshot()),before);assert.equal(JSON.stringify(storage.records.get(identity)),saved);
 await assert.rejects(()=>s.updateHub(hubId,{card:{frame:'arcade'}},{actor:'demo-luca'}),/permission/i);
});

test('v2 seed has stable channels, multiple node kinds, original demo messages and isolated identities',async()=>{
 const storage=memory(),a=await store(storage),s=a.snapshot();assert.equal(s.version,2);assert.equal(s.mode,'local-demo');assert.ok(s.nodes.some(n=>n.kind==='space'));assert.ok(s.nodes.some(n=>n.id==='welcome'));assert.match(s.messages.welcome[0].text,/Workshop/);await a.updateHub(s.selectedHubId,{name:'Private hub'});const b=await store(storage,other);assert.notEqual(b.snapshot().name,'Private hub');assert.equal((await store(storage)).snapshot().name,'Private hub');s.nodes[0].name='tampered';assert.notEqual(a.snapshot().nodes[0].name,'tampered');await assert.rejects(()=>store(storage,'bad'),/identity/i);
});

test('legacy migration preserves IDs, drafts, messages and original backup after verified v2 save',async()=>{
 const raw=local(),old=JSON.stringify(legacy()),key='vumiro.server-sandbox.v1.'+identity;raw.setItem(key,old);const s=await store(api().createLocalStorageAdapter(raw));assert.equal(s.snapshot().selectedNodeId,'original');assert.equal(s.snapshot().drafts.original,'unsent words');assert.equal(s.snapshot().messages.original[0].text,'Do not lose me');assert.equal(raw.getItem(key),old);assert.equal(raw.getItem('vumiro.community.v2.backup.'+identity),old);assert.equal(JSON.parse(raw.getItem('vumiro.community.v2.'+identity)).version,2);assert.equal((await store(api().createLocalStorageAdapter(raw))).snapshot().drafts.original,'unsent words');assert.equal(s.status().migrated,true);
});

test('failed and interrupted migration keeps original readable and retries safely',async()=>{
 const raw=local(),key='vumiro.server-sandbox.v1.'+identity;raw.setItem(key,JSON.stringify(legacy()));const set=raw.setItem.bind(raw);raw.setItem=(k,v)=>{if(k==='vumiro.community.v2.'+identity)throw Error('quota');set(k,v);};const s=await store(api().createLocalStorageAdapter(raw));assert.equal(s.snapshot().drafts.original,'unsent words');assert.equal(s.status().saved,false);assert.equal(s.status().error,'save');raw.setItem=set;const again=await store(api().createLocalStorageAdapter(raw));assert.equal(again.snapshot().messages.original.length,1);assert.equal(again.status().saved,true);assert.ok(raw.getItem(key));
 // A partially written v2 snapshot must not hide recoverable legacy history.
 raw.setItem('vumiro.community.v2.'+identity,'{"version":2');const recovered=await store(api().createLocalStorageAdapter(raw));assert.equal(recovered.snapshot().drafts.original,'unsent words');assert.equal(recovered.status().migrated,true);
});

test('save failure keeps edits in memory and queued writes remain identity bound',async()=>{
 let fail=true;const m=memory(),save=m.save;m.save=async(id,state)=>{if(fail)throw Error('quota');return save(id,state);};const a=await store(m);await a.setDraft('welcome','still here');assert.equal(a.snapshot().drafts.welcome,'still here');assert.equal(a.status().saved,false);fail=false;await a.setDraft('workbench','second');assert.equal(a.status().saved,true);const b=await store(m,other);assert.equal(b.snapshot().drafts.welcome,'');assert.equal((await store(m)).snapshot().drafts.welcome,'still here');
});

test('nested moves, order, collapse, breadcrumbs and archive restore preserve channel content',async()=>{
 const s=await store(),hubId=s.snapshot().selectedHubId;const folder=await s.createNode({hubId,kind:'folder',name:'Plans'}),nested=await s.createNode({hubId,parentId:folder.id,kind:'space',name:'Expedition'});await s.setDraft('welcome','draft survives');await s.moveNode('welcome',nested.id);assert.equal(s.snapshot().drafts.welcome,'draft survives');assert.equal(s.snapshot().messages.welcome[0].id,'seed-welcome');assert.deepEqual(Array.from(s.breadcrumbs('welcome'),x=>x.id),[hubId,folder.id,nested.id,'welcome']);await assert.rejects(()=>s.moveNode(folder.id,nested.id),/cycle/i);await assert.rejects(()=>s.moveNode(folder.id,'welcome'),/parent|container/i);await s.setCollapsed(folder.id,true);assert.ok(!s.tree(hubId).some(n=>n.id==='welcome'));assert.ok(s.tree(hubId,{query:'welcome'}).some(n=>n.id==='welcome'));await s.archiveNode(folder.id);assert.ok(!s.tree(hubId).some(n=>n.id==='welcome'));await s.restoreNode(folder.id);assert.equal(s.snapshot().drafts.welcome,'draft survives');await s.moveNode('welcome',null,{index:0});assert.equal(s.tree(hubId)[0].id,'welcome');
});

test('hub membership and ancestor restrictions filter search, messages, activity, unread and participants',async()=>{
 const s=await store(),h=s.snapshot().selectedHubId,p=await s.createNode({hubId:h,kind:'space',name:'Secret',access:{mode:'restricted',memberIds:[identity]}}),c=await s.createNode({hubId:h,parentId:p.id,kind:'text',name:'Hidden needle'});await s.setUnread(c.id,8);await s.postMessage(c.id,'secret activity','Me');const actor='demo-luca';assert.equal(s.previewAccess(c.id,actor).view,false);assert.ok(!s.tree(h,{query:'needle',actor}).length);assert.equal(s.unreadTotal(h,actor),0);assert.ok(!s.visibleActivity(h,actor).some(m=>m.nodeId===c.id));assert.equal(s.previewAccess('welcome','outsider').view,false);await assert.rejects(()=>s.setDraft(c.id,'steal',{actor}),/permission|access/i);
});

test('access modes require local joined or invited state and explicit dimensions stay independent',async()=>{
 const s=await store(),h=s.snapshot().selectedHubId,n=await s.createNode({hubId:h,kind:'space',name:'Club'});for(const mode of ['joinable','approval','invite']){await s.setAccess(n.id,{mode});assert.equal(s.previewAccess(n.id,'demo-luca').view,false);await s.setAccess(n.id,{mode,memberIds:['demo-luca']});assert.equal(s.previewAccess(n.id,'demo-luca').view,true);}await s.setAccess(n.id,{mode:'all',permissions:{post:{denyMembers:['demo-luca']},joinVoice:{denyMembers:['demo-luca']}}});const preview=s.previewAccess(n.id,'demo-luca');assert.equal(preview.view,true);assert.equal(preview.post,false);assert.equal(preview.joinVoice,false);assert.equal(preview.speak,true);
});

test('delegated managers control only their subtree and unauthorized destinations reject moves',async()=>{
 const s=await store(),h=s.snapshot().selectedHubId,a=await s.createNode({hubId:h,kind:'space',name:'Managed',managerIds:['demo-luca']}),b=await s.createNode({hubId:h,kind:'space',name:'Sibling'}),c=await s.createNode({hubId:h,parentId:a.id,kind:'folder',name:'Child'},{actor:'demo-luca'});await s.renameNode(c.id,'Edited',{actor:'demo-luca'});await assert.rejects(()=>s.renameNode(b.id,'Unauthorized',{actor:'demo-luca'}),/permission/i);await assert.rejects(()=>s.moveNode(c.id,b.id,{actor:'demo-luca'}),/permission/i);assert.equal(s.previewAccess(a.id,'demo-luca').roles,false);assert.equal(s.previewAccess(a.id,'demo-luca').structure,true);
});

test('equal authority moderation is off by default, configurable and never defeats owner protection',async()=>{
 const s=await store(),h=s.snapshot().selectedHubId;await s.setRole('demo-luca','Moderator');assert.equal(s.canModerate('demo-ari','demo-luca',h),false);await s.updateHub(h,{allowEqualAuthorityModeration:true});assert.equal(s.canModerate('demo-ari','demo-luca',h),true);assert.equal(s.canModerate('demo-ari',identity,h),false);assert.equal(s.canModerate(identity,'demo-ari',h),true);
});

test('home presets and theme bindings survive reload without leaking package metadata into permissions',async()=>{
 const m=memory(),s=await store(m),h=s.snapshot().selectedHubId,n=await s.createNode({hubId:h,kind:'space',name:'Home'});await s.setHome(n.id,{preset:'banner',welcome:'Welcome home',featuredIds:['welcome']});await s.setThemeBinding(n.id,{mode:'package',packageId:'viking',version:'1.0.0',overrides:{tokens:{density:'compact'}}});const again=await store(m);assert.equal(again.snapshot().nodes.find(x=>x.id===n.id).home.preset,'banner');assert.equal(again.snapshot().nodes.find(x=>x.id===n.id).themeBinding.packageId,'viking');await assert.rejects(()=>s.setHome(n.id,{preset:'arbitrary'}),/preset/i);
});

test('schema rejects cycles, identity mismatches, unsafe IDs and corrupt permission dimensions',async()=>{
 const M=api(),s=(await store()).snapshot();s.identity=other;assert.throws(()=>M.validateState(s,identity),/identity/i);s.identity=identity;const a=s.nodes.find(n=>n.kind==='folder');a.parentId=a.id;assert.throws(()=>M.validateState(s,identity),/cycle/i);a.parentId=null;a.id='__proto__';assert.throws(()=>M.validateState(s,identity),/id/i);
});

test('migration chooses a collision-free hub ID and retains existing channel IDs',async()=>{
 const old=legacy();old.channels[0].id='workshop';old.selectedChannel='workshop';old.messages.workshop=old.messages.original;old.drafts.workshop=old.drafts.original;const m=memory();m.records.set(identity,old);const s=await store(m);assert.equal(s.snapshot().selectedNodeId,'workshop');assert.notEqual(s.snapshot().selectedHubId,'workshop');assert.equal(s.snapshot().messages.workshop[0].text,'Do not lose me');
});

test('silent failed storage writes and backup failures never claim migration is saved',async()=>{
 const raw=local();raw.setItem('vumiro.server-sandbox.v1.'+identity,JSON.stringify(legacy()));const set=raw.setItem.bind(raw);raw.setItem=(k,v)=>{if(!k.startsWith('vumiro.community.v2.backup.'))set(k,v);};let s=await store(api().createLocalStorageAdapter(raw));assert.equal(s.status().saved,false);assert.equal(raw.getItem('vumiro.community.v2.'+identity),null);raw.setItem=(k,v)=>{if(k!=='vumiro.community.v2.'+identity)set(k,v);};s=await store(api().createLocalStorageAdapter(raw));assert.equal(s.status().saved,false);assert.equal(s.snapshot().drafts.original,'unsent words');
});

test('permission draft previews do not save and ancestor dimension denies cannot be overridden',async()=>{
 const s=await store(),h=s.snapshot().selectedHubId,p=await s.createNode({hubId:h,kind:'space',name:'Parent'}),c=await s.createNode({hubId:h,parentId:p.id,kind:'text',name:'Child'});const before=s.snapshot();assert.equal(s.previewAccess(c.id,'demo-luca',{mode:'restricted',memberIds:[identity]}).view,false);assert.equal(s.snapshot().nodes.find(n=>n.id===c.id).access.mode,'all');assert.equal(before.nodes.length,s.snapshot().nodes.length);await s.setAccess(p.id,{permissions:{post:{denyRoles:['Member']}}});await s.setAccess(c.id,{permissions:{post:{allowMembers:['demo-luca']}}});assert.equal(s.previewAccess(c.id,'demo-luca').post,false);assert.equal(s.previewAccess(c.id,{roleIds:['Member']}).post,false);
});

test('queued writes serialize snapshots and later saves cannot be marked by earlier completions',async()=>{
 let release,writes=0;const saved=[],storage={async load(){return null;},async save(id,value){writes++;if(writes===1)await new Promise(r=>release=r);saved.push({id,value});}};const s=await store(storage),first=s.setDraft('welcome','first'),second=s.setDraft('welcome','second');await new Promise(r=>setImmediate(r));assert.equal(writes,1);assert.equal(s.status().saved,false);release();await Promise.all([first,second]);assert.equal(writes,2);assert.equal(saved[0].value.drafts.welcome,'first');assert.equal(saved[1].value.drafts.welcome,'second');assert.ok(saved.every(value=>value.id===identity));assert.equal(s.status().saved,true);
});

test('cross-hub moves preserve history and invalid edits roll back atomically',async()=>{
 const s=await store(),original=s.snapshot().selectedHubId,next=await s.createHub({name:'Second'});await s.moveNode('welcome',null,{hubId:next.id});assert.equal(s.snapshot().nodes.find(n=>n.id==='welcome').hubId,next.id);assert.equal(s.snapshot().messages.welcome[0].id,'seed-welcome');const before=JSON.stringify(s.snapshot());await assert.rejects(()=>s.updateNode('welcome',{name:''}),/name/i);assert.equal(JSON.stringify(s.snapshot()),before);await s.selectHub(original);assert.ok(!s.snapshot().channels.some(n=>n.id==='welcome'));
});

test('delegated managers can restore their archived scope and descendant restrictions remain enforced',async()=>{
 const s=await store(),h=s.snapshot().selectedHubId,p=await s.createNode({hubId:h,kind:'space',name:'Managed archive',managerIds:['demo-luca']});await s.archiveNode(p.id,{actor:'demo-luca'});assert.ok(s.archivedNodes(h,'demo-luca').some(n=>n.id===p.id));await s.restoreNode(p.id,{actor:'demo-luca'});assert.equal(s.previewAccess(p.id,'demo-luca').structure,true);await s.setAccess(p.id,{mode:'restricted',memberIds:[identity]});await s.archiveNode(p.id);assert.ok(!s.archivedNodes(h,'demo-luca').some(n=>n.id===p.id));await assert.rejects(()=>s.restoreNode(p.id,{actor:'demo-luca'}),/permission/i);
});
