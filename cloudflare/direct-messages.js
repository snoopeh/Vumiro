// Mailbox protocol v1. The directory authorizes participants; each conversation
// owns its SQLite log. A self-hosted adapter can implement the same append/list
// request interface without changing the browser protocol.
import { DurableObject } from 'cloudflare:workers';

const ID=/^[A-Za-z0-9_-]{43}$/,NONCE=/^[A-Za-z0-9_-]{16,64}$/;
const encoder=new TextEncoder(),MAX_TEXT=4096,MAX_MESSAGES=10000,MAX_BYTES=8*1024*1024;
const canonical=m=>JSON.stringify(['vumiro-dm-v1',m.from,m.to,m.id,m.timestamp,m.text,m.key]);
const fields=(value,required)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===required.length&&required.every(key=>Object.hasOwn(value,key));
const rows=(directory,query,...args)=>[...directory.ctx.storage.sql.exec(query,...args)];
const failure=(code,message)=>({error:{code,message}});
const error=(d,ws,nonce,code,message)=>d.send(ws,{type:'dm-error',nonce:typeof nonce==='string'?nonce:'',code,message});
function attachment(ws){try{return ws.deserializeAttachment();}catch{return null;}}
function active(d,ws,id){const value=attachment(ws);return value?.auth&&!value.departed&&value.id===id&&d.owner(id)===ws?value:null;}
function decode(value,max){if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>Math.ceil(max*4/3))return null;try{const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));return bytes.length<=max?bytes:null;}catch{return null;}}
async function proof(message,session){try{const bytes=decode(message.key,256),signature=decode(message.signature,64);if(message.key!==session.key||!bytes||signature?.length!==64)return false;const key=await crypto.subtle.importKey('spki',bytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,encoder.encode(canonical(message)));}catch{return false;}}
export function initializeDirectMessages(d){const sql=d.ctx.storage.sql;sql.exec('CREATE TABLE IF NOT EXISTS direct_acl (identity_id TEXT PRIMARY KEY, watch_json TEXT NOT NULL, blocked_json TEXT NOT NULL)');sql.exec('CREATE TABLE IF NOT EXISTS direct_inbox (owner_id TEXT NOT NULL, friend_id TEXT NOT NULL, message_id TEXT NOT NULL, stored_at INTEGER NOT NULL, sequence INTEGER NOT NULL, from_id TEXT NOT NULL, PRIMARY KEY(owner_id,friend_id))');sql.exec('CREATE TABLE IF NOT EXISTS direct_budgets (identity_id TEXT PRIMARY KEY, minute INTEGER NOT NULL, minute_count INTEGER NOT NULL, day INTEGER NOT NULL, day_count INTEGER NOT NULL)');}
export function persistDirectAcl(d,session,pruneWatch=false){
  d.ctx.storage.sql.exec('INSERT INTO direct_acl(identity_id,watch_json,blocked_json) VALUES(?,?,?) ON CONFLICT(identity_id) DO UPDATE SET watch_json=excluded.watch_json,blocked_json=excluded.blocked_json',session.id,JSON.stringify(session.watch||[]),JSON.stringify(session.blocked||[]));
  for(const row of rows(d,'SELECT friend_id FROM direct_inbox WHERE owner_id=?',session.id))if(pruneWatch&&!session.watch.includes(row.friend_id)||(session.blocked||[]).includes(row.friend_id))d.ctx.storage.sql.exec('DELETE FROM direct_inbox WHERE owner_id=? AND friend_id=?',session.id,row.friend_id);
}
function permitted(d,session,to){if(!ID.test(to||'')||session.id===to||!session.watch.includes(to)||(session.blocked||[]).includes(to))return false;const target=d.owner(to),live=target&&attachment(target),saved=!live&&rows(d,'SELECT watch_json,blocked_json FROM direct_acl WHERE identity_id=?',to)[0];if(live)return live.watch.includes(session.id)&&!(live.blocked||[]).includes(session.id);return !!saved&&JSON.parse(saved.watch_json).includes(session.id)&&!JSON.parse(saved.blocked_json).includes(session.id);}
function spend(d,id,now){const minute=Math.floor(now/60000),day=Math.floor(now/86400000),old=rows(d,'SELECT * FROM direct_budgets WHERE identity_id=?',id)[0],minuteCount=old?.minute===minute?old.minute_count:0,dayCount=old?.day===day?old.day_count:0;if(minuteCount>=60||dayCount>=2000)return false;d.ctx.storage.sql.exec('INSERT INTO direct_budgets(identity_id,minute,minute_count,day,day_count) VALUES(?,?,?,?,?) ON CONFLICT(identity_id) DO UPDATE SET minute=excluded.minute,minute_count=excluded.minute_count,day=excluded.day,day_count=excluded.day_count',id,minute,minuteCount+1,day,dayCount+1);return true;}
function thread(d,owner,friend,m){d.ctx.storage.sql.exec('INSERT INTO direct_inbox(owner_id,friend_id,message_id,stored_at,sequence,from_id) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,friend_id) DO UPDATE SET message_id=excluded.message_id,stored_at=excluded.stored_at,sequence=excluded.sequence,from_id=excluded.from_id WHERE excluded.sequence>direct_inbox.sequence',owner,friend,m.id,m.storedAt,m.sequence,m.from);}
export async function handleDirectMessage(d,ws,session,wire){
  const nonce=wire?.nonce;
  if(!d.env.DIRECT_CONVERSATIONS){error(d,ws,nonce,'dm-unavailable','Direct messages need the updated Vumiro service.');return;}
  if(!NONCE.test(nonce||'')){error(d,ws,nonce,'dm-invalid','Invalid direct message request.');return;}
  if(!spend(d,session.id,Date.now())){error(d,ws,nonce,'dm-rate-limit','Direct message limit reached. Try again later (60 requests per minute, 2,000 per day).');return;}
  if(wire.type==='dm-inbox'){
    if(!fields(wire,['type','nonce'])){error(d,ws,nonce,'dm-invalid','Invalid inbox request.');return;}
    const threads=rows(d,'SELECT * FROM direct_inbox WHERE owner_id=? ORDER BY stored_at DESC,friend_id ASC LIMIT 128',session.id).filter(row=>permitted(d,session,row.friend_id)).map(row=>({friend:row.friend_id,id:row.message_id,storedAt:row.stored_at,sequence:row.sequence,from:row.from_id}));d.send(ws,{type:'dm-inbox-result',nonce,threads});return;
  }
  const sending=wire.type==='dm-send',message=wire.envelope,to=sending?message?.to:wire.to;
  if(sending?(!fields(wire,['type','nonce','envelope'])||!fields(message,['version','from','to','id','timestamp','text','key','signature'])||message.version!==1||message.from!==session.id||!NONCE.test(message.id||'')||!Number.isSafeInteger(message.timestamp)||Math.abs(Date.now()-message.timestamp)>7*86400000||typeof message.text!=='string'||!message.text.trim()||encoder.encode(message.text).length>MAX_TEXT||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message.text)):(!fields(wire,['type','nonce','to','before','limit'])||wire.before!==null&&(typeof wire.before!=='string'||!/^[1-9]\d{0,14}$/.test(wire.before))||!Number.isInteger(wire.limit)||wire.limit<1||wire.limit>100)){
    error(d,ws,nonce,'dm-invalid','Messages must contain 1–4,096 UTF-8 bytes and valid request details.');return;
  }
  if(!permitted(d,session,to)){error(d,ws,nonce,'dm-forbidden','Direct messages require a mutual friendship without blocks.');return;}
  if(sending&&!await proof(message,session)){if(active(d,ws,session.id))error(d,ws,nonce,'dm-invalid-proof','The direct message signature is invalid.');return;}
  session=active(d,ws,session.id);if(!session)return;
  if(!permitted(d,session,to)){error(d,ws,nonce,'dm-forbidden','Direct messages require a mutual friendship without blocks.');return;}
  try{
    const pair=[session.id,to].sort(),mailbox=d.env.DIRECT_CONVERSATIONS.get(d.env.DIRECT_CONVERSATIONS.idFromName(`direct-v1:${pair.join(':')}`));
    const response=await mailbox.fetch(new Request('https://direct.internal/v1/'+(sending?'append':'history'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sending?{participants:pair,message}:{participants:pair,before:wire.before,limit:wire.limit})}));
    const result=await response.json();session=active(d,ws,session.id);if(!session)return;
    if(result.error){error(d,ws,nonce,result.error.code,result.error.message);return;}
    if(!response.ok)throw Error('Mailbox failed');
    if(sending){const stored=result.message;thread(d,session.id,to,stored);thread(d,to,session.id,stored);d.send(ws,{type:'dm-ack',nonce,state:'stored',message:stored});const target=d.owner(to);if(!result.duplicate&&target&&permitted(d,session,to))d.send(target,{type:'dm-message',message:stored});}
    else if(permitted(d,session,to))d.send(ws,{type:'dm-history-result',nonce,messages:result.messages,before:result.before});else error(d,ws,nonce,'dm-forbidden','Direct messages require a mutual friendship without blocks.');
  }catch{if(active(d,ws,session.id))error(d,ws,nonce,'dm-unavailable','Message storage is unavailable. Retry with the same message ID; no stored acknowledgment was received.');}
}

