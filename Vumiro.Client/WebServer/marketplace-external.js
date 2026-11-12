(() => {
  'use strict';
  const pending=new Map();
  function validUrl(value){
    if(typeof value!=='string'||value.length>8192||/[\s\\\u0000-\u001f]/.test(value))return false;
    try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&((url.hostname==='checkout.stripe.com'&&url.pathname.startsWith('/c/pay/'))||(url.hostname==='connect.stripe.com'&&url.pathname.startsWith('/setup/')));}catch{return false;}
  }
  const bridge=window.chrome?.webview;
  bridge?.addEventListener('message',event=>{
    const data=event.data;if(data?.type!=='marketplace-external-result')return;
    const entry=pending.get(data.requestId);if(!entry)return;pending.delete(data.requestId);clearTimeout(entry.timer);
    if(data.ok===true)entry.resolve(true);else entry.reject(Error(data.error||'Could not open the system browser.'));
  });
  async function openExternal(url){
    if(!validUrl(url))throw Error('Only hosted payment and seller onboarding URLs can be opened.');
    if(window.vumiroDesktop?.marketplace?.openExternal)return window.vumiroDesktop.marketplace.openExternal(url);
    if(!bridge)throw Error('Opening checkout requires the Vumiro desktop app.');
    return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('The system browser did not open. Try again.'));},15000);pending.set(requestId,{resolve,reject,timer});try{bridge.postMessage({type:'marketplace',action:'open-external',requestId,url});}catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);}});
  }
  window.VumiroMarketplaceExternal=Object.freeze({validUrl,openExternal});
})();
