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
    const document=root.document,nav=document.getElementById('gamingNav'),engine=root.VumiroControllerMapping;
    if(!nav||!engine)return;
    const $=id=>document.getElementById(id);
    // Register feature vocabulary without modifying the shared catalog file.
    const translations={
      'pt-BR':{'Gaming':'Jogos','LAN tunneling':'Rede LAN virtual','Game together':'Jogar juntos','Controller mappings':'Mapeamento de controles','Play like you are in the same room.':'Jogue como se estivessem na mesma sala.','Refresh status':'Atualizar status','Your virtual LAN':'Sua LAN virtual','Create a network':'Criar uma rede','Join network':'Entrar na rede','Network ID':'ID da rede','Leave network':'Sair da rede','Copy connection details':'Copiar dados da conexão','No networks joined.':'Nenhuma rede conectada.','Host a game':'Hospedar um jogo','Connect to a friend':'Conectar a um amigo','Friend’s PC address':'Endereço do PC do amigo','Pair with PC':'Parear com o PC','Start remote play':'Iniciar jogo remoto','Open host settings':'Abrir configurações do host','Keyboard → controller':'Teclado → controle','Physical controller':'Controle físico','Start mapper':'Ativar mapeador','Stop mapper':'Desativar mapeador','Save profile':'Salvar perfil','Reset bindings':'Redefinir teclas','Import profile':'Importar perfil','Export profile':'Exportar perfil','Profile name':'Nome do perfil','Controller preview':'Prévia do controle','Press a key…':'Pressione uma tecla…','Not checked':'Não verificado','Left stick':'Analógico esquerdo','Right stick':'Analógico direito','Controller':'Controle','Controls':'Controles','Left trigger':'Gatilho esquerdo','Right trigger':'Gatilho direito','Clear binding':'Remover tecla','Delete profile':'Excluir perfil','New profile':'Novo perfil','Setup':'Configurar'},
      es:{'Gaming':'Juegos','LAN tunneling':'LAN virtual','Game together':'Jugar juntos','Controller mappings':'Mapeo de mandos','Refresh status':'Actualizar estado','Your virtual LAN':'Tu LAN virtual','Create a network':'Crear una red','Join network':'Unirse a la red','Network ID':'ID de red','Leave network':'Salir de la red','Host a game':'Alojar un juego','Connect to a friend':'Conectarse con un amigo','Pair with PC':'Emparejar con PC','Start remote play':'Iniciar juego remoto','Open host settings':'Abrir ajustes del anfitrión','Keyboard → controller':'Teclado → mando','Physical controller':'Mando físico','Start mapper':'Activar mapeador','Stop mapper':'Desactivar mapeador','Save profile':'Guardar perfil','Reset bindings':'Restablecer teclas','Import profile':'Importar perfil','Export profile':'Exportar perfil','Profile name':'Nombre del perfil','Controller preview':'Vista previa del mando','Press a key…':'Pulsa una tecla…','Not checked':'Sin comprobar','Left stick':'Palanca izquierda','Right stick':'Palanca derecha','Setup':'Configurar'}
    };
    Object.assign(translations['pt-BR'],{
      'Custom mappings':'Mapeamentos personalizados','Driver setup':'Configurar driver','Driver ready':'Driver pronto','Mapper ready':'Mapeador pronto','Capturing keys':'Capturando teclas','Setup required':'Configuração necessária','Permission required':'Permissão necessária','Networks':'Redes','Bring your party together':'Reúna seu grupo','Connection':'Conexão','Choose your controls':'Escolha seus controles',
      'Click a controller control or its key to change the binding. Press a key in this screen to preview it. Escape cancels rebinding and stops an active mapper.':'Clique em um comando do controle ou na tecla atribuída para alterar o mapeamento. Pressione uma tecla nesta tela para ver a prévia. Esc cancela a alteração e desativa o mapeador.',
      'Profiles stay on this device. Export a profile to take your bindings to another PC. Every key can control one action; clear a binding before moving its key.':'Os perfis ficam neste dispositivo. Exporte um perfil para levar seus mapeamentos a outro PC. Cada tecla controla uma ação; remova o mapeamento anterior antes de reutilizar a tecla.',
      'Connect your controller and use it directly in Moonlight. Keyboard conversion is off.':'Conecte seu controle e use-o diretamente no Moonlight. A conversão de teclado está desativada.',
      'Requires the optional ViGEmBus driver. This free compatibility driver is end of life. Vumiro does not install it automatically. While active, mapped keys are captured only in Moonlight. The diagram previews your keys in Vumiro. Escape is always an emergency stop.':'Requer o driver opcional ViGEmBus. Este driver gratuito de compatibilidade teve seu suporte encerrado. O Vumiro não o instala automaticamente. As teclas mapeadas são capturadas apenas na transmissão do Moonlight. O diagrama mostra uma prévia no Vumiro. Esc sempre desativa o mapeador.',
      'Join the same private ZeroTier network as your friends. Games with LAN multiplayer can use the addresses below.':'Entre na mesma rede privada ZeroTier que seus amigos. Jogos com multijogador em LAN podem usar os endereços abaixo.',
      'Install ZeroTier on each PC, then create a private network in ZeroTier Central.':'Instale o ZeroTier em cada PC e crie uma rede privada no ZeroTier Central.',
      'Share its 16-character network ID with your friends and join it here.':'Compartilhe o ID da rede de 16 caracteres com seus amigos e entre nela por aqui.',
      'The network owner must authorize each member in ZeroTier Central.':'O proprietário da rede precisa autorizar cada membro no ZeroTier Central.',
      'Start a LAN game and connect to the host’s assigned LAN address.':'Inicie um jogo em LAN e conecte-se ao endereço LAN atribuído ao anfitrião.',
      'Only authorize people you trust. Joining a network grants access according to its network rules and your firewall.':'Autorize apenas pessoas de confiança. A rede permite acesso conforme suas regras e seu firewall.',
      'Set up ZeroTier':'Configurar ZeroTier','Manage members':'Gerenciar membros','Set up Moonlight':'Configurar Moonlight','Set up Sunshine':'Configurar Sunshine',
      'Your friend runs Sunshine; you connect with Moonlight. Video, sound and controller input travel through the streaming connection.':'Seu amigo executa o Sunshine e você se conecta pelo Moonlight. Vídeo, áudio e comandos do controle passam pela transmissão.',
      'Use your friend’s ZeroTier LAN address when you are on different networks. Pair once and approve the PIN on the host PC. Starting opens Moonlight’s Desktop stream.':'Use o endereço LAN ZeroTier do seu amigo quando estiverem em redes diferentes. Faça o pareamento uma vez e aprove o PIN no PC anfitrião. Iniciar abre a transmissão Desktop do Moonlight.',
      'A connected physical controller works through Moonlight. For keyboard-only play, activate your Vumiro mapping before opening the stream.':'Um controle físico conectado funciona pelo Moonlight. Para jogar só com o teclado, ative seu mapeamento no Vumiro antes de abrir a transmissão.',
      'The host keeps their own local controls. Use a game that supports multiple local players and assign a separate player slot to the remote controller.':'O anfitrião mantém seus controles locais. Use um jogo com multijogador local e atribua uma posição de jogador separada ao controle remoto.',
      'Install Sunshine on the PC that runs the game.':'Instale o Sunshine no PC que executa o jogo.',
      'Open its settings, create local login credentials and enable controller input.':'Abra as configurações, crie suas credenciais locais e habilite a entrada de controle.',
      'Share your LAN address and approve your friend’s pairing PIN.':'Compartilhe seu endereço LAN e aprove o PIN de pareamento do seu amigo.',
      'Keep the game open and add the remote controller as another local player.':'Mantenha o jogo aberto e adicione o controle remoto como outro jogador local.',
      'Host access and pairing are managed by Sunshine. Grant access only to someone you trust; they can interact with the streamed desktop. Hosting a virtual controller also requires a compatible driver on the host.':'O Sunshine gerencia o acesso ao anfitrião e o pareamento. Conceda acesso apenas a pessoas de confiança: elas poderão interagir com a área de trabalho transmitida. O anfitrião também precisa de um driver compatível para o controle virtual.'
    });
    const catalogs=root.VumiroI18n?.catalogs;
    if(catalogs){
      const vocabulary=new Set(Object.values(translations).flatMap(entries=>Object.keys(entries)));
      for(const key of vocabulary)for(const locale of Object.keys(catalogs)){
        if(translations[locale]?.[key])catalogs[locale][key]=translations[locale][key];
        else if(!Object.prototype.hasOwnProperty.call(catalogs[locale],key))catalogs[locale][key]=key;
      }
    }
    const t=text=>root.VumiroI18n?.t(text)||text;
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
    const section=document.createElement('section');section.id='gamingWorkspace';section.className='gamingWorkspace';section.hidden=true;
    section.innerHTML=`
      <div class="gamingHead"><div><div class="gamingEyebrow">Gaming</div><h1 id="gamingTitle" tabindex="-1">LAN tunneling</h1><p>Play like you are in the same room.</p></div><button type="button" id="gamingRefresh">Refresh status</button></div>
      <p id="gamingMessage" class="gamingMessage" role="status" aria-live="polite"></p>
      <div id="gamingLanPanel"><div class="gamingGrid"><div><section class="gamingCard"><div class="gamingActions" style="justify-content:space-between"><h2>Your virtual LAN</h2><span id="gamingLanStatus" class="gamingStatus">Not checked</span></div><p>Join the same private ZeroTier network as your friends. Games with LAN multiplayer can use the addresses below.</p><form id="gamingJoinForm"><label for="gamingNetworkId">Network ID</label><input id="gamingNetworkId" class="gamingMono" maxlength="16" pattern="[0-9a-fA-F]{16}" placeholder="0123456789abcdef" autocomplete="off" required><div class="gamingActions"><button id="gamingJoin" class="primary" type="submit">Join network</button><button type="button" data-gaming-setup="central">Create a network</button></div></form></section><section class="gamingCard"><h2>Networks</h2><div id="gamingNetworks"><p>No networks joined.</p></div></section></div><aside><section class="gamingCard"><h2>Bring your party together</h2><ol class="gamingSteps"><li>Install ZeroTier on each PC, then create a private network in ZeroTier Central.</li><li>Share its 16-character network ID with your friends and join it here.</li><li>The network owner must authorize each member in ZeroTier Central.</li><li>Start a LAN game and connect to the host’s assigned LAN address.</li></ol><div class="gamingActions"><button type="button" data-gaming-setup="zerotier">Set up ZeroTier</button><button type="button" data-gaming-setup="central">Manage members</button></div><p>Only authorize people you trust. Joining a network grants access according to its network rules and your firewall.</p></section><section class="gamingCard"><h3>Connection</h3><p id="gamingLanDetail">Refresh status to check the local ZeroTier service.</p><div id="gamingPeerSummary" class="gamingRouteSummary">Peer routes appear after a network is joined.</div></section></aside></div></div>
      <div id="gamingTogetherPanel" hidden><div class="gamingGrid"><div><section class="gamingCard"><div class="gamingActions" style="justify-content:space-between"><h2>Connect to a friend</h2><span class="gamingStatus" id="gamingClientStatus">Not checked</span></div><p>Your friend runs Sunshine; you connect with Moonlight. Video, sound and controller input travel through the streaming connection.</p><form id="gamingRemoteForm"><label for="gamingHost">Friend’s PC address</label><input id="gamingHost" maxlength="253" autocomplete="off" placeholder="10.147.20.5 or gaming-pc.example"><div class="gamingActions"><button type="button" id="gamingPair">Pair with PC</button><button type="submit" class="primary" id="gamingStream">Start remote play</button></div></form><p>Use your friend’s ZeroTier LAN address when you are on different networks. Pair once and approve the PIN on the host PC. Starting opens Moonlight’s Desktop stream.</p><button type="button" data-gaming-setup="moonlight">Set up Moonlight</button></section><section class="gamingCard"><h2>Choose your controls</h2><p>A connected physical controller works through Moonlight. For keyboard-only play, activate your Vumiro mapping before opening the stream.</p><button type="button" id="gamingToMappings">Controller mappings</button><p>The host keeps their own local controls. Use a game that supports multiple local players and assign a separate player slot to the remote controller.</p></section></div><aside><section class="gamingCard"><div class="gamingActions" style="justify-content:space-between"><h2>Host a game</h2><span class="gamingStatus" id="gamingHostStatus">Not checked</span></div><ol class="gamingSteps"><li>Install Sunshine on the PC that runs the game.</li><li>Open its settings, create local login credentials and enable controller input.</li><li>Share your LAN address and approve your friend’s pairing PIN.</li><li>Keep the game open and add the remote controller as another local player.</li></ol><div class="gamingActions"><button type="button" class="primary" id="gamingOpenHost">Open host settings</button><button type="button" data-gaming-setup="sunshine">Set up Sunshine</button></div><p>Host access and pairing are managed by Sunshine. Grant access only to someone you trust; they can interact with the streamed desktop. Hosting a virtual controller also requires a compatible driver on the host.</p></section></aside></div></div>
      <div id="gamingMappingPanel" hidden><div class="gamingModes" role="group" aria-label="Controller input source"><label><input type="radio" name="gamingInputMode" value="keyboard" checked>Keyboard → controller</label><label><input type="radio" name="gamingInputMode" value="physical">Physical controller</label></div><p id="gamingPhysicalHelp" class="gamingHelp" hidden>Connect your controller and use it directly in Moonlight. Keyboard conversion is off.</p><div id="gamingKeyboardEditor"><div class="gamingMapperGrid"><section class="gamingCard"><div class="gamingActions" style="justify-content:space-between"><h2>Controller preview</h2><span id="gamingMapperStatus" class="gamingStatus">Not checked</span></div><div id="gamingControllerDiagram"></div><p>Click a controller control or its key to change the binding. Press a key in this screen to preview it. Escape cancels rebinding and stops an active mapper.</p><div class="gamingKeys" id="gamingKeys" data-i18n-skip></div><div class="gamingActions"><button type="button" id="gamingMapperStart" class="primary">Start mapper</button><button type="button" id="gamingMapperStop" disabled>Stop mapper</button><button type="button" data-gaming-setup="driver">Driver setup</button></div><p id="gamingMapperDetail">Keyboard conversion creates a virtual Xbox 360 controller on this PC. Moonlight forwards it to the host. Steam and compatible games can also detect it locally.</p><p>Requires the optional ViGEmBus driver. This free compatibility driver is end of life. Vumiro does not install it automatically. While active, mapped keys are captured only in Moonlight. The diagram previews your keys in Vumiro. Escape is always an emergency stop.</p></section><section class="gamingCard"><h2>Custom mappings</h2><div class="gamingProfileActions"><select id="gamingProfiles" aria-label="Mapping profile"></select><button type="button" id="gamingNewProfile">New profile</button><button type="button" id="gamingDeleteProfile">Delete profile</button></div><label for="gamingProfileName">Profile name</label><input id="gamingProfileName" maxlength="60" value="Default"><div id="gamingBindings" class="gamingBindings"></div><div class="gamingActions" style="margin-top:18px"><button type="button" id="gamingSaveProfile" class="primary">Save profile</button><button type="button" id="gamingReset">Reset bindings</button><button type="button" id="gamingImport">Import profile</button><button type="button" id="gamingExport">Export profile</button><input id="gamingImportFile" type="file" accept=".json,application/json" hidden></div><p>Profiles stay on this device. Export a profile to take your bindings to another PC. Every key can control one action; clear a binding before moving its key.</p></section></div></div></div>
    `;
    document.querySelector('.workspace').insertBefore(section,$('friendsBody'));
    let bridge=createBridge(root.chrome?.webview),route='lan',opened=false,busy=false,controllerActive=false,capturing='',profileIndex=-1;
    let mapperEpoch=0,pendingMapperStart=false;
    let bindings={...engine.DEFAULT_BINDINGS},profiles=loadProfiles(root.localStorage,engine.validateBindings);
    const pressed=new Set();let latestStatus;
    function message(text,error=false){$('gamingMessage').textContent=text;$('gamingMessage').dataset.error=String(error);}
    function badge(id,text,ready=false,active=false){$(id).textContent=text;$(id).dataset.ready=String(ready);$(id).dataset.active=String(active);}
    async function perform(action,fields={},announce=true) {
      if(busy)return;
      const epoch=mapperEpoch;
      if(action==='mapper-start')pendingMapperStart=true;
      busy=true;section.setAttribute('aria-busy','true');
      section.querySelectorAll('button').forEach(button=>button.disabled=true);
      try {
        const result=await bridge.request(action,fields);
        if(action==='mapper-start'&&(epoch!==mapperEpoch||!opened)){
          bridge.request('mapper-stop').catch(()=>{});return;
        }
        if(announce)message(result?.message||'');if(result?.status)renderStatus(result);if(result?.controller)renderController(result.controller);return result;
      }
      catch(error){message(error.message,true);}
      finally{if(action==='mapper-start')pendingMapperStart=false;busy=false;section.setAttribute('aria-busy','false');section.querySelectorAll('button').forEach(button=>button.disabled=false);$('gamingMapperStop').disabled=!controllerActive;$('gamingMapperStart').disabled=controllerActive;}
    }
    function renderController(controller){
      controllerActive=!!controller.active;
      badge('gamingMapperStatus',controller.active?(controller.capturing?'Capturing keys':'Mapper ready'):controller.available?'Driver ready':'Setup required',controller.available,controller.active);
      $('gamingMapperDetail').textContent=controller.message||'Keyboard conversion creates a virtual Xbox 360 controller on this PC. Moonlight forwards it to the host.';
      $('gamingMapperStart').disabled=controllerActive;$('gamingMapperStop').disabled=!controllerActive;
    }
    function renderStatus(result){
      latestStatus=result;
      const status=result.status,lan=status.lan,streaming=status.streaming;
      badge('gamingLanStatus',lan.online?'Online':lan.state==='permission-required'?'Permission required':lan.state==='not-installed'?'Setup required':lan.state,lan.online);
      $('gamingLanDetail').textContent=lan.message||[lan.nodeId,lan.version].filter(Boolean).join(' · ');
      const peers=(lan.peers||[]).filter(peer=>peer.role==='LEAF');
      const direct=peers.filter(peer=>peer.paths?.some(path=>path.active));
      $('gamingPeerSummary').textContent=`${peers.length} peer routes · ${direct.length} with an active direct path. Membership is controlled in ZeroTier Central.`;
      const networks=$('gamingNetworks');networks.replaceChildren();
      if(!lan.networks?.length){const p=document.createElement('p');p.textContent=t('No networks joined.');networks.append(p);}
      for(const network of lan.networks||[]){
        const card=document.createElement('div');card.className='gamingNetwork';
        const name=document.createElement('strong');name.textContent=network.name||network.id;
        const id=document.createElement('code');id.textContent=network.id;
        const state=document.createElement('p');state.textContent=network.status==='ACCESS_DENIED'?'Awaiting authorization. Ask the network owner to approve this PC in ZeroTier Central.':network.status;
        const addresses=document.createElement('code');addresses.textContent=(network.assignedAddresses||[]).join(' · ')||'No LAN address assigned yet.';
        const actions=document.createElement('div');actions.className='gamingActions';
        const copy=document.createElement('button');copy.type='button';copy.textContent=t('Copy connection details');copy.onclick=async()=>{try{await root.navigator.clipboard.writeText(`ZeroTier network: ${network.id}\nPC LAN address: ${(network.assignedAddresses||[]).map(a=>a.split('/')[0]).join(', ')}`);message('Connection details copied. Share them with your friends.');}catch{message('Clipboard unavailable. Select and copy the network ID and LAN address above.',true);}};
        const leave=document.createElement('button');leave.type='button';leave.textContent=t('Leave network');leave.onclick=()=>perform('lan-leave',{networkId:network.id});
        actions.append(copy,leave);card.append(name,id,state,addresses,actions);networks.append(card);
      }
      badge('gamingHostStatus',streaming.host.installed?'Sunshine installed':'Setup required',streaming.host.installed);
      badge('gamingClientStatus',streaming.client.installed?'Moonlight installed':'Setup required',streaming.client.installed);
      if(result.controller)renderController(result.controller);
    }
    async function refresh(){const result=await perform('status',{},false);if(result)message('');}
    function open(next) {
      if(!['lan','together','mapping'].includes(next))return;
      if(!opened)$('browseApp')?.click();
      opened=true;route=next;document.body.classList.add('gaming-view');section.hidden=false;
      $('gamingSubnav').hidden=false;nav.setAttribute('aria-expanded','true');
      for(const button of document.querySelectorAll('.nav>button')){button.classList.toggle('active',button===nav);button.setAttribute('aria-current',button===nav?'page':'false');}
      const tabs={lan:'gamingLanNav',together:'gamingTogetherNav',mapping:'gamingMappingNav'};
      for(const [tab,id]of Object.entries(tabs)){$(id).setAttribute('aria-current',tab===next?'page':'false');$(`gaming${tab==='lan'?'Lan':tab==='together'?'Together':'Mapping'}Panel`).hidden=tab!==next;}
      $('gamingTitle').textContent=t(next==='lan'?'LAN tunneling':next==='together'?'Game together':'Controller mappings');$('gamingTitle').focus();
      if(!latestStatus)refresh();
    }
    function close(){if(!opened)return;opened=false;document.body.classList.remove('gaming-view');section.hidden=true;nav.classList.remove('active');nav.setAttribute('aria-current','false');clearPreview();stopMapper();}
    if(root.MutationObserver)new root.MutationObserver(()=>{
      if(opened&&document.body.classList.contains('room-view'))close();
    }).observe(document.body,{attributes:true,attributeFilter:['class']});
    nav.addEventListener('click',()=>{if(opened){const expand=$('gamingSubnav').hidden;$('gamingSubnav').hidden=!expand;nav.setAttribute('aria-expanded',String(expand));}else open(route);});
    $('gamingLanNav').onclick=()=>open('lan');$('gamingTogetherNav').onclick=()=>open('together');$('gamingMappingNav').onclick=()=>open('mapping');
    document.addEventListener('click',event=>{const target=event.target.closest?.('button');if(target&&['homeNav','friendsNav','roomNav','watchNav','returnToRoom','acceptInvite'].includes(target.id))close();},true);
    $('gamingRefresh').onclick=refresh;
    $('gamingJoinForm').onsubmit=event=>{event.preventDefault();const networkId=$('gamingNetworkId').value.trim();if(!/^[a-f0-9]{16}$/i.test(networkId))return message('Enter a 16-character hexadecimal network ID.',true);perform('lan-join',{networkId});};
    section.querySelectorAll('[data-gaming-setup]').forEach(button=>button.onclick=()=>perform('open-setup',{component:button.dataset.gamingSetup}));
    $('gamingOpenHost').onclick=()=>perform('open-host');
    function remote(action){const host=$('gamingHost').value.trim();if(!host)return message('Enter your friend’s PC address.',true);perform(action,{host});}
    $('gamingPair').onclick=()=>remote('pair');$('gamingRemoteForm').onsubmit=event=>{event.preventDefault();remote('stream');};$('gamingToMappings').onclick=()=>open('mapping');
    const labels={leftUp:'Left stick ↑',leftDown:'Left stick ↓',leftLeft:'Left stick ←',leftRight:'Left stick →',rightUp:'Right stick ↑',rightDown:'Right stick ↓',rightLeft:'Right stick ←',rightRight:'Right stick →',a:'A',b:'B',x:'X',y:'Y',lb:'LB',rb:'RB',lt:'LT',rt:'RT',back:'Back',start:'Start',ls:'Left stick click',rs:'Right stick click',dpadUp:'D-pad ↑',dpadDown:'D-pad ↓',dpadLeft:'D-pad ←',dpadRight:'D-pad →'};
    function keyLabel(code){return code?code.replace(/^Key|^Digit/,'').replace('Arrow','↗ '):'—';}
    function bindTarget(target){if(controllerActive)return message('Stop the mapper before editing bindings.',true);capturing=target;clearPreview();renderBindings();message(`${labels[target]}: ${t('Press a key…')} Escape cancels.`);}
    function renderBindings(){
      const container=$('gamingBindings');container.replaceChildren();
      for(const [target,label]of Object.entries(labels)){
        const row=document.createElement('div');row.className='gamingBinding';
        const name=document.createElement('span');name.textContent=label;
        const button=document.createElement('button');button.type='button';button.dataset.target=target;button.setAttribute('aria-label',`${label}: ${bindings[target]||'Unbound'}`);button.setAttribute('aria-pressed',String(capturing===target));button.setAttribute('data-i18n-skip','');button.textContent=capturing===target?t('Press a key…'):keyLabel(bindings[target]);button.onclick=()=>bindTarget(target);
        const clear=document.createElement('button');clear.type='button';clear.className='gamingClear';clear.textContent='×';clear.setAttribute('aria-label',`${t('Clear binding')}: ${label}`);clear.onclick=()=>{if(controllerActive)return message('Stop the mapper before editing bindings.',true);delete bindings[target];capturing='';renderBindings();};
        row.append(name,button,clear);container.append(row);
      }
    }
    function makeDiagram(){
      const circle=(target,cx,cy,label,r=18)=>`<g><circle class="control" data-control="${target}" tabindex="0" role="button" aria-label="Map ${labels[target]}" cx="${cx}" cy="${cy}" r="${r}"/><text x="${cx}" y="${cy}">${label}</text></g>`;
      const rect=(target,x,y,w,h,label)=>`<g><rect class="control" data-control="${target}" tabindex="0" role="button" aria-label="Map ${labels[target]}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/><text x="${x+w/2}" y="${y+h/2}">${label}</text></g>`;
      $('gamingControllerDiagram').innerHTML=`<svg class="gamingController" viewBox="0 0 520 340" role="group" aria-label="Controller mapping diagram"><path class="shell" d="M111 65Q73 60 58 113L22 267Q16 312 50 317Q73 321 99 286L146 239H374L421 286Q447 321 470 317Q504 312 498 267L462 113Q447 60 409 65Z"/><path class="surface" d="M110 88H410Q433 91 437 115L447 205Q438 232 409 233H111Q82 232 73 205L83 115Q87 91 110 88Z"/>${rect('lt',89,15,66,30,'LT')}${rect('rt',365,15,66,30,'RT')}${rect('lb',74,52,92,26,'LB')}${rect('rb',354,52,92,26,'RB')}${circle('a',407,176,'A')}${circle('b',437,146,'B')}${circle('x',377,146,'X')}${circle('y',407,116,'Y')}${circle('back',228,133,'‹',12)}${circle('start',292,133,'≡',12)}<circle class="surface" cx="136" cy="145" r="44"/>${circle('ls',136,145,'L',19)}${circle('leftUp',136,112,'↑',11)}${circle('leftDown',136,178,'↓',11)}${circle('leftLeft',103,145,'←',11)}${circle('leftRight',169,145,'→',11)}<circle class="surface" cx="321" cy="218" r="44"/>${circle('rs',321,218,'R',19)}${circle('rightUp',321,185,'↑',11)}${circle('rightDown',321,251,'↓',11)}${circle('rightLeft',288,218,'←',11)}${circle('rightRight',354,218,'→',11)}${rect('dpadUp',193,184,22,22,'↑')}${rect('dpadDown',193,228,22,22,'↓')}${rect('dpadLeft',171,206,22,22,'←')}${rect('dpadRight',215,206,22,22,'→')}<text class="label" x="136" y="282">Left stick</text><text class="label" x="321" y="282">Right stick</text></svg>`;
      for(const control of $('gamingControllerDiagram').querySelectorAll('[data-control]')){
        control.addEventListener('click',()=>bindTarget(control.dataset.control));
        control.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();bindTarget(control.dataset.control);}});
      }
    }
    function preview(){
      $('gamingKeys').textContent=Array.from(pressed).map(keyLabel).join(' + ');
      for(const control of $('gamingControllerDiagram').querySelectorAll('[data-control]'))control.dataset.pressed=String(pressed.has(bindings[control.dataset.control]));
    }
    function clearPreview(){pressed.clear();preview();}
    function textEntry(target){return !!target?.closest?.('input,textarea,select,[contenteditable="true"]');}
    document.addEventListener('keydown',event=>{
      if(!opened||route!=='mapping'||$('gamingKeyboardEditor').hidden)return;
      if(event.code==='Escape'){if(capturing){capturing='';renderBindings();message('Binding cancelled.');}if(controllerActive)stopMapper();clearPreview();return;}
      if(capturing){event.preventDefault();event.stopPropagation();const candidate={...bindings,[capturing]:event.code},check=engine.validateBindings(candidate);if(!check.valid)return message(check.errors.join(' '),true);bindings={...check.bindings};capturing='';renderBindings();message('Binding updated. Save the profile to keep it.');return;}
      if(!textEntry(event.target)&&Object.values(bindings).includes(event.code)){pressed.add(event.code);preview();}
    },true);
    document.addEventListener('keyup',event=>{pressed.delete(event.code);if(opened)preview();});root.addEventListener('blur',clearPreview);
    function renderProfiles(){const select=$('gamingProfiles');select.replaceChildren();const base=document.createElement('option');base.value='-1';base.textContent=t('New profile');select.append(base);profiles.forEach((profile,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=profile.name;select.append(option);});select.value=String(profileIndex);}
    async function stopMapper(){
      mapperEpoch++;
      if(!controllerActive&&!pendingMapperStart)return;
      controllerActive=false;
      try{const result=await bridge.request('mapper-stop');if(result.controller)renderController(result.controller);}catch(error){message(error.message,true);}
      clearPreview();
    }
    document.addEventListener('focusin',event=>{if(textEntry(event.target)&&(controllerActive||pendingMapperStart))stopMapper();});
    $('gamingMapperStart').onclick=async()=>{capturing='';renderBindings();await perform('mapper-start',{bindings});};$('gamingMapperStop').onclick=()=>perform('mapper-stop');
    section.querySelectorAll('[name=gamingInputMode]').forEach(input=>input.onchange=()=>{const physical=input.value==='physical';$('gamingKeyboardEditor').hidden=physical;$('gamingPhysicalHelp').hidden=!physical;if(physical)stopMapper();});
    $('gamingProfiles').onchange=async()=>{await stopMapper();profileIndex=Number($('gamingProfiles').value);const profile=profiles[profileIndex];bindings={...(profile?.bindings||engine.DEFAULT_BINDINGS)};$('gamingProfileName').value=profile?.name||'Default';capturing='';renderBindings();};
    $('gamingNewProfile').onclick=async()=>{await stopMapper();profileIndex=-1;bindings={...engine.DEFAULT_BINDINGS};$('gamingProfileName').value='New profile';renderProfiles();renderBindings();};
    $('gamingSaveProfile').onclick=()=>{try{const profile=parseProfile(JSON.stringify({version:1,name:$('gamingProfileName').value,bindings}),engine.validateBindings);const next=profiles.slice();if(profileIndex<0)next.push(profile);else next[profileIndex]=profile;saveProfiles(root.localStorage,next,engine.validateBindings);profiles=next;if(profileIndex<0)profileIndex=profiles.length-1;renderProfiles();message('Profile saved on this device.');}catch(error){message(error.message,true);}};
    $('gamingDeleteProfile').onclick=()=>{if(profileIndex<0)return;try{const next=profiles.filter((_,index)=>index!==profileIndex);saveProfiles(root.localStorage,next,engine.validateBindings);profiles=next;profileIndex=-1;renderProfiles();message('Saved profile deleted. Current bindings are still available to export.');}catch(error){message(error.message,true);}};
    $('gamingReset').onclick=async()=>{await stopMapper();bindings={...engine.DEFAULT_BINDINGS};capturing='';renderBindings();message('Default bindings restored. Save to update your profile.');};
    $('gamingImport').onclick=()=>$('gamingImportFile').click();$('gamingImportFile').onchange=async()=>{const input=$('gamingImportFile'),file=input.files[0];input.value='';if(!file)return;try{if(file.size>16384)throw Error('Choose a mapping profile smaller than 16 KiB.');const profile=parseProfile(await file.text(),engine.validateBindings);await stopMapper();bindings=profile.bindings;$('gamingProfileName').value=profile.name;profileIndex=-1;renderProfiles();renderBindings();message('Profile imported. Save it to keep it on this device.');}catch(error){message(error.message,true);}};
    $('gamingExport').onclick=()=>{try{const profile=parseProfile(JSON.stringify({version:1,name:$('gamingProfileName').value,bindings}),engine.validateBindings);const url=URL.createObjectURL(new Blob([JSON.stringify(profile,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='vumiro-controller.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Mapping profile exported.');}catch(error){message(error.message,true);}};
    const heartbeat=setInterval(()=>{if(controllerActive){const epoch=mapperEpoch;bridge.request('mapper-heartbeat').then(result=>{if(epoch===mapperEpoch&&controllerActive&&result?.controller)renderController(result.controller);}).catch(error=>{if(epoch!==mapperEpoch)return;controllerActive=false;clearPreview();badge('gamingMapperStatus','Connection lost');message(error.message,true);});}},1000);
    const polling=setInterval(()=>{if(opened&&!busy)perform('status',{},false);},5000);
    root.addEventListener('pagehide',()=>{clearInterval(heartbeat);clearInterval(polling);if(controllerActive)bridge.request('mapper-stop').catch(()=>{});bridge.dispose();});
    root.addEventListener('vumiro-host-ready',()=>{if(opened)refresh();});
    makeDiagram();renderBindings();renderProfiles();root.VumiroI18n?.refresh(section);root.VumiroI18n?.refresh(nav);root.VumiroI18n?.refresh($('gamingSubnav'));
    api.open=open;api.close=close;
  };
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='object'?window:null);
