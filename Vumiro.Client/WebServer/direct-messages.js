(() => {
  'use strict';
  const ID=/^[A-Za-z0-9_-]{43}$/,NONCE=/^[A-Za-z0-9_-]{16,64}$/;
  const encoder=new TextEncoder();
  const canonical=m=>JSON.stringify(['vumiro-dm-v1',m.from,m.to,m.id,m.timestamp,m.text,m.key]);
  const cursor=value=>value===null||typeof value==='string'&&/^[1-9]\d{0,14}$/.test(value);
  function create({local,send,getProfile,getFriend,isBlocked=()=>false,onMessage=()=>{},onState=()=>{},onError=()=>{}}){
    const pending=new Map(),retry=new Map(),seen=new Set();let online=false,available=false,generation=0,anchor=null;
    const own=()=>getProfile(),peer=value=>typeof value==='string'?value:value?.id;
    const allowed=id=>ID.test(id||'')&&!!getFriend(id)&&!isBlocked(id)&&id!==own()?.id;
    const now=()=>anchor?anchor.server+Date.now()-anchor.local:Date.now();
    const state=extra=>onState({connected:online,available,...extra});
    function ready(){if(!online)throw Error('Reconnect before sending direct messages.');if(!available)throw Error('Direct messages need the updated Vumiro service.');}
    function friend(id){if(!allowed(id))throw Error('Direct messages require a current unblocked friend.');}
    function disconnected(){online=false;available=false;generation++;anchor=null;for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Direct message connection disconnected. Retry to confirm storage.'));}pending.clear();state({});}
    function connected(capabilities,serverTime){
      const announcement=capabilities?.capabilities?capabilities:null;
      capabilities=announcement?.capabilities||capabilities;serverTime=announcement?.serverTime??serverTime;
      online=true;available=capabilities?.directMessages===1;
      if(Number.isSafeInteger(serverTime)&&serverTime>0)anchor={server:serverTime,local:Date.now()};
      state({});
    }
    async function verifyMessage(message){
      try{
        const self=own(),other=message?.from===self?.id?message.to:message?.from;
        if(!self||!message||message.version!==1||!ID.test(message.from||'')||!ID.test(message.to||'')||message.from===message.to||message.from!==self.id&&message.to!==self.id||!allowed(other)||!NONCE.test(message.id||'')||!Number.isSafeInteger(message.timestamp)||message.timestamp<=0||typeof message.text!=='string'||!message.text.trim()||encoder.encode(message.text).length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message.text)||typeof message.key!=='string'||message.key.length>344||typeof message.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(message.signature)||!Number.isSafeInteger(message.storedAt)||message.storedAt<=0||!Number.isSafeInteger(message.sequence)||message.sequence<1)return false;
        const author=message.from===self.id?self:getFriend(message.from);
        if(!author||author.key!==message.key)return false;
        const version=generation;
        return await local.verify(author,canonical(message),message.signature)&&version===generation&&allowed(other)&&own()?.id===self.id;
      }catch{return false;}
    }
    function deliver(message,history){const key=message.from+':'+message.id;if(seen.has(key))return;seen.add(key);if(seen.size>4096)seen.delete(seen.values().next().value);onMessage(message,{history});}
    function request(wire,details){
      ready();if(pending.size>=32)return Promise.reject(Error('Too many direct message requests are pending.'));
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(wire.nonce);const error=Error('Direct message request timed out. Retry to confirm storage.');error.code='dm-timeout';reject(error);},15000);
        pending.set(wire.nonce,{resolve,reject,timer,...details});
        try{const result=send(wire);if(result===false)throw Error('Direct message connection is unavailable.');if(result?.catch)result.catch(error=>finish(wire.nonce,error));}catch(error){finish(wire.nonce,error);}
      });
    }
    function finish(nonce,error,result){const entry=pending.get(nonce);if(!entry)return;pending.delete(nonce);clearTimeout(entry.timer);if(error)entry.reject(error);else entry.resolve(result);}
    async function sendMessage(value,text,{id=crypto.randomUUID()}={}){
      ready();const to=peer(value);friend(to);
      if(!NONCE.test(id||''))throw Error('Invalid direct message ID.');
      if(typeof text!=='string'||!text.trim()||encoder.encode(text).length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw Error('Messages must contain 1–4,096 UTF-8 bytes.');
      const profile=own(),key=profile.id+':'+id;let envelope=retry.get(key);
      if(envelope&&(envelope.to!==to||envelope.text!==text))throw Error('This message ID already belongs to different content.');
      if(!envelope){
        const version=generation;envelope={version:1,from:profile.id,to,id,timestamp:Math.floor(now()),text,key:profile.key};envelope.signature=await local.sign(canonical(envelope));
        if(version!==generation||own()?.id!==profile.id)throw Error('Direct message connection changed before signing finished.');
        retry.set(key,envelope);if(retry.size>256)retry.delete(retry.keys().next().value);
      }
      ready();friend(to);
      return request({type:'dm-send',nonce:crypto.randomUUID(),envelope},{kind:'send',to,envelope});
    }
    async function history(value,{before=null,limit=50}={}){ready();const to=peer(value);friend(to);if(!cursor(before))throw Error('Invalid direct message history cursor.');if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Direct message history limit must be 1–100.');return request({type:'dm-history',nonce:crypto.randomUUID(),to,before,limit},{kind:'history',to,limit});}
    async function inbox(){ready();return request({type:'dm-inbox',nonce:crypto.randomUUID()},{kind:'inbox'});}
    async function receive(wire){
      if(!wire||typeof wire.type!=='string'||!['dm-ack','dm-message','dm-history-result','dm-inbox-result','dm-error'].includes(wire.type))return false;
      const entry=pending.get(wire.nonce),version=generation;
      if(!online||!available)return true;
      if(wire.type==='dm-error'){
        const error=Error(typeof wire.message==='string'?wire.message:'Direct message request failed.');error.code=typeof wire.code==='string'?wire.code:'dm-error';
        if(entry){finish(wire.nonce,error);onError(error);}return true;
      }
      if(wire.type==='dm-message'){if(await verifyMessage(wire.message)&&version===generation)deliver(wire.message,false);return true;}
      if(!entry)return true;
      if(wire.type==='dm-ack'&&entry.kind==='send'){
        const m=wire.message,expected=entry.envelope;
        if(wire.state!=='stored'||!await verifyMessage(m)||canonical(m)!==canonical(expected)||m.signature!==expected.signature){finish(wire.nonce,Error('Invalid stored direct message acknowledgment.'));return true;}
        if(version!==generation||pending.get(wire.nonce)!==entry)return true;
        deliver(m,false);finish(wire.nonce,null,m);return true;
      }
      if(wire.type==='dm-history-result'&&entry.kind==='history'){
        if(!Array.isArray(wire.messages)||wire.messages.length>entry.limit||!cursor(wire.before)){finish(wire.nonce,Error('Invalid direct message history response.'));return true;}
        const messages=[];for(const message of wire.messages){if(message?.from!==entry.to&&message?.to!==entry.to||!await verifyMessage(message)){finish(wire.nonce,Error('Invalid signed direct message history.'));return true;}messages.push(message);}
        if(version!==generation||pending.get(wire.nonce)!==entry)return true;
        for(const message of messages)deliver(message,true);finish(wire.nonce,null,{messages,before:wire.before});return true;
      }
      if(wire.type==='dm-inbox-result'&&entry.kind==='inbox'){
        if(!Array.isArray(wire.threads)||wire.threads.length>128){finish(wire.nonce,Error('Invalid direct message inbox.'));return true;}
        const threads=wire.threads.filter(row=>allowed(row?.friend)&&NONCE.test(row.id||'')&&Number.isSafeInteger(row.storedAt)&&row.storedAt>0&&Number.isSafeInteger(row.sequence)&&row.sequence>0&&(row.from===own()?.id||row.from===row.friend));
        finish(wire.nonce,null,{threads});return true;
      }
      finish(wire.nonce,Error('Unexpected direct message response.'));return true;
    }
    return {connected,disconnected,sendMessage,history,inbox,receive,verifyMessage};
  }
  window.VumiroDirectMessages={create,canonical};
})();
