(function(root) {
  'use strict';
  const PROFILE_KEY='vumiro-gaming-profiles-v1';
  function parseProfile(text,validate) {
    if(typeof text!=='string'||text.length>16384)throw Error('Choose a mapping profile smaller than 16 KiB.');
    const value=JSON.parse(text);
    if(!value||Array.isArray(value)||value.version!==1||typeof value.name!=='string'||!value.name.trim()||value.name.length>60)throw Error('Invalid mapping profile.');
    const checked=validate(value.bindings);
    if(!checked.valid)throw Error('Invalid controller bindings.');
    return {version:1,name:value.name.trim(),bindings:{...checked.bindings}};
  }
  function loadProfiles(storage,validate) {
    try {
      const text=storage.getItem(PROFILE_KEY)||'[]';if(text.length>327680)return [];
      const values=JSON.parse(text);if(!Array.isArray(values)||values.length>20)return [];
      return values.map(value=>parseProfile(JSON.stringify(value),validate));
    }catch{return [];}
  }
  function saveProfiles(storage,values,validate) {
    if(!Array.isArray(values)||values.length>20)throw Error('Keep up to 20 mapping profiles.');
    storage.setItem(PROFILE_KEY,JSON.stringify(values.map(value=>parseProfile(JSON.stringify(value),validate))));
  }
  function createBridge(host,timeoutMs=15000) {
    const pending=new Map();let sequence=0,closed=false;
    const receive=event=>{
      const data=event.data;if(data?.type!=='gaming-result'||!pending.has(data.requestId))return;
      const request=pending.get(data.requestId);pending.delete(data.requestId);clearTimeout(request.timer);
      if(!data.ok||data.result?.ok===false)request.reject(Error(data.error||data.result?.error||data.result?.controller?.message||'Gaming action failed.'));
      else request.resolve(data.result);
    };
    host?.addEventListener?.('message',receive);
    return {
      request(action,fields={}) {
        return new Promise((resolve,reject)=>{
          if(closed)return reject(Error('Gaming connection closed.'));
          if(!host?.postMessage)return reject(Error('Native gaming connections require the Windows desktop app. You can still edit and export controller profiles.'));
          const requestId='g'+Date.now().toString(36)+(++sequence).toString(36);
          const wait=['self-test','lan-start','remote-controller-start'].includes(action)?Math.max(timeoutMs,330000):timeoutMs;
          const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('The gaming service did not respond. Refresh its status and try again.'));},wait);
          pending.set(requestId,{resolve,reject,timer});
          try{host.postMessage({...fields,type:'gaming',requestId,action});}catch(error){clearTimeout(timer);pending.delete(requestId);reject(error);}
        });
      },
      dispose(){closed=true;host?.removeEventListener?.('message',receive);for(const request of pending.values()){clearTimeout(request.timer);request.reject(Error('Gaming connection closed.'));}pending.clear();}
    };
  }
  const api={parseProfile,loadProfiles,saveProfiles,createBridge};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(!root?.document)return;
  root.VumiroGaming=api;
  const init=()=>{
    const document=root.document,$=id=>document.getElementById(id),nav=$('gamingNav'),mapping=root.VumiroControllerMapping;
    if(!nav||!mapping)return;
    const catalogs=root.VumiroI18n?.catalogs;
    const pt={'Gaming':'Jogos','LAN tunneling':'Rede LAN virtual','Game together':'Jogar juntos','Controller mappings':'Mapeamento de controles','Play like you are in the same room.':'Jogue como se estivessem na mesma sala.','Invite friend':'Convidar amigo','Invite to play':'Convidar para jogar','Your LAN':'Sua rede LAN','Online friend':'Amigo on-line','Leave session':'Sair da sessão','Share game':'Compartilhar jogo','Stop sharing':'Parar compartilhamento','Connect your controller or use your keyboard mapping.':'Conecte seu controle ou use seu mapeamento de teclado.','Keyboard → controller':'Teclado → controle','Physical controller':'Controle físico','Controller preview':'Prévia do controle','Custom mappings':'Mapeamentos personalizados','New profile':'Novo perfil','Delete profile':'Excluir perfil','Profile name':'Nome do perfil','Save profile':'Salvar perfil','Reset bindings':'Redefinir teclas','Import profile':'Importar perfil','Export profile':'Exportar perfil','Accept invitation':'Aceitar convite','Decline':'Recusar','Ready':'Pronto','Refresh status':'Atualizar status','Apply to game':'Usar no jogo','Enable game audio':'Ativar áudio do jogo','No friends online':'Nenhum amigo on-line','Choose a friend':'Escolha um amigo','Built into Vumiro':'Integrado ao Vumiro','Focus game to control':'Clique no jogo para controlar','Left stick':'Analógico esquerdo','Right stick':'Analógico direito','Your virtual address':'Seu endereço virtual','Participants':'Participantes'};
    Object.assign(pt,root.VumiroGamingView?.translations||{});
    for(const key of Object.keys(pt))for(const locale of Object.keys(catalogs||{})){if(!Object.hasOwn(catalogs[locale],key))catalogs[locale][key]=locale==='pt-BR'?pt[key]:key;}
    const t=value=>root.VumiroI18n?.t(value)||value;
    const view=root.VumiroGamingView,icon=root.VumiroControls?.icon||(()=> '');
    if(!view)return;
    const style=document.createElement('style');style.textContent=view.styles;document.head.append(style);
    const section=document.createElement('section');section.id='gamingWorkspace';section.className='gamingWorkspace';section.hidden=true;section.innerHTML=view.markup(icon);
    document.querySelector('.workspace').insertBefore(section,$('friendsBody'));
    const inviteDialog=document.createElement('dialog');inviteDialog.id='gamingInviteDialog';inviteDialog.setAttribute('aria-labelledby','gamingInviteTitle');inviteDialog.innerHTML='<h2 id="gamingInviteTitle">Gaming invitation</h2><p id="gamingInviteText"></p><div class="gamingActions"><button id="gamingDeclineInvite" type="button">Decline</button><button id="gamingAcceptInvite" class="primary" type="button">Accept invitation</button></div>';document.body.append(inviteDialog);
    const bridge=createBridge(root.chrome?.webview);
    const labDialog=document.createElement('dialog');labDialog.id='gamingLabDialog';labDialog.className='gamingLabDialog';labDialog.setAttribute('aria-labelledby','gamingLabTitle');labDialog.innerHTML=view.labMarkup(icon);document.body.append(labDialog);
    let session=null,context=null,epoch=0,opened=false,route='lan',invitation=null,busy=false,capturing='',profileIndex=-1;
    let bindings={...mapping.DEFAULT_BINDINGS},profiles=loadProfiles(root.localStorage,mapping.validateBindings),inputMode='keyboard';
    const pressed=new Set();
    let labRunning=false,lastLabReport=null;
    function renderCheck(check){const row=document.createElement('div');row.className='gamingLabCheck';row.dataset.status=check.status;const mark=document.createElement('span');mark.textContent=check.status==='passed'?'✓':check.status==='failed'?'!':'—';const content=document.createElement('div');content.textContent=check.label;const detail=document.createElement('small');detail.textContent=check.detail;content.append(detail);const status=document.createElement('span');status.textContent=t(check.status==='passed'?'Passed':check.status==='failed'?'Failed':'Unavailable');row.append(mark,content,status);$('gamingLabResults').append(row);row.scrollIntoView?.({block:'nearest'});}
    const lab=root.VumiroGamingLab?.create({requestNative:(name,fields)=>bridge.request(name,fields),getBindings:()=>({...bindings}),onProgress:renderCheck});
    async function runLab(task){if(labRunning||!lab)return;labRunning=true;lastLabReport=null;$('gamingLabResults').replaceChildren();$('gamingLabExport').disabled=true;$('gamingLabStatus').textContent=t('Test running…');for(const id of ['gamingLabTransport','gamingLabCapture','gamingLabLan','gamingLabController'])$(id).disabled=true;$('gamingLabCancel').disabled=false;
      try{lastLabReport=await task();$('gamingLabStatus').textContent=t(lastLabReport.cancelled?'Test cancelled':lastLabReport.passed?'Checks passed':'Check incomplete');$('gamingLabExport').disabled=false;}
      catch(error){renderCheck({label:'Test lab',status:'failed',detail:error.message});$('gamingLabStatus').textContent=t('Check incomplete');}
      finally{labRunning=false;for(const id of ['gamingLabTransport','gamingLabCapture','gamingLabLan','gamingLabController'])$(id).disabled=id==='gamingLabLan'||id==='gamingLabController'?root.__VUMIRO_LOCAL_QA__!==true:false;$('gamingLabCancel').disabled=true;}
    }
    $('gamingLabOpen').onclick=()=>{if(!labDialog.open)labDialog.showModal();for(const id of ['gamingLabLan','gamingLabController'])$(id).disabled=labRunning||root.__VUMIRO_LOCAL_QA__!==true;root.VumiroControls?.enhance(labDialog);};
    $('gamingLabClose').onclick=()=>{lab?.cancel();labDialog.close();};labDialog.addEventListener('cancel',()=>lab?.cancel());
    $('gamingLabTransport').onclick=()=>runLab(()=>lab.runTransport());$('gamingLabCapture').onclick=()=>runLab(()=>lab.testCapture());$('gamingLabLan').onclick=()=>runLab(()=>lab.runNative('lan'));$('gamingLabController').onclick=()=>runLab(()=>lab.runNative('controller'));$('gamingLabCancel').onclick=()=>lab?.cancel();
    $('gamingLabExport').onclick=()=>{if(!lastLabReport)return;const url=URL.createObjectURL(new Blob([JSON.stringify({checkedAt:new Date().toISOString(),...lastLabReport},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='vumiro-gaming-checks.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    $('gamingStreamBitrate').addEventListener('input',()=>{$('gamingBitrateValue').textContent=$('gamingStreamBitrate').value+' Mbps';});
    $('gamingCopyAddress').onclick=()=>action(async()=>{const address=session?.snapshot().lanAddress;if(address){await root.navigator.clipboard.writeText(address);message(t('Address copied.'));}});
    function message(text,error=false){$('gamingMessage').textContent=text||'';$('gamingMessage').dataset.error=String(error);}
    async function action(task){if(busy)return;busy=true;section.setAttribute('aria-busy','true');try{return await task();}catch(error){message(error.message,true);}finally{busy=false;section.setAttribute('aria-busy','false');}}
    const friendName=id=>context?.getFriend(id)?.nickname||context?.getFriend(id)?.name||'Friend';
    function renderFriends(){
      for(const id of ['gamingLanFriend','gamingRemoteFriend']){
        const select=$(id),saved=select.value;select.replaceChildren();
        const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=t('Choose a friend');select.append(placeholder);
        const friends=(context?.listFriends()||[]).filter(friend=>context.isOnline(friend.id));
        for(const friend of friends){const option=document.createElement('option');option.value=friend.id;option.textContent=friend.nickname||friend.name||'Friend';select.append(option);}
        if(friends.some(friend=>friend.id===saved))select.value=saved;
        if(!friends.length)placeholder.textContent=t('No friends online');
      }
    }
    function renderState(state){
      const statusLabels={idle:'Ready',offline:'Offline',invited:'Invitation sent',connecting:'Connecting',connected:'Connected',ended:'Disconnected',error:'Connection error'};
      $('gamingSessionStatus').textContent=t(statusLabels[state.state]||state.state||'Ready');$('gamingSessionStatus').dataset.ready=String(state.state==='connected');
      $('gamingLanAddress').textContent=state.mode==='lan'?(state.lanAddress||'—'):'—';
      $('gamingCopyAddress').disabled=!state.lanAddress;
      $('gamingLanDetail').textContent=state.mode==='lan'?state.error||`Vumiro LAN · ${state.state}`:'Create or accept a LAN invitation to connect.';
      $('gamingRemoteDetail').textContent=state.mode==='together'?state.error||`${state.role==='host'?'Hosting':'Joining'} · ${state.state}${state.sharing?' · sharing game':''}`:'Accept an invitation or invite a friend to start.';
      for(const id of ['gamingLanParticipants','gamingRemoteParticipants']){
        const container=$(id);container.replaceChildren();
        for(const peer of state.participants||[]){const row=document.createElement('div');row.className='gamingParticipant';const name=document.createElement('span');name.textContent=friendName(peer.peerId);const detail=document.createElement('small');detail.textContent=[peer.state,peer.peerAddress].filter(Boolean).join(' · ');row.append(name,detail);container.append(row);}
        if(!state.participants?.length){const empty=document.createElement('div');empty.className='gamingEmpty';empty.textContent=t('No players connected yet.');container.append(empty);}
      }
      $('gamingShare').disabled=state.mode!=='together'||state.role!=='host'||!state.accepted;
      $('gamingStopShare').disabled=!state.sharing;
      if(state.error)message(state.error,true);
      if(state.state==='idle'||state.state==='ended'){setVideoStream(null);releaseInput();}
    }
    function onInvitation(value){invitation=value;$('gamingInviteTitle').textContent=value.mode==='lan'?'LAN invitation':'Game together invitation';$('gamingInviteText').textContent=`${friendName(value.peerId)} invited you to ${value.mode==='lan'?'join their Vumiro LAN':'play a game on their PC'}. Accept only if you want to connect.`;if(!inviteDialog.open)inviteDialog.showModal();}
    function ensureSession(){
      const next=root.VumiroGamingDirectory?.getContext();
      if(next===context&&session)return session;
      const previous=session;session=null;context=next;epoch++;previous?.stop().catch(()=>{});
      invitation=null;if(inviteDialog.open)inviteDialog.close();setVideoStream(null);
      renderState({state:next?'idle':'offline',participants:[]});
      if(!next){renderFriends();return null;}
      const ownEpoch=epoch;
      session=root.VumiroGamingSession.create({local:next.local,send:next.send,getFriend:next.getFriend,
        requestNative:(name,fields)=>bridge.request(name,fields),
        onState:state=>{if(ownEpoch===epoch)renderState(state);},
        onInvitation:value=>{if(ownEpoch===epoch)onInvitation(value);},
        onTrack:value=>{if(ownEpoch!==epoch)return;const video=setVideoStream(value.stream);video.muted=!!value.local;if(!value.stream)return;video.play()?.catch(()=>message('Click Enable game audio to play the incoming stream.'));}});
      session.setBindings(bindings);session.setInputMode(inputMode);renderFriends();return session;
    }
    function requireSession(){const current=ensureSession();if(!current)throw Error('Connect to Vumiro and choose an online friend.');return current;}
    async function invite(mode){const friendId=$(mode==='lan'?'gamingLanFriend':'gamingRemoteFriend').value;if(!friendId)throw Error('Choose an online friend.');await requireSession().invite(friendId,mode);message('Invitation sent. Your friend must accept to connect.');}
    $('gamingLanInvite').onclick=()=>action(()=>invite('lan'));$('gamingRemoteInvite').onclick=()=>action(()=>invite('together'));
    $('gamingLanLeave').onclick=$('gamingRemoteLeave').onclick=()=>action(async()=>{await session?.stop();message('Gaming session ended.');});
    $('gamingAcceptInvite').onclick=()=>action(async()=>{const value=invitation;if(!value||!await open(value.mode==='lan'?'lan':'together')||invitation!==value)return;invitation=null;inviteDialog.close();await requireSession().accept(value.id);});
    $('gamingDeclineInvite').onclick=()=>action(async()=>{const value=invitation;invitation=null;inviteDialog.close();if(value)await session?.decline(value.id);});
    inviteDialog.addEventListener('cancel',event=>{event.preventDefault();$('gamingDeclineInvite').click();});
    $('gamingShare').onclick=()=>action(()=>requireSession().startSharing({frameRate:Number($('gamingStreamFps').value)||60,bitrateMbps:Number($('gamingStreamBitrate').value)||15}));
    $('gamingStopShare').onclick=()=>action(()=>session?.stopSharing());$('gamingPlayAudio').onclick=()=>action(()=>$('gamingVideo').play());
    $('gamingRefresh').onclick=()=>action(async()=>{ensureSession();renderFriends();const result=await bridge.request('status');$('gamingRuntimeStatus').textContent=result.status?.runtime?.bundled?'Windows gaming components are bundled with Vumiro. Initial use may require Windows authorization.':'This development build is missing a bundled gaming component.';$('gamingControllerStatus').textContent=result.controller?.available?'Controller ready':'Included with Vumiro setup';});
    async function open(next){if(!['lan','together','mapping'].includes(next))return false;if(!opened){
      if(root.VumiroWorkspace){if(!await root.VumiroWorkspace.prepareExternal('gaming'))return false;}
      else $('browseApp')?.click();
      if(root.VumiroWorkspace?.isCurrent?.('gaming')===false)return false;
      }opened=true;route=next;section.hidden=false;document.body.classList.add('gaming-view');$('gamingSubnav').hidden=false;nav.setAttribute('aria-expanded','true');
      const tabs={lan:'gamingLanNav',together:'gamingTogetherNav',mapping:'gamingMappingNav'};
      for(const [key,id]of Object.entries(tabs)){$(id).setAttribute('aria-current',key===next?'page':'false');$(`gaming${key==='lan'?'Lan':key==='together'?'Together':'Mapping'}Panel`).hidden=key!==next;}
      for(const button of document.querySelectorAll('.nav>button')){button.classList.toggle('active',button===nav);button.setAttribute('aria-current',button===nav?'page':'false');}
      $('gamingTitle').textContent=t(next==='lan'?'LAN tunneling':next==='together'?'Game together':'Controller mappings');$('gamingTitle').focus();ensureSession();renderFriends();return true;}
    function releaseInput(){pressed.clear();session?.releaseInput();preview();}
    function close(){opened=false;section.hidden=true;document.body.classList.remove('gaming-view');nav.classList.remove('active');nav.setAttribute('aria-current','false');releaseInput();}
    nav.addEventListener('click',()=>open(route));$('gamingLanNav').onclick=()=>open('lan');$('gamingTogetherNav').onclick=()=>open('together');$('gamingMappingNav').onclick=()=>open('mapping');$('gamingToMappings').onclick=()=>open('mapping');
    document.addEventListener('click',event=>{if(['homeNav','friendsNav','roomNav','watchNav','returnToRoom'].includes(event.target.closest?.('button')?.id))close();},true);
    if(root.MutationObserver)new root.MutationObserver(()=>{if(opened&&document.body.classList.contains('room-view'))close();}).observe(document.body,{attributes:true,attributeFilter:['class']});
    const labels={leftUp:'Left stick ↑',leftDown:'Left stick ↓',leftLeft:'Left stick ←',leftRight:'Left stick →',rightUp:'Right stick ↑',rightDown:'Right stick ↓',rightLeft:'Right stick ←',rightRight:'Right stick →',a:'A',b:'B',x:'X',y:'Y',lb:'LB',rb:'RB',lt:'LT',rt:'RT',back:'Back',start:'Start',ls:'Left stick click',rs:'Right stick click',dpadUp:'D-pad ↑',dpadDown:'D-pad ↓',dpadLeft:'D-pad ←',dpadRight:'D-pad →'};
    const keyLabel=code=>code?code.replace(/^Key|^Digit/,''):'—';
    function bindTarget(target){releaseInput();capturing=target;renderBindings();message(`${t(labels[target])}: ${t('Press a key. Escape cancels.')}`);}
    function renderBindings(){const container=$('gamingBindings');container.replaceChildren();const groups=[['Analog sticks',['leftUp','leftDown','leftLeft','leftRight','rightUp','rightDown','rightLeft','rightRight','ls','rs']],['Buttons & triggers',['a','b','x','y','lb','rb','lt','rt','back','start']],['Directional pad',['dpadUp','dpadDown','dpadLeft','dpadRight']]];
      for(const [heading,targets]of groups){const group=document.createElement('section');group.className='gamingBindingGroup';const title=document.createElement('h3');title.textContent=t(heading);const grid=document.createElement('div');grid.className='gamingBindingGrid';group.append(title,grid);container.append(group);for(const target of targets){const label=labels[target],row=document.createElement('div');row.className='gamingBinding';const name=document.createElement('span');name.textContent=t(label);const button=document.createElement('button');button.type='button';button.dataset.target=target;button.setAttribute('data-i18n-skip','');button.setAttribute('aria-label',`${t(label)}: ${bindings[target]||'Unbound'}`);button.setAttribute('aria-pressed',String(capturing===target));button.textContent=capturing===target?t('Press a key…'):keyLabel(bindings[target]);button.onclick=()=>bindTarget(target);const clear=document.createElement('button');clear.type='button';clear.className='gamingClear';clear.textContent='×';clear.setAttribute('aria-label',t('Clear')+' '+t(label));clear.onclick=()=>{delete bindings[target];capturing='';renderBindings();};row.append(name,button,clear);grid.append(row);}}session?.setBindings(bindings);root.VumiroControls?.enhance(container);}
    function makeDiagram(){
      $('gamingControllerDiagram').innerHTML=root.VumiroControllerArt?.render()||'';
      for(const control of $('gamingControllerDiagram').querySelectorAll('[data-control]')){
        control.addEventListener('click',()=>bindTarget(control.dataset.control));
        control.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();bindTarget(control.dataset.control);}});
      }
    }
    function preview(){
      const enabled=$('gamingMonitorEnabled').checked!==false,pad=inputMode==='physical'?Array.from(root.navigator?.getGamepads?.()||[]).find(value=>value?.connected&&value.mapping==='standard'):null;
      const frame=inputMode==='physical'?mapping.frameFromGamepad(enabled?pad:null):mapping.frameFromKeys(bindings,enabled?pressed:new Set());
      $('gamingKeys').textContent=Array.from(pressed).map(keyLabel).join(' + ');
      const flags={a:4096,b:8192,x:16384,y:32768,lb:256,rb:512,back:32,start:16,ls:64,rs:128,dpadUp:1,dpadDown:2,dpadLeft:4,dpadRight:8};
      const active=target=>target==='lt'?frame.leftTrigger>0:target==='rt'?frame.rightTrigger>0:flags[target]?!!(frame.buttons&flags[target]):target.endsWith('Up')?frame[target.startsWith('left')?'leftY':'rightY']>0:target.endsWith('Down')?frame[target.startsWith('left')?'leftY':'rightY']<0:target.endsWith('Left')?frame[target.startsWith('left')?'leftX':'rightX']<0:frame[target.startsWith('left')?'leftX':'rightX']>0;
      for(const control of $('gamingControllerDiagram').querySelectorAll('[data-control]'))control.dataset.pressed=String(active(control.dataset.control));
      for(const side of ['Left','Right']){const key=side.toLowerCase(),x=frame[key+'X']/32767,y=frame[key+'Y']/32767;$('gaming'+side+'StickDot').style.transform=`translate(${x*14}px,${-y*14}px)`;$('gaming'+side+'Axis').textContent=`${side[0]}X ${x.toFixed(2)} · ${side[0]}Y ${y.toFixed(2)}`;$('gaming'+side+'TriggerMeter').style.width=(frame[key+'Trigger']/255*100)+'%';}
      $('gamingMonitorDevice').textContent=!enabled?t('Preview paused'):inputMode==='keyboard'?t('Keyboard preview'):pad?.id||t('Press a button on your controller.');
      const values=Object.entries(labels).filter(([target])=>active(target)).map(([,label])=>t(label));$('gamingInputReadout').textContent=values.join(' · ')||t(inputMode==='physical'?'Move a stick or press a button.':'Press a mapped key to test.');
    }
    function setVideoStream(stream){const video=$('gamingVideo');if(video.srcObject!==stream)video.srcObject=stream;$('gamingVideoHint').hidden=!!stream;return video;}
    const videoShell=$('gamingVideoShell');videoShell.addEventListener('focus',()=>session?.setInputFocused(true));videoShell.addEventListener('blur',releaseInput);
    document.addEventListener('keydown',event=>{
      if(capturing&&opened&&route==='mapping'){event.preventDefault();if(event.code==='Escape'){capturing='';renderBindings();return;}const candidate={...bindings,[capturing]:event.code},check=mapping.validateBindings(candidate);if(!check.valid)return message(check.errors.join(' '),true);bindings={...check.bindings};capturing='';renderBindings();message('Binding updated. Save the profile to keep it.');return;}
      if(event.target===videoShell&&opened&&route==='together'){
        if(event.code==='Escape'){event.preventDefault();releaseInput();$('gamingTitle').focus();return;}
        if(inputMode==='keyboard'&&Object.values(bindings).includes(event.code)){event.preventDefault();session?.setKey(event.code,true);return;}
      }
      if(opened&&route==='mapping'&&!event.target?.closest?.('input,textarea,select,[contenteditable="true"]')&&Object.values(bindings).includes(event.code)){pressed.add(event.code);preview();}
    },true);
    document.addEventListener('keyup',event=>{session?.setKey(event.code,false);pressed.delete(event.code);preview();});root.addEventListener('blur',releaseInput);
    function setMode(mode){inputMode=mode;releaseInput();session?.setInputMode(mode);$('gamingKeyboardMode').checked=$('gamingPreviewKeyboard').checked=mode==='keyboard';$('gamingPhysicalMode').checked=$('gamingPreviewPhysical').checked=mode==='physical';preview();}
    $('gamingPreviewKeyboard').onchange=()=>setMode('keyboard');$('gamingPreviewPhysical').onchange=()=>setMode('physical');$('gamingMonitorEnabled').onchange=preview;
    $('gamingKeyboardMode').onchange=()=>setMode('keyboard');$('gamingPhysicalMode').onchange=()=>setMode('physical');$('gamingUsePhysical').onclick=()=>{setMode('physical');open('together');};$('gamingApplyMapping').onclick=()=>{setMode('keyboard');session?.setBindings(bindings);open('together');message('Mapping applied. Focus the remote game to send controls.');};
    function renderProfiles(){const select=$('gamingProfiles');select.replaceChildren();const base=document.createElement('option');base.value='-1';base.textContent=t('New profile');select.append(base);profiles.forEach((profile,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=profile.name;select.append(option);});select.value=String(profileIndex);}
    $('gamingProfiles').onchange=()=>{releaseInput();profileIndex=Number($('gamingProfiles').value);const profile=profiles[profileIndex];bindings={...(profile?.bindings||mapping.DEFAULT_BINDINGS)};$('gamingProfileName').value=profile?.name||'Default';capturing='';renderBindings();};
    $('gamingNewProfile').onclick=()=>{releaseInput();profileIndex=-1;bindings={...mapping.DEFAULT_BINDINGS};$('gamingProfileName').value='New profile';renderProfiles();renderBindings();};
    $('gamingSaveProfile').onclick=()=>action(async()=>{const profile=parseProfile(JSON.stringify({version:1,name:$('gamingProfileName').value,bindings}),mapping.validateBindings);const next=profiles.slice();if(profileIndex<0)next.push(profile);else next[profileIndex]=profile;saveProfiles(root.localStorage,next,mapping.validateBindings);profiles=next;if(profileIndex<0)profileIndex=profiles.length-1;renderProfiles();message('Profile saved on this device.');});
    $('gamingDeleteProfile').onclick=()=>action(async()=>{if(profileIndex<0)return;const next=profiles.filter((_,index)=>index!==profileIndex);saveProfiles(root.localStorage,next,mapping.validateBindings);profiles=next;profileIndex=-1;renderProfiles();message('Saved profile deleted. Current bindings can still be exported.');});
    $('gamingReset').onclick=()=>{releaseInput();bindings={...mapping.DEFAULT_BINDINGS};capturing='';renderBindings();};
    $('gamingImport').onclick=()=>$('gamingImportFile').click();$('gamingImportFile').onchange=()=>action(async()=>{const input=$('gamingImportFile'),file=input.files[0];input.value='';if(!file)return;if(file.size>16384)throw Error('Choose a profile smaller than 16 KiB.');const profile=parseProfile(await file.text(),mapping.validateBindings);releaseInput();bindings=profile.bindings;profileIndex=-1;$('gamingProfileName').value=profile.name;renderProfiles();renderBindings();message('Profile imported. Save it to keep it on this device.');});
    $('gamingExport').onclick=()=>action(async()=>{const profile=parseProfile(JSON.stringify({version:1,name:$('gamingProfileName').value,bindings}),mapping.validateBindings);const url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='vumiro-controller.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    root.VumiroGamingDirectory?.subscribe(value=>{const active=ensureSession();active?.receive(value).catch(error=>message(error.message,true));});
    root.chrome?.webview?.addEventListener('message',event=>{if(event.data?.type==='gaming-lan-packet')session?.handleNativePacket(event.data);});
    root.addEventListener('vumiro:gaming-directory',()=>{ensureSession();renderFriends();});
    const poll=setInterval(()=>{if(opened){ensureSession();renderFriends();}},4000);
    const monitor=setInterval(()=>{if(opened&&route==='mapping'&&document.visibilityState!=='hidden')preview();},50);
    root.addEventListener('pagehide',()=>{clearInterval(poll);clearInterval(monitor);lab?.dispose();epoch++;session?.stop().catch(()=>{});session=null;bridge.dispose();});
    makeDiagram();renderBindings();renderProfiles();ensureSession();root.VumiroI18n?.refresh(section);root.VumiroI18n?.refresh(labDialog);root.VumiroControls?.enhance(section);api.open=open;api.close=close;api.snapshot=()=>session?.snapshot()||{state:'offline'};api.testReport=()=>lastLabReport;
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='object'?window:null);
