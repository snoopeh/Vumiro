(() => {
  'use strict';
  const storageKey='vumiro-chat-pane-ratio-v1',defaultRatio=.24,maxRatio=.30,compactWidth=780;
  function create({layout,handle,storage}) {
    if(!layout||!handle)return null;
    let ratio=defaultRatio,drag=null,width=0;
    try{const saved=Number(storage?.getItem(storageKey));if(Number.isFinite(saved)&&saved>=.10&&saved<=maxRatio)ratio=saved;}catch{}
    const viewport=()=>Math.max(1,Number(window.innerWidth)||1);
    const bounds=()=>{const max=Math.floor(viewport()*maxRatio);return {min:Math.min(280,max),max};};
    const clamp=value=>{const {min,max}=bounds();return Math.min(max,Math.max(min,value));};
    function paint(value=viewport()*ratio) {
      width=clamp(value);layout.style.setProperty('--chat-pane-width',width+'px');
      const {min,max}=bounds();handle.hidden=viewport()<=compactWidth;
      handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(max));handle.setAttribute('aria-valuenow',String(Math.round(width)));
      handle.setAttribute('aria-disabled',String(min===max));
    }
    function save(){ratio=width/viewport();try{storage?.setItem(storageKey,String(ratio));}catch{}}
    function finish(commit=false) {
      if(!drag)return;const id=drag.id;drag=null;layout.classList.remove('chat-resizing');
      if(commit)save();else paint();
      try{if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);}catch{}
    }
    function down(event) {
      if(drag||event.isPrimary===false||event.button!==0||handle.hidden||bounds().min===bounds().max)return;
      try{handle.setPointerCapture(event.pointerId);}catch{return;}
      drag={id:event.pointerId,x:event.clientX,width};layout.classList.add('chat-resizing');event.preventDefault();
    }
    function move(event){if(drag?.id===event.pointerId){paint(drag.width+drag.x-event.clientX);event.preventDefault();}}
    function up(event){if(drag?.id===event.pointerId)finish(true);}
    function cancel(event){if(drag?.id===event.pointerId)finish();}
    function key(event) {
      if(handle.hidden||drag)return;
      const step=event.shiftKey?48:16,{min,max}=bounds();
      const value=event.key==='ArrowLeft'?width+step:event.key==='ArrowRight'?width-step:event.key==='Home'?min:event.key==='End'?max:null;
      if(value===null)return;event.preventDefault();paint(value);save();
    }
    function resize(){finish();paint();}
    const events={pointerdown:down,pointermove:move,pointerup:up,pointercancel:cancel,lostpointercapture:cancel,keydown:key};
    for(const [name,fn] of Object.entries(events))handle.addEventListener(name,fn);
    window.addEventListener('resize',resize);paint();
    return {destroy(){finish();window.removeEventListener('resize',resize);for(const [name,fn] of Object.entries(events))handle.removeEventListener(name,fn);}};
  }
  window.VumiroChatPane={create};
})();
