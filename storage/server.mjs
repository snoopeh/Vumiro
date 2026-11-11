import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const safeEqual=(a,b)=>{const first=Buffer.from(a),second=Buffer.from(b);return first.length===second.length&&timingSafeEqual(first,second);};
export function createStorageServer({file,tokens,origins=['https://screentask.local','vumiro://app']}) {
  if(!file||!tokens||!Object.entries(tokens).length||Object.entries(tokens).some(([owner,token])=>!identifier(owner)||typeof token!=='string'||!token))throw Error('Configure a database and a separate secret token for each owner.');
  mkdirSync(path.dirname(path.resolve(file)),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS messages(owner TEXT NOT NULL,room TEXT NOT NULL,id TEXT NOT NULL,timestamp INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,room,id));
    CREATE INDEX IF NOT EXISTS message_history ON messages(owner,room,timestamp DESC,id DESC);
    CREATE TABLE IF NOT EXISTS servers(owner TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(owner,id));
    PRAGMA user_version=1;`);
  const existing=db.prepare('SELECT payload FROM messages WHERE owner=? AND room=? AND id=?');
  const insert=db.prepare('INSERT INTO messages(owner,room,id,timestamp,payload) VALUES(?,?,?,?,?)');
  let closed=false;
  const server=createServer(async(request,response)=>{
    const origin=request.headers.origin;
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',Vary:'Origin'};
    if(origin&&origins.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS'});
    const reply=(status,value)=>{response.writeHead(status,headers);response.end(JSON.stringify(value));};
    try {
      if(origin&&!origins.includes(origin))return reply(403,{error:'Origin not allowed.'});
      if(request.method==='OPTIONS')return reply(204,{});
      const url=new URL(request.url,'http://archive.local');
      const route=/^\/v1\/owners\/([A-Za-z0-9_-]{1,200})\/(?:rooms\/([A-Za-z0-9_-]{1,200})\/messages|(servers))$/.exec(url.pathname);
      if(!route)return reply(404,{error:'Unknown archive route.'});
      const [,owner,room]=route;
      const bearer=request.headers.authorization||'';
      if(!Object.hasOwn(tokens,owner)||!safeEqual(bearer,'Bearer '+tokens[owner]))return reply(403,{error:'Archive credentials do not match this owner.'});
      if(request.method==='GET') {
        if(!room)return reply(200,{version:1,servers:db.prepare('SELECT payload FROM servers WHERE owner=? ORDER BY id LIMIT 200').all(owner).map(row=>JSON.parse(row.payload))});
        const limit=Number(url.searchParams.get('limit')||100),cursor=url.searchParams.get('before');
        if(!Number.isSafeInteger(limit)||limit<1||limit>200)return reply(400,{error:'Limit must be 1–200.'});
        let before;
        if(cursor){try{before=JSON.parse(Buffer.from(cursor,'base64url'));}catch{}if(!Array.isArray(before)||!Number.isSafeInteger(before[0])||typeof before[1]!=='string'||!/^[A-Za-z0-9_:-]{1,401}$/.test(before[1]))return reply(400,{error:'Invalid history cursor.'});}
        const rows=before?db.prepare('SELECT payload,timestamp,id FROM messages WHERE owner=? AND room=? AND (timestamp<? OR (timestamp=? AND id<?)) ORDER BY timestamp DESC,id DESC LIMIT ?').all(owner,room,before[0],before[0],before[1],limit+1):db.prepare('SELECT payload,timestamp,id FROM messages WHERE owner=? AND room=? ORDER BY timestamp DESC,id DESC LIMIT ?').all(owner,room,limit+1);
        const more=rows.length>limit;rows.length=Math.min(rows.length,limit);
        const oldest=rows.at(-1);
        return reply(200,{version:1,messages:rows.reverse().map(row=>JSON.parse(row.payload)),before:more&&oldest?Buffer.from(JSON.stringify([oldest.timestamp,oldest.id])).toString('base64url'):null});
      }
      if(request.method!==(room?'POST':'PUT'))return reply(405,{error:'Method not allowed.'});
      let size=0;const chunks=[];
      for await(const chunk of request){size+=chunk.length;if(size>96*1024){reply(413,{error:'Archive entry too large.'});return;}chunks.push(chunk);}
      let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Expected JSON.'});}
      if(!value||typeof value!=='object'||Array.isArray(value)||!identifier(value.id))return reply(400,{error:'Invalid entry.'});
      if(room) {
        if(typeof value.room!=='string'||value.room.length>2048||createHash('sha256').update(value.room).digest('hex')!==room||value.type!=='chat'||value.version!==2||!Number.isSafeInteger(value.timestamp)||value.timestamp<0||typeof value.signature!=='string'||!value.signature||!identifier(value.author?.id)||typeof value.text!=='string'||value.text.length>4000)return reply(400,{error:'Invalid signed message envelope.'});
        const id=value.author.id+':'+value.id,payload=JSON.stringify(value),old=existing.get(owner,room,id);
        if(old)return reply(old.payload===payload?200:409,{ok:old.payload===payload});
        insert.run(owner,room,id,value.timestamp,payload);return reply(201,{ok:true});
      }
      if(typeof value.name!=='string'||!value.name.trim()||value.name.length>80||!Array.isArray(value.channels)||value.channels.length>100||value.channels.some(channel=>!identifier(channel.id)||typeof channel.name!=='string'||!channel.name.trim()||channel.name.length>80||channel.type!=='text')||new Set(value.channels.map(channel=>channel.id)).size!==value.channels.length)return reply(400,{error:'Invalid server or text channels.'});
      const clean={id:value.id,name:value.name.trim(),channels:value.channels.map(({id,name})=>({id,name:name.trim(),type:'text'}))};
      db.prepare('INSERT INTO servers(owner,id,payload) VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET payload=excluded.payload').run(owner,value.id,JSON.stringify(clean));return reply(200,{ok:true});
    }catch(error){if(!response.headersSent)reply(500,{error:'Archive request failed.'});else response.end();}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=32;
  return {server,async close(){if(closed)return;closed=true;await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});db.close();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const tokens=JSON.parse(process.env.VUMIRO_STORAGE_TOKENS||'{}');
  if(Object.values(tokens).some(token=>typeof token!=='string'||token.length<32))throw Error('Use random owner tokens at least 32 characters long.');
  const service=createStorageServer({file:process.env.VUMIRO_STORAGE_FILE||'./data/vumiro.sqlite',tokens,origins:process.env.VUMIRO_STORAGE_ORIGINS?.split(',').map(x=>x.trim()).filter(Boolean)});
  const port=Number(process.env.PORT||8788),host=process.env.HOST||'127.0.0.1';
  service.server.listen(port,host,()=>console.log(`Vumiro private archive listening on ${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void service.close().then(()=>process.exit(0));});
}
