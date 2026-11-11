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
          const timer=setTimeout(()=>{pending.delete(requestId);reject(Error('The gaming service did not respond. Refresh its status and try again.'));},timeoutMs);
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
    for(const key of Object.keys(pt))for(const locale of Object.keys(catalogs||{})){if(!Object.hasOwn(catalogs[locale],key))catalogs[locale][key]=locale==='pt-BR'?pt[key]:key;}
    const t=value=>root.VumiroI18n?.t(value)||value;
    const style=document.createElement('style');
    style.textContent=`
      .gaming-view .workspace>.topbar,.gaming-view #friendsBody,.gaming-view #callArea{display:none!important}
      .gamingWorkspace{flex:1;min-height:0;overflow:auto;padding:28px clamp(20px,4vw,48px);color:var(--text,#f8f8f8)}
      .gamingWorkspace[hidden],.gamingWorkspace [hidden]{display:none!important}.gamingWorkspace h1{font-size:27px;letter-spacing:-.8px}.gamingWorkspace h2{font-size:18px;margin:0 0 10px}.gamingWorkspace h3{font-size:13px;margin:0 0 7px}
      .gamingHead{display:flex;align-items:center;gap:18px;margin-bottom:24px}.gamingHead p{font-size:12px;color:var(--muted);margin:6px 0 0}.gamingHead>div{flex:1}.gamingEyebrow{color:var(--accent,#e11d2e);font-size:10px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px}
      .gamingGrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(235px,.7fr);gap:20px}.gamingCard{border:1px solid var(--line,#29292f);border-radius:13px;padding:23px;background:var(--panel,#141417);margin-bottom:18px;min-width:0}.gamingCard p,.gamingHelp{font-size:12px;color:var(--muted,#a1a1aa);line-height:1.85;margin:9px 0 16px}.gamingCard label{display:block;font-size:12px;color:var(--muted);margin-bottom:7px}.gamingCard input,.gamingCard select{width:100%;margin-bottom:12px}.gamingActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.gamingActions button{font-size:12px}.gamingStatus{font-size:11px;border:1px solid var(--line);padding:5px 9px;border-radius:20px;display:inline-flex;align-items:center;gap:7px;max-width:100%;overflow-wrap:anywhere}.gamingStatus:before{content:'';width:6px;height:6px;border-radius:50%;background:#85858c}.gamingStatus[data-ready=true]:before{background:var(--green,#67cb93)}.gamingStatus[data-active=true]:before{background:var(--accent,#e11d2e)}
      .gamingMessage{min-height:22px;font-size:12px;line-height:1.7;margin:10px 0 20px;overflow-wrap:anywhere}.gamingMessage[data-error=true]{color:var(--red,#ff949e)}.gamingNetwork{padding:16px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.gamingNetwork strong{font-size:13px}.gamingNetwork code{font:11px/1.9 Consolas,monospace;display:block;color:var(--muted);user-select:text}.gamingNetwork p{margin:4px 0 10px}.gamingSteps{padding-left:19px;color:var(--muted);font-size:12px;line-height:2}.gamingSteps li{margin-bottom:9px}.gamingMono{font-family:Consolas,monospace}.gamingRouteSummary{padding:15px 0;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
      #gamingSubnav button[aria-current=page]{color:var(--text);background:#ffffff09}#gamingSubnav button{white-space:normal;text-align:left}.gamingModes{display:flex;gap:18px;flex-wrap:wrap;margin:18px 0}.gamingModes label{display:flex;gap:7px;align-items:center;font-size:12px}.gamingModes input{width:auto;margin:0;accent-color:var(--accent)}
      .gamingMapperGrid{display:grid;grid-template-columns:minmax(290px,1.15fr) minmax(260px,1fr);gap:20px}.gamingController{width:100%;max-height:330px;display:block;overflow:visible;margin:12px auto}.gamingController .shell{fill:#1e1e24;stroke:#484850;stroke-width:2}.gamingController .surface{fill:#111114;stroke:#45454f;stroke-width:1.5}.gamingController .control{fill:#29292f;stroke:#65656e;stroke-width:1.5;cursor:pointer}.gamingController .control:hover,.gamingController .control:focus{stroke:var(--accent,#e11d2e);outline:none;filter:brightness(1.4)}.gamingController .control[data-pressed=true]{fill:var(--accent,#e11d2e);stroke:#ffc1c7}.gamingController text{fill:var(--text,#fff);font:12px 'Segoe UI',sans-serif;text-anchor:middle;dominant-baseline:middle;pointer-events:none}.gamingController .label{font-size:10px;fill:var(--muted)}
      .gamingBindings{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;max-height:430px;overflow:auto;padding:2px}.gamingBinding{display:flex;align-items:center;gap:6px;justify-content:space-between;border-bottom:1px solid var(--line);padding:7px 0;font-size:11px}.gamingBinding button{padding:5px 7px;font:11px Consolas,monospace;min-width:54px}.gamingBinding button[aria-pressed=true]{border-color:var(--accent);color:#ff9ca8}.gamingBinding .gamingClear{min-width:22px;padding:4px;border:0;background:none;color:var(--muted)}.gamingBinding>span{flex:1}.gamingProfileActions{display:flex;gap:7px;align-items:center;margin-bottom:14px}.gamingProfileActions select{margin:0;min-width:0;flex:1}.gamingProfileActions button{padding:8px;font-size:11px}.gamingKeys{font:11px/1.6 Consolas,monospace;color:var(--muted);min-height:18px}.gamingWorkspace button:focus-visible,.gamingWorkspace input:focus-visible,.gamingWorkspace select:focus-visible{outline:2px solid var(--accent,#e11d2e);outline-offset:3px}
      @media(max-width:1100px){.gamingGrid,.gamingMapperGrid{grid-template-columns:minmax(0,1fr)}.gamingMapperGrid{gap:0}.gamingBindings{max-height:none}.gamingController{max-height:280px}}@media(max-width:570px){#gamingSubnav{padding-left:0}#gamingSubnav button{font-size:9px;padding:7px 3px}.gamingWorkspace{padding:20px 15px}.gamingHead{align-items:start}.gamingHead h1{font-size:21px}.gamingBindings{grid-template-columns:1fr}.gamingCard{padding:17px}}
    `;
    document.head.append(style);
    const extra=document.createElement('style');extra.textContent=`
      .gamingVideoShell{position:relative;display:grid;place-items:center;background:#070708;border:1px solid var(--line);border-radius:12px;aspect-ratio:16/9;overflow:hidden;outline:none;margin-bottom:12px}
      .gamingVideoShell:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.gamingVideoShell video{width:100%;height:100%;object-fit:contain}.gamingVideoHint{position:absolute;inset:auto 12px 12px;background:#101012d9;border:1px solid #ffffff18;padding:7px 10px;border-radius:7px;font-size:11px;pointer-events:none}.gamingSessionHead{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:18px}.gamingParticipant{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);font-size:12px}.gamingParticipant small{color:var(--muted)}.gamingCaptureQuality{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}.gamingCaptureQuality select{width:auto;max-width:180px}.gamingRuntimeNote{max-width:860px;font-size:11px;color:var(--muted);line-height:1.8;margin:0 0 22px}#gamingInviteDialog{max-width:440px}#gamingInviteDialog h2{margin-bottom:12px}.gamingAddress{font:20px/1.7 Consolas,monospace;color:var(--text);user-select:text}.gamingController{max-width:650px}.gamingHead{margin-bottom:16px}.gamingCard .gamingModes{margin-top:8px}
    `;document.head.append(extra);
    const section=document.createElement('section');section.id='gamingWorkspace';section.className='gamingWorkspace';section.hidden=true;
    section.innerHTML=`
      <div class="gamingHead"><div><div class="gamingEyebrow">Gaming</div><h1 id="gamingTitle" tabindex="-1">LAN tunneling</h1><p>Play like you are in the same room.</p></div><span class="gamingStatus" id="gamingSessionStatus">Ready</span><button id="gamingRefresh" type="button">Refresh status</button></div>
      <p id="gamingMessage" class="gamingMessage" role="status" aria-live="polite"></p>
      <div id="gamingLanPanel"><div class="gamingGrid"><div><section class="gamingCard"><div class="gamingSessionHead"><h2>Your LAN</h2><span class="gamingStatus">Built into Vumiro</span></div><p>Invite up to three friends to a private Vumiro LAN. Each PC receives a virtual address; games connect as if the players share a local network.</p><label for="gamingLanFriend">Online friend</label><select id="gamingLanFriend"></select><div class="gamingActions"><button id="gamingLanInvite" class="primary" type="button">Invite friend</button><button id="gamingLanLeave" type="button">Leave session</button></div><p>Friends must accept before their PCs join. Windows may ask to authorize Vumiro’s bundled network component the first time you connect.</p></section><section class="gamingCard"><h2>Your virtual address</h2><div class="gamingAddress" id="gamingLanAddress">—</div><p id="gamingLanDetail">Create or accept a LAN invitation to connect.</p><h3>Participants</h3><div id="gamingLanParticipants"></div></section></div><aside><section class="gamingCard"><h2>A real local network</h2><ol class="gamingSteps"><li>Invite your friend from the list. Vumiro establishes an authenticated, encrypted connection.</li><li>Open the game’s LAN multiplayer mode. Broadcast discovery is supported for games that use it.</li><li>If the game asks for an address, use the host’s Vumiro LAN address shown here.</li></ol><p>The network remains active while you browse Vumiro. Leave the session to disconnect it. Your normal internet route stays separate from the gaming network.</p><p id="gamingRuntimeStatus">The required Windows components are included with Vumiro.</p></section></aside></div></div>
      <div id="gamingTogetherPanel" hidden><div class="gamingGrid"><div><section class="gamingCard"><div class="gamingSessionHead"><h2>Game together</h2><span class="gamingStatus">Built into Vumiro</span></div><label for="gamingRemoteFriend">Online friend</label><select id="gamingRemoteFriend"></select><div class="gamingActions"><button id="gamingRemoteInvite" class="primary" type="button">Invite to play</button><button id="gamingRemoteLeave" type="button">Leave session</button></div><p>Invite a friend, then share the game window. Their controller appears on your PC as another local player. No separate streaming application or account is needed.</p><div class="gamingCaptureQuality"><label for="gamingStreamFps">Frame rate</label><select id="gamingStreamFps"><option value="60">60 FPS</option><option value="30">30 FPS</option></select><label for="gamingStreamBitrate">Video quality</label><select id="gamingStreamBitrate"><option value="15">15 Mbps</option><option value="8">8 Mbps</option><option value="25">25 Mbps</option></select></div><div class="gamingActions"><button id="gamingShare" class="primary" type="button">Share game</button><button id="gamingStopShare" type="button">Stop sharing</button></div></section><div id="gamingVideoShell" class="gamingVideoShell" tabindex="0" role="application" aria-label="Remote game controls"><video id="gamingVideo" playsinline autoplay></video><span id="gamingVideoHint" class="gamingVideoHint">Focus game to control</span></div><div class="gamingActions"><button id="gamingPlayAudio" type="button">Enable game audio</button><button id="gamingToMappings" type="button">Controller mappings</button></div><p class="gamingHelp" id="gamingRemoteDetail">Accept an invitation or invite a friend to start.</p></div><aside><section class="gamingCard"><h2>Choose your controls</h2><p>Connect your controller or use your keyboard mapping.</p><div class="gamingModes" role="group" aria-label="Input source"><label><input id="gamingKeyboardMode" type="radio" name="gamingInputMode" value="keyboard" checked>Keyboard → controller</label><label><input id="gamingPhysicalMode" type="radio" name="gamingInputMode" value="physical">Physical controller</label></div><p>Click the game picture to send controls. Moving focus away releases all inputs. Escape releases control and returns focus to Vumiro.</p><p>The host must choose a game with local multiplayer and assign the remote virtual controller to another player. A physical controller passes directly to the host without keyboard conversion.</p><h3>Participants</h3><div id="gamingRemoteParticipants"></div></section></aside></div></div>
      <div id="gamingMappingPanel" hidden><div class="gamingMapperGrid"><section class="gamingCard"><div class="gamingSessionHead"><h2>Controller preview</h2><span class="gamingStatus" id="gamingControllerStatus">Built into Vumiro</span></div><div id="gamingControllerDiagram"></div><p>Click a controller control or its key to rebind it. Press a key here to preview the result. Your keyboard is converted only while a remote game has focus.</p><div id="gamingKeys" class="gamingKeys" data-i18n-skip></div><div class="gamingActions"><button id="gamingApplyMapping" class="primary" type="button">Apply to game</button><button id="gamingUsePhysical" type="button">Physical controller</button></div><p>The virtual controller is created on the host PC, so Steam and games can read it. The joining player needs no controller driver. Required components are included in Vumiro’s installation.</p></section><section class="gamingCard"><h2>Custom mappings</h2><div class="gamingProfileActions"><select id="gamingProfiles" aria-label="Mapping profile"></select><button id="gamingNewProfile" type="button">New profile</button><button id="gamingDeleteProfile" type="button">Delete profile</button></div><label for="gamingProfileName">Profile name</label><input id="gamingProfileName" maxlength="60" value="Default"><div id="gamingBindings" class="gamingBindings"></div><div class="gamingActions" style="margin-top:18px"><button id="gamingSaveProfile" class="primary" type="button">Save profile</button><button id="gamingReset" type="button">Reset bindings</button><button id="gamingImport" type="button">Import profile</button><button id="gamingExport" type="button">Export profile</button><input id="gamingImportFile" type="file" accept=".json,application/json" hidden></div><p>Profiles stay on this device. Import or export them to carry your bindings between PCs. Each key can control one action.</p></section></div></div>
    `;
    document.querySelector('.workspace').insertBefore(section,$('friendsBody'));
    const inviteDialog=document.createElement('dialog');inviteDialog.id='gamingInviteDialog';inviteDialog.setAttribute('aria-labelledby','gamingInviteTitle');inviteDialog.innerHTML='<h2 id="gamingInviteTitle">Gaming invitation</h2><p id="gamingInviteText"></p><div class="gamingActions"><button id="gamingDeclineInvite" type="button">Decline</button><button id="gamingAcceptInvite" class="primary" type="button">Accept invitation</button></div>';document.body.append(inviteDialog);
    const bridge=createBridge(root.chrome?.webview);
    let session=null,context=null,epoch=0,opened=false,route='lan',invitation=null,busy=false,capturing='',profileIndex=-1;
    let bindings={...mapping.DEFAULT_BINDINGS},profiles=loadProfiles(root.localStorage,mapping.validateBindings),inputMode='keyboard';
    const pressed=new Set();
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
      $('gamingSessionStatus').textContent=state.state||'Ready';$('gamingSessionStatus').dataset.ready=String(state.state==='connected');
      $('gamingLanAddress').textContent=state.mode==='lan'?(state.lanAddress||'—'):'—';
      $('gamingLanDetail').textContent=state.mode==='lan'?state.error||`Vumiro LAN · ${state.state}`:'Create or accept a LAN invitation to connect.';
      $('gamingRemoteDetail').textContent=state.mode==='together'?state.error||`${state.role==='host'?'Hosting':'Joining'} · ${state.state}${state.sharing?' · sharing game':''}`:'Accept an invitation or invite a friend to start.';
      for(const id of ['gamingLanParticipants','gamingRemoteParticipants']){
        const container=$(id);container.replaceChildren();
        for(const peer of state.participants||[]){const row=document.createElement('div');row.className='gamingParticipant';const name=document.createElement('span');name.textContent=friendName(peer.peerId);const detail=document.createElement('small');detail.textContent=[peer.state,peer.peerAddress].filter(Boolean).join(' · ');row.append(name,detail);container.append(row);}
      }
      $('gamingShare').disabled=state.mode!=='together'||state.role!=='host'||!state.accepted;
      $('gamingStopShare').disabled=!state.sharing;
      if(state.error)message(state.error,true);
      if(state.state==='idle'||state.state==='ended'){$('gamingVideo').srcObject=null;releaseInput();}
    }
    function onInvitation(value){invitation=value;$('gamingInviteTitle').textContent=value.mode==='lan'?'LAN invitation':'Game together invitation';$('gamingInviteText').textContent=`${friendName(value.peerId)} invited you to ${value.mode==='lan'?'join their Vumiro LAN':'play a game on their PC'}. Accept only if you want to connect.`;if(!inviteDialog.open)inviteDialog.showModal();}
    function ensureSession(){
      const next=root.VumiroGamingDirectory?.getContext();
      if(next===context&&session)return session;
      const previous=session;session=null;context=next;epoch++;previous?.stop().catch(()=>{});
      invitation=null;if(inviteDialog.open)inviteDialog.close();$('gamingVideo').srcObject=null;
      renderState({state:next?'idle':'offline',participants:[]});
      if(!next){renderFriends();return null;}
      const ownEpoch=epoch;
      session=root.VumiroGamingSession.create({local:next.local,send:next.send,getFriend:next.getFriend,
        requestNative:(name,fields)=>bridge.request(name,fields),
        onState:state=>{if(ownEpoch===epoch)renderState(state);},
        onInvitation:value=>{if(ownEpoch===epoch)onInvitation(value);},
        onTrack:value=>{if(ownEpoch!==epoch)return;const video=$('gamingVideo');if(video.srcObject!==value.stream)video.srcObject=value.stream;video.muted=!!value.local;if(!value.stream)return;video.play()?.catch(()=>message('Click Enable game audio to play the incoming stream.'));}});
      session.setBindings(bindings);session.setInputMode(inputMode);renderFriends();return session;
    }
    function requireSession(){const current=ensureSession();if(!current)throw Error('Connect to Vumiro and choose an online friend.');return current;}
    async function invite(mode){const friendId=$(mode==='lan'?'gamingLanFriend':'gamingRemoteFriend').value;if(!friendId)throw Error('Choose an online friend.');await requireSession().invite(friendId,mode);message('Invitation sent. Your friend must accept to connect.');}
    $('gamingLanInvite').onclick=()=>action(()=>invite('lan'));$('gamingRemoteInvite').onclick=()=>action(()=>invite('together'));
    $('gamingLanLeave').onclick=$('gamingRemoteLeave').onclick=()=>action(async()=>{await session?.stop();message('Gaming session ended.');});
    $('gamingAcceptInvite').onclick=()=>action(async()=>{const value=invitation;if(!value)return;invitation=null;inviteDialog.close();open(value.mode==='lan'?'lan':'together');await requireSession().accept(value.id);});
    $('gamingDeclineInvite').onclick=()=>action(async()=>{const value=invitation;invitation=null;inviteDialog.close();if(value)await session?.decline(value.id);});
    inviteDialog.addEventListener('cancel',event=>{event.preventDefault();$('gamingDeclineInvite').click();});
    $('gamingShare').onclick=()=>action(()=>requireSession().startSharing({frameRate:Number($('gamingStreamFps').value)||60,bitrateMbps:Number($('gamingStreamBitrate').value)||15}));
    $('gamingStopShare').onclick=()=>action(()=>session?.stopSharing());$('gamingPlayAudio').onclick=()=>action(()=>$('gamingVideo').play());
    $('gamingRefresh').onclick=()=>action(async()=>{ensureSession();renderFriends();const result=await bridge.request('status');$('gamingRuntimeStatus').textContent=result.status?.runtime?.bundled?'Windows gaming components are bundled with Vumiro. Initial use may require Windows authorization.':'This development build is missing a bundled gaming component.';$('gamingControllerStatus').textContent=result.controller?.available?'Controller ready':'Included with Vumiro setup';});
    function open(next){if(!['lan','together','mapping'].includes(next))return;if(!opened)$('browseApp')?.click();opened=true;route=next;section.hidden=false;document.body.classList.add('gaming-view');$('gamingSubnav').hidden=false;nav.setAttribute('aria-expanded','true');
      const tabs={lan:'gamingLanNav',together:'gamingTogetherNav',mapping:'gamingMappingNav'};
      for(const [key,id]of Object.entries(tabs)){$(id).setAttribute('aria-current',key===next?'page':'false');$(`gaming${key==='lan'?'Lan':key==='together'?'Together':'Mapping'}Panel`).hidden=key!==next;}
      for(const button of document.querySelectorAll('.nav>button')){button.classList.toggle('active',button===nav);button.setAttribute('aria-current',button===nav?'page':'false');}
      $('gamingTitle').textContent=t(next==='lan'?'LAN tunneling':next==='together'?'Game together':'Controller mappings');$('gamingTitle').focus();ensureSession();renderFriends();}
    function releaseInput(){pressed.clear();session?.releaseInput();preview();}
    function close(){opened=false;section.hidden=true;document.body.classList.remove('gaming-view');nav.classList.remove('active');nav.setAttribute('aria-current','false');releaseInput();}
    nav.addEventListener('click',()=>open(route));$('gamingLanNav').onclick=()=>open('lan');$('gamingTogetherNav').onclick=()=>open('together');$('gamingMappingNav').onclick=()=>open('mapping');$('gamingToMappings').onclick=()=>open('mapping');
    document.addEventListener('click',event=>{if(['homeNav','friendsNav','roomNav','watchNav','returnToRoom'].includes(event.target.closest?.('button')?.id))close();},true);
    if(root.MutationObserver)new root.MutationObserver(()=>{if(opened&&document.body.classList.contains('room-view'))close();}).observe(document.body,{attributes:true,attributeFilter:['class']});
    const labels={leftUp:'Left stick ↑',leftDown:'Left stick ↓',leftLeft:'Left stick ←',leftRight:'Left stick →',rightUp:'Right stick ↑',rightDown:'Right stick ↓',rightLeft:'Right stick ←',rightRight:'Right stick →',a:'A',b:'B',x:'X',y:'Y',lb:'LB',rb:'RB',lt:'LT',rt:'RT',back:'Back',start:'Start',ls:'Left stick click',rs:'Right stick click',dpadUp:'D-pad ↑',dpadDown:'D-pad ↓',dpadLeft:'D-pad ←',dpadRight:'D-pad →'};
    const keyLabel=code=>code?code.replace(/^Key|^Digit/,''):'—';
    function bindTarget(target){releaseInput();capturing=target;renderBindings();message(`${labels[target]}: press a key. Escape cancels.`);}
    function renderBindings(){const container=$('gamingBindings');container.replaceChildren();for(const [target,label]of Object.entries(labels)){const row=document.createElement('div');row.className='gamingBinding';const name=document.createElement('span');name.textContent=label;const button=document.createElement('button');button.type='button';button.dataset.target=target;button.setAttribute('data-i18n-skip','');button.setAttribute('aria-label',`${label}: ${bindings[target]||'Unbound'}`);button.setAttribute('aria-pressed',String(capturing===target));button.textContent=capturing===target?'Press a key…':keyLabel(bindings[target]);button.onclick=()=>bindTarget(target);const clear=document.createElement('button');clear.type='button';clear.className='gamingClear';clear.textContent='×';clear.setAttribute('aria-label','Clear '+label);clear.onclick=()=>{delete bindings[target];capturing='';renderBindings();};row.append(name,button,clear);container.append(row);}session?.setBindings(bindings);}
    function makeDiagram(){
      const circle=(target,cx,cy,label,r=18)=>`<g><circle class="control" data-control="${target}" tabindex="0" role="button" aria-label="Map ${labels[target]}" cx="${cx}" cy="${cy}" r="${r}"/><text x="${cx}" y="${cy}">${label}</text></g>`;
      const rect=(target,x,y,w,h,label)=>`<g><rect class="control" data-control="${target}" tabindex="0" role="button" aria-label="Map ${labels[target]}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/><text x="${x+w/2}" y="${y+h/2}">${label}</text></g>`;
      $('gamingControllerDiagram').innerHTML=`<svg class="gamingController" viewBox="0 0 520 340" role="group" aria-label="Controller mapping diagram"><path class="shell" d="M111 65Q73 60 58 113L22 267Q16 312 50 317Q73 321 99 286L146 239H374L421 286Q447 321 470 317Q504 312 498 267L462 113Q447 60 409 65Z"/><path class="surface" d="M110 88H410Q433 91 437 115L447 205Q438 232 409 233H111Q82 232 73 205L83 115Q87 91 110 88Z"/>${rect('lt',89,15,66,30,'LT')}${rect('rt',365,15,66,30,'RT')}${rect('lb',74,52,92,26,'LB')}${rect('rb',354,52,92,26,'RB')}${circle('a',407,176,'A')}${circle('b',437,146,'B')}${circle('x',377,146,'X')}${circle('y',407,116,'Y')}${circle('back',228,133,'‹',12)}${circle('start',292,133,'≡',12)}<circle class="surface" cx="136" cy="145" r="44"/>${circle('ls',136,145,'L',19)}${circle('leftUp',136,112,'↑',11)}${circle('leftDown',136,178,'↓',11)}${circle('leftLeft',103,145,'←',11)}${circle('leftRight',169,145,'→',11)}<circle class="surface" cx="321" cy="218" r="44"/>${circle('rs',321,218,'R',19)}${circle('rightUp',321,185,'↑',11)}${circle('rightDown',321,251,'↓',11)}${circle('rightLeft',288,218,'←',11)}${circle('rightRight',354,218,'→',11)}${rect('dpadUp',193,184,22,22,'↑')}${rect('dpadDown',193,228,22,22,'↓')}${rect('dpadLeft',171,206,22,22,'←')}${rect('dpadRight',215,206,22,22,'→')}<text class="label" x="136" y="282">Left stick</text><text class="label" x="321" y="282">Right stick</text></svg>`;
      for(const control of $('gamingControllerDiagram').querySelectorAll('[data-control]')){
        control.addEventListener('click',()=>bindTarget(control.dataset.control));
        control.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();bindTarget(control.dataset.control);}});
      }
    }
    function preview(){$('gamingKeys').textContent=Array.from(pressed).map(keyLabel).join(' + ');for(const control of $('gamingControllerDiagram').querySelectorAll('[data-control]'))control.dataset.pressed=String(pressed.has(bindings[control.dataset.control]));}
    const videoShell=$('gamingVideoShell');videoShell.addEventListener('focus',()=>{session?.setInputFocused(true);$('gamingVideoHint').textContent='Game controls active · Escape releases';});videoShell.addEventListener('blur',()=>{releaseInput();$('gamingVideoHint').textContent=t('Focus game to control');});
    document.addEventListener('keydown',event=>{
      if(capturing&&opened&&route==='mapping'){event.preventDefault();if(event.code==='Escape'){capturing='';renderBindings();return;}const candidate={...bindings,[capturing]:event.code},check=mapping.validateBindings(candidate);if(!check.valid)return message(check.errors.join(' '),true);bindings={...check.bindings};capturing='';renderBindings();message('Binding updated. Save the profile to keep it.');return;}
      if(event.target===videoShell&&opened&&route==='together'){
        if(event.code==='Escape'){event.preventDefault();releaseInput();$('gamingTitle').focus();return;}
        if(inputMode==='keyboard'&&Object.values(bindings).includes(event.code)){event.preventDefault();session?.setKey(event.code,true);return;}
      }
      if(opened&&route==='mapping'&&!event.target?.closest?.('input,textarea,select,[contenteditable="true"]')&&Object.values(bindings).includes(event.code)){pressed.add(event.code);preview();}
    },true);
    document.addEventListener('keyup',event=>{session?.setKey(event.code,false);pressed.delete(event.code);preview();});root.addEventListener('blur',releaseInput);
    function setMode(mode){inputMode=mode;releaseInput();session?.setInputMode(mode);$('gamingKeyboardMode').checked=mode==='keyboard';$('gamingPhysicalMode').checked=mode==='physical';}
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
    root.addEventListener('pagehide',()=>{clearInterval(poll);epoch++;session?.stop().catch(()=>{});session=null;bridge.dispose();});
    makeDiagram();renderBindings();renderProfiles();ensureSession();root.VumiroI18n?.refresh(section);api.open=open;api.close=close;api.snapshot=()=>session?.snapshot()||{state:'offline'};
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='object'?window:null);
