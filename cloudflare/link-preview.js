// Deliberately bounded public-site metadata fetcher, not a general URL proxy.
const sites=['github.com','www.youtube.com','youtube.com','youtu.be','en.wikipedia.org','pt.wikipedia.org','www.wikipedia.org','vimeo.com','www.vimeo.com','www.twitch.tv','twitch.tv','open.spotify.com','store.steampowered.com','giphy.com','tenor.com','www.reddit.com','reddit.com'];
function destination(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&sites.includes(url.hostname)?url:null;}catch{return null;}}
function decode(value){return value.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi,entity=>{const named={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"};if(named[entity.toLowerCase()])return named[entity.toLowerCase()];const number=entity[2]?.toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);return Number.isFinite(number)&&number>0&&number<=0x10ffff?String.fromCodePoint(number):'';}).replace(/\s+/g,' ').trim();}
export async function handleLinkPreview(request,env={},fetcher=fetch){
  const origin=request.headers.get('Origin'),own=new URL(request.url).origin;
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  if(origin&&[own,'https://screentask.local','https://vumiro.local','vumiro://app'].includes(origin))headers['Access-Control-Allow-Origin']=origin;
  const reply=(status,value)=>Response.json(value,{status,headers});
  if(origin&&!headers['Access-Control-Allow-Origin'])return reply(403,{error:'Origin not allowed.'});
  if(request.method!=='GET')return reply(405,{error:'GET required.'});
  let target=destination(new URL(request.url).searchParams.get('url'));
  if(!target)return reply(422,{error:'Preview unavailable for this site.'});
  if(env.ACCOUNT_API_RATE_LIMITER){const result=await env.ACCOUNT_API_RATE_LIMITER.limit({key:'link-preview:'+(request.headers.get('CF-Connecting-IP')||'unknown')});if(!result.success)return reply(429,{error:'Preview request limit reached.'});}
  const signal=AbortSignal.timeout(5000);
  try {
    const video=['youtube.com','www.youtube.com'].includes(target.hostname)?target.pathname==='/watch'?target.searchParams.get('v'):null:target.hostname==='youtu.be'?target.pathname.slice(1):null;
    if(typeof video==='string'&&/^[A-Za-z0-9_-]{11}$/.test(video)){
      const source=new URL('https://www.youtube.com/oembed');source.searchParams.set('url','https://www.youtube.com/watch?v='+video);source.searchParams.set('format','json');
      const provider=await fetcher(source.href,{redirect:'manual',signal,headers:{Accept:'application/json','User-Agent':'Vumiro-LinkPreview/1.0'}});
      if(provider.ok&&/application\/json/i.test(provider.headers.get('Content-Type')||'')){
        const reader=provider.body.getReader(),decoder=new TextDecoder();let raw='',size=0;
        try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw Error('Metadata too large');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel();}
        const data=JSON.parse(raw),title=typeof data.title==='string'?decode(data.title).slice(0,300):'';
        if(title)return reply(200,{url:target.href,title,description:typeof data.author_name==='string'?decode(data.author_name).slice(0,100):'',siteName:'YouTube',image:'https://i.ytimg.com/vi/'+video+'/hqdefault.jpg'});
      }else await provider.body?.cancel();
    }
    let response;
    for(let attempt=0;attempt<3;attempt++){
      response=await fetcher(target.href,{redirect:'manual',signal,headers:{Accept:'text/html','User-Agent':'Vumiro-LinkPreview/1.0'}});
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('Location');await response.body?.cancel();
      target=location?destination(new URL(location,target).href):null;
      if(!target)return reply(422,{error:'Preview redirect unavailable.'});
      if(attempt===2)return reply(422,{error:'Too many preview redirects.'});
    }
    if(!response.ok||!/^text\/html(?:;|$)/i.test(response.headers.get('Content-Type')||'')){await response.body?.cancel();return reply(422,{error:'Page preview unavailable.'});}
    const reader=response.body.getReader(),decoder=new TextDecoder();let html='',bytes=0;
    try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>256*1024)break;html+=decoder.decode(value,{stream:true});if(/<\/head\s*>/i.test(html))break;}}finally{await reader.cancel();}
    const meta=new Map();
    for(const tag of html.matchAll(/<meta\s[^>]{1,4096}>/gi)){
      const attributes=new Map();for(const match of tag[0].matchAll(/([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))attributes.set(match[1].toLowerCase(),match[2]??match[3]??match[4]);
      const key=(attributes.get('property')||attributes.get('name')||'').toLowerCase();if(key&&!meta.has(key))meta.set(key,decode(attributes.get('content')||''));
    }
    let image='';try{const url=new URL(meta.get('og:image')||meta.get('twitter:image')||'',target);if(url.protocol==='https:'&&!url.username&&!url.password&&url.href!==target.href&&!/^(localhost|127\.|10\.|192\.168\.|\[)/i.test(url.hostname))image=url.href;}catch{}
    return reply(200,{url:target.href,title:(meta.get('og:title')||meta.get('twitter:title')||decode(/<title[^>]*>([^<]{0,2000})<\/title>/i.exec(html)?.[1]||'')||target.hostname).slice(0,300),description:(meta.get('og:description')||meta.get('description')||'').slice(0,600),siteName:(meta.get('og:site_name')||target.hostname).slice(0,100),image});
  }catch{return reply(422,{error:'Page preview unavailable.'});}
}
