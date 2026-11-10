import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const create=require('../Vumiro.Linux/native-nudge.cjs');
function fixture(options={}){let time=0,tick,position={x:100,y:100,width:800,height:600};const overlays=[];class Overlay{constructor(options){this.options=options;overlays.push(this);}setIgnoreMouseEvents(value){this.clickThrough=value;}loadURL(){}showInactive(){this.shown=true;}destroy(){this.dead=true;}isDestroyed(){return !!this.dead;}}
const win={isDestroyed:()=>false,isVisible:()=>true,isMinimized:()=>false,isMaximized:()=>false,isFullScreen:()=>false,getBounds:()=>({...position}),setPosition(x,y){position.x=x;position.y=y;}};
const effect=create({...options,BrowserWindow:Overlay,screen:{getDisplayMatching:()=>({bounds:{x:0,y:0,width:1920,height:1080}})},now:()=>time,setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{tick=null;}});
return {effect,win,overlays,get position(){return position;},step(ms){time=ms;tick?.();}};}
test('Linux nudge changes actual bounds and restores exact start without focus',()=>{const f=fixture();assert.equal(f.effect.start(f.win,false),true);f.step(80);assert.notEqual(f.position.x,100);assert.equal(f.effect.start(f.win,false),false);f.step(901);assert.equal(f.position.x,100);assert.equal(f.position.y,100);});
test('Linux screen glow covers monitor, passes clicks through and closes',()=>{const f=fixture();f.effect.start(f.win,true);assert.equal(f.overlays[0].options.width,1920);assert.equal(f.overlays[0].options.focusable,false);assert.equal(f.overlays[0].clickThrough,true);f.step(901);assert.equal(f.overlays[0].dead,true);});

test('user movement or resize cancels without overriding new geometry',()=>{
 for(const changed of [{x:420,y:220},{width:950,height:700}]){const f=fixture();f.effect.start(f.win,false);f.step(80);Object.assign(f.position,changed);const preserved={...f.position};f.step(120);f.step(950);assert.deepEqual(f.position,preserved);}
});
test('unsupported positioning backend refuses physical shake and monitor overlay',()=>{
 const f=fixture({positioningSupported:false});assert.equal(f.effect.start(f.win,false),false);assert.equal(f.effect.start(f.win,true),false);assert.equal(f.overlays.length,0);assert.deepEqual(f.position,{x:100,y:100,width:800,height:600});
});

test('Wayland capability is disabled unless an explicit X11 backend is selected',()=>{
 assert.equal(create.positioningSupported({WAYLAND_DISPLAY:'wayland-0',XDG_SESSION_TYPE:'wayland'}),false);
 assert.equal(create.positioningSupported({},'wayland'),false);
 assert.equal(create.positioningSupported({XDG_SESSION_TYPE:'x11'}),true);
 assert.equal(create.positioningSupported({WAYLAND_DISPLAY:'wayland-0'},'x11'),true);
});