export class DirectConversation extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    const sql=ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS direct_messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, message_id TEXT NOT NULL, envelope_json TEXT NOT NULL, stored_at INTEGER NOT NULL, bytes INTEGER NOT NULL, UNIQUE(from_id,message_id))');
    sql.exec('CREATE TABLE IF NOT EXISTS direct_participants (slot INTEGER PRIMARY KEY CHECK(slot=1), pair_json TEXT NOT NULL)');
    sql.exec('CREATE TABLE IF NOT EXISTS direct_usage (slot INTEGER PRIMARY KEY CHECK(slot=1), message_count INTEGER NOT NULL, bytes INTEGER NOT NULL)');
    ctx.storage.transactionSync(()=>{
      // The aggregate runs only when upgrading an existing log. Ordinary
      // hibernation and every append read/update this one durable counter row.
      if(![...sql.exec('SELECT slot FROM direct_usage WHERE slot=1')].length)
        sql.exec('INSERT INTO direct_usage(slot,message_count,bytes) SELECT 1,COUNT(*),COALESCE(SUM(bytes),0) FROM direct_messages');
    });
  }
  async fetch(request){
    if(request.method!=='POST'||!['/v1/append','/v1/history'].includes(new URL(request.url).pathname))return Response.json(failure('dm-invalid','Invalid mailbox operation.'),{status:400});
    let value;try{const raw=await request.text();if(encoder.encode(raw).length>16384)throw Error();value=JSON.parse(raw);}catch{return Response.json(failure('dm-invalid','Invalid mailbox request.'),{status:400});}
    const pair=value?.participants;if(!Array.isArray(pair)||pair.length!==2||!pair.every(id=>ID.test(id))||pair[0]>=pair[1])return Response.json(failure('dm-forbidden','Invalid participants.'),{status:403});
    const sql=this.ctx.storage.sql,all=(query,...args)=>[...sql.exec(query,...args)],pairJson=JSON.stringify(pair),existing=all('SELECT pair_json FROM direct_participants WHERE slot=1')[0];
    if(existing&&existing.pair_json!==pairJson)return Response.json(failure('dm-forbidden','Wrong conversation participants.'),{status:403});
    if(new URL(request.url).pathname==='/v1/history'){
      if(value.before!==null&&(typeof value.before!=='string'||!/^[1-9]\d{0,14}$/.test(value.before))||!Number.isInteger(value.limit)||value.limit<1||value.limit>100)return Response.json(failure('dm-invalid','Invalid history cursor.'),{status:400});
      const messages=all('SELECT * FROM direct_messages WHERE sequence<? ORDER BY sequence DESC LIMIT ?',value.before===null?Number.MAX_SAFE_INTEGER:Number(value.before),value.limit+1),more=messages.length>value.limit;if(more)messages.pop();return Response.json({version:1,messages:messages.map(row=>({...JSON.parse(row.envelope_json),sequence:row.sequence,storedAt:row.stored_at})).reverse(),before:more?String(messages.at(-1).sequence):null});
    }
    const m=value.message;if(!m||!pair.includes(m.from)||!pair.includes(m.to)||m.from===m.to||!NONCE.test(m.id||'')||typeof m.text!=='string'||encoder.encode(m.text).length>MAX_TEXT)return Response.json(failure('dm-invalid','Invalid message.'),{status:400});
    let result;this.ctx.storage.transactionSync(()=>{
      const encoded=JSON.stringify(m),previous=all('SELECT * FROM direct_messages WHERE from_id=? AND message_id=?',m.from,m.id)[0];
      if(previous){result=previous.envelope_json===encoded?{message:{...JSON.parse(previous.envelope_json),sequence:previous.sequence,storedAt:previous.stored_at},duplicate:true}:failure('dm-id-conflict','This message ID already belongs to different content.');return;}
      const totals=all('SELECT message_count,bytes FROM direct_usage WHERE slot=1')[0],bytes=encoder.encode(encoded).length;
      if(totals.message_count>=MAX_MESSAGES||totals.bytes+bytes>MAX_BYTES){result=failure('dm-quota','This conversation reached its storage limit (10,000 messages or 8 MiB).');return;}
      sql.exec('INSERT OR IGNORE INTO direct_participants(slot,pair_json) VALUES(1,?)',pairJson);const storedAt=Date.now();sql.exec('INSERT INTO direct_messages(from_id,message_id,envelope_json,stored_at,bytes) VALUES(?,?,?,?,?)',m.from,m.id,encoded,storedAt,bytes);const saved=all('SELECT sequence FROM direct_messages WHERE from_id=? AND message_id=?',m.from,m.id)[0];result={message:{...m,sequence:saved.sequence,storedAt},duplicate:false};
      sql.exec('UPDATE direct_usage SET message_count=message_count+1,bytes=bytes+? WHERE slot=1',bytes);
    });return Response.json({version:1,...result},{status:result.error?409:200});
  }
}
