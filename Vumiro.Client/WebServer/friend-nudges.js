(() => {
  'use strict';
  function create({getFriend,isOnline,isReady,transport,preferences,status=()=>{},toast=()=>{},panel,anchors=[]}) {
    const busy=new Set(),sent=new Map(),buttons=[];let generation=0,timer=0;
    const eligible=id=>!!getFriend(id)&&isReady()&&isOnline(id);
    function render(){for(const [id,time]of sent)if(Date.now()-time>=30000)sent.delete(id);for(const {button,id} of buttons){const key=id();button.hidden=!getFriend(key);button.disabled=!eligible(key)||busy.has(key)||Date.now()-(sent.get(key)||0)<30000;}}
    function schedule(){clearTimeout(timer);if(!buttons.length)return;timer=setTimeout(()=>{render();if(sent.size)schedule();},1000);}
    async function send(id){
      if(!eligible(id)||busy.has(id))return false;
      if(Date.now()-(sent.get(id)||0)<30000){toast('Wait 30 seconds before nudging this friend again.');return false;}
      const version=generation;busy.add(id);sent.set(id,Date.now());if(sent.size>256)sent.delete(sent.keys().next().value);render();schedule();status('Sending nudge…');
      try{await transport(id);if(version!==generation||!eligible(id))return false;toast('Nudge delivered.');status('Nudge delivered.');return true;}
      catch(error){if(version===generation){const message=window.VumiroI18n?.error(error)||error.message||'Could not send nudge.';toast(message);status(message);}return false;}
      finally{if(version===generation){busy.delete(id);render();}}
    }
    function receive(id){if(!preferences.value.allow||!eligible(id))return false;window.VumiroNudge?.effect({silent:preferences.value.silent});toast('You received a nudge.');return true;}
    for(const {anchor,id} of anchors){if(!anchor)continue;const button=document.createElement('button');button.type='button';button.textContent='Nudge';button.onclick=()=>send(id());anchor.after(button);buttons.push({button,id});}
    let allow,silent;
    if(panel){const section=document.createElement('section');section.className='nudgeSettings';const heading=document.createElement('h3');heading.textContent='Nudge a friend';section.append(heading);
      const field=(text,value)=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=value;label.append(input,document.createTextNode(' '+text));section.append(label);return input;};
      allow=field('Allow nudges from friends',preferences.value.allow);silent=field('Silent mode',preferences.value.silent);
      const help=document.createElement('p');help.className='help';help.textContent='Show a soft yellow glow instead of shaking. Reduced motion always uses the glow.';section.append(help);
      const button=document.createElement('button');button.type='button';button.textContent='Save nudge settings';button.onclick=()=>adapter.save();section.append(button);panel.append(section);
      const style=document.createElement('style');style.textContent='.nudgeSettings{margin-top:24px;padding-top:16px;border-top:1px solid #ffffff14}.nudgeSettings>label{display:flex;gap:10px;align-items:center;margin:12px 0}.nudgeSettings input{width:auto}';document.head.append(style);
    }
    const adapter={dirty:()=>!!allow&&(allow.checked!==preferences.value.allow||silent.checked!==preferences.value.silent),save:()=>{if(!allow)return true;const saved=preferences.save({allow:allow.checked,silent:silent.checked});toast(saved?'Nudge settings saved.':'Could not save nudge settings.');return saved;},discard:()=>{if(allow){allow.checked=preferences.value.allow;silent.checked=preferences.value.silent;}}};
    function reset(){generation++;busy.clear();sent.clear();clearTimeout(timer);window.VumiroNudge?.cancel();render();}
    render();return{send,receive,render,adapter,reset};
  }
  window.VumiroFriendNudges={create};
})();
