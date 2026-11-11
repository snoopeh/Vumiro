/* Desktop effects belong to the host; browsers can only show a local glow. */
(() => {
  'use strict';
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let current=null,timer=0;
  const desktop=window.chrome?.webview||window.vumiroDesktop;
  const host=desktop?.platform==='linux'&&!(desktop.capabilities?.nativeWindowNudge&&desktop.capabilities?.screenNudgeGlow)?null:desktop;
  const style=document.createElement('style');style.textContent=`
    .vumiro-nudge-frame{position:fixed;inset:0;pointer-events:none;z-index:2147483000;border-radius:12px;box-shadow:inset 0 0 24px 10px #f6f0eb45,inset 0 0 76px 18px #f6f0eb1a;filter:blur(2px);animation:vumiro-nudge-glow 900ms ease-out both}

    @keyframes vumiro-nudge-glow{0%,100%{opacity:0}20%,65%{opacity:1}}

  `;document.head.append(style);
  function glow() {
    if(!current||current.frame)return;
    if(current.native){host.postMessage({type:'window',action:'nudge',silent:true});return;}
    const frame=document.createElement('div');frame.className='vumiro-nudge-frame';frame.setAttribute('aria-hidden','true');current.target.append(frame);current.frame=frame;
  }
  function cancel() {
    clearTimeout(timer);timer=0;if(!current)return;
    if(current.native)host.postMessage({type:'window',action:'nudge-cancel'});current.frame?.remove();current=null;
  }
  function effect({silent=false,reducedMotion=false,target}={}) {
    if(current)return false;
    target=target||document.querySelector('dialog[open]')||document.querySelector('.app')||document.body;if(!target)return false;
    current={target,frame:null,native:!!host};
    if(host)host.postMessage({type:'window',action:'nudge',silent:!!(silent||reducedMotion||media?.matches)});else glow();
    timer=setTimeout(cancel,900);return true;
  }
  media?.addEventListener?.('change',()=>{if(media.matches)glow();});
  function preferences(storage){
    const key='vumiro-nudge-preferences-v1';let saved={allow:true,silent:false};
    try{const value=JSON.parse(storage.getItem(key));if(value&&typeof value==='object')saved={allow:typeof value.allow==='boolean'?value.allow:true,silent:typeof value.silent==='boolean'?value.silent:false};}catch{}
    return {get value(){return {...saved};},save(next){if(typeof next?.allow!=='boolean'||typeof next?.silent!=='boolean')return false;const value={allow:next.allow,silent:next.silent};try{storage.setItem(key,JSON.stringify(value));saved=value;return true;}catch{return false;}}};
  }
  window.VumiroNudge={effect,cancel,preferences};
})();
