/* A bounded app-content effect. Nudges never move or focus the native window. */
(() => {
  'use strict';
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let current=null,timer=0;
  const style=document.createElement('style');style.textContent=`
    .vumiro-nudge-shake{animation:vumiro-nudge-shake 900ms ease-out!important;transform-origin:50% 50%}
    .vumiro-nudge-frame{position:fixed;inset:0;pointer-events:none;z-index:2147483000;border-radius:12px;box-shadow:inset 0 0 24px 10px #ffd4486b,inset 0 0 76px 18px #ffdf572b;filter:blur(2px);animation:vumiro-nudge-glow 900ms ease-out both}
    @keyframes vumiro-nudge-shake{0%,100%{transform:translate(0,0)}8%,24%{transform:translate(-4px,1px) rotate(-.15deg)}16%,32%{transform:translate(4px,-1px) rotate(.15deg)}42%{transform:translate(-3px,1px)}52%{transform:translate(3px,-1px)}64%{transform:translate(-2px,0)}76%{transform:translate(2px,0)}88%{transform:translate(-1px,0)}}
    @keyframes vumiro-nudge-glow{0%,100%{opacity:0}20%,65%{opacity:1}}
    @media(prefers-reduced-motion:reduce){.vumiro-nudge-shake{animation:none!important}}
  `;document.head.append(style);
  function glow() {
    if(!current||current.frame)return;
    current.target.classList.remove('vumiro-nudge-shake');
    const frame=document.createElement('div');frame.className='vumiro-nudge-frame';frame.setAttribute('aria-hidden','true');current.target.append(frame);current.frame=frame;
  }
  function cancel() {
    clearTimeout(timer);timer=0;if(!current)return;
    current.target.classList.remove('vumiro-nudge-shake');current.frame?.remove();current=null;
  }
  function effect({silent=false,reducedMotion=false,target}={}) {
    if(current)return false;
    target=target||document.querySelector('dialog[open]')||document.querySelector('.app')||document.body;if(!target)return false;
    current={target,frame:null};
    if(silent||reducedMotion||media?.matches)glow();else target.classList.add('vumiro-nudge-shake');
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
