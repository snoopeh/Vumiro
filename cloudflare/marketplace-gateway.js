// The existing account origin remains the only browser credential destination.
// D1 and private objects belong exclusively to the separately configured Worker.
export async function marketplaceGateway(request,env){
  const path=new URL(request.url).pathname;
  if(path!=='/api/v1/marketplace'&&!path.startsWith('/api/v1/marketplace/'))return null;
  if(env.MARKETPLACE_SERVICE_ENABLED!=='true'||!env.MARKETPLACE_SERVICE?.fetch)return Response.json({error:'Marketplace service is not enabled.'},{status:503,headers:{'Cache-Control':'no-store'}});
  return env.MARKETPLACE_SERVICE.fetch(request);
}
