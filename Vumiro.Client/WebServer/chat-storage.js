/* Identity-scoped local archive. The optional private API uses the same signed envelopes. */
(() => {
  'use strict';
  const preferenceKey=owner=>'vumiro-chat-storage:'+owner;
  const messageKey=value=>value.author.id+':'+value.id;
  const compareMessages=(a,b)=>a.timestamp-b.timestamp||(messageKey(a)<messageKey(b)?-1:messageKey(a)>messageKey(b)?1:0);
  function historyCursor(value){
    if(value===undefined||value===null)return undefined;
    try{if(typeof value==='string'){if(!/^[A-Za-z0-9_-]{1,1024}$/.test(value))throw Error();value=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));}}catch{throw Error('Invalid history cursor.');}
    if(!Array.isArray(value)||value.length!==2||!Number.isSafeInteger(value[0])||value[0]<0||typeof value[1]!=='string'||!/^[A-Za-z0-9_-]{43}:[A-Za-z0-9_-]{16,64}$/.test(value[1]))throw Error('Invalid history cursor.');
    return [value[0],value[1]];
  }
  const encodeCursor=value=>btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  function historyOptions({before,limit=200}={}){if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('History limit must be 1–200.');return {limit,before:historyCursor(before)};}
  function historyPage(values,{before,limit},more=false){
    const ordered=values.filter(value=>!before||value.timestamp<before[0]||value.timestamp===before[0]&&messageKey(value)<before[1]).sort(compareMessages),messages=ordered.slice(-limit),first=messages[0];
    return {messages,before:first&&(more||ordered.length>limit)?encodeCursor([first.timestamp,messageKey(first)]):null};
  }
  function cleanEnvelope(value,room){
    if(!value||typeof value!=='object'||Array.isArray(value)||value.type!=='chat'||value.version!==2||value.room!==room||typeof room!=='string'||room.length>2048||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(value.id)||!Number.isSafeInteger(value.timestamp)||value.timestamp<0||typeof value.text!=='string'||!value.text.trim()||value.text.length>2000||typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.signature))return null;
    const author=value.author;if(!author||typeof author.id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(author.id)||typeof author.key!=='string'||!author.key||author.key.length>256||typeof author.name!=='string'||!author.name.trim()||author.name.length>48)return null;
    const hasReply=Object.prototype.hasOwnProperty.call(value,'replyTo'),hasSignature=Object.prototype.hasOwnProperty.call(value,'replySignature'),reply=value.replyTo;
    if((hasReply||hasSignature)&&(!hasReply||!hasSignature||!reply||Object.keys(reply).length!==2||typeof reply.authorId!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(reply.authorId)||typeof reply.id!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(reply.id)||typeof value.replySignature!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value.replySignature)))return null;
    return {type:'chat',version:2,room,id:value.id,timestamp:value.timestamp,text:value.text,signature:value.signature,author:{id:author.id,key:author.key,name:author.name},...(hasReply?{replyTo:{authorId:reply.authorId,id:reply.id},replySignature:value.replySignature}:{})};
  }
  async function responseJson(response){
    const maximum=20*1024*1024,length=Number(response.headers?.get?.('Content-Length'));
    if(length>maximum){try{await response.body?.cancel?.();}catch{}throw Error('Private archive response too large.');}
    let text='';
    if(response.body?.getReader){
      const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maximum)throw Error('Private archive response too large.');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{try{await reader.cancel();}catch{}}
    }else{ text=await response.text();if(new TextEncoder().encode(text).byteLength>maximum)throw Error('Private archive response too large.'); }
    return JSON.parse(text);
  }
  function validateEndpoint(value){
    const url=new URL(String(value));
    if(url.username||url.password)throw Error('Do not put credentials in the server URL.');
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Use HTTPS for a private server, or HTTP on localhost.');
    if(url.pathname!=='/'||url.search||url.hash)throw Error('Use the server origin without a path, query or fragment.');
    return url.origin;
  }
  function configuration(owner){try{const value=JSON.parse(window.localStorage.getItem(preferenceKey(owner))||'{}');return {mode:value.mode==='private'?'private':'local',endpoint:value.endpoint||'',token:window.sessionStorage.getItem(preferenceKey(owner)+':token')||''};}catch{return {mode:'local',endpoint:'',token:''};}}
  function configure(owner,value){
    if(!owner)throw Error('A local signing identity is required.');
    const next={mode:value.mode==='private'?'private':'local',endpoint:value.endpoint?validateEndpoint(value.endpoint):''};
    if(next.mode==='private'&&(!next.endpoint||!value.token))throw Error('Enter the private server URL and your archive token.');
    window.localStorage.setItem(preferenceKey(owner),JSON.stringify(next));
    if(value.token)window.sessionStorage.setItem(preferenceKey(owner)+':token',String(value.token));else window.sessionStorage.removeItem(preferenceKey(owner)+':token');
    return next;
  }
  let opened;
  function database(){
    if(opened)return opened;
    opened=new Promise((resolve,reject)=>{
      const request=window.indexedDB.open('vumiro-chat-archive',1);
      request.onupgradeneeded=()=>{const db=request.result;const messages=db.createObjectStore('messages',{keyPath:['owner','room','id']});messages.createIndex('timeline',['owner','room','timestamp','id']);db.createObjectStore('servers',{keyPath:['owner','id']});};
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opened=null;};resolve(request.result);};
      request.onerror=()=>{opened=null;reject(request.error||Error('Local chat archive is unavailable.'));};
      request.onblocked=()=>{opened=null;reject(Error('Close other Vumiro windows to upgrade chat history.'));};
    });return opened;
  }
  async function transaction(store,mode,work){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result;try{result=work(tx.objectStore(store));}catch(error){tx.abort();reject(error);return;}tx.oncomplete=()=>resolve(result?.result);tx.onabort=tx.onerror=()=>reject(tx.error||Error('Chat history could not be saved.'));});}
  const indexed={
    append(owner,room,value){return transaction('messages','readwrite',store=>store.put({owner,room,id:value.author.id+':'+value.id,timestamp:value.timestamp,message:value}));},
    async history(owner,room,{before,limit=200}={}){
      ({before,limit}=historyOptions({before,limit}));
      const db=await database();return new Promise((resolve,reject)=>{
        const tx=db.transaction('messages'),messages=[];
        const lower=[owner,room,0,''],upper=before?[owner,room,before[0],before[1]]:[owner,room,Number.MAX_SAFE_INTEGER,'\uffff'];
        const cursor=tx.objectStore('messages').index('timeline').openCursor(window.IDBKeyRange.bound(lower,upper,false,!!before),'prev');
        cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;messages.push(row.value.message);if(messages.length<limit+1)row.continue();};
        tx.oncomplete=()=>resolve(historyPage(messages,{before,limit},messages.length>limit));tx.onabort=tx.onerror=()=>reject(tx.error||Error('Chat history could not be read.'));
      });
    },
    saveServer(owner,server){return transaction('servers','readwrite',store=>store.put({...server,owner}));},
    async listServers(owner){const values=await transaction('servers','readonly',store=>store.getAll(window.IDBKeyRange.bound([owner,''],[owner,'\uffff'])));return values.map(({owner:_,...value})=>value);}
  };
  async function roomId(room){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(room));return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');}
  function create({owner,local=indexed,configuration:read=()=>configuration(owner),fetch:request=window.fetch?.bind(window)}={}){
    if(typeof owner!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(owner))throw Error('A local signing identity is required.');
    async function remote(route,{method='GET',body}={}){
      const config=read();if(config.mode!=='private')return null;
      if(!config.token)throw Error('Enter your private archive token in Data & servers for this session.');
      const endpoint=validateEndpoint(config.endpoint),response=await request(endpoint+'/v1/owners/'+encodeURIComponent(owner)+route,{method,headers:{Authorization:'Bearer '+config.token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!response.ok){try{await response.body?.cancel?.();}catch{}throw Error('Private archive request failed ('+response.status+').');}
      return responseJson(response);
    }
    return {
      async append(room,message){await local.append(owner,room,message);try{await remote('/rooms/'+await roomId(room)+'/messages',{method:'POST',body:message});}catch(cause){const error=Error('Message kept locally; private backup unavailable.');error.localSaved=true;error.cause=cause;throw error;}},
      async history(room,options={}){
        const normalized=historyOptions(options),stored=await local.history(owner,room,normalized);
        if(!Array.isArray(stored?.messages)||stored.messages.length>200)throw Error('Invalid local history response.');
        const localValues=stored.messages.map(value=>cleanEnvelope(value,room)).filter(Boolean),saved=historyPage(localValues,normalized,!!stored.before);if(read().mode!=='private')return saved;
        try{const query=new URLSearchParams({limit:String(normalized.limit)});if(normalized.before)query.set('before',encodeCursor(normalized.before));const page=await remote('/rooms/'+await roomId(room)+'/messages?'+query);if(!Array.isArray(page?.messages)||page.messages.length>normalized.limit)throw Error('Invalid private history response.');
          if(page.before!==undefined&&page.before!==null)historyCursor(page.before);
          // Do not trust/cache remote envelopes here. The caller verifies signatures
          // before display; an untrusted archive cannot overwrite the local copy.
          const remoteValues=page.messages.map(value=>cleanEnvelope(value,room)).filter(Boolean),merged=new Map(remoteValues.map(value=>[messageKey(value),value]));for(const value of saved.messages)merged.set(messageKey(value),value);
          return historyPage([...merged.values()],normalized,!!saved.before||!!page.before);
        }catch(error){return {...saved,warning:'Local history loaded; private archive unavailable.'};}
      },
      async saveServer(server){if(!server||typeof server.id!=='string'||typeof server.name!=='string'||!server.name.trim()||server.name.length>80||!Array.isArray(server.channels))throw Error('Enter a server name.');await local.saveServer(owner,server);try{await remote('/servers',{method:'PUT',body:server});}catch(cause){const error=Error('Server saved locally; private backup unavailable.');error.localSaved=true;error.cause=cause;throw error;}},
      listServers:()=>local.listServers(owner),
      async test(){const result=await remote('/servers');if(!result)throw Error('Choose a private server first.');return result;}
    };
  }
  window.VumiroChatStorage={create,configuration,configure,validateEndpoint};
})();
