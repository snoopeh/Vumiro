/* A bounded thumb over the native chat scroller; no duplicate scroll range. */
(() => {
  'use strict';
  const controllers=new WeakMap();
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,Number.isFinite(value)?value:min));
  function measure(viewport,content,scrollTop,trackHeight=viewport) {
    const range=Math.max(0,content-viewport);
    if(!(viewport>0&&trackHeight>0&&range>1))return {visible:false,thumbHeight:0,thumbTop:0,range,travel:0};
    const thumbHeight=trackHeight*clamp(viewport/content,.20,.60),travel=trackHeight-thumbHeight;
    return {visible:true,thumbHeight,thumbTop:travel*clamp(scrollTop/range,0,1),range,travel};
  }
  function create({log,shell,track,thumb}={}) {
    if(!log||!shell||!track||!thumb)return null;
    if(controllers.has(log))return controllers.get(log);
    let disposed=false,frame=0,drag=null,geometry=null;
    const cleanups=[],observed=new Set();
    const listen=(node,type,fn,options)=>{node.addEventListener(type,fn,options);cleanups.push(()=>node.removeEventListener(type,fn,options));};
    const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
    const mutation=typeof MutationObserver==='function'?new MutationObserver(schedule):null;
    function observeMessages() {
      if(!resize)return;
      const current=new Set(log.children);
      for(const node of observed)if(!current.has(node)){resize.unobserve(node);observed.delete(node);}
      for(const node of current)if(!observed.has(node)){resize.observe(node);observed.add(node);}
    }
    function refresh() {
      if(disposed)return null;
      observeMessages();
      geometry=measure(log.clientHeight,log.scrollHeight,log.scrollTop,shell.clientHeight||log.clientHeight);
      track.hidden=!geometry.visible;
      thumb.style.height=geometry.thumbHeight+'px';
      thumb.style.transform='translateY('+geometry.thumbTop+'px)';
      thumb.setAttribute('aria-valuemax',String(Math.round(geometry.range)));
      thumb.setAttribute('aria-valuenow',String(Math.round(clamp(log.scrollTop,0,geometry.range))));
      if(!geometry.visible)stopDrag();
      return geometry;
    }
    function schedule() {
      if(disposed||frame)return;
      frame=requestAnimationFrame(()=>{frame=0;refresh();});
    }
    function stopDrag(event) {
      if(!drag||(event&&event.pointerId!==drag.id))return;
      const pointer=drag.id;drag=null;shell.classList.remove('is-dragging');
      try {if(thumb.hasPointerCapture?.(pointer))thumb.releasePointerCapture(pointer);}catch{/* Detached or already-released pointer. */}
    }
    function down(event) {
      if(event.button!==0||drag)return;
      const current=refresh();if(!current?.visible)return;
      const offset=event.clientY-track.getBoundingClientRect().top-current.thumbTop;
      drag={id:event.pointerId,grab:clamp(offset/current.thumbHeight,0,1)};
      try {thumb.setPointerCapture(event.pointerId);}catch{drag=null;return;}
      event.preventDefault();thumb.focus({preventScroll:true});shell.classList.add('is-dragging');
    }
    function move(event) {
      if(!drag||event.pointerId!==drag.id)return;
      const current=refresh();if(!drag||!current?.visible)return;
      const top=event.clientY-track.getBoundingClientRect().top-current.thumbHeight*drag.grab;
      log.scrollTop=current.range*clamp(top/current.travel,0,1);refresh();event.preventDefault();
    }
    function key(event) {
      const current=refresh();if(!current?.visible||event.altKey||event.ctrlKey||event.metaKey)return;
      const page=log.clientHeight*.9,steps={ArrowUp:-40,ArrowDown:40,PageUp:-page,PageDown:page};
      let next;
      if(event.key==='Home')next=0;
      else if(event.key==='End')next=current.range;
      else if(Object.hasOwn(steps,event.key))next=log.scrollTop+steps[event.key];
      else return;
      event.preventDefault();log.scrollTop=clamp(next,0,current.range);refresh();
    }
    function wheel(event) {
      // The overlay is a sibling of the log. Forward only wheel events directly
      // over its small handle; content retains the browser's native scrolling.
      if(event.ctrlKey||!geometry?.visible)return;
      const unit=event.deltaMode===1?16:event.deltaMode===2?log.clientHeight:1;
      if(!event.deltaY)return;
      event.preventDefault();log.scrollTop=clamp(log.scrollTop+event.deltaY*unit,0,geometry.range);schedule();
    }
    function dispose() {
      if(disposed)return;disposed=true;
      if(frame)cancelAnimationFrame(frame);frame=0;stopDrag();
      resize?.disconnect();mutation?.disconnect();observed.clear();
      for(const cleanup of cleanups)cleanup();
      shell.classList.remove('chat-scroll-custom');track.hidden=true;controllers.delete(log);
    }
    thumb.setAttribute('role','scrollbar');thumb.setAttribute('aria-controls',log.id||'chatLog');
    thumb.setAttribute('aria-orientation','vertical');thumb.setAttribute('aria-valuemin','0');
    listen(log,'scroll',schedule,{passive:true});listen(log,'load',schedule,true);
    listen(thumb,'pointerdown',down);listen(thumb,'pointermove',move);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(thumb,type,stopDrag);
    listen(thumb,'keydown',key);listen(thumb,'wheel',wheel,{passive:false});
    listen(window,'resize',schedule,{passive:true});listen(window,'pagehide',dispose);
    resize?.observe(log);resize?.observe(shell);
    mutation?.observe(log,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style','src','hidden']});
    shell.classList.add('chat-scroll-custom');refresh();
    const controller=Object.freeze({refresh,dispose});controllers.set(log,controller);return controller;
  }
  window.VumiroChatScrollbar=Object.freeze({measure,create});
})();
