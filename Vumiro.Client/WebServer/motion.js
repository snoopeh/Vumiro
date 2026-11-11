/* Local launch artwork and connection feedback. No network requests or generated particles. */
(() => {
  'use strict';
  const preference=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const launchKey='vumiro-launch-reveal-seen';
  const launchId=window.__VUMIRO_LAUNCH_ID__||window.vumiroDesktop?.launchId||'browser-session';
  let bootPending=false;
  function recordLaunchSeen(){try{window.sessionStorage.setItem(launchKey,launchId);}catch{ /* Optional session storage. */ }}
  function markLaunchSeen(){if(!bootPending)recordLaunchSeen();}
  function boot({overlay,content,skip,art}) {
    if(!overlay)return;
    const media=preference();
    let seen=false,disabled=false,finished=false,fade=0,end=0,elapsed=0;
    try {
      seen=window.sessionStorage.getItem(launchKey)===launchId;
      const progress=JSON.parse(window.sessionStorage.getItem(launchKey+'-started')||'null');
      const now=Date.now();
      if(progress?.id===launchId&&Number.isFinite(progress.at)&&progress.at<=now)elapsed=Math.min(4800,now-progress.at);
      else window.sessionStorage.setItem(launchKey+'-started',JSON.stringify({id:launchId,at:now}));
    } catch { /* Storage is optional; sign in must remain available. */ }
    try { disabled=window.localStorage.getItem('vumiro-disable-launch-animation')==='true'; } catch { /* Preferences are optional. */ }
    overlay.classList.remove('boot-exiting');
    function finish() {
      if(finished)return;finished=true;clearTimeout(fade);clearTimeout(end);
      recordLaunchSeen();overlay.hidden=true;overlay.classList.remove('boot-exiting');if(content)content.inert=false;art?.pauseAnimations?.();
      media?.removeEventListener?.('change',changed);skip?.removeEventListener('click',finish);
      if(document.activeElement===skip)content?.querySelector?.('input,button')?.focus();
    }
    function changed(){if(media.matches)finish();}
    if(seen||disabled||media?.matches||elapsed>=4800){finish();return;}
    if(overlay.style)overlay.style.animation='none';
    overlay.hidden=false;
    // Account startup may take longer than the stylesheet's safety timeout.
    // Restart it when artwork actually becomes visible, including redirects.
    if(overlay.style){void overlay.offsetWidth;overlay.style.animation='';}
    if(content)content.inert=true;
    art?.setCurrentTime?.(elapsed/1000);art?.unpauseAnimations?.();
    skip?.addEventListener('click',finish);media?.addEventListener?.('change',changed);
    fade=setTimeout(()=>overlay.classList.add('boot-exiting'),Math.max(0,3850-elapsed));
    end=setTimeout(finish,4800-elapsed);
    return {finish};
  }
  function petals({art,layer,toggle}) {
    if(!art||!layer||!toggle)return;
    const media=preference();let paused=false,minimized=false;
    function update() {
      const reduced=!!media?.matches,stopped=paused||document.hidden||minimized||reduced;
      layer.hidden=reduced;toggle.hidden=reduced;
      toggle.setAttribute('aria-pressed',String(paused));
      toggle.textContent=paused?'Resume petals':'Pause petals';
      if(stopped)art.pauseAnimations?.();else art.unpauseAnimations?.();
    }
    toggle.addEventListener('click',()=>{paused=!paused;update();});
    document.addEventListener('visibilitychange',update);media?.addEventListener?.('change',update);update();
    const host=window.vumiroDesktop||window.chrome?.webview;
    host?.addEventListener?.('message',event=>{
      if(event.data?.type!=='window-state'||typeof event.data.minimized!=='boolean')return;
      minimized=event.data.minimized;update();
    });
    try{host?.postMessage?.({type:'window',action:'state'});}catch{ /* Browser visibility remains available if the host is unavailable. */ }
    return {update};
  }
  function connection({overlay,title,detail,retry,cancel,onRetry,onCancel,content=[],returnFocus}) {
    if(!overlay)return;
    let timeout=0,state='idle';
    retry.addEventListener('click',()=>onRetry?.());cancel.addEventListener('click',()=>onCancel?.());
    function set(next,message='') {
      clearTimeout(timeout);timeout=0;state=next;
      const visible=['joining','reconnecting','error'].includes(state);
      const wasVisible=!overlay.hidden;
      for(const node of content)if(node)node.inert=visible;
      overlay.hidden=!visible;overlay.dataset.state=state;
      overlay.setAttribute('aria-busy',String(visible&&state!=='error'));
      retry.hidden=state!=='error'&&state!=='reconnecting';
      title.textContent=state==='error'?'Unable to connect':state==='reconnecting'?'Reconnecting to your room':'Establishing connection';
      detail.textContent=message||(state==='reconnecting'?'Restoring your room connection…':'Connecting securely. Your microphone and screen stay off until you choose to share.');
      if(visible&&!wasVisible)cancel.focus();
      else if(!visible&&wasVisible&&overlay.contains?.(document.activeElement))returnFocus?.focus();
      if(state==='joining'||state==='reconnecting')timeout=setTimeout(()=>{
        timeout=0;overlay.dataset.state='slow';overlay.setAttribute('aria-busy','false');retry.hidden=false;
        detail.textContent='This is taking longer than expected. You can retry or return to your friends.';
      },15000);
    }
    set('idle');return {set};
  }
  function scrollbar(log) {
    if(!log)return;let timeout=0;
    log.addEventListener('scroll',()=>{log.classList.add('is-scrolling');clearTimeout(timeout);timeout=setTimeout(()=>{timeout=0;log.classList.remove('is-scrolling');},900);},{passive:true});
  }
  function roomLaunch({slot,getFrame,origin,onCancel,onRetry}) {
    if(!slot)return null;
    const style=document.createElement('style');style.textContent=`.roomLaunchSurface{position:absolute;inset:0;z-index:10;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 42%,#431c2480,transparent 65%),#121011;padding:24px;color:#faf8fa;text-align:center}.roomLaunchSurface[hidden]{display:none}.roomLaunchCard{max-width:460px}.roomLaunchMark{font-size:54px;font-weight:800;color:#ff233b;animation:roomLaunchPulse 1.5s ease-in-out infinite}.roomLaunchCard h2{margin:18px 0 12px;font-size:24px;letter-spacing:-.7px}.roomLaunchCard p{font-size:13px;line-height:1.7;color:#b8afb3}.roomLaunchActions{display:flex;gap:10px;justify-content:center;margin-top:24px}@keyframes roomLaunchPulse{50%{opacity:.45;transform:scale(.93)}}@media(prefers-reduced-motion:reduce){.roomLaunchMark{animation:none}}`;document.head.append(style);
    slot.style.position='relative';
    const surface=document.createElement('section'),card=document.createElement('div'),mark=document.createElement('div'),title=document.createElement('h2'),detail=document.createElement('p'),actions=document.createElement('div'),cancel=document.createElement('button'),retry=document.createElement('button');
    surface.className='roomLaunchSurface';surface.hidden=true;surface.setAttribute('role','status');surface.setAttribute('aria-live','polite');card.className='roomLaunchCard';mark.className='roomLaunchMark';mark.innerHTML='<svg width="68" height="54" viewBox="0 0 300 240"><use href="#vumiro-mark"/></svg>';mark.setAttribute('aria-hidden','true');actions.className='roomLaunchActions';cancel.type=retry.type='button';cancel.textContent='Cancel';retry.textContent='Try again';retry.className='primary';actions.append(cancel,retry);card.append(mark,title,detail,actions);surface.append(card);slot.append(surface);
    let active=null,timer=0;
    function stop(){clearTimeout(timer);timer=0;if(active){active.frame.style.visibility='';active.frame.inert=false;}active=null;surface.hidden=true;}
    function start(frame,id){stop();const attempt=active={frame,id};frame.style.visibility='hidden';frame.inert=true;surface.hidden=false;surface.setAttribute('aria-busy','true');title.textContent='Establishing connection';detail.textContent='Connecting securely. Your microphone and screen stay off until you choose to share.';retry.hidden=true;cancel.focus?.();
      timer=setTimeout(()=>{timer=0;if(active!==attempt||getFrame()!==frame)return;surface.setAttribute('aria-busy','false');detail.textContent='This is taking longer than expected. You can retry or return to your friends.';retry.hidden=false;},15000);
    }
    function receive(event){if(!active||getFrame()!==active.frame||event.source!==active.frame.contentWindow||event.origin!==origin||event.data?.type!=='vumiro-room-ui-ready'||event.data.launchId!==active.id)return false;stop();return true;}
    cancel.addEventListener('click',()=>{if(!active)return;stop();onCancel();});retry.addEventListener('click',()=>{if(active&&!retry.hidden)onRetry();});
    return {start,stop,receive};
  }
  window.VumiroMotion={boot,petals,connection,scrollbar,markLaunchSeen,roomLaunch};
  const $=id=>document.getElementById(id);
  const bootNodes={overlay:$('bootReveal'),content:$('authContent')||$('friendsContent')||$('app'),skip:$('bootSkip'),art:$('bootArt')};
  bootPending=!!bootNodes.overlay&&!$('authContent');
  if(bootPending||bootNodes.overlay&&window.__VUMIRO_WAIT_FOR_HOST__&&!window.__VUMIRO_HOST_READY__){bootNodes.overlay.hidden=true;bootNodes.art?.pauseAnimations?.();}
  function autoBoot(){
    if(bootNodes.overlay&&window.__VUMIRO_WAIT_FOR_HOST__&&!window.__VUMIRO_HOST_READY__){window.addEventListener('vumiro-host-ready',autoBoot,{once:true});return;}
    if(bootPending&&window.VumiroAccount?.ready){window.VumiroAccount.ready().then(ready=>{if(ready)boot(bootNodes);bootPending=false;}).catch(()=>{bootPending=false;});}
    else {boot(bootNodes);bootPending=false;}
  }
  if(bootPending&&document.readyState==='loading')document.addEventListener('DOMContentLoaded',autoBoot,{once:true});else autoBoot();
  petals({art:$('petalArt'),layer:$('loginPetals'),toggle:$('petalPause')});
  scrollbar($('chatLog'));
})();
