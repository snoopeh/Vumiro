import { authenticate } from './accounts.js';
import { handleMarketplaceRequest, runMarketplaceMaintenance } from './marketplace.js';
import { marketplaceReturn } from './marketplace-return.js';

const PREFIX='/api/v1/marketplace';
const response=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function originAllowed(origin,url){
  if(!origin||origin===url.origin||['https://vumiro.local','https://screentask.local','vumiro://app'].includes(origin))return true;
  try{return ['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);}catch{return false;}
}
export default {
  async fetch(request,env){
    const url=new URL(request.url),origin=request.headers.get('Origin');
    if(!originAllowed(origin,url))return response({error:'origin-forbidden'},403);
    const cors=origin?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, Idempotency-Key','Access-Control-Expose-Headers':'X-Vumiro-Package-Digest','Vary':'Origin'}:{};
    let result;
    if(url.pathname===`${PREFIX}/return`)result=marketplaceReturn(request);
    else if(request.method==='OPTIONS')result=new Response(null,{status:204});
    else if(url.pathname.startsWith(`${PREFIX}/commerce/`)||url.pathname===`${PREFIX}/webhooks/stripe`){
      const {handleCommerceRequest}=await import('./marketplace-commerce.js');
      const webhook=url.pathname===`${PREFIX}/webhooks/stripe`;
      const user=webhook?null:await authenticate(request,env);
      if(!webhook&&!user)result=response({error:'account-auth-required'},401);
      else result=await handleCommerceRequest(request,env,{accountId:user?.id||null,db:env.MARKETPLACE_DB,admin:!!user&&String(env.MARKETPLACE_ADMIN_ACCOUNTS||'').split(',').map(v=>v.trim()).includes(user.id)})||response({error:'route-not-found'},404);
    } else result=await handleMarketplaceRequest(request,env)||response({error:'route-not-found'},404);
    const headers=new Headers(result.headers);for(const [key,value]of Object.entries(cors))headers.set(key,value);
    headers.set('X-Content-Type-Options','nosniff');return new Response(result.body,{status:result.status,headers});
  },
  async scheduled(_controller,env,context){context.waitUntil(runMarketplaceMaintenance(env));}
};
