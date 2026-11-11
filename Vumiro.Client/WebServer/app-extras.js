/* Maintainer: set the verified PayPal.Me or hosted Donate link before enabling contributions. */
(() => {
  'use strict';
  const PAYPAL_SUPPORT_URL='';
  const $=id=>document.getElementById(id);
  function paypalDestination(value){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)return '';if(['paypal.me','www.paypal.me'].includes(url.hostname)&&/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))return url.href;if(['paypal.com','www.paypal.com'].includes(url.hostname)&&/^\/donate\/?$/.test(url.pathname)&&url.searchParams.get('hosted_button_id'))return url.href;}catch{}return '';}
  window.VumiroAppExtras={paypalDestination};
  const donation=$('supportDonate'),pending=$('supportPending');
  if(donation){const target=paypalDestination(PAYPAL_SUPPORT_URL);donation.hidden=!target;if(target)donation.href=target;if(pending)pending.hidden=!!target;}
  const animation=$('disableLaunchAnimation');
  if(animation){try{animation.checked=window.localStorage.getItem('vumiro-disable-launch-animation')==='true';}catch{}animation.addEventListener('change',()=>{try{window.localStorage.setItem('vumiro-disable-launch-animation',String(animation.checked));$('launchAnimationStatus').textContent='Saved. Applies the next time you fully quit and open Vumiro.';}catch{$('launchAnimationStatus').textContent='This preference could not be saved.';}});}
  if(!$('chatStorageMode'))return;
  const api=window.VumiroChatStorage;
  let owner='',repo,baseline='',initialized=false;
  const draft=()=>JSON.stringify({mode:$('chatStorageMode').value,endpoint:$('chatStorageEndpoint').value,token:$('chatStorageToken').value});
  const dirty=()=>initialized&&draft()!==baseline;
  const report=(message,error=false)=>{const node=$('chatStorageStatus');node.textContent=message;node.classList.toggle('error',error);};
  async function identity(){const value=await window.VumiroLocalProfile.initialize();if(!value?.id)throw Error('Create or restore your profile first.');if(owner!==value.id){owner=value.id;repo=api.create({owner});initialized=false;}return value;}
  async function render(){await identity();if(!dirty()){const config=api.configuration(owner);$('chatStorageMode').value=config.mode;$('chatStorageEndpoint').value=config.endpoint;$('chatStorageToken').value=config.token;baseline=draft();initialized=true;}$('chatStorageOwner').textContent=owner;const servers=await repo.listServers();$('chatServerList').replaceChildren();for(const server of servers){const row=document.createElement('p');row.textContent=server.name+' · '+server.channels.map(channel=>'#'+channel.name).join(', ');$('chatServerList').append(row);}}
  async function saveStorage(){await identity();api.configure(owner,JSON.parse(draft()));baseline=draft();report('Storage settings saved. Rejoin your room to apply them.');return true;}
  $('chatStorageSave').addEventListener('click',async()=>{try{await saveStorage();}catch(error){report(error.message,true);}});
  $('chatStorageTest').addEventListener('click',async()=>{const button=$('chatStorageTest');button.disabled=true;try{await identity();const candidate={mode:'private',endpoint:$('chatStorageEndpoint').value,token:$('chatStorageToken').value};await api.create({owner,configuration:()=>candidate}).test();api.configure(owner,candidate);$('chatStorageMode').value='private';baseline=draft();report('Connected to your private archive. New chat messages will also be backed up there.');}catch(error){report(error.message,true);}finally{button.disabled=false;}});
  $('chatServerCreate').addEventListener('click',async()=>{const button=$('chatServerCreate');button.disabled=true;try{await identity();const name=$('chatServerName').value.trim();await repo.saveServer({id:crypto.randomUUID(),name,channels:[{id:crypto.randomUUID(),name:'general',type:'text'}]});$('chatServerName').value='';await render();report('Server and #general channel records saved. Shared server chat is still being built.');}catch(error){report(error.message,true);}finally{button.disabled=false;}});
  // Settings may open after account restore changes the device identity.
  $('profileDialog')?.addEventListener('toggle',()=>{if($('profileDialog').open)void render().catch(error=>report(error.message,true));});
  $('settingsNav')?.addEventListener('click',()=>{void render().catch(error=>report(error.message,true));});
  void window.VumiroAccount?.ready?.().then(ready=>{if(ready)return render();}).catch(error=>report(error.message,true));
  const register=()=>window.VumiroSettingsExit?.add({dirty,save:saveStorage,discard:async()=>{initialized=false;await render();}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',register,{once:true});else register();
})();
