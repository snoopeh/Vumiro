// The identity is SHA-256(SPKI P-256 public key), matching local-profile.js.
export const IDENTITY_PATTERN=/^[A-Za-z0-9_-]{43}$/;
export const HUB_PATTERN=/^[A-Za-z0-9_-]{1,160}$/;
export function encode(bytes){
  const value=new Uint8Array(bytes),chunks=[];
  // Keep function arguments bounded for the full 1 MiB theme-asset contract.
  for(let offset=0;offset<value.length;offset+=8192)chunks.push(String.fromCharCode(...value.subarray(offset,offset+8192)));
  return btoa(chunks.join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decode(value,max){if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>Math.ceil(max*4/3))return null;try{const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));return bytes.length<=max&&encode(bytes)===value?bytes:null;}catch{return null;}}
export const challengeText=(hubId,id,nonce,action,payload)=>JSON.stringify(['vumiro-community-v1',hubId,id,nonce,action,payload]);
export async function verifyIdentity(envelope,canonical){try{const bytes=decode(envelope.key,256),signature=decode(envelope.signature,64);if(!bytes||signature?.length!==64||!IDENTITY_PATTERN.test(envelope.id)||encode(await crypto.subtle.digest('SHA-256',bytes))!==envelope.id)return false;const key=await crypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,new TextEncoder().encode(canonical));}catch{return false;}}
