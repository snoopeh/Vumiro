'use strict';
// This desktop effect never focuses, restores, or captures a user's screen.
module.exports=function createNativeNudge({BrowserWindow,screen,positioningSupported=true,now=Date.now,setInterval:repeat=global.setInterval,clearInterval:stop=global.clearInterval}){
 let active=null;
 function sameBounds(a,b){return ['x','y','width','height'].every(key=>a[key]===b[key]);}
 function restore(){const value=active;if(value?.moving&&!value.win.isDestroyed()&&sameBounds(value.win.getBounds(),value.expected)&&value.win.isVisible()&&!value.win.isMaximized()&&!value.win.isFullScreen()&&!value.win.isMinimized())value.win.setPosition(value.bounds.x,value.bounds.y,false);}
 function cancel(restoreOriginal=true){if(!active)return;stop(active.timer);if(restoreOriginal)restore();if(active.overlay&&!active.overlay.isDestroyed())active.overlay.destroy();active=null;}
 function glow(){
  const value=active;if(!value||value.overlay)return;restore();value.moving=false;
  const bounds=screen.getDisplayMatching(value.bounds).bounds;
  const overlay=value.overlay=new BrowserWindow({...bounds,frame:false,transparent:true,show:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,hasShadow:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  overlay.setIgnoreMouseEvents(true);
  const html=`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}body{box-sizing:border-box;box-shadow:inset 0 0 24px 10px #ffd44880,inset 0 0 70px 22px #ffdf5733;animation:glow .9s ease-out both}@keyframes glow{0%,100%{opacity:0}20%,65%{opacity:1}}</style></head><body></body></html>`;
  overlay.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));overlay.showInactive();
 }
 function start(win,silent){
  if(!positioningSupported)return false;
  if(active){if(silent)glow();return false;}if(win.isDestroyed())return false;
  active={win,bounds:win.getBounds(),started:now(),moving:!silent&&win.isVisible()&&!win.isMinimized()&&!win.isMaximized()&&!win.isFullScreen(),overlay:null,timer:null};
  active.expected={...active.bounds};
  if(!active.moving)glow();
  active.timer=repeat(()=>{const value=active;if(!value)return;const elapsed=now()-value.started;if(value.moving&&!win.isDestroyed()&&!sameBounds(win.getBounds(),value.expected)){cancel(false);return;}if(elapsed>=900||value.win.isDestroyed()){cancel();return;}
   if(value.moving){if(!win.isVisible()||win.isMinimized()||win.isMaximized()||win.isFullScreen()){value.moving=false;glow();return;}const strength=12*(1-elapsed/900);value.expected={...value.bounds,x:value.bounds.x+Math.round(Math.sin(elapsed*Math.PI/42)*strength),y:value.bounds.y+Math.round(Math.sin(elapsed*Math.PI/65)*strength*.42)};win.setPosition(value.expected.x,value.expected.y,false);}
  },16);return true;
 }
 return {start,cancel,positioningSupported};
};

// Conservative on Wayland sessions, including auto-selected Ozone backends.
// Explicit X11 is supported through Xwayland per Electron documentation.
module.exports.positioningSupported=(environment,ozonePlatform='')=>ozonePlatform==='x11'||(ozonePlatform!=='wayland'&&!environment.WAYLAND_DISPLAY&&environment.XDG_SESSION_TYPE!=='wayland');
