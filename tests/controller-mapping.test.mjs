import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const source = new URL('../Vumiro.Client/WebServer/controller-mapping.js', import.meta.url);
test('mapping module exists', () => assert.ok(fs.existsSync(source), 'controller mapping implementation missing'));
const engine = fs.existsSync(source) ? require(fileURLToPath(source)) : null;
const neutral = { buttons:0,leftX:0,leftY:0,rightX:0,rightY:0,leftTrigger:0,rightTrigger:0 };
test('default mapping is complete and valid', () => {
  assert.ok(engine, 'mapping engine missing');
  assert.equal(Object.keys(engine.DEFAULT_BINDINGS).length, 24);
  assert.equal(engine.validateBindings(engine.DEFAULT_BINDINGS).valid, true);
});
test('empty keys release every controller control', () => {
  assert.ok(engine, 'mapping engine missing');
  assert.deepEqual(engine.frameFromKeys(engine.DEFAULT_BINDINGS,new Set()),neutral);
});
test('WASD maps to normalized left stick and opposite keys cancel', () => {
  assert.ok(engine, 'mapping engine missing');
  const frame=engine.frameFromKeys(engine.DEFAULT_BINDINGS,new Set(['KeyW','KeyD']));
  assert.equal(frame.leftX,23169); assert.equal(frame.leftY,23169);
  assert.ok(Math.hypot(frame.leftX,frame.leftY)<=32767);
  const cancelled=engine.frameFromKeys(engine.DEFAULT_BINDINGS,new Set(['KeyW','KeyS','KeyA','KeyD']));
  assert.deepEqual(cancelled,neutral);
});
test('both sticks, buttons and triggers use XUSB values', () => {
  assert.ok(engine, 'mapping engine missing');
  const b=engine.DEFAULT_BINDINGS;
  const frame=engine.frameFromKeys(b,new Set([b.a,b.lb,b.lt,b.rt,b.rightDown,b.dpadUp]));
  assert.equal(frame.buttons,0x1000|0x100|1);
  assert.equal(frame.rightY,-32767); assert.equal(frame.leftTrigger,255); assert.equal(frame.rightTrigger,255);
});
test('duplicate codes, reserved escape, unknown controls and unsafe codes fail validation', () => {
  assert.ok(engine, 'mapping engine missing');
  for (const bindings of [{a:'KeyZ',b:'KeyZ'},{a:'Escape'},{wat:'KeyZ'},{a:'__proto__'},{a:'F24'},{a:42},null]) {
    assert.equal(engine.validateBindings(bindings).valid,false,JSON.stringify(bindings));
    assert.deepEqual(engine.frameFromKeys(bindings,new Set(['KeyZ'])),neutral);
  }
});
test('partial profiles and unbound controls are accepted without mutating inputs', () => {
  assert.ok(engine, 'mapping engine missing');
  const bindings=Object.freeze({a:'KeyP',b:''});
  assert.equal(engine.validateBindings(bindings).valid,true);
  assert.equal(engine.frameFromKeys(bindings,new Set(['KeyP'])).buttons,0x1000);
});
