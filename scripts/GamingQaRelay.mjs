import {createRequire} from 'node:module';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {isIP} from 'node:net';
const options=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,args)=>index%2?pairs:[...pairs,[value,args[index+1]]],[]));
const root=resolve(options['--root']||'.'),host=options['--host']||'127.0.0.1',port=Number(options['--port']||8787);
if(!isIP(host)||!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose a literal bind IP and port 1024..65535.');
const require=createRequire(join(root,'package.json'));
const {Miniflare,convertV4MiniflareOptions,Response:WorkerResponse}=require('miniflare');
const {build}=require('esbuild');
const ResponseType=WorkerResponse||Response;
const publicRoot=join(root,'public');
// Follow the Worker's complete import graph, including shared client validators.
// Keep runtime-provided Cloudflare modules external, as Wrangler does.
const bundled=await build({entryPoints:[join(root,'worker.js')],bundle:true,format:'esm',platform:'neutral',external:['cloudflare:*'],write:false,logLevel:'silent'});
const modules=[{type:'ESModule',path:join(root,'worker.js'),contents:bundled.outputFiles[0].text}];
const relay=new Miniflare(convertV4MiniflareOptions({
    host,port,modules,
    compatibilityDate:'2026-10-30',
    durableObjects:{CALL_ROOMS:{className:'CallRoom',useSQLite:true},FRIEND_DIRECTORY:{className:'FriendDirectory',useSQLite:true},DIRECT_CONVERSATIONS:{className:'DirectConversation',useSQLite:true}},
    durableObjectsPersist:resolve(options['--state']||join(root,'relay-state')),
    serviceBindings:{ASSETS:async request=>{
        const pathname=new URL(request.url).pathname;
        if(request.method!=='GET'||!/^\/[a-zA-Z0-9_.-]+\.(html|js|css|png|svg|ico|webp)$/.test(pathname))return new ResponseType('LOCAL QA relay',{status:404});
        const file=resolve(publicRoot,'.'+pathname);
        if(!file.startsWith(publicRoot+sep))return new ResponseType('Not found',{status:404});
        try{if((await stat(file)).size>2*1024*1024)return new ResponseType('Too large',{status:413});
            const body=await readFile(file);const type=pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.js')?'application/javascript; charset=utf-8':'application/octet-stream';
            return new ResponseType(body,{headers:{'content-type':type,'cache-control':'no-store'}});
        }catch{return new ResponseType('Not found',{status:404});}
    }}
}));
let stopping=false;async function stop(){if(stopping)return;stopping=true;await relay.dispose();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
process.stdin.setEncoding('utf8');process.stdin.on('data',data=>{if(data.trim()==='stop')stop();});
console.log('LOCAL QA relay ready: '+await relay.ready);
console.log('Current Worker identity/friend authentication is active. No deployment or account backend is configured.');
