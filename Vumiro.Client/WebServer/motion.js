/* Local launch artwork and connection feedback. No network requests or generated particles. */
(() => {
  'use strict';
  const preference=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const launchKey='vumiro-launch-reveal-seen';
  function markLaunchSeen(){try{window.sessionStorage.setItem(launchKey,'1');}catch{ /* Optional session storage. */ }}
  function boot({overlay,content,skip,art}) {
    if(!overlay)return;
    const media=preference();
    let seen=false,finished=false,fade=0,end=0;
    try { seen=window.sessionStorage.getItem(launchKey)==='1'; } catch { /* Storage is optional; sign in must remain available. */ }
    markLaunchSeen();
    function finish() {
      if(finished)return;finished=true;clearTimeout(fade);clearTimeout(end);
      overlay.hidden=true;if(content)content.inert=false;art?.pauseAnimations?.();
      media?.removeEventListener?.('change',changed);skip?.removeEventListener('click',finish);
      if(document.activeElement===skip)content?.querySelector?.('input,button')?.focus();
    }
    function changed(){if(media.matches)finish();}
    if(seen||media?.matches){finish();return;}
    overlay.hidden=false;if(content)content.inert=true;
    art?.setCurrentTime?.(0);art?.unpauseAnimations?.();
    skip?.addEventListener('click',finish);media?.addEventListener?.('change',changed);
    fade=setTimeout(()=>overlay.classList.add('boot-exiting'),3850);
    end=setTimeout(finish,4800);
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
  window.VumiroMotion={boot,petals,connection,scrollbar,markLaunchSeen};
  const $=id=>document.getElementById(id);
  boot({overlay:$('bootReveal'),content:$('authContent'),skip:$('bootSkip'),art:$('bootArt')});
  petals({art:$('petalArt'),layer:$('loginPetals'),toggle:$('petalPause')});
  scrollbar($('chatLog'));
})();
