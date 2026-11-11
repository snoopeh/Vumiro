(() => {
  'use strict';
  // Keep shape validation aligned with cloudflare/gaming-signals.js. The relay
  // authorizes mutual friendship; this adapter independently checks saved keys.
  const ID=/^[A-Za-z0-9_-]{43}$/;
  const encoder=new TextEncoder();
  const fields=(value,required,optional=[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
  function candidate(value) {
    return value===null || fields(value,['candidate'],['sdpMid','sdpMLineIndex','usernameFragment'])&&
      typeof value.candidate==='string'&&value.candidate.length<=4096&&!/[\0\r\n]/.test(value.candidate)&&
      (value.candidate===''||/^candidate:\S+\s+[12]\s+(?:UDP|TCP)\s+\d+\s+\S+\s+\d+\s+typ\s+(?:host|srflx|prflx|relay)(?:\s|$)/i.test(value.candidate))&&
      (value.sdpMid==null||typeof value.sdpMid==='string'&&value.sdpMid.length<=256)&&
      (value.sdpMLineIndex==null||Number.isInteger(value.sdpMLineIndex)&&value.sdpMLineIndex>=0&&value.sdpMLineIndex<=64)&&
      (value.usernameFragment==null||typeof value.usernameFragment==='string'&&value.usernameFragment.length<=256);
  }
  function lan(value) {
    if(!fields(value,['address','peerAddress','prefix'])||value.prefix!==24)return false;
    const host=/^10\.203\.(\d{1,3})\.1$/.exec(value.address||''),peer=/^10\.203\.(\d{1,3})\.(\d{1,3})$/.exec(value.peerAddress||'');
    return !!host&&!!peer&&+host[1]>=1&&+host[1]<=250&&host[1]===String(+host[1])&&peer[1]===host[1]&&+peer[2]>=2&&+peer[2]<=254&&peer[2]===String(+peer[2]);
  }
  function payload(value) {
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    if(value.kind==='invite')return fields(value,['kind','mode'],['lan'])&&['lan','together'].includes(value.mode)&&(value.lan===undefined||value.mode==='lan'&&lan(value.lan));
    if(value.kind==='lan-peers')return fields(value,['kind','revision','addresses'])&&Number.isSafeInteger(value.revision)&&value.revision>=1&&value.revision<=2147483647&&Array.isArray(value.addresses)&&value.addresses.length>=1&&value.addresses.length<=4&&
      new Set(value.addresses).size===value.addresses.length&&value.addresses.every(address=>typeof address==='string'&&/^10\.203\.[1-9]\d{0,2}\.[1-9]\d{0,2}$/.test(address)&&
        +address.split('.')[2]<=250&&+address.split('.')[3]<=254&&address.split('.')[2]===value.addresses[0].split('.')[2]);
    if(['accept','decline','end'].includes(value.kind))return fields(value,['kind']);
    if(['offer','answer'].includes(value.kind))return fields(value,['kind','description'])&&fields(value.description,['type','sdp'])&&value.description.type===value.kind&&
      typeof value.description.sdp==='string'&&value.description.sdp.length<=12000&&/^v=0\r?\n/.test(value.description.sdp)&&!value.description.sdp.includes('\0');
    return value.kind==='ice'&&fields(value,['kind','candidate'])&&candidate(value.candidate);
  }
  function validate(value,sender,recipient,now=Date.now()) {
    try {
      if(!fields(value,['type','from','to','session','nonce','expires','payload','signature'])||value.type!=='gaming-signal'||
        !ID.test(value.from)||!ID.test(value.to)||value.from!==sender||value.to!==recipient||value.from===value.to||
        typeof value.session!=='string'||!/^[a-f0-9]{32}$/.test(value.session)||typeof value.nonce!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(value.nonce)||
        !Number.isSafeInteger(value.expires)||value.expires<=now||value.expires>now+120000||typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{85}[AQgw]$/.test(value.signature)||!payload(value.payload))return null;
      const json=JSON.stringify(value);return encoder.encode(json).byteLength<=16384?JSON.parse(json):null;
    } catch { return null; }
  }
  const text=value=>['vumiro-gaming-signal-v1',value.from,value.to,value.session,value.nonce,value.expires,JSON.stringify(value.payload)].join('\n');
  const listeners=new Set(),seen=new Map();
  let current=null,epoch=0;
  function changed(online) { window.dispatchEvent(new CustomEvent('vumiro:gaming-directory',{detail:{online}})); }
  function reset() { ++epoch;current=null;seen.clear();changed(false); }
  function register(options) {
    if(!options?.local||!['send','getFriend','listFriends','isOnline'].every(key=>typeof options[key]==='function')||
      !['profile','verify','validateContact'].every(key=>typeof options.local[key]==='function'))throw Error('The gaming directory requires the authenticated friend transport.');
    ++epoch;seen.clear();const version=epoch;
    const active=()=>current?.version===version&&options.isOnline();
    const context=Object.freeze({local:options.local,
      send(message) {
        if(!active()||!options.isOnline(message?.to))throw Error('The gaming directory is offline.');
        const own=options.local.profile();
        if(!validate(message,own?.id,message?.to)||!options.getFriend(message.to))throw Error('Choose a saved friend and a signed gaming message.');
        return options.send(message);
      },
      getFriend:id=>active()?options.getFriend(id):null,
      listFriends:()=>active()?options.listFriends():[],
      isOnline:id=>!!active()&&!!options.isOnline(id)});
    current={version,options,context};changed(!!options.isOnline());return context;
  }
  async function receive(message) {
    const state=current;
    if(!state||!state.options.isOnline())return false;
    const {local,getFriend}=state.options;
    const clean=validate(message,message?.from,local.profile()?.id);
    const friend=clean&&getFriend(clean.from);
    if(!friend||friend.id!==clean.from)return false;
    const trustedKey=friend.key;
    const replayKey=clean.from+':'+clean.nonce;
    for(const [key,expires] of seen)if(expires<=Date.now())seen.delete(key);
    if(seen.has(replayKey)||seen.size>=512)return false;
    try {
      const contact=await local.validateContact(friend);
      if(contact?.id!==clean.from||!await local.verify(contact,text(clean),clean.signature))return false;
      if(current!==state||!state.options.isOnline()||clean.expires<=Date.now()||local.profile()?.id!==clean.to||
        getFriend(clean.from)?.key!==trustedKey||seen.has(replayKey)||seen.size>=512)return false;
      seen.set(replayKey,clean.expires);
      for(const listener of listeners) { try { listener(clean); } catch { /* One view cannot prevent another from receiving a valid signal. */ } }
      return true;
    } catch { return false; }
  }
  window.VumiroGamingDirectory=Object.freeze({register,receive,getContext:()=>current?.context||null,
    subscribe(listener) { if(typeof listener!=='function')throw Error('A gaming signal listener is required.');listeners.add(listener);return ()=>listeners.delete(listener); },reset});
})();
