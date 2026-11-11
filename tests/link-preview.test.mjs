import test from 'node:test';
import assert from 'node:assert/strict';
test('page preview returns bounded metadata and refuses private or unsupported destinations',async()=>{
  const {handleLinkPreview}=await import('../cloudflare/link-preview.js');let calls=0;
  const fetcher=async()=>{calls++;return new Response('<title>Fallback</title><meta property="og:title" content="A &amp; B"><meta property="og:image" content="https://images.example/header.jpg"><meta name="description" content="A useful page">',{headers:{'Content-Type':'text/html'}});};
  const get=url=>new Request('https://worker.example/api/link-preview?url='+encodeURIComponent(url),{headers:{Origin:'https://screentask.local'}});
  const response=await handleLinkPreview(get('https://github.com/snoopeh/Vumiro'),{},fetcher),metadata=await response.json();
  assert.equal(response.status,200);assert.equal(metadata.title,'A & B');assert.equal(metadata.description,'A useful page');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://screentask.local');
  for(const url of ['http://127.0.0.1','https://localhost','https://github.com@localhost','https://random.example','https://github.com:8443/private'])assert.equal((await handleLinkPreview(get(url),{},fetcher)).status,422);
  assert.equal(calls,1);
  const redirect=await handleLinkPreview(get('https://github.com/foo'),{},async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/admin'}}));assert.equal(redirect.status,422);
});
test('YouTube uses provider metadata when watch HTML has no useful title',async()=>{
  const {handleLinkPreview}=await import('../cloudflare/link-preview.js');
  const request=new Request('https://worker.example/api/link-preview?url='+encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  const response=await handleLinkPreview(request,{},async url=>{assert.equal(new URL(url).pathname,'/oembed');return Response.json({title:'A real video title',author_name:'A creator',thumbnail_url:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'});});
  const value=await response.json();assert.equal(response.status,200);assert.equal(value.title,'A real video title');assert.equal(value.siteName,'YouTube');assert.match(value.image,/i\.ytimg\.com/);
});
