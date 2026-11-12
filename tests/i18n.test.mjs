import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(saved, languages=['en'], document) {
  const values=new Map(saved===undefined?[]:[['vumiro.locale',saved]]);
  const app={Intl, console, navigator:{languages}, localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}, setTimeout, clearTimeout};
  if(document)app.document=document;
  app.window=app;vm.createContext(app);
  const path=new URL('../Vumiro.Client/WebServer/i18n.js',import.meta.url);
  if(fs.existsSync(path))vm.runInContext(fs.readFileSync(path,'utf8'),app);
  return {api:app.VumiroI18n,values};
}

test('allowlisted storage and network codes have safe actionable messages in every locale',()=>{
  const {api}=load();
  const codes=['SECURE_STORAGE_UNAVAILABLE','SECURE_STORAGE_UNPROTECTED','SECURE_STORAGE_READ_FAILED','SECURE_STORAGE_WRITE_FAILED','SECURE_STORAGE_DELETE_FAILED','NETWORK_CERTIFICATE','NETWORK_DNS','NETWORK_TIMEOUT','NETWORK_OFFLINE','NETWORK_FAILED'];
  for(const {code:locale} of api.locales){
    api.setLocale(locale);
    for(const code of codes){
      const message=api.error({code,message:'native secret-token from https://private.example'});
      assert.notEqual(message,api.t('Could not complete this request. Try again.'),locale+': '+code);
      assert.doesNotMatch(message,/secret-token|private\.example|ERR_/);
      if(locale!=='en'){api.setLocale('en');const english=api.error({code});api.setLocale(locale);assert.notEqual(message,english);}
    }
  }
  api.setLocale('en');
  assert.match(api.error({code:'SECURE_STORAGE_UNAVAILABLE',backend:'gnome_libsecret'}),/GNOME Keyring/);
  assert.match(api.error({code:'SECURE_STORAGE_UNAVAILABLE',backend:'kwallet6'}),/KWallet/);
  assert.match(api.error({code:'NETWORK_CERTIFICATE'}),/certificate/i);
  assert.equal(api.error({code:'UNRECOGNIZED',message:'secret-token'}),api.t('Could not complete this request. Try again.'));
});

test('Friends and server sandbox labels explain local-only behavior in every language',()=>{
  const {api}=load('pt-BR');
  assert.equal(api.t('Conversations'),'Conversas');
  assert.equal(api.t('Local sandbox'),'Ambiente de testes local');
  assert.equal(api.t('Voice is not connected'),'A voz não está conectada');
  assert.equal(api.t('Only you can see these messages.'),'Só você pode ver estas mensagens.');
  for(const code of ['es','pt-BR','ja','zh-CN','ru']){
    api.setLocale(code);
    for(const key of ['Conversations','Local sandbox','Voice is not connected','Only you can see these messages.'])
      assert.notEqual(api.t(key),key,code+' explains '+key);
  }
});

