(() => {
  'use strict';
  // LOCAL DEMO: these checks support previews. A future service must authorize every operation.
  const DIMENSIONS = Object.freeze(['view', 'post', 'joinVoice', 'speak', 'moderate', 'structure', 'themes', 'roles']);
  const HOME_PRESETS = Object.freeze(['compact', 'banner', 'split']);
  const ACCESS_MODES = Object.freeze(['all', 'joinable', 'approval', 'invite', 'restricted']);
  const LIMITS = Object.freeze({bytes:1500000, hubs:20, nodes:500, messages:40, message:1000, draft:1000});
  const clone = value => JSON.parse(JSON.stringify(value));
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const emptyMap = () => Object.create(null);
  // Shared UI affordances mirror the service's canAccess rules. The service
  // still authorizes every request; this never changes the local demo schema.
  function sharedAccess(snapshot, actorId, scopeId, permission='view') {
    if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||typeof actorId!=='string'||!actorId||typeof scopeId!=='string'||!scopeId)return false;
    const hubId=snapshot.hubId||snapshot.id;
    if(typeof hubId!=='string'||!hubId||typeof snapshot.ownerId!=='string'||!snapshot.ownerId)return false;
    const state={id:hubId,ownerId:snapshot.ownerId,equalAuthorityModeration:snapshot.equalAuthorityModeration};
    for(const key of ['nodes','members','roles']) {
      if(!Array.isArray(snapshot[key]))return false;
      const records=emptyMap();
      for(const value of snapshot[key]) {
        if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.id!=='string'||!value.id||own(records,value.id))return false;
        records[value.id]=value;
      }
      state[key]=records;
    }
    const sharedIds=value=>Array.isArray(value)?value.filter(x=>typeof x==='string'):[];
    const rolePermissions=role=>Array.isArray(role.permissions)?role.permissions:Object.keys(role.permissions||{}).filter(k=>role.permissions[k]===true).map(k=>k==='joinVoice'?'voice':k);
    const member=state.members[actorId];if(!member||member.banned)return false;
    const chain=[],seen=new Set();let node=state.nodes[scopeId];
    while(node){if(seen.has(node.id))return false;seen.add(node.id);chain.push(node);if(node.id===state.id)break;node=state.nodes[node.parentId];}
    if(chain.at(-1)?.id!==state.id||chain.some(n=>n.archived))return false;
    if(actorId===state.ownerId)return true;
    const roles=sharedIds(member.roles||member.roleIds).map(r=>state.roles[r]).filter(Boolean);
    let granted=roles.some(r=>rolePermissions(r).includes(permission)&&(!r.scopeId||chain.some(n=>n.id===r.scopeId))),viewGranted=roles.some(r=>rolePermissions(r).includes('view')&&(!r.scopeId||chain.some(n=>n.id===r.scopeId)));
    let denied=false,viewDenied=false;
    for(const n of chain) {
      const access=n.access||{},mode=access.mode||'all',allowedMembers=sharedIds(access.members||access.memberIds),allowedRoles=sharedIds(access.roles||access.roleIds),approved=[...sharedIds(access.approvedMembers),...(['joinable','approval'].includes(mode)?sharedIds(access.joinedMemberIds):mode==='invite'?sharedIds(access.invitedMemberIds):[])];
      if(!['all','open','public','members','inherit'].includes(mode)&&!allowedMembers.includes(actorId)&&!approved.includes(actorId)&&!roles.some(r=>allowedRoles.includes(r.id)))return false;
      if(sharedIds(access.deniedMembers).includes(actorId)||roles.some(r=>sharedIds(access.deniedRoles).includes(r.id)))return false;
      if(access.permissions?.[permission]===false||n.permissions?.[permission]===false)denied=true;if(access.permissions?.view===false||n.permissions?.view===false)viewDenied=true;
      if(sharedIds(n.managers||n.managerIds).includes(actorId)){viewGranted=true;if(['view','structure','themes','moderate'].includes(permission))granted=true;}
      for(const dimension of [permission,...(permission==='view'?[]:['view'])]) {
        const rule=access.permissions?.[dimension]||access.permissions?.[dimension==='voice'?'joinVoice':dimension];
        if(!rule||typeof rule!=='object')continue;
        const deny=sharedIds(rule.denyMembers).includes(actorId)||roles.some(r=>sharedIds(rule.denyRoles).includes(r.id)),allow=sharedIds(rule.allowMembers).includes(actorId)||roles.some(r=>sharedIds(rule.allowRoles).includes(r.id));
        if(dimension==='view'){viewDenied=viewDenied||deny;viewGranted=viewGranted||allow;}
        if(dimension===permission){denied=denied||deny;granted=granted||allow;}
      }
    }
    return granted&&!denied&&viewGranted&&!viewDenied;
  }
  function identityKey(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw Error('A valid profile identity is required.');
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ['__proto__','constructor','prototype'].includes(value)) throw Error('Invalid ID.');
    return value;
  }
  function text(value, max, label, required=true) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw Error(label+' must contain '+(required?'1–':'0–')+max+' characters.');
    return value.trim();
  }
  function ids(value=[]) {
    if (!Array.isArray(value) || value.length>1000) throw Error('Invalid member or role IDs.');
    return Array.from(new Set(value.map(id)));
  }
  function access(value={}) {
    const mode=value.mode??'all';
    if (!ACCESS_MODES.includes(mode)) throw Error('Invalid access mode.');
    const permissions={};
    for (const [dimension, rule] of Object.entries(value.permissions??{})) {
      if (!DIMENSIONS.includes(dimension) || !rule || typeof rule!=='object') throw Error('Invalid permission dimension.');
      permissions[dimension]={};
      for (const key of ['allowRoles','denyRoles','allowMembers','denyMembers']) permissions[dimension][key]=ids(rule[key]);
    }
    return {mode,roleIds:ids(value.roleIds),memberIds:ids(value.memberIds),joinedMemberIds:ids(value.joinedMemberIds),invitedMemberIds:ids(value.invitedMemberIds),permissions};
  }
  function home(value={}) {
    const preset=value.preset??'compact';
    if (!HOME_PRESETS.includes(preset)) throw Error('Invalid home preset.');
    return {preset,welcome:text(value.welcome??'',2000,'Welcome',false),featuredIds:ids(value.featuredIds),announcements:text(value.announcements??'',2000,'Announcements',false),showActivity:value.showActivity!==false};
  }
  function binding(value={mode:'inherit'}) {
    const overrides=value.overrides??{};
    if (!overrides || typeof overrides!=='object' || Array.isArray(overrides) || Object.keys(overrides).some(key=>!['tokens','components','layout'].includes(key)) || JSON.stringify(overrides).length>40000) throw Error('Invalid theme overrides.');
    if (value.mode==='inherit') return {mode:'inherit',...(Object.keys(overrides).length?{overrides:clone(overrides)}:{})};
    const packageId=text(value.packageId,100,'Theme package'),version=text(value.version,40,'Theme version');
    if (!/^[A-Za-z0-9_.-]+$/.test(packageId) || !/^[A-Za-z0-9_.+-]+$/.test(version)) throw Error('Invalid theme binding.');
    return {mode:'package',packageId,version,overrides:clone(overrides)};
  }
  function defaultRoles() {
    return [{id:'Host',name:'Host',authority:100,permissions:Object.fromEntries(DIMENSIONS.map(p=>[p,true]))},
      {id:'Moderator',name:'Moderator',authority:50,permissions:{view:true,post:true,joinVoice:true,speak:true,moderate:true}},
      {id:'Member',name:'Member',authority:10,permissions:{view:true,post:true,joinVoice:true,speak:true}}];
  }
  function demoMembers() {
    return [{id:'demo-mira',name:'Mira Chen',status:'online',activity:'Sketching a new idea',roleIds:['Host'],role:'Host',demo:true},
      {id:'demo-luca',name:'Luca Silva',status:'online',activity:'At the workbench',roleIds:['Member'],role:'Member',demo:true},
      {id:'demo-ari',name:'Ari Morgan',status:'away',activity:'Taking a break',roleIds:['Moderator'],role:'Moderator',demo:true},
      {id:'demo-noor',name:'Noor Ahmed',status:'offline',activity:'Back later',roleIds:['Member'],role:'Member',demo:true}];
  }
  function hubTemplate(identity, hubId='workshop', name='The Workshop') {
    return {id:hubId,name,description:'A small place to build something together.',ownerId:identity,roles:defaultRoles(),members:[{id:identity,name:'You',roleIds:['Host'],role:'Host',demo:false},...demoMembers()],access:access(),home:home({welcome:'Welcome to your local Community Hub.'}),themeBinding:binding(),allowEqualAuthorityModeration:false};
  }
  function nodeTemplate(fields) {
    return {id:id(fields.id),hubId:id(fields.hubId),parentId:fields.parentId??null,kind:fields.kind,name:text(fields.name,64,'Node name'),description:text(fields.description??'',280,'Description',false),order:fields.order??0,archived:fields.archived===true,access:access(fields.access),managerIds:ids(fields.managerIds),home:home(fields.home),themeBinding:binding(fields.themeBinding),participantIds:ids(fields.participantIds)};
  }
  function seed(identity) {
    const hub=hubTemplate(identity),nodes=[
      {id:'start-here',kind:'folder',name:'Start here'}, {id:'welcome',kind:'text',name:'welcome',parentId:'start-here',description:'Say hello and find your way around.'},
      {id:'together',kind:'folder',name:'Together'}, {id:'workbench',kind:'text',name:'workbench',parentId:'together',description:'Ideas, progress, and small discoveries.'},
      {id:'listening-room',kind:'voice',name:'Listening room',parentId:'together',description:'A quiet voice space. Preview only.',participantIds:['demo-luca','demo-ari']},
      {id:'games',kind:'folder',name:'Games'}, {id:'valheim',kind:'space',name:'Valheim',parentId:'games',themeBinding:{packageId:'viking',version:'1.0.0'},home:{preset:'banner',welcome:'Gather at the longhouse. Plan the next expedition.'}},
      {id:'expedition-planning',kind:'text',name:'Expedition planning',parentId:'valheim'}, {id:'expeditions',kind:'folder',name:'Expeditions',parentId:'valheim'},
      {id:'viking-longhouse',kind:'voice',name:'Viking longhouse',parentId:'expeditions'},
      {id:'cyberpunk',kind:'space',name:'Cyberpunk',parentId:'games',themeBinding:{packageId:'cyberpunk',version:'1.0.0'},home:{preset:'split',welcome:'Build something bright in Night City.'}},
      {id:'builds',kind:'text',name:'Builds',parentId:'cyberpunk'}, {id:'night-city',kind:'voice',name:'Night City',parentId:'cyberpunk'}
    ].map((n,index)=>nodeTemplate({...n,hubId:hub.id,order:index}));
    return validateState({version:2,mode:'local-demo',identity,hubs:[hub],nodes,selectedHubId:hub.id,selectedNodeId:'welcome',collapsed:[],messages:{welcome:[{id:'seed-welcome',authorId:'demo-mira',author:'Mira Chen',text:'Welcome to the Workshop. This is a local space to try channels, messages, and management.',at:1794268800000,demo:true}],workbench:[{id:'seed-workbench',authorId:'demo-luca',author:'Luca Silva',text:'What should we make here first?',at:1794268860000,demo:true}]},drafts:{},unread:{}},identity);
  }
  function getTarget(state,targetId) {
    const target=state.nodes.find(n=>n.id===targetId)||state.hubs.find(h=>h.id===targetId);
    if (!target) throw Error('Node or hub does not exist.');
    return target;
  }
  function ancestry(state,targetId) {
    let target=getTarget(state,targetId);const path=[],seen=new Set();
    while (target) {
      if (seen.has(target.id)) throw Error('Tree cycle is not allowed.');seen.add(target.id);path.unshift(target);
      target=target.hubId?(target.parentId?getTarget(state,target.parentId):getTarget(state,target.hubId)):null;
    }
    return path;
  }
  function memberFor(hub,actor) {
    if (typeof actor==='string') return hub.members.find(m=>m.id===actor)||null;
    if (actor && typeof actor==='object') {
      const member=hub.members.find(m=>m.id===actor.id);
      if (member) return {...member,...(actor.roleIds?{roleIds:actor.roleIds}:{})};
      // Role-only objects are explicit LOCAL DEMO previews, never persisted memberships.
      if (!actor.id && Array.isArray(actor.roleIds)) return {id:'role-preview',roleIds:actor.roleIds};
    }
    return null;
  }
  function evaluateAccess(state,targetId,actor=state.identity) {
    const path=ancestry(state,targetId),hub=path[0],member=memberFor(hub,actor),result=Object.fromEntries(DIMENSIONS.map(p=>[p,false]));
    const output={...result,localPreview:true,reason:'Hub membership required.'};
    if (!member) return output;
    if (path.some(n=>n.archived)) return {...output,reason:'Archived content.'};
    if (member.id===hub.ownerId) return {...Object.fromEntries(DIMENSIONS.map(p=>[p,true])),localPreview:true,reason:'Hub owner (local preview).'};
    const roles=hub.roles.filter(r=>member.roleIds.includes(r.id)),roleSet=new Set(roles.map(r=>r.id)),blocked=new Set();
    for (const dimension of DIMENSIONS) result[dimension]=roles.some(r=>r.permissions[dimension]===true);
    for (const target of path) {
      const rules=target.access;
      const admitted=rules.mode==='all' || rules.memberIds.includes(member.id) || rules.roleIds.some(r=>roleSet.has(r)) || ((rules.mode==='joinable'||rules.mode==='approval')&&rules.joinedMemberIds.includes(member.id)) || (rules.mode==='invite'&&rules.invitedMemberIds.includes(member.id));
      if (!admitted) return {...output,reason:'Restricted by '+target.name+'.'};
      if ((target.managerIds??[]).includes(member.id)) for (const dimension of ['view','moderate','structure','themes']) result[dimension]=true;
      for (const [dimension,rule] of Object.entries(rules.permissions)) {
        if (rule.denyMembers.includes(member.id)||rule.denyRoles.some(r=>roleSet.has(r))) blocked.add(dimension);
        if (rule.allowMembers.includes(member.id)||rule.allowRoles.some(r=>roleSet.has(r))) result[dimension]=true;
      }
    }
    for (const dimension of blocked) result[dimension]=false;
    if (!result.view) for (const dimension of DIMENSIONS) result[dimension]=false;
    return {...result,localPreview:true,reason:result.view?'Effective local permission preview.':'Viewing is denied.'};
  }
  function canModerate(state,actor,targetMemberId,scopeId) {
    const path=ancestry(state,scopeId),hub=path[0],source=memberFor(hub,actor),target=memberFor(hub,targetMemberId);
    if (!source||!target||source.id===target.id||target.id===hub.ownerId||!evaluateAccess(state,scopeId,actor).moderate) return false;
    if (source.id===hub.ownerId) return true;
    const authority=member=>Math.max(0,...hub.roles.filter(r=>member.roleIds.includes(r.id)).map(r=>r.authority));
    return authority(source)>authority(target)||(hub.allowEqualAuthorityModeration&&authority(source)===authority(target));
  }
  function validateState(value,identity) {
    identityKey(identity);
    if (!value || value.version!==2 || value.mode!=='local-demo') throw Error('Invalid community schema.');
    if (value.identity!==identity) throw Error('Community identity mismatch.');
    if (!Array.isArray(value.hubs)||!value.hubs.length||value.hubs.length>LIMITS.hubs||!Array.isArray(value.nodes)||value.nodes.length>LIMITS.nodes) throw Error('Invalid community tree.');
    const seen=new Set(),claim=value=>{id(value);if(seen.has(value))throw Error('Duplicate ID.');seen.add(value);};
    const hubs=value.hubs.map(h=>{
      claim(h.id);identityKey(h.ownerId);if(h.ownerId!==identity)throw Error('Local hub owner identity mismatch.');
      const roles=(h.roles??defaultRoles()).map(r=>{id(r.id);const permissions={};for(const [key,v]of Object.entries(r.permissions??{})){if(!DIMENSIONS.includes(key)||typeof v!=='boolean')throw Error('Invalid role permission dimension.');permissions[key]=v;}if(!Number.isFinite(r.authority)||r.authority<0||r.authority>10000)throw Error('Invalid authority bracket.');return {id:r.id,name:text(r.name,64,'Role name'),authority:r.authority,permissions};});
      if (roles.length>100||new Set(roles.map(r=>r.id)).size!==roles.length) throw Error('Invalid roles.');
      const members=(h.members??[]).map(m=>({id:id(m.id),name:text(m.name,80,'Member name'),roleIds:ids(m.roleIds??[m.role??'Member']),role:m.role??m.roleIds?.[0]??'Member',status:['online','away','offline'].includes(m.status)?m.status:'offline',activity:text(m.activity??'',280,'Activity',false),demo:m.demo===true}));
      if (members.length>500||new Set(members.map(m=>m.id)).size!==members.length||!members.some(m=>m.id===identity)||members.some(m=>m.roleIds.some(r=>!roles.some(role=>role.id===r))))throw Error('Invalid hub membership.');
      return {id:h.id,name:text(h.name,64,'Hub name'),description:text(h.description??'',280,'Description',false),ownerId:h.ownerId,roles,members,access:access(h.access),home:home(h.home),themeBinding:binding(h.themeBinding),allowEqualAuthorityModeration:h.allowEqualAuthorityModeration===true};
    });
    const nodes=value.nodes.map(n=>{claim(n.id);if(!['folder','space','text','voice'].includes(n.kind))throw Error('Invalid node kind.');if(!Number.isFinite(n.order))throw Error('Invalid node order.');return nodeTemplate(n);});
    const out={version:2,mode:'local-demo',identity,hubs,nodes,selectedHubId:value.selectedHubId,selectedNodeId:value.selectedNodeId??null,collapsed:ids(value.collapsed),messages:emptyMap(),drafts:emptyMap(),unread:emptyMap()};
    for (const n of nodes) {
      if (!hubs.some(h=>h.id===n.hubId)) throw Error('Invalid node hub.');
      if (n.parentId!==null) {id(n.parentId);const parent=nodes.find(p=>p.id===n.parentId);if(!parent||parent.hubId!==n.hubId||!['folder','space'].includes(parent.kind))throw Error('Invalid parent container.');}
      ancestry(out,n.id);
      const history=value.messages?.[n.id]??[];
      if (!Array.isArray(history)||history.length>LIMITS.messages||(n.kind!=='text'&&history.length))throw Error('Invalid messages.');
      const hub=hubs.find(h=>h.id===n.hubId),messageIds=new Set();
      out.messages[n.id]=history.map(m=>{id(m.id);if(messageIds.has(m.id)||!Number.isFinite(m.at)||m.at<0||m.at>8640000000000000)throw Error('Invalid message.');messageIds.add(m.id);const demo=m.demo===true&&hub.members.some(member=>member.id===m.authorId&&member.demo);if(!demo&&m.authorId!==identity)throw Error('Invalid message author.');return {id:m.id,authorId:m.authorId,author:text(m.author,80,'Author'),text:text(m.text,LIMITS.message,'Message'),at:m.at,demo};});
      const draft=value.drafts?.[n.id]??'';if(typeof draft!=='string'||draft.length>LIMITS.draft)throw Error('Invalid draft.');out.drafts[n.id]=n.kind==='text'?draft:'';
      const unread=value.unread?.[n.id]??0;if(!Number.isSafeInteger(unread)||unread<0)throw Error('Invalid unread count.');out.unread[n.id]=unread;
    }
    if (!hubs.some(h=>h.id===out.selectedHubId))out.selectedHubId=hubs[0].id;
    if (!nodes.some(n=>n.id===out.selectedNodeId&&n.hubId===out.selectedHubId&&!ancestry(out,n.id).some(a=>a.archived)))out.selectedNodeId=null;
    out.collapsed=out.collapsed.filter(value=>nodes.some(n=>n.id===value&&['folder','space'].includes(n.kind)));
    if(JSON.stringify(out).length>LIMITS.bytes)throw Error('Community data too large.');
    return out;
  }
  function migrate(value,identity) {
    if (!value||value.version!==1||value.mode!=='local-demo'||!Array.isArray(value.channels)||!value.channels.length)throw Error('Invalid legacy community.');
    const occupied=new Set(value.channels.map(c=>c.id));let hubId='workshop';
    while(occupied.has(hubId))hubId+='-hub';
    const hub=hubTemplate(identity,hubId);hub.name=text(value.name,64,'Hub name');hub.description=text(value.description??'',280,'Description',false);
    for(const member of hub.members){const old=value.members?.find(m=>m.id===member.id);if(old&&hub.roles.some(r=>r.id===old.role)){member.role=old.role;member.roleIds=[old.role];}}
    const nodes=[],categories=new Map();occupied.add(hub.id);let serial=0;
    for(const c of value.channels){if(!['text','voice'].includes(c.kind))throw Error('Invalid legacy channel.');const category=text(c.category,40,'Category');if(!categories.has(category)){let folderId;do{folderId='legacy-folder-'+(++serial);}while(occupied.has(folderId));occupied.add(folderId);categories.set(category,folderId);nodes.push(nodeTemplate({id:folderId,hubId:hub.id,kind:'folder',name:category,order:nodes.length}));}nodes.push(nodeTemplate({id:c.id,hubId:hub.id,parentId:categories.get(category),kind:c.kind,name:c.name,description:c.description??'',order:nodes.length}));}
    return validateState({version:2,mode:'local-demo',identity,hubs:[hub],nodes,selectedHubId:hub.id,selectedNodeId:value.selectedChannel,collapsed:[],messages:value.messages??{},drafts:value.drafts??{},unread:value.unread??{}},identity);
  }
  function createLocalStorageAdapter(storage) {
    const key=identity=>'vumiro.community.v2.'+identityKey(identity),legacy=identity=>'vumiro.server-sandbox.v1.'+identityKey(identity),backup=identity=>'vumiro.community.v2.backup.'+identityKey(identity);
    function parse(raw) {if(raw.length>LIMITS.bytes)throw Error('Community data too large.');return JSON.parse(raw);}
    return {
      async load(identity) {
        let error;const raw=storage.getItem(key(identity));
        if(raw!==null)try{return validateState(parse(raw),identity);}catch(e){error=e;}
        const original=storage.getItem(legacy(identity))??storage.getItem(backup(identity));
        if(original!==null){const old=parse(original);migrate(old,identity);return old;}
        if(error)throw error;return null;
      },
      async backup(identity) {
        const original=storage.getItem(legacy(identity));if(original===null)return;
        if(storage.getItem(backup(identity))===null){storage.setItem(backup(identity),original);if(storage.getItem(backup(identity))!==original)throw Error('Migration backup could not be verified.');}
      },
      async save(identity,state) {
        const raw=JSON.stringify(validateState(state,identity));storage.setItem(key(identity),raw);
        if(storage.getItem(key(identity))!==raw)throw Error('Community save could not be verified.');
        validateState(parse(storage.getItem(key(identity))),identity);
      }
    };
  }
  async function createStore({identity,storage,now=()=>Date.now()}) {
    identityKey(identity);let state=seed(identity),serial=0,revision=0,queue=Promise.resolve();
    let health={saved:true,error:'',recovered:false,fresh:true,migrated:false};
    if(!storage)storage={async load(){return null;},async save(){throw Error('Storage unavailable.');}};
    try{const loaded=await storage.load(identity);if(loaded!==null){state=loaded.version===1?migrate(loaded,identity):validateState(loaded,identity);health.fresh=false;health.migrated=loaded.version===1;}}catch{health={...health,saved:false,error:'load',recovered:true};}
    function persist() {
      const snapshot=clone(state),savingRevision=++revision;health.saved=false;health.fresh=false;health.error='';
      queue=queue.then(async()=>{try{if(health.migrated&&storage.backup)await storage.backup(identity);await storage.save(identity,snapshot);if(savingRevision===revision){health.saved=true;health.error='';}}catch{if(savingRevision===revision){health.saved=false;health.error='save';}}});return queue;
    }
    if(health.migrated)await persist();
    const actorOf=options=>options?.actor??identity;
    function requirePermission(targetId,dimension,options) {if(!evaluateAccess(state,targetId,actorOf(options))[dimension])throw Error('Permission denied: '+dimension+'.');return getTarget(state,targetId);}
    function node(targetId){const target=state.nodes.find(n=>n.id===targetId);if(!target)throw Error('Node does not exist.');return target;}
    function freshId(prefix){let result;do{result=prefix+'-'+(++serial).toString(36);}while(state.nodes.some(n=>n.id===result)||state.hubs.some(h=>h.id===result)||Object.values(state.messages).some(history=>history.some(m=>m.id===result)));return result;}
    function transact(update) {const previous=state;try{state=clone(state);const result=update();state=validateState(state,identity);return {result,pending:persist()};}catch(error){state=previous;throw error;}}
    async function change(update){const {result,pending}=transact(update);await pending;return result===undefined?undefined:clone(result);}
    function children(hubId,parentId){return state.nodes.filter(n=>n.hubId===hubId&&n.parentId===parentId).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id));}
    function place(target,parentId,hubId,index) {
      const descendants=new Set(state.nodes.filter(n=>ancestry(state,n.id).some(p=>p.id===target.id)).map(n=>n.id));
      if(parentId&&descendants.has(parentId))throw Error('Tree cycle is not allowed.');
      if(hubId!==target.hubId){const sourceHub=state.hubs.find(h=>h.id===target.hubId),destination=state.hubs.find(h=>h.id===hubId);for(const descendant of state.nodes.filter(n=>descendants.has(n.id))){for(const member of sourceHub.members.filter(m=>(state.messages[descendant.id]??[]).some(message=>message.authorId===m.id))){if(!destination.members.some(m=>m.id===member.id))destination.members.push(clone(member));}descendant.hubId=hubId;}}
      target.parentId=parentId;target.hubId=hubId;const siblings=children(hubId,parentId).filter(n=>n.id!==target.id);siblings.splice(Math.max(0,Math.min(index??siblings.length,siblings.length)),0,target);siblings.forEach((n,i)=>n.order=i);
    }
    function destination(parentId,hubId,options){const target=requirePermission(parentId??hubId,'structure',options);if(parentId&&!['folder','space'].includes(target.kind))throw Error('A parent container is required.');if(parentId&&target.hubId!==hubId)throw Error('Parent belongs to another hub.');return target;}
    function restoreAccess(targetId,actor) {const preview=clone(state);getTarget(preview,targetId).archived=false;return evaluateAccess(preview,targetId,actor);}
    function tree(hubId=state.selectedHubId,{query='',actor=identity}={}) {
      const normalized=String(query).trim().toLocaleLowerCase(),visible=state.nodes.filter(n=>n.hubId===hubId&&evaluateAccess(state,n.id,actor).view);
      const allowed=new Set(visible.map(n=>n.id)),matches=new Set(visible.filter(n=>(n.name+' '+n.description).toLocaleLowerCase().includes(normalized)).map(n=>n.id)),revealed=new Set();
      if(normalized)for(const match of matches)for(const parent of ancestry(state,match))if(allowed.has(parent.id))revealed.add(parent.id);
      const rows=[];function visit(parentId,depth){for(const n of children(hubId,parentId)){if(!allowed.has(n.id)||(normalized&&!revealed.has(n.id)))continue;const collapsed=state.collapsed.includes(n.id);rows.push({...clone(n),depth,matched:normalized?matches.has(n.id):false,hasChildren:children(hubId,n.id).some(c=>allowed.has(c.id)),collapsed});if(normalized||!collapsed)visit(n.id,depth+1);}}visit(null,0);return rows;
    }
    const store={
      snapshot(){const out=clone(state),hub=out.hubs.find(h=>h.id===out.selectedHubId);out.name=hub.name;out.description=hub.description;out.members=clone(hub.members);out.channels=out.nodes.filter(n=>n.hubId===hub.id&&['text','voice'].includes(n.kind)).map(n=>({...n,category:n.parentId?(out.nodes.find(p=>p.id===n.parentId)?.name??'Community'):'Community'}));out.selectedChannel=out.selectedNodeId;return out;},
      status:()=>({...health}),flush:()=>queue,
      async selectHub(hubId,options){requirePermission(hubId,'view',options);return change(()=>{state.selectedHubId=hubId;state.selectedNodeId=null;});},
      async selectNode(targetId,options){const target=requirePermission(targetId,'view',options);return change(()=>{state.selectedHubId=target.hubId??target.id;state.selectedNodeId=target.hubId?targetId:null;if(target.hubId)state.unread[targetId]=0;});},
      async setCollapsed(targetId,collapsed=true){const target=node(targetId);if(!['folder','space'].includes(target.kind))throw Error('A container is required.');return change(()=>{state.collapsed=state.collapsed.filter(value=>value!==targetId);if(collapsed)state.collapsed.push(targetId);});},
      async setDraft(targetId,value,options){requirePermission(targetId,'post',options);if(node(targetId).kind!=='text')throw Error('A text channel is required.');if(typeof value!=='string'||value.length>LIMITS.draft)throw Error('Draft is too long.');return change(()=>{state.drafts[targetId]=value;});},
      async postMessage(targetId,value,author='You',options){requirePermission(targetId,'post',options);if(node(targetId).kind!=='text')throw Error('A text channel is required.');const message={id:freshId('local'),authorId:identity,author:text(author,80,'Author'),text:text(value,LIMITS.message,'Message'),at:now(),demo:false};return change(()=>{state.messages[targetId]=[...(state.messages[targetId]??[]),message].slice(-LIMITS.messages);state.drafts[targetId]='';return message;});},
      async setUnread(targetId,value){node(targetId);return change(()=>{state.unread[targetId]=value;});},
      async createHub(fields={}){return change(()=>{const hub=hubTemplate(identity,freshId('hub'),text(fields.name??'New community',64,'Hub name'));if(fields.description!==undefined)hub.description=text(fields.description,280,'Description',false);state.hubs.push(hub);state.selectedHubId=hub.id;state.selectedNodeId=null;return hub;});},
      async createNode(fields,options){const hubId=fields.hubId??state.selectedHubId,parentId=fields.parentId??null;destination(parentId,hubId,options);if(fields.managerIds?.length||fields.access!==undefined)requirePermission(parentId??hubId,'roles',options);if(fields.themeBinding!==undefined)requirePermission(parentId??hubId,'themes',options);return change(()=>{const target=nodeTemplate({...fields,id:freshId('node'),hubId,parentId,order:children(hubId,parentId).length});state.nodes.push(target);return target;});},
      async updateHub(hubId,patch,options){requirePermission(hubId,'structure',options);if(patch.allowEqualAuthorityModeration!==undefined)requirePermission(hubId,'roles',options);return change(()=>{const hub=state.hubs.find(h=>h.id===hubId);for(const key of ['name','description','allowEqualAuthorityModeration'])if(own(patch,key))hub[key]=patch[key];});},
      async updateNode(targetId,patch,options){requirePermission(targetId,'structure',options);if(patch.managerIds!==undefined)requirePermission(targetId,'roles',options);return change(()=>{const target=node(targetId);for(const key of ['name','description','managerIds'])if(own(patch,key))target[key]=patch[key];});},
      async renameNode(targetId,name,options){return store.updateNode(targetId,{name},options);},
      async moveNode(targetId,parentId=null,options={}){const target=requirePermission(targetId,'structure',options),hubId=options.hubId??(parentId?node(parentId).hubId:target.hubId);if(!target.hubId)throw Error('A node is required.');requirePermission(target.parentId??target.hubId,'structure',options);destination(parentId,hubId,options);if(ancestry(state,parentId??hubId).some(n=>n.id===targetId))throw Error('Tree cycle is not allowed.');return change(()=>{place(node(targetId),parentId,hubId,options.index);});},
      async reorderNode(targetId,index,options={}){const target=node(targetId);return store.moveNode(targetId,target.parentId,{...options,index});},
      async archiveNode(targetId,options){requirePermission(targetId,'structure',options);return change(()=>{node(targetId).archived=true;});},
      async restoreNode(targetId,options){node(targetId);if(!restoreAccess(targetId,actorOf(options)).structure)throw Error('Permission denied: structure.');return change(()=>{node(targetId).archived=false;});},
      async setAccess(targetId,value,options){requirePermission(targetId,'roles',options);return change(()=>{getTarget(state,targetId).access=access(value);});},
      async setHome(targetId,value,options){requirePermission(targetId,'structure',options);return change(()=>{const target=getTarget(state,targetId);if(target.kind&&!['folder','space'].includes(target.kind))throw Error('A home container is required.');target.home=home(value);});},
      async setThemeBinding(targetId,value,options){requirePermission(targetId,'themes',options);return change(()=>{getTarget(state,targetId).themeBinding=binding(value);});},
      async setRole(memberId,roleId,hubId=state.selectedHubId,options){requirePermission(hubId,'roles',options);return change(()=>{const hub=state.hubs.find(h=>h.id===hubId),member=hub.members.find(m=>m.id===memberId);if(!member||!hub.roles.some(r=>r.id===roleId))throw Error('Choose a valid member and role.');member.roleIds=[roleId];member.role=roleId;});},
      async setRoles(hubId,roles,options){requirePermission(hubId,'roles',options);return change(()=>{state.hubs.find(h=>h.id===hubId).roles=clone(roles);});},
      previewAccess:(targetId,actor,draftAccess)=>{if(draftAccess===undefined)return evaluateAccess(state,targetId,actor);const preview=clone(state);getTarget(preview,targetId).access=access(draftAccess);return evaluateAccess(preview,targetId,actor);},
      canModerate:(actor,targetMemberId,scopeId=state.selectedHubId)=>canModerate(state,actor,targetMemberId,scopeId),
      tree,breadcrumbs:(targetId,actor=identity)=>ancestry(state,targetId).filter(n=>evaluateAccess(state,n.id,actor).view).map(clone),
      archivedNodes:(hubId=state.selectedHubId,actor=identity)=>state.nodes.filter(n=>n.hubId===hubId&&n.archived&&restoreAccess(n.id,actor).structure).map(clone),
      unreadTotal:(hubId=state.selectedHubId,actor=identity)=>state.nodes.filter(n=>n.hubId===hubId&&evaluateAccess(state,n.id,actor).view).reduce((total,n)=>total+state.unread[n.id],0),
      visibleActivity:(hubId=state.selectedHubId,actor=identity)=>state.nodes.filter(n=>n.hubId===hubId&&evaluateAccess(state,n.id,actor).view).flatMap(n=>state.messages[n.id].map(m=>({...clone(m),nodeId:n.id}))).sort((a,b)=>b.at-a.at).slice(0,40),
      getMessages:(targetId,actor=identity)=>evaluateAccess(state,targetId,actor).view?clone(state.messages[targetId]??[]):[],
      participants:(targetId,actor=identity)=>{if(!evaluateAccess(state,targetId,actor).view)return [];const target=node(targetId),hub=state.hubs.find(h=>h.id===target.hubId);return target.participantIds.map(participant=>hub.members.find(m=>m.id===participant)).filter(m=>m&&evaluateAccess(state,targetId,m.id).view).map(clone);}
    };
    store.selectChannel=store.selectNode;
    return store;
  }
  window.VumiroCommunityModel={createStore,createLocalStorageAdapter,validateState,evaluateAccess,sharedAccess,canModerate,DIMENSIONS,HOME_PRESETS,ACCESS_MODES,LIMITS};
})();
