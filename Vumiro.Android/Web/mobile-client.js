(function(root){
 'use strict';
 if(!root?.document||root.vumiroDesktop?.platform!=='android')return;
 const document=root.document,html=document.documentElement,page=root.location.pathname.endsWith('/auth.html')?'auth':root.location.pathname.endsWith('/call.html')?'call':'friends';
 const cleanup=[],tabs=new Map(),capabilities=root.vumiroDesktop.capabilities||{};
 let initialized=false,disposed=false,route='friends',navigation=0,nav,more,feedback,shadowObserver,communityBoundary,viewportHeight=root.innerHeight,viewportWidth=root.innerWidth;
 html.classList.add('vumiro-mobile');html.dataset.mobilePage=page;html.dataset.mobileOauth=String(capabilities.oauth===true);
 const $=id=>document.getElementById(id),t=text=>root.VumiroI18n?.t(text)||text;
 function node(tag,id,text,cls){const value=document.createElement(tag);if(id)value.id=id;if(text!==undefined)value.textContent=t(text);if(cls)value.className=cls;return value;}
 function listen(target,type,handler){target?.addEventListener(type,handler);cleanup.push(()=>target?.removeEventListener(type,handler));}
 function report(error){const target=$('status')||feedback;if(target){target.textContent=error?.message||String(error);target.hidden=false;}}
 function button(id,text,handler,cls){const value=node('button',id,text,cls);value.type='button';listen(value,'click',handler);return value;}
 function paint(){const selected=more?.open?'more':route==='conversations'?'messages':route==='servers'?'communities':route==='friends'?'friends':'more';for(const [key,value]of tabs){value.setAttribute('aria-current',key===selected?'page':'false');if(key==='more')value.setAttribute('aria-expanded',String(!!more?.open));}}
 function closeMore(){if(more?.open){more.close();paint();tabs.get('more')?.focus();return true;}return false;}
 async function navigate(destination){
  const action={friends:'showFriends',messages:'showConversations',communities:'showServers'}[destination],serial=++navigation;
  if(!action||!root.VumiroWorkspace?.[action])return false;
  try{const result=await root.VumiroWorkspace[action]();if(disposed||serial!==navigation||result===false)return false;route={friends:'friends',messages:'conversations',communities:'servers'}[destination];closeMore();paint();adaptCommunity();return true;}catch(error){report(error);return false;}
 }
 function existing(id){closeMore();const target=$(id);if(!target||target.disabled||target.hidden){report(t('This action is unavailable right now.'));return;}target.click();}
 function hasRoom(){return !!$('callFrameSlot')?.querySelector('iframe');}
 function leaveRoom(){const leave=page==='call'?$('leave'):$('leaveCall');if(!leave||leave.disabled)return false;if(root.confirm(t('Leave the current room? Voice and playback will disconnect.')))leave.click();return true;}
 function back(){
  if(!initialized||disposed)return false;
  if(closeMore())return true;
  const dialogs=Array.from(document.querySelectorAll('dialog[open]'));if(dialogs.length){const dialog=dialogs.at(-1);if(dialog.classList.contains('settingsScreen')&&root.VumiroSettingsExit?.requestClose){Promise.resolve(root.VumiroSettingsExit.requestClose()).catch(report);}else if(dialog.dispatchEvent(new Event('cancel',{cancelable:true})))dialog.close();return true;}
  const shadow=$('serverWorkspace')?.shadowRoot;
  if(shadow&&!$('serverWorkspace').hidden){const overlay=shadow.querySelector('[data-action="community-menu"],[data-action="create-dialog"],[data-action="settings-panel"]');if(overlay){overlay.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;}if(shadow.querySelector('[data-action="community-root"]')?.dataset.navOpen==='true'){shadow.querySelector('[data-action="close-channels"]')?.click();return true;}}
  if(root.VumiroDirectChatController?.active){$('directChatBack')?.click();return true;}
  if(page==='call'){for(const [id,close]of [['roomPolicyDialog','roomPolicyClose'],['streamSettings','settingsClose']])if($(id)&&!$(id).hidden&&$(close)&&!$(close).disabled){$(close).click();return true;}const cancel=$('connectionCancel');if($('roomConnection')&&!$('roomConnection').hidden&&cancel&&!cancel.hidden&&!cancel.disabled){cancel.click();return true;}return leaveRoom();}
  try{if($('callFrameSlot')?.querySelector('iframe')?.contentWindow?.VumiroMobile?.back()===true)return true;}catch{/* An unready or navigated frame falls back to the lobby leave flow. */}
  if(hasRoom())return leaveRoom();
  if(page==='auth'){const control=$('accountBack');if(control&&!control.hidden){control.click();return true;}return false;}
  if(route!=='friends'){void navigate('friends');return true;}
  return false;
 }
 function editable(){try{let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;if(active?.tagName==='IFRAME')active=active.contentDocument?.activeElement;return ['INPUT','TEXTAREA','SELECT'].includes(active?.tagName)||active?.isContentEditable===true;}catch{return false;}}
 function updateViewport(){
  if(disposed)return;const viewport=root.visualViewport,height=Math.max(1,Math.round(viewport?.height||root.innerHeight));
  if(root.innerWidth!==viewportWidth){viewportWidth=root.innerWidth;viewportHeight=root.innerHeight;}if(!editable()||height>viewportHeight)viewportHeight=Math.max(height,root.innerHeight);
  html.style.setProperty('--mobile-vh',height+'px');html.style.setProperty('--mobile-viewport-top',(viewport?.offsetTop||0)+'px');html.dataset.mobileKeyboard=String(editable()&&viewportHeight-height>100);
 }
 const communityStyles='.ch-root button,.ch-root select{min-height:44px}.ch-root .ch-icon-button,.ch-root .ch-row .ch-icon-button{min-width:44px;min-height:44px;width:44px;height:44px}.ch-root .ch-row .ch-node-main{min-height:44px}.ch-root .ch-menu .ch-menu-item{min-height:44px}.ch-root .ch-sidebar{padding-bottom:env(safe-area-inset-bottom,0px)}';
 function adaptCommunity(){
  const shadow=$('serverWorkspace')?.shadowRoot;if(!shadow)return;
  const inject=()=>{if(disposed||shadow.querySelector('#androidMobileCommunityStyle'))return;const style=node('style','androidMobileCommunityStyle',communityStyles);shadow.append(style);};
  if(shadow!==communityBoundary){shadowObserver?.disconnect();communityBoundary=shadow;if(root.MutationObserver){shadowObserver=new root.MutationObserver(inject);shadowObserver.observe(shadow,{childList:true});}}
  inject();
 }
 function availability(parent,id,text){const note=node('p',id,text,'mobile-availability');note.setAttribute('role','note');parent?.append(note);return note;}
 function buildMore(){
  more=node('dialog','mobileMore',undefined,'mobile-more');more.setAttribute('aria-labelledby','mobileMoreTitle');
  const head=node('div',undefined,undefined,'mobile-more-head');head.append(node('h2','mobileMoreTitle','More'),button('mobileMoreClose','Close',closeMore,'mobile-sheet-close'));more.append(head);
  for(const [key,label,id]of [['Profile','Your profile','profileNav'],['Settings','Settings','settingsNav'],['Account','Account & backup','accountNav'],['Notifications','Notifications','notificationOpen'],['Marketplace','Marketplace','marketplaceNav'],['Rooms','Rooms','discoverRooms'],['Return','Return to room','returnToRoom'],['Reconnect','Reconnect','reconnectService'],['Support','Support Vumiro','supportNav']])if($(id))more.append(button('mobileMore'+key,label,()=>existing(id),'mobile-more-action'));
  more.append(button('mobileMoreLeave','Leave room',()=>{if(leaveRoom())closeMore();},'mobile-more-action mobile-danger'));
  availability(more,'mobileGamingNotice','Gaming, virtual LAN and hosting a shared screen are unavailable on Android. You can use messages, communities, voice and watch shared screens.');
  availability(more,'mobileBackgroundNotice','Calls currently work while Vumiro is open. Android may disconnect voice when the app goes into the background.');
  listen(more,'cancel',paint);listen(more,'close',paint);listen(more,'click',event=>{if(event.target===more)closeMore();});document.body.append(more);
 }
 function openMore(){if(!more)return;if(more.open){closeMore();return;}for(const id of ['mobileMoreReturn','mobileMoreLeave'])if($(id))$(id).hidden=!hasRoom();more.showModal();paint();$('mobileMoreClose')?.focus();}
 function tabIcon(name){const paths={friends:'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8m0 3a4 4 0 0 1 5 4v1',messages:'M21 11a9 9 0 0 1-9 9H5l-3 2 1-6a9 9 0 1 1 18-5Z',communities:'M4 3h16v7H4zM4 14h16v7H4zM8 6h.01M8 17h.01M12 6h5M12 17h5',more:'M4 6h16M4 12h16M4 18h16'};if(!document.createElementNS)return node('span',undefined,'','mobile-tab-icon');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('aria-hidden','true');path.setAttribute('d',paths[name]);svg.append(path);return svg;}
 function buildNavigation(){
  nav=node('nav','mobileNavigation',undefined,'mobile-navigation');nav.setAttribute('aria-label',t('Main navigation'));
  for(const [key,label]of [['friends','Friends'],['messages','Messages'],['communities','Communities'],['more','More']]){const id='mobileTab'+key[0].toUpperCase()+key.slice(1),control=button(id,undefined,()=>key==='more'?openMore():void navigate(key),'mobile-tab');control.append(tabIcon(key),node('span',undefined,label));if(key==='more'){control.setAttribute('aria-haspopup','dialog');control.setAttribute('aria-controls','mobileMore');}tabs.set(key,control);nav.append(control);}document.body.append(nav);buildMore();paint();
 }
 function init(){
  if(initialized||disposed)return;initialized=true;
  if(page==='friends'&&$('friendsContent')){buildNavigation();feedback=node('p','mobileFeedback','','mobile-feedback');feedback.setAttribute('role','status');feedback.hidden=true;document.body.append(feedback);}
  if(page==='auth'&&capabilities.oauth!==true){if($('accountSocial'))$('accountSocial').hidden=true;const description=$('accountDescription'),note=node('p','mobileAuthNotice','Sign in with your email on Android.','mobile-availability');if(description?.after)description.after(note);else ($('accountDialog')||document.body).append(note);}
  const stream=$('streamDetails');if(stream&&capabilities.screenCapture!==true){stream.classList.add('mobile-stream-unavailable');availability(stream,'mobileScreenNotice','Sharing your Android screen is unavailable in this version. Voice and watching shared screens remain available.');}
  if(page==='call')availability(document.body,'mobileCallNotice','You can use voice and watch shared screens. Sharing this device’s screen is unavailable.');
  listen(root,'vumiro-workspace-change',event=>{route=event.detail?.view||route;closeMore();paint();adaptCommunity();});
  listen(root,'vumiro:androidbackground',event=>{if(event.detail?.preservePendingCapture!==true)$('serverWorkspace')?.shadowRoot?.querySelector('[data-action="voice-leave"]')?.click();});
  listen(root,'resize',updateViewport);listen(root.visualViewport,'resize',updateViewport);listen(root.visualViewport,'scroll',updateViewport);listen(document,'focusin',updateViewport);listen(document,'focusout',updateViewport);listen(root,'pagehide',dispose);updateViewport();adaptCommunity();
 }
 function dispose(){if(disposed)return;disposed=true;++navigation;shadowObserver?.disconnect();communityBoundary?.querySelector('#androidMobileCommunityStyle')?.remove();for(const off of cleanup.splice(0))off();nav?.remove();more?.remove();feedback?.remove();html.classList.remove('vumiro-mobile');delete html.dataset.mobileKeyboard;html.style.removeProperty('--mobile-vh');html.style.removeProperty('--mobile-viewport-top');}
 root.VumiroMobile=Object.freeze({back,navigate,dispose});
 if(document.readyState==='loading')listen(document,'DOMContentLoaded',init);else init();
})(typeof window==='object'?window:null);