test('sign out loading describes the pending session transition in every language',()=>{
  const {api}=load();
  for(const code of ['es','pt-BR','ja','zh-CN','ru']){
    api.setLocale(code);
    for(const key of ['Signing out…','Finishing your session. Your local profile stays on this device.'])assert.notEqual(api.t(key),key,code+' translates '+key);
  }
});
test('lobby language selector stays in the settings menu while sign-in keeps its visible control',()=>{
  function fixture(withSidebar,withSettings=false){
    let dialog=null;
    const document={readyState:'complete',documentElement:{},querySelector:selector=>selector==='.sideBottom'?bottom:null,querySelectorAll:selector=>selector==='dialog'&&dialog?[dialog]:[],addEventListener(){}};
    function element(tag){const node={tagName:tag.toUpperCase(),ownerDocument:document,children:[],className:'',attributes:{},setAttribute(key,value){this.attributes[key]=value;},addEventListener(){},append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}},insertBefore(child,before){if(child.parentElement){const existing=child.parentElement.children.indexOf(child);if(existing>=0)child.parentElement.children.splice(existing,1);}const index=this.children.indexOf(before);child.parentElement=this;this.children.splice(index<0?this.children.length:index,0,child);},querySelector(selector){for(const child of this.children){if(selector.startsWith('.')&&child.classList.contains(selector.slice(1)))return child;const found=child.querySelector(selector);if(found)return found;}return null;},get firstChild(){return this.children[0]||null;},get nextSibling(){return this.parentElement?.children[this.parentElement.children.indexOf(this)+1]||null;}};node.classList={contains:name=>node.className.split(' ').includes(name),add:name=>{if(!node.classList.contains(name))node.className+=' '+name;}};return node;}
    document.createElement=element;document.body=element('body');document.head=element('head');
    const bottom=withSidebar?element('section'):null,service=element('div'),profile=element('button');
    if(bottom){bottom.append(service,profile);document.body.append(bottom);}
    const nav=element('nav'),title=element('div'),back=element('button');
    if(withSettings){dialog=element('dialog');nav.className='settingsNav';title.className='settingsNavTitle';back.className='settingsReturn';nav.append(title,back);dialog.append(nav);document.body.append(dialog);}
    return {document,bottom,service,profile,dialog,nav,title,back};
  }
  const lobby=fixture(true);load('pt-BR',['en'],lobby.document);
  assert.equal(lobby.bottom.children.length,2);
  assert.equal(lobby.bottom.children[0],lobby.service);assert.equal(lobby.bottom.children[1],lobby.profile);
  assert.equal(lobby.document.body.children.length,1,'no fixed control overlays the lobby profile');
  const auth=fixture(false);load('en',['en'],auth.document);
  assert.ok(auth.document.body.children[0].classList.contains('vumiro-language'));
  assert.ok(!auth.document.body.children[0].classList.contains('vumiro-language-sidebar'));
  const settings=fixture(false,true);load('en',['en'],settings.document);
  assert.equal(settings.dialog.children.length,1,'settings control stays inside its visible navigation');
  assert.equal(settings.nav.children[0],settings.title);
  assert.ok(settings.nav.children[1].classList.contains('vumiro-language-settings'));
  assert.equal(settings.nav.children[2],settings.back);
});
test('locale resolution respects ordered browser preferences and explicit choice',()=>{
  const {api}=load(undefined,['fr-FR','pt-PT','es']);assert.ok(api,'shared locale API exists');
  assert.equal(api.locale,'pt-BR');assert.equal(api.resolveLocale(['zh-Hant-TW','ru']),'zh-CN');
  assert.equal(load('ja',['ru']).api.locale,'ja');assert.equal(load('broken',['ru']).api.locale,'en');
  assert.equal(api.resolveLocale(['de-DE','ru-RU']),'ru');
});
test('six complete catalogs have identical keys and parameters',()=>{
  const {api}=load();assert.ok(api,'shared locale API exists');
  assert.deepEqual(Array.from(api.locales,item=>item.code),['en','es','pt-BR','ja','zh-CN','ru']);
  assert.ok(Object.keys(api.catalogs.en).length>500,'catalog includes full interface and recovery flows');
  const params=text=>Array.from(text.matchAll(/\{(\w+)\}/g),m=>m[1]).sort();
  for(const {code}of api.locales){
    assert.deepEqual(Object.keys(api.catalogs[code]).sort(),Object.keys(api.catalogs.en).sort());
    for(const [key,value]of Object.entries(api.catalogs.en)){
      assert.equal(typeof api.catalogs[code][key],'string',`${code}: ${key}`);
      assert.ok(api.catalogs[code][key].trim(),`${code}: ${key}`);
      assert.deepEqual(params(api.catalogs[code][key]),params(value),`${code}: ${key}`);
    }
  }
});
test('chat resize and authenticated entry copy are available in all six languages',()=>{
  const {api}=load();
  for(const {code} of api.locales)for(const key of ['Chat and people width','Signing you in…','Opening your lobby.']){
    assert.ok(Object.hasOwn(api.catalogs[code],key),`${code}: ${key}`);
    if(code!=='en')assert.notEqual(api.catalogs[code][key],key);
  }
});
test('room catalogs describe shared app rooms rather than bedrooms',()=>{
  const {api}=load();
  assert.equal(api.catalogs['pt-BR'].Rooms,'Salas');
  assert.equal(api.catalogs.es.Rooms,'Salas');
  for(const code of ['pt-BR','es'])for(const [key,value]of Object.entries(api.catalogs[code])){
    if(/\brooms?\b/i.test(key))assert.doesNotMatch(value,code==='pt-BR'?/\bquartos?\b/i:/\bhabitaci[oó]n(?:es)?\b/i,`${code}: ${key}`);
  }
  assert.equal(api.catalogs['pt-BR']['Room with {name}'],'Sala com {name}');
  assert.equal(api.catalogs['pt-BR']['Room with {p0}'],'Sala com {p0}');
  assert.equal(api.catalogs['pt-BR']['Getting your room ready…'],'Preparando sua sala…');
  assert.equal(api.catalogs['pt-BR']['Reconnecting your room…'],'Reconectando sua sala…');
  assert.equal(api.catalogs['pt-BR']['Reconnect to see your friends’ rooms.'],'Reconecte-se para ver as salas dos seus amigos.');
  assert.equal(api.catalogs['pt-BR']['to your current room.'],'para a sua sala atual.');
  for(const {code}of api.locales)assert.equal(api.catalogs[code]['room-toast {p0}'],'room-toast {p0}','CSS class templates remain literal');
});
test('ambiguous window, audio and room actions retain their application meaning',()=>{
  const {api}=load();
  const expected={
    'es':['Cerrar y minimizar a la bandeja','Inicio de Vumiro','Has salido de la sala','Silenciar todo','Activar audio','Cerrar ajustes de calidad de transmisión','Cerrar ajustes de acceso a la sala'],
    'pt-BR':['Fechar para a bandeja','Início do Vumiro','Saiu da sala','Silenciar tudo','Ativar áudio','Fechar configurações de qualidade da transmissão','Fechar configurações de acesso à sala'],
    'ja':['閉じてトレイに格納','Vumiro ホーム','ルームから退出しました','すべてミュート','受信音声を再開','配信品質の設定を閉じる','ルームアクセス設定を閉じる'],
    'zh-CN':['关闭到系统托盘','Vumiro 主页','已离开房间','全部静音','恢复接收音频','关闭直播画质设置','关闭房间访问设置'],
    'ru':['Закрыть в трей','Главная Vumiro','Вы вышли из комнаты','Отключить весь звук','Включить входящий звук','Закрыть настройки качества трансляции','Закрыть настройки доступа к комнате']
  };
  const keys=['Close to tray','Vumiro home','Left room','Deafen','Undeafen','Close stream quality','Close room access'];
  for(const [code,values]of Object.entries(expected))keys.forEach((key,index)=>assert.equal(api.catalogs[code][key],values[index],`${code}: ${key}`));
  assert.equal(api.catalogs['pt-BR']['Block'],'Bloquear');
  assert.equal(api.catalogs['zh-CN']['Block'],'屏蔽');
  assert.equal(api.catalogs['zh-CN']['Call'],'呼叫');
  assert.equal(api.catalogs['zh-CN']['Connection'],'连接');
  assert.equal(api.catalogs['pt-BR']['Source size'],'Tamanho original');
  assert.equal(api.catalogs.es['Source size'],'Tamaño original');
  assert.equal(api.catalogs.ru['Stop share'],'Остановить демонстрацию экрана');
  assert.equal(api.catalogs['pt-BR']['Your room is getting ready'],'Sua sala está sendo preparada');
  assert.equal(api.catalogs['pt-BR']['Finish your current room or call invitation first.'],'Saia da sala atual ou resolva o convite de chamada primeiro.');
  assert.equal(api.catalogs['zh-CN']['Join a room together. {seconds}s remaining'],'一起加入房间。还剩 {seconds} 秒');
  assert.equal(api.catalogs.ru['Join a room together. {seconds}s remaining'],'Войдите в комнату вместе. Осталось {seconds} с');
});
test('People navigation has localized search, filters and conversation actions in every locale',()=>{
  const {api}=load();
  for(const {code}of api.locales)for(const key of ['People','Search people','People filters','All','Live now','Recent conversations','Offline','Choose someone to start a conversation.','View profile','Conversation actions','Back to people']){
    assert.ok(Object.hasOwn(api.catalogs[code],key),`${code}: ${key}`);
    if(code!=='en')assert.notEqual(api.catalogs[code][key],key,`${code}: ${key}`);
  }
});
test('localized call and reply templates preserve opaque participant names',()=>{
  const hostile='Rooms / Quartos / <img src=x> / {name}';
  for(const {code}of load().api.locales){
    const {api}=load(code);
    for(const key of ['Room with {name}','Reply to {name}','Stream from {name}'])assert.ok(api.t(key,{name:hostile}).includes(hostile),`${code}: ${key}`);
  }
});
test('room counts use complete localized singular and plural phrases',()=>{
  const {api}=load('pt-BR');
  assert.equal(api.t('{count} person',{count:1}),'1 pessoa');
  assert.equal(api.t('{count} people',{count:2}),'2 pessoas');
  assert.equal(api.t('In the room · {count} participant.',{count:1}),'Na sala · 1 participante.');
  assert.equal(api.t('In the room · {count} participants.',{count:2}),'Na sala · 2 participantes.');
  for(const {code}of api.locales)for(const key of ['{count} person','{count} people','In the room · {count} participant.','In the room · {count} participants.','A participant joined · {count} in the room.','A participant left · {count} in the room.'])assert.ok(Object.hasOwn(api.catalogs[code],key),`${code}: ${key}`);
});
test('language choice survives device preference changes and unavailable storage',()=>{
  const {api,values}=load();assert.ok(api);api.setLocale('ru');assert.equal(values.get('vumiro.locale'),'ru');
  assert.equal(api.t('Sign in'),'Войти');assert.equal(api.setLocale('nonsense'),'en');
  assert.equal(load('ru',['ja']).api.locale,'ru');
});
test('unrecognized provider failures have a localized recovery message',()=>{
  const {api}=load('ru');assert.equal(typeof api.error,'function');
  assert.equal(api.error(new Error('An unknown English provider error')),api.t('Could not complete this request. Try again.'));
  assert.equal(api.error(new Error('Your passwords do not match.')),api.t('Your passwords do not match.'));
});
test('parameters remain inert text and formatters use the chosen language',()=>{
  const {api}=load('pt-BR');assert.ok(api);
  assert.equal(api.t('Room with {name}',{name:'<img src=x onerror=alert(1)>'}),'Sala com <img src=x onerror=alert(1)>');
  assert.equal(api.number(1234.5),'1.234,5');
  assert.equal(api.plural(2),'other');assert.equal(api.plural(1),'one');
  assert.ok(api.date(new Date('2026-11-10T12:00:00Z'),{timeZone:'UTC'}).includes('2026'));
  assert.equal(api.t('__proto__'),'__proto__');
  assert.equal(api.t('constructor'),'constructor');
});

