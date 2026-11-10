/* Draft-only cover framing dialog. Saving the profile is the only persistence action. */
(() => {
  'use strict';
  let active=null,generation=0;
  const cancel=()=>{generation++;active?.close('cancel');};
  async function open({source,crop=null,hasOriginal=true,isCurrent=()=>true}) {
    cancel();
    const selection=generation,current=()=>selection===generation&&isCurrent();
    if(!(source instanceof Blob)||!['image/png','image/jpeg','image/webp'].includes(source.type)||source.size>10*1024*1024)throw Error('Choose a PNG, JPEG or WebP image under 10 MiB.');
    const header=window.VumiroCoverMedia.rasterSize(new Uint8Array(await source.arrayBuffer()),source.type);if(header&&header.width*header.height>25000000)throw Error('Choose an image smaller than 25 megapixels.');if(!current())return null;
    const bitmap=await createImageBitmap(source),width=bitmap.width,height=bitmap.height;bitmap.close();
    if(!current())return null;
    if(!width||!height||width*height>25000000)throw Error('Choose an image smaller than 25 megapixels.');
    const opener=document.activeElement,dialog=document.createElement('dialog'),url=URL.createObjectURL(source);
    dialog.className='coverCropDialog';dialog.setAttribute('aria-labelledby','coverCropTitle');
    dialog.innerHTML='<h2 id="coverCropTitle">Frame your cover</h2><p class="coverCropHelp">Drag to reposition. Use the slider or mouse wheel to zoom. Arrow keys move the image; Home resets it.</p><div class="coverCropViewport" tabindex="0" role="group" aria-label="Cover crop. Drag or use arrow keys to move, plus and minus to zoom."><img alt="" draggable="false"></div><label class="coverCropZoom">Zoom <output></output><input type="range" min="1" max="4" step="0.01" value="1" aria-label="Cover zoom"></label><p class="coverCropSize" aria-live="polite"></p><p class="coverCropPrivacy"></p><div class="dialogActions"><button type="button" data-reset>Reset</button><button type="button" data-cancel>Cancel</button><button type="button" class="primary" data-use>Use cover</button></div>';
    if(!document.getElementById('coverCropStyles')) {
      const style=document.createElement('style');style.id='coverCropStyles';style.textContent='.coverCropDialog{width:min(800px,calc(100vw - 32px));max-height:calc(100svh - 30px);overflow:auto}.coverCropViewport{position:relative;width:100%;aspect-ratio:3/1;overflow:hidden;touch-action:none;background:#141417;border:1px solid #555;cursor:grab}.coverCropViewport:active{cursor:grabbing}.coverCropViewport img{position:absolute;max-width:none;max-height:none;pointer-events:none;user-select:none}.coverCropZoom{display:flex;align-items:center;gap:14px;margin-top:18px}.coverCropZoom input{flex:1;margin:0!important}.coverCropSize,.coverCropPrivacy{font-size:12px;margin:12px 0!important}.coverCropPrivacy{color:var(--muted,#aaa)}';document.head.append(style);
    }
    const image=dialog.querySelector('img');image.src=url;
    let binding;
    try {
      await image.decode();if(!current())return null;
      document.body.append(dialog);active=dialog;dialog.showModal();
      const viewport=dialog.querySelector('.coverCropViewport'),viewportWidth=viewport.clientWidth;
      const model=window.VumiroProfileCrop.create({imageWidth:width,imageHeight:height,viewportWidth,viewportHeight:viewportWidth/3});
      if(crop)try{model.restoreCrop(crop);}catch{model.reset();}
      dialog.querySelector('.coverCropPrivacy').textContent=hasOriginal?'Your original stays on this device. Only the finished cover is shared or backed up.':'Only the finished cover is available on this device. Choose the original file to reveal areas outside this crop.';
      binding=window.VumiroProfileCrop.bindControls({model,viewport,image,zoomInput:dialog.querySelector('input'),zoomOutput:dialog.querySelector('output'),resetButton:dialog.querySelector('[data-reset]'),onChange:()=>{
        try{const size=model.outputSize();dialog.querySelector('.coverCropSize').textContent=`Finished cover: ${size.width} × ${size.height} pixels.`+(size.width<1920?' This small crop may look soft on large displays.':'');dialog.querySelector('[data-use]').disabled=false;}
        catch(error){dialog.querySelector('.coverCropSize').textContent=error.message;dialog.querySelector('[data-use]').disabled=true;}
      }});
      return await new Promise(resolve=>{
        dialog.addEventListener('close',()=>resolve(dialog.returnValue==='use'&&current()?{rect:model.sourceRect(),size:model.outputSize()}:null),{once:true});
        dialog.addEventListener('cancel',()=>{dialog.returnValue='cancel';});
        dialog.querySelector('[data-cancel]').onclick=()=>dialog.close('cancel');
        dialog.querySelector('[data-use]').onclick=()=>dialog.close('use');
        dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close('cancel');}});
        viewport.focus();
      });
    } finally {binding?.destroy();if(active===dialog)active=null;dialog.remove();URL.revokeObjectURL(url);if(!active&&opener?.isConnected)opener.focus();}
  }
  globalThis.VumiroCoverEditor=Object.freeze({open,cancel});
})();