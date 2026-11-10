/* Draft decisions are independent from rendering and persistence. */
(() => {
  'use strict';
  function create({sections=[],confirm,close,onError=()=>{}}){
    const adapters=[...sections];let busy=false;
    const dirty=()=>adapters.filter(section=>section.dirty());
    return {
      add:section=>adapters.push(section),
      dirty:()=>dirty().length>0,
      async requestClose(){
        if(busy)return false;
        busy=true;
        try{
          if(!dirty().length){close();return true;}
          const choice=await confirm();
          if(choice==='discard'){
            for(const section of dirty())await section.discard();
            close();return true;
          }
          if(choice!=='save')return false;
          for(const section of dirty())if(await section.save()!==true)throw Error('Could not save all changes. Your unsaved changes are still here.');
          if(dirty().length)throw Error('Some settings changed while saving. Review your changes before leaving.');
          close();return true;
        }catch(error){onError(error);return false;}
        finally{busy=false;}
      }
    };
  }
  function confirmExit(){
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='settingsExitPrompt';
      dialog.setAttribute('aria-labelledby','settingsExitHeading');dialog.setAttribute('aria-describedby','settingsExitDescription');
      const heading=document.createElement('h2');heading.id='settingsExitHeading';heading.textContent='Save your changes?';
      const description=document.createElement('p');description.id='settingsExitDescription';description.textContent='You changed your settings. Save or discard your changes before leaving.';
      const actions=document.createElement('div');actions.className='dialogActions';
      let settled=false;
      const finish=choice=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(choice);};
      for(const [value,label]of[['stay','Keep editing'],['discard','Discard changes'],['save','Save changes']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        if(value==='save')button.className='primary';
        if(value==='stay')button.autofocus=true;
        button.onclick=()=>finish(value);actions.append(button);
      }
      dialog.addEventListener('cancel',event=>{event.preventDefault();finish('stay');});
      dialog.append(heading,description,actions);document.body.append(dialog);
      window.VumiroI18n?.refresh(dialog);dialog.showModal();
    });
  }
  window.VumiroSettingsDrafts={create,confirmExit};
})();
