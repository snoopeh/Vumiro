(function(root){
 'use strict';
 const paths={
  network:'M5 16v-5h14v5M12 11V6M9 3h6v3H9zM2 16h6v5H2zM9 16h6v5H9zM16 16h6v5h-6z',
  gamepad:'M8 7h8c3 0 4 2 5 7l1 4c.5 3-2 4-4 2l-3-3H9l-3 3c-2 2-4.5 1-4-2l1-4c1-5 2-7 5-7ZM7 10v5M4.5 12.5h5M16 11h.01M19 14h.01',
  sliders:'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
  play:'m9 5 11 7-11 7V5Z',flask:'M9 3h6M10 3v6l-6 9c-1 2 0 3 2 3h12c2 0 3-1 2-3l-6-9V3M7 15h10',
  save:'M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8',
  plus:'M12 5v14M5 12h14',upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  refresh:'M20 7V3l-3 3a8 8 0 1 0 2 11M20 7h-5',leave:'M9 4H4v16h5m5-13 5 5-5 5M8 12h11',
  screen:'M3 4h18v13H3zM8 21h8m-4-4v4',keyboard:'M2 6h20v13H2zM5 10h.01M9 10h.01M13 10h.01M17 10h.01M5 14h.01M9 14h8',
  stop:'M6 6h12v12H6z',audio:'M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  check:'m5 12 4 4L19 6',chevron:'m9 5 7 7-7 7',trash:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
  copy:'M8 8h12v13H8zM4 16V3h12',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3c0-3 3-5 8-5s8 2 8 5v3',edit:'m4 16-1 5 5-1L20 8l-4-4L4 16Zm9-9 4 4',
  info:'M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'
 };
 function icon(name){return Object.hasOwn(paths,name)?`<svg class="uiIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-i18n-skip fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]}"/></svg>`:'';}
 function inputKind(input){
  if(input.type==='radio')return 'radio';if(input.type==='range')return 'range';
  if(input.type!=='checkbox')return '';
  const words=(input.id||'').replace(/([a-z0-9])([A-Z])/g,'$1 $2').split(/[^a-z0-9]+/i);
  if(input.required||input.indeterminate||input.getAttribute?.('role')==='checkbox'||input.getAttribute?.('data-checkbox')!=null||words.some(word=>/^(ack(?:nowledge(?:d|ment)?)?|consent|terms|agree(?:d|ment)?|select(?:ed|ion|all)?|pick(?:ed)?)$/i.test(word)))return 'checkbox';
  return input.closest?.('.settingsScreen,.settingsPanel,.va-dialog,.va-grid,.gamingWorkspace,[data-preferences]')?'switch':'checkbox';
 }
 const css=`
 @property --v-scroll-opacity{syntax:"<number>";inherits:true;initial-value:0}
 :root,*{--v-scroll-opacity:0;scrollbar-width:auto!important;scrollbar-color:auto!important;transition:--v-scroll-opacity .22s ease}
 :root:hover,*:hover,*:focus-visible,*:focus-within,*.v-scrolling{--v-scroll-opacity:1}
 ::-webkit-scrollbar{width:8px;height:8px;background:transparent}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent;border:0;box-shadow:none}::-webkit-scrollbar-button{display:none;width:0;height:0}::-webkit-scrollbar-thumb{background:rgba(225,54,69,var(--v-scroll-opacity));border:2px solid transparent;border-radius:8px;background-clip:padding-box}
 .chat-scroll-custom>#chatLog{scrollbar-width:none!important}.chat-scroll-custom>#chatLog::-webkit-scrollbar{display:none;width:0;height:0}
 @supports not selector(::-webkit-scrollbar){:root,*{scrollbar-width:thin!important;scrollbar-color:rgba(225,54,69,var(--v-scroll-opacity)) transparent!important}}
 @media(prefers-reduced-motion:reduce){:root,*{transition:none}}
 @media(forced-colors:active){:root,*{scrollbar-color:auto!important}::-webkit-scrollbar-thumb{background:Highlight}.chat-scroll-custom>#chatLog{scrollbar-width:auto!important}.chat-scroll-custom>#chatLog::-webkit-scrollbar{display:initial;width:8px}}

 :root{--bg:#0e0e0e;--surface:#151515;--panel:#191919;--raised:#262626;--line:#303030;--muted:#a0a0a0}.uiIcon{width:18px;height:18px;flex:0 0 18px;vertical-align:middle;pointer-events:none}.v-button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;line-height:1.35;white-space:nowrap;border-radius:8px!important;border-color:#ffffff14!important;background:var(--raised,#262626)!important;box-shadow:none!important;text-shadow:none;transition:background .15s,border-color .15s}
 .v-button:hover:not(:disabled){border-color:#ffffff25!important;background:#333!important}.v-button:active:not(:disabled){background:#222!important;box-shadow:none!important}.v-button.primary{color:white!important;background:var(--accent,#e11d2e)!important;border-color:var(--accent,#e11d2e)!important;box-shadow:none!important}.v-button.primary:hover:not(:disabled){background:#ef3041!important}.v-button.quiet{background:transparent!important;box-shadow:none!important;border-color:transparent!important;color:var(--muted,#aaa)}.v-button.quiet:hover:not(:disabled){background:#ffffff06!important}.v-button.danger{color:#ff96a4!important}.v-button:disabled{opacity:.38;box-shadow:none!important;transform:none;cursor:not-allowed}
 button:focus-visible,a:focus-visible,select:focus-visible,textarea:focus-visible,input:focus-visible,[role=button]:focus-visible{outline:2px solid var(--accent,#e11d2e);outline-offset:3px}input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),select,textarea{box-shadow:none;border-color:#ffffff14;transition:border-color .15s,box-shadow .15s}input:not([type=checkbox]):not([type=radio]):not([type=range]):focus,select:focus,textarea:focus{border-color:#e4445566;box-shadow:0 0 0 3px #e11d2e0c}.qaProfileEntry>div:first-child{font-size:10px;letter-spacing:.12em;color:#fa9d87;margin-bottom:20px}.qaProfileEntry h2{font-size:34px}.qaProfileEntry button{margin-top:20px;width:100%}
 input.v-switch{appearance:none!important;-webkit-appearance:none!important;position:relative!important;width:40px!important;min-width:40px!important;height:23px!important;border-radius:99px!important;padding:0!important;margin:0!important;vertical-align:middle;background:#ffffff0a!important;border:1px solid #ffffff20!important;box-shadow:inset 0 1px 3px #0003;cursor:pointer;transition:background .18s,border-color .18s;flex:0 0 40px}input.v-switch::after{content:'';position:absolute;width:17px;height:17px;left:2px;top:2px;border-radius:50%;background:#d7d7d7;box-shadow:0 1px 3px #0004;transition:transform .18s,background .18s}input.v-switch:checked{background:var(--accent,#e11d2e)!important;border-color:#ff667166!important}input.v-switch:checked::after{transform:translateX(16px);background:#fff}input.v-switch:disabled{opacity:.35;cursor:default}input.v-radio{appearance:none!important;width:19px!important;min-width:19px!important;height:19px!important;margin:0!important;padding:0!important;border:1.5px solid #ffffff40!important;border-radius:50%!important;background:transparent!important;box-shadow:none;vertical-align:middle;cursor:pointer;flex:0 0 19px}input.v-radio:checked{border:5px solid var(--accent,#e11d2e)!important;background:#fff!important}input.v-radio:disabled{opacity:.35;cursor:default}
 input.v-range{appearance:none!important;width:100%;height:5px!important;padding:0!important;border:0!important;border-radius:6px;background:linear-gradient(to right,var(--accent,#e11d2e) 0 var(--range-fill,50%),#ffffff14 var(--range-fill,50%) 100%)!important;box-shadow:none;cursor:pointer;vertical-align:middle}input.v-range::-webkit-slider-thumb{appearance:none;width:16px;height:16px;border:2px solid #fff;border-radius:50%;background:#eeeeee;box-shadow:0 1px 4px #0006;transition:box-shadow .15s}input.v-range:hover::-webkit-slider-thumb{box-shadow:0 0 0 5px #e11d2e1c,0 1px 4px #0006}input.v-range:disabled{opacity:.35;cursor:default}.settingsActionRow{padding-block:20px;gap:28px}.settingsSection{margin-block:10px}.settingsPanel .settingsSection>h3{margin-bottom:20px}.settingsGrid{gap:22px}.settingsScreen .check:has(.v-switch){display:flex;align-items:center;justify-content:space-between;gap:24px;padding:12px 0}.settingsScreen .check:has(.v-switch)>.v-switch{order:2}.settingsScreen .check:has(.v-switch)>span{order:1}.settingsScreen .settingsActionRow .v-button{min-height:38px;padding-inline:15px}.v-setting-note{font-size:12px;line-height:1.65;color:var(--muted)}
 @media(prefers-reduced-motion:reduce){.v-button,input.v-switch,input.v-switch::after,input.v-range::-webkit-slider-thumb{transition:none!important}.v-button:active{transform:none!important}}
 `;
 const actionIcons={gamingRefresh:'refresh',gamingLanInvite:'plus',gamingRemoteInvite:'plus',gamingLanLeave:'leave',gamingRemoteLeave:'leave',gamingShare:'screen',gamingStopShare:'stop',gamingPlayAudio:'audio',gamingToMappings:'sliders',gamingApplyMapping:'check',gamingUsePhysical:'gamepad',gamingSaveProfile:'save',gamingNewProfile:'plus',gamingDeleteProfile:'trash',gamingReset:'refresh',gamingImport:'download',gamingExport:'upload',gamingLabTransport:'play',gamingLabCapture:'screen',gamingLabLan:'network',gamingLabController:'gamepad',gamingLabCancel:'stop',gamingLabOpen:'flask',gamingCopyAddress:'copy',emptyAdd:'plus',addFriend:'plus',editProfile:'edit',saveProfile:'save',accountExport:'download',accountSave:'save'};
 const switches=new WeakMap();
 function firstLabelText(node){
  for(const child of node.childNodes||[]){
   if(child.nodeType===3&&child.nodeValue.trim())return child;
   if(child.nodeType===1&&child.tagName?.toLowerCase()!=='svg'&&child.getAttribute?.('aria-hidden')!=='true'){const text=firstLabelText(child);if(text)return text;}
  }
 }
 function enhance(scope=root.document){
  const collect=selector=>[...(scope.matches?.(selector)?[scope]:[]),...(scope.querySelectorAll?.(selector)||[])];
  for(const button of collect('button')){
   if(button.getAttribute?.('role')==='tab'){button.classList.remove('v-button');continue;}
   if(button.closest?.('.nav,.settingsNav,.windowControls,.authWindowControls')||button.classList.contains('gamingClear')||button.hasAttribute?.('data-flat'))continue;
   if(button.closest?.('.gamingWorkspace,.gamingLabDialog,.gamingActions,.settingsBody,.dialogActions,.quickActions,.toolbar,.roomActions,.authCard')||button.classList.contains('primary'))button.classList.add('v-button');
   const name=button.dataset?.uiIcon||actionIcons[button.id];if(name&&!button.querySelector('svg')&&!button.hasAttribute?.('data-i18n')){button.insertAdjacentHTML('afterbegin',icon(name));}
   if(name==='plus'&&button.querySelector('svg')){const label=firstLabelText(button);if(label){const plain=label.nodeValue.replace(/^\s*[+＋]\s+(?=\S)/u,'');if(plain!==label.nodeValue)label.nodeValue=plain;}}
  }
  for(const input of collect('input')){
   const kind=inputKind(input);
   if(kind!=='switch'&&switches.has(input)){
    input.classList.remove('v-switch');
    if(input.getAttribute('role')==='switch'){const previous=switches.get(input);if(previous===null)input.removeAttribute('role');else input.setAttribute('role',previous);}
    switches.delete(input);
   }
   if(kind==='switch'){if(!switches.has(input))switches.set(input,input.getAttribute('role'));input.classList.add('v-switch');input.setAttribute('role','switch');}
   else if(kind==='radio')input.classList.add('v-radio');
   else if(kind==='range'){input.classList.add('v-range');const fill=()=>{const min=Number(input.min)||0,max=input.max===''||!Number.isFinite(Number(input.max))?100:Number(input.max),value=Number(input.value)||0;input.style.setProperty('--range-fill',`${Math.max(0,Math.min(100,(value-min)*100/(max-min||1)))}%`);};fill();if(!input.dataset.rangeStyled){input.addEventListener('input',fill);input.addEventListener('change',fill);input.dataset.rangeStyled='true';}}
  }
 }
 function observeScrolling(document,clock=root){
  const pending=new Map();
  const onScroll=event=>{const node=event.target===document?document.scrollingElement:event.target;if(!node?.classList)return;if(pending.has(node))clock.clearTimeout(pending.get(node));node.classList.add('v-scrolling');pending.set(node,clock.setTimeout(()=>{pending.delete(node);node.classList.remove('v-scrolling');},800));};
  document.addEventListener('scroll',onScroll,true);
  return ()=>{document.removeEventListener('scroll',onScroll,true);for(const [node,timer]of pending){clock.clearTimeout(timer);node.classList.remove('v-scrolling');}pending.clear();};
 }
 const api={icon,inputKind,enhance,css,observeScrolling};if(typeof module==='object'&&module.exports)module.exports=api;
 if(!root?.document)return;root.VumiroControls=Object.freeze(api);
 function init(){const style=root.document.createElement('style');style.id='vumiroControls';style.textContent=css;root.document.head.append(style);enhance();if(root.document.addEventListener){const disposeScroll=observeScrolling(root.document);root.addEventListener?.('pagehide',disposeScroll,{once:true});}if(root.MutationObserver)new root.MutationObserver(records=>{
  const scopes=new Set();
  for(const record of records){
   const target=record.target?.nodeType===3?record.target.parentElement:record.target;
   const button=target?.matches?.('button')?target:target?.closest?.('button');if(button)scopes.add(button);
   for(const node of record.addedNodes)if(node.nodeType===1)scopes.add(node);
  }
  for(const scope of scopes)enhance(scope);
 }).observe(root.document.body,{childList:true,subtree:true,characterData:true});}
 if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window==='object'?window:null);
