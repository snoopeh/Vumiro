// This envelope travels only through the authenticated mutual-friend directory.
// Keep shape validation aligned with WebServer/gaming-directory.js.
const ID=/^[A-Za-z0-9_-]{43}$/;
const encoder=new TextEncoder();
const fields=(value,required,optional=[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
function candidate(value) {
  return value===null || fields(value,['candidate'],['sdpMid','sdpMLineIndex','usernameFragment']) &&
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
export function gamingSignalText(value) {
  return ['vumiro-gaming-signal-v1',value.from,value.to,value.session,value.nonce,value.expires,JSON.stringify(value.payload)].join('\n');
}
export function validateGamingSignal(value,sender,recipient,now=Date.now()) {
  try {
    if(!fields(value,['type','from','to','session','nonce','expires','payload','signature'])||value.type!=='gaming-signal'||
      !ID.test(value.from)||!ID.test(value.to)||value.from!==sender||value.from===value.to||recipient!==undefined&&value.to!==recipient||
      typeof value.session!=='string'||!/^[a-f0-9]{32}$/.test(value.session)||typeof value.nonce!=='string'||!/^[A-Za-z0-9_-]{16,64}$/.test(value.nonce)||
      !Number.isSafeInteger(value.expires)||value.expires<=now||value.expires>now+120000||typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{85}[AQgw]$/.test(value.signature)||!payload(value.payload))return null;
    const json=JSON.stringify(value);
    return encoder.encode(json).byteLength<=16384?JSON.parse(json):null;
  } catch { return null; }
}
// `verify` is the directory's existing verify(key, signature, canonical) helper.
// The caller must recheck socket ownership, friendship and expiry after await.
export async function verifyGamingSignal(value,fromContact,verify,now=Date.now()) {
  const clean=validateGamingSignal(value,fromContact?.id,undefined,now);
  if(!clean||typeof fromContact?.key!=='string'||typeof verify!=='function')return null;
  try { return await verify(fromContact.key,clean.signature,gamingSignalText(clean))?clean:null; } catch { return null; }
}
