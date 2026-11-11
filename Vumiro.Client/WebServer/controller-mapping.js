(function (root, factory) {
  'use strict';
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  if (root) root.VumiroControllerMapping = engine;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const DEFAULT_BINDINGS = Object.freeze({
    leftUp:'KeyW',leftDown:'KeyS',leftLeft:'KeyA',leftRight:'KeyD',
    rightUp:'ArrowUp',rightDown:'ArrowDown',rightLeft:'ArrowLeft',rightRight:'ArrowRight',
    a:'Space',b:'KeyE',x:'KeyR',y:'KeyF',lb:'KeyQ',rb:'KeyC',lt:'ShiftLeft',rt:'ControlLeft',
    back:'Tab',start:'Enter',ls:'KeyZ',rs:'KeyX',dpadUp:'Digit1',dpadDown:'Digit2',dpadLeft:'Digit3',dpadRight:'Digit4'
  });
  const flags = Object.freeze({dpadUp:1,dpadDown:2,dpadLeft:4,dpadRight:8,start:16,back:32,ls:64,rs:128,lb:256,rb:512,a:4096,b:8192,x:16384,y:32768});
  const codes = new Set(['Space','Tab','Enter','Backspace','ShiftLeft','ShiftRight','ControlLeft','ControlRight','AltLeft','AltRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown','Insert','Delete','NumpadEnter','NumpadAdd','NumpadSubtract','NumpadMultiply','NumpadDivide','NumpadDecimal','Minus','Equal','BracketLeft','BracketRight','Backslash','Semicolon','Quote','Backquote','Comma','Period','Slash']);
  for(let i=0;i<26;i++) codes.add('Key'+String.fromCharCode(65+i));
  for(let i=0;i<10;i++){codes.add('Digit'+i);codes.add('Numpad'+i);}
  for(let i=1;i<=12;i++) codes.add('F'+i);
  function validateBindings(input) {
    const errors=[], bindings={}, used=new Set();
    if(!input || typeof input!=='object' || Array.isArray(input)) return {valid:false,errors:['Bindings must be an object.'],bindings};
    for(const target of Object.keys(input)) {
      const code=input[target];
      if(!Object.prototype.hasOwnProperty.call(DEFAULT_BINDINGS,target)){errors.push('Unknown control: '+target);continue;}
      if(typeof code!=='string' || (code!==''&&!codes.has(code))){errors.push('Unsupported key for '+target);continue;}
      if(code && used.has(code)){errors.push('Duplicate key: '+code);continue;}
      if(code)used.add(code);
      bindings[target]=code;
    }
    return {valid:errors.length===0,errors,bindings};
  }
  function frameFromKeys(input, keys) {
    const frame={buttons:0,leftX:0,leftY:0,rightX:0,rightY:0,leftTrigger:0,rightTrigger:0};
    const validation=validateBindings(input);
    if(!validation.valid || !keys || typeof keys.has!=='function')return frame;
    const b=validation.bindings, down=t=>!!b[t]&&keys.has(b[t]);
    for(const side of ['left','right']) {
      const x=Number(down(side+'Right'))-Number(down(side+'Left'));
      const y=Number(down(side+'Up'))-Number(down(side+'Down'));
      const scale=x&&y ? Math.floor(32767/Math.sqrt(2)) : 32767;
      frame[side+'X']=Math.round(x*scale); frame[side+'Y']=Math.round(y*scale);
    }
    for(const target of Object.keys(flags))if(down(target))frame.buttons|=flags[target];
    // Opposite D-pad directions are also neutral.
    if((frame.buttons&3)===3)frame.buttons&=~3;
    if((frame.buttons&12)===12)frame.buttons&=~12;
    frame.leftTrigger=down('lt')?255:0; frame.rightTrigger=down('rt')?255:0;
    return frame;
  }
  function frameFromGamepad(pad) {
    const frame={buttons:0,leftX:0,leftY:0,rightX:0,rightY:0,leftTrigger:0,rightTrigger:0};
    if(!pad?.connected||pad.mapping!=='standard')return frame;
    const limit=(value,min,max)=>Math.max(min,Math.min(max,Math.round(value)));
    const buttons=[4096,8192,16384,32768,256,512,0,0,32,16,64,128,1,2,4,8];
    buttons.forEach((flag,index)=>{if(pad.buttons?.[index]?.pressed)frame.buttons|=flag;});
    const axis=(index,invert=false)=>{const value=pad.axes?.[index];return typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)>.12?limit((invert?-value:value)*32767,-32768,32767):0;};
    frame.leftX=axis(0);frame.leftY=axis(1,true);frame.rightX=axis(2);frame.rightY=axis(3,true);
    for(const [name,index]of [['leftTrigger',6],['rightTrigger',7]]){const value=pad.buttons?.[index]?.value;frame[name]=typeof value==='number'&&Number.isFinite(value)?limit(value*255,0,255):0;}
    return frame;
  }
  return Object.freeze({DEFAULT_BINDINGS,validateBindings,frameFromKeys,frameFromGamepad});
});