test('DOM refresh preserves drafts, user names and chat while updating text and accessible controls',()=>{
  const {api}=load('es');assert.ok(api);
  // Minimal browser-shaped tree; the production walker and binding code run unchanged.
  const document={createTreeWalker(root){const nodes=[];const walk=node=>{for(const child of node.childNodes||[]){nodes.push(child);walk(child);}};walk(root);let i=0;return {nextNode:()=>nodes[i++]||null};}};
  function element(tag,attributes={},children=[]){
    const item={nodeType:1,tagName:tag.toUpperCase(),ownerDocument:document,attributes:{...attributes},childNodes:children,value:'Save profile',
      getAttribute(name){return this.attributes[name]??null;},setAttribute(name,value){this.attributes[name]=value;},querySelectorAll(){return [];},
      matches(selector){return selector.split(',').some(value=>value.trim().toLowerCase()===tag);},
      closest(selector){for(let node=this;node;node=node.parentElement){for(const part of selector.split(',')){if(part==='[data-i18n-skip]'&&'data-i18n-skip'in node.attributes)return node;if(part==='[translate="no"]'&&node.attributes.translate==='no')return node;if(part.startsWith('.')&&String(node.attributes.class||'').split(' ').includes(part.slice(1)))return node;if(part.startsWith('#')&&node.attributes.id===part.slice(1))return node;if(part.toLowerCase()===node.tagName.toLowerCase())return node;}}return null;}};
    for(const child of children)child.parentElement=item;return item;
  }
  const text=value=>({nodeType:3,nodeValue:value,ownerDocument:document});
  const saveText=text('Save profile'),nameText=text('Save profile'),chatText=text('Sign in'),bioText=text('Close');
  const button=element('button',{'aria-label':'Sign in'},[saveText]);
  const name=element('span',{class:'friendName'},[nameText]);
  const chat=element('div',{'data-i18n-skip':''},[chatText]);
  const bio=element('div',{class:'profileBio'},[bioText]);
  const draft=element('input',{placeholder:'Enter your password'});
  const opaqueInput=element('input',{'data-i18n-skip':'',placeholder:'Save profile'});
  const runtimeKey='Your passwords do not match.';
  const spanishError=api.error(new Error(runtimeKey));
  const runtimeError=text(spanishError),opaqueError=text(spanishError);
  const runtimeAlert=element('p',{role:'alert',title:api.t(runtimeKey)},[runtimeError]);
  const runtimeTemplate=text(api.t('Room with {name}',{name:'Save profile'}));
  const runtimeNotice=element('p',{},[runtimeTemplate]);
  const opaqueName=element('span',{'data-i18n-skip':''},[opaqueError]);
  const root=element('main',{},[button,name,chat,bio,draft,opaqueInput,runtimeAlert,opaqueName,runtimeNotice]);
  api.refresh(root);
  assert.notEqual(saveText.nodeValue,'Save profile');assert.notEqual(button.attributes['aria-label'],'Sign in');
  assert.equal(nameText.nodeValue,'Save profile');assert.equal(chatText.nodeValue,'Sign in');assert.equal(bioText.nodeValue,'Close');
  assert.equal(draft.value,'Save profile');assert.notEqual(draft.attributes.placeholder,'Enter your password');
  assert.equal(opaqueInput.attributes.placeholder,'Save profile');
  const spanish=saveText.nodeValue;api.setLocale('ja');api.refresh(root);
  assert.notEqual(saveText.nodeValue,spanish);assert.equal(nameText.nodeValue,'Save profile');
  assert.equal(runtimeError.nodeValue,api.t(runtimeKey),'pretranslated runtime errors follow the new locale');
  assert.equal(runtimeAlert.attributes.title,api.t(runtimeKey),'pretranslated accessible labels follow the new locale');
  assert.equal(runtimeTemplate.nodeValue,api.t('Room with {name}',{name:'Save profile'}),'template parameters remain opaque while the surrounding text changes');
  assert.equal(opaqueError.nodeValue,spanishError,'user text matching a translation stays opaque');
  api.setLocale('en');api.refresh(root);assert.equal(saveText.nodeValue,'Save profile');
  assert.equal(runtimeError.nodeValue,runtimeKey);
  assert.equal(runtimeAlert.attributes.title,runtimeKey);
});

