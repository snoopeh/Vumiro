/* Community transport is independent from the local demo store and media. */
(() => {
  'use strict';
  const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const canonical=(hubId,id,nonce,action,payload)=>JSON.stringify(['vumiro-community-v1',hubId,id,nonce,action,payload]);
  function createCatalog(options={}) {
    const identity=options.identity;
    if(typeof identity!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(identity))throw Error('A valid local identity is required for remembered communities.');
    const base=new URL(options.baseUrl||window.location?.origin||'https://vumiro.local');
    if(base.protocol==='wss:')base.protocol='https:';if(base.protocol==='ws:')base.protocol='http:';
    if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Community service requires HTTPS.');
    const key='vumiro.community.catalog.v1.'+identity+'.'+encodeURIComponent(base.origin),limit=20;
    let storage=null,entries=[],saved=true;
    try{storage=Object.hasOwn(options,'storage')?options.storage:window.localStorage;}catch{}
    const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
    const validHub=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value);
    const text=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max):'';
    function image(value){
      if(typeof value!=='string'||value.length>200000)return '';
      if(/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return value;
      try{const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password&&url.href.length<=200000)return url.href;}catch{}
      return '';
    }
    function card(value){const c=object(value)?value:{};return {banner:image(c.banner),icon:image(c.icon),frame:['none','aurora','arcade','regal'].includes(c.frame)?c.frame:'none',frameColor:typeof c.frameColor==='string'&&/^#[0-9a-f]{6}$/i.test(c.frameColor)?c.frameColor:'#8b5cf6',frameImage:image(c.frameImage)};}
    function summary(value){return {hubId:value.hubId,name:text(value.name,96)||'Community Hub',description:text(value.description,280),card:card(value.card)};}
    // Read only a bounded public summary schema. Snapshot data is never serialized.
    try{
      const raw=storage?.getItem(key);
      if(typeof raw==='string'&&raw.length<=12100000){
        const cached=JSON.parse(raw);
        if(cached?.version===1&&Array.isArray(cached.entries))for(const row of cached.entries){
          if(object(row)&&validHub(row.hubId)&&typeof row.name==='string'&&typeof row.description==='string'&&!entries.some(e=>e.hubId===row.hubId))entries.push(summary(row));
          if(entries.length===limit)break;
        }
      }
    }catch{}
    function persist(){
      saved=false;
      if(typeof storage?.setItem!=='function')return;
      try{storage.setItem(key,JSON.stringify({version:1,entries}));saved=true;return;}catch{}
      // Keep joined IDs durable when embedded artwork exceeds localStorage quota.
      // Compact only the serialized copy so the open session retains its artwork.
      const compact=entries.map(entry=>({...entry,card:{...entry.card,...Object.fromEntries(['banner','icon','frameImage'].map(field=>{const value=entry.card[field];return [field,value.startsWith('https:')&&value.length<=2048?value:''];}))}}));
      try{storage.setItem(key,JSON.stringify({version:1,entries:compact}));saved=true;}catch{}
    }
    function remember(snapshot){
      if(!object(snapshot))throw Error('A valid community snapshot is required.');
      const nodes=Array.isArray(snapshot.nodes)?snapshot.nodes:object(snapshot.nodes)?Object.values(snapshot.nodes):[];
      const root=nodes.find(n=>object(n)&&n.id===snapshot.hubId)||nodes.find(n=>object(n)&&(n.type==='hub'||n.kind==='hub'))||snapshot;
      const hubId=snapshot.hubId||root.id||snapshot.id;
      if(!validHub(hubId))throw Error('A valid community hub ID is required.');
      const entry=summary({hubId,name:root.name||snapshot.name,description:root.description??snapshot.description,card:root.card});
      entries=[entry,...entries.filter(e=>e.hubId!==hubId)].slice(0,limit);persist();return copy(entry);
    }
    function forget(hubId){if(!validHub(hubId))throw Error('A valid community hub ID is required.');entries=entries.filter(e=>e.hubId!==hubId);persist();}
    return Object.freeze({list:()=>copy(entries),remember,forget,status:()=>({saved})});
  }
  function create(options={}) {
    const identity=options.identity||window.VumiroLocalProfile,http=options.fetch||window.fetch?.bind(window),Socket=options.WebSocket||window.WebSocket;
    const base=new URL(options.baseUrl||window.location?.origin||'https://vumiro.local');
    if(base.protocol==='wss:')base.protocol='https:';if(base.protocol==='ws:')base.protocol='http:';
    if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw Error('Community service requires HTTPS.');
    base.pathname='/';base.search='';base.hash='';
    let hubId=null,boundIdentity=null,socket=null,generation=0,retry=null,attempt=0,currentSnapshot=null,eventCursor=0,watched=null,connection='offline';
    const listeners=new Set(),controllers=new Set(),messages=new Map();
    function emit(event){for(const fn of [...listeners])try{fn(copy(event));}catch(error){window.VumiroDiagnostics?.record('community-listener-error',{name:error.name});}try{options.onEvent?.(copy(event));}catch{}}
    function status(value){connection=value;try{options.onState?.(value);}catch{}emit({type:'community-connection',state:value,hubId});}
    function profile(){const p=identity?.profile?.();if(!p?.id||!p.key)throw Error('A local identity is required for live communities.');if(boundIdentity&&p.id!==boundIdentity){disconnect();throw Error('Your identity changed. Reconnect the community.');}return p;}
    function url(action,target=hubId){if(!target)throw Error('Connect to a community first.');return new URL(`api/community/${encodeURIComponent(target)}/${action}`,base).href;}
    async function fetchJson(endpoint,init={}){if(!http)throw Error('Community networking is unavailable.');const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),15000);try{const result=await http(endpoint,{...init,signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});if(init.binary&&result.ok)return result.blob();const body=await result.json();if(!result.ok||body.error){const error=Error(body.error?.message||'Community request failed.');error.code=body.error?.code||'community-network-error';error.status=result.status;throw error;}return body;}finally{clearTimeout(timer);controllers.delete(controller);}}
    async function request(action,payload={},settings={}){const p=profile(),target=settings.hubId||hubId,epoch=generation,challenge=await fetchJson(url('challenge',target)+'?id='+encodeURIComponent(p.id));if(profile().id!==p.id||epoch!==generation)throw Error('Community connection changed.');const envelope={id:p.id,key:p.key,nonce:challenge.nonce,payload:copy(payload)};envelope.signature=await identity.sign(canonical(target,p.id,envelope.nonce,action,envelope.payload));if(profile().id!==p.id||epoch!==generation)throw Error('Community connection changed.');const result=await fetchJson(url(action,target),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(envelope),binary:settings.binary});if(epoch!==generation)throw Error('Community connection changed.');if(profile().id!==p.id)throw Error('Your identity changed. Reconnect the community.');return result;}
    function remember(message){const key=`${message.channelId}:${message.authorId}:${message.id}`,old=messages.get(key);if(old&&!message.removed)return false;messages.set(key,copy(message));while(messages.size>2000)messages.delete(messages.keys().next().value);return true;}
    async function receive(event,epoch){if(epoch!==generation)return;if(event.eventSequence)eventCursor=Math.max(eventCursor,event.eventSequence);if(event.type==='community-message'&&!remember(event.message))return;if(event.type==='community-message-removed'){for(const [key,m] of messages)if(m.sequence===event.sequence&&m.channelId===event.channelId)messages.set(key,{...m,text:'',removed:true});}if(event.type==='community-welcome'){attempt=0;currentSnapshot=event.snapshot;status('connected');emit(event);try{let recovered=eventCursor,more=true;while(more){const recovery=await request('events',{after:recovered});if(epoch!==generation)return;for(const item of recovery.events||[])await receive(item,epoch);recovered=recovery.after||recovered;eventCursor=Math.max(eventCursor,recovered);if(recovery.resync)emit({type:'community-resync-required'});more=recovery.hasMore===true;}if(watched)await history(watched);}catch(error){emit({type:'community-error',code:error.code,message:error.message});}return;}if(event.type==='community-revoked'){emit(event);disconnect();return;}emit(event);}
    function openEvents(epoch){if(epoch!==generation||!hubId||!Socket)return;clearTimeout(retry);const endpoint=new URL(url('events'));endpoint.protocol=endpoint.protocol==='https:'?'wss:':'ws:';endpoint.searchParams.set('id',profile().id);const current=new Socket(endpoint.href);socket=current;current.onmessage=async e=>{if(epoch!==generation||socket!==current)return;try{const event=JSON.parse(e.data);if(event.type==='community-challenge'){const p=profile(),payload={channelId:watched},envelope={type:'authenticate',id:p.id,key:p.key,nonce:event.nonce,payload};envelope.signature=await identity.sign(canonical(hubId,p.id,event.nonce,'subscribe',payload));if(epoch===generation&&socket===current&&current.readyState===1)current.send(JSON.stringify(envelope));return;}await receive(event,epoch);}catch(error){emit({type:'community-error',code:error.code||'community-event-error',message:error.message});}};current.onclose=e=>{if(epoch!==generation||socket!==current)return;socket=null;if([4003,1008].includes(e.code)){emit({type:'community-revoked'});disconnect();return;}status('reconnecting');retry=setTimeout(()=>openEvents(epoch),Math.min(30000,500*2**Math.min(attempt++,6)));};current.onerror=()=>emit({type:'community-error',code:'community-connection-failed',message:'Community connection failed; retrying.'});}
    async function publish(snapshot){const p=profile(),source=copy(snapshot||{}),root=source.hub||source,target=source.liveHubId||p.id+'_'+crypto.randomUUID(),oldId=root.id||root.hubId;const nodes=(Array.isArray(source.nodes)?source.nodes:Object.values(source.nodes||{})).filter(n=>n.id!==oldId).map(n=>({...n,type:n.type||n.kind,kind:n.kind||n.type,hubId:target,parentId:!n.parentId||n.parentId===oldId?target:n.parentId}));const hub={...root,id:target};delete hub.nodes;delete hub.messages;delete hub.members;delete hub.invitations;delete hub.drafts;const result=await request('publish',{hub,nodes},{hubId:target});hubId=result.hubId;boundIdentity=p.id;currentSnapshot=result.snapshot||result;return copy(result);}
    async function connect(target,settings={}){disconnect();hubId=target;boundIdentity=profile().id;const epoch=generation;status('connecting');try{currentSnapshot=await request('snapshot');if(epoch!==generation)throw Error('Community connection changed.');if(settings.events!==false&&Socket)openEvents(epoch);else status('connected');return copy(currentSnapshot);}catch(error){if(epoch===generation)status('failed');throw error;}}
    function disconnect(){generation++;clearTimeout(retry);retry=null;for(const c of controllers)c.abort();controllers.clear();const old=socket;socket=null;try{old?.close(1000,'Community disconnected.');}catch{}hubId=null;boundIdentity=null;currentSnapshot=null;watched=null;eventCursor=0;messages.clear();status('offline');}
    async function snapshot(){currentSnapshot=await request('snapshot');return copy(currentSnapshot);}
    async function history(channelId,settings={}){watched=channelId;if(socket?.readyState===1)socket.send(JSON.stringify({type:'watch',channelId}));const cursor=Object.hasOwn(settings,'after')?{after:settings.after}:Object.hasOwn(settings,'before')?{before:settings.before}:{before:Number.MAX_SAFE_INTEGER};const page=await request('history',{channelId,...cursor,limit:settings.limit||100});for(const m of page.messages)remember(m);emit({type:'community-history',channelId,...page});return page;}
    async function send(channelId,text,settings={}){const id=settings.id||crypto.randomUUID();try{const result=await request('send',{channelId,text,id});if(remember(result.message))emit({type:'community-message',message:result.message});return result;}catch(error){error.messageId=id;throw error;}}
    async function spaceAction(action,payload){const result=await request(action,payload);if(result.snapshot)currentSnapshot=result.snapshot;else if(currentSnapshot&&Number.isSafeInteger(result.revision))currentSnapshot={...currentSnapshot,revision:result.revision};return copy(result);}
    return Object.freeze({publish,connect,disconnect,snapshot,request,history,send,canonical,archives:scopeId=>request('archives',scopeId?{scopeId}:{}),spaceJoin:scopeId=>spaceAction('space-join',{scopeId}),requestAccess:scopeId=>spaceAction('space-request',{scopeId}),reviewAccess:details=>spaceAction('space-review',details),accessRequests:scopeId=>spaceAction('space-requests',{scopeId}),on(fn){listeners.add(fn);return ()=>listeners.delete(fn);},state:()=>({hubId,identity:boundIdentity,connection,revision:currentSnapshot?.revision||0}),async mutate(operations,expectedRevision=currentSnapshot?.revision){currentSnapshot=await request('mutate',{operations,expectedRevision});return copy(currentSnapshot);},invite:p=>request('invite',p),async join(token,target=hubId){const result=await request('join',{token,name:profile().name},{hubId:target});return connect(result.hubId);},moderate:p=>request('moderate',p),themePackage:scopeId=>request('theme-package',{scopeId}),async assetUpload(scopeId,blob){if(blob.size>1024*1024)throw Error('Theme assets may contain at most 1 MiB.');const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return request('asset-upload',{scopeId,contentType:blob.type,data:btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')});},assetRead:assetId=>request('asset-read',{assetId},{binary:true})});
  }
  window.VumiroCommunityLive=Object.freeze({create,createCatalog,canonical});
})();