test('new static HTML content cannot silently fall back to English',()=>{
  const {api}=load();assert.ok(api);
  const unchanged=new Set(['Vumiro','Google','Microsoft','Steam','Spotify','Twitch','YouTube','GitHub','Xbox','PRIVACY.md','licenses/PRIVACY.md','B','I','720p','1080p','1440p','2160p · 4K','(Linux).']);
  for(const page of ['auth','friends','call']){
    const source=fs.readFileSync(new URL(`../Vumiro.Client/WebServer/${page}.html`,import.meta.url),'utf8').replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
    for(const match of source.matchAll(/>([^<>]+)</g)){
      const value=match[1].trim().replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
      if(!/[A-Za-z]{3}/.test(value)||unchanged.has(value)||/^(?:https?:|wss?:|vmr?1\.|you@|username#)/.test(value))continue;
      assert.ok(Object.hasOwn(api.catalogs.en,value),`${page}: ${value}`);
    }
  }
});


test('server conversation and channel search controls are localized in every language',()=>{
  const {api}=load('pt-BR');
  assert.equal(api.t('Continue conversation'),'Continuar conversa');
  for(const code of ['es','pt-BR','ja','zh-CN','ru']){
    api.setLocale(code);
    for(const key of ['Continue conversation','Search channels','No channels match your search.','Clear search'])
      assert.notEqual(api.t(key),key,code+' translates '+key);
  }
});

test('marketplace sidebar entry is translated in every supported language',()=>{
  const {api}=load('pt-BR');assert.equal(api.t('Marketplace'),'Mercado');
  for(const code of ['es','pt-BR','ja','zh-CN','ru']){api.setLocale(code);assert.notEqual(api.t('Marketplace'),'Marketplace',code);}
});
