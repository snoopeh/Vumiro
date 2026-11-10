import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../Vumiro.Client/WebServer/profile-crop.js', import.meta.url), 'utf8'), context);
const {create, bindControls} = context.VumiroProfileCrop;
const make = (options = {}) => create({imageWidth: 3000, imageHeight: 2000, viewportWidth: 600, viewportHeight: 200, ...options});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('cover starts centered at 3:1 and exports high resolution without byte compression', () => {
  const model = make(), crop = model.sourceRect(), size = model.outputSize();
  near(crop.x, 0); near(crop.y, 500); near(crop.width, 3000); near(crop.height, 1000);
  assert.equal(size.width, 3000); assert.equal(size.height, 1000);
  assert.equal(model.outputSize(1920, 640).width, 1920);
  assert.equal(make({imageWidth: 6000, imageHeight: 4000}).outputSize().width, 3840);
});
test('pan and zoom bounds never expose blank areas for landscape, portrait or tiny sources', () => {
  for (const [imageWidth, imageHeight] of [[4000, 1000], [1000, 4000], [3, 1], [5, 7]]) {
    const model = make({imageWidth, imageHeight});
    for (const zoom of [0, 1, 2, 4, 99]) for (const delta of [-1e6, 0, 1e6]) {
      model.zoomTo(zoom); model.pan(delta, -delta);
      const r = model.sourceRect();
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= imageWidth + 1e-8 && r.y + r.height <= imageHeight + 1e-8);
      near(r.width / r.height, 3);
    }
  }
});
test('zoom anchors the pointed source pixel and responsive resize preserves the crop', () => {
  const model = make(); model.zoomTo(2);
  const before = model.snapshot(), sourceX = (200 - before.x) / before.scale, sourceY = (90 - before.y) / before.scale;
  model.zoomTo(3, 200, 90);
  const after = model.snapshot(); near((200 - after.x) / after.scale, sourceX); near((90 - after.y) / after.scale, sourceY);
  const r = model.sourceRect(); model.resize(300, 100);
  for (const key of ['x', 'y', 'width', 'height']) near(model.sourceRect()[key], r[key]);
});
test('small or zoomed crops are never upscaled; reset restores the original framing', () => {
  const model = make({imageWidth: 900, imageHeight: 300});
  assert.equal(model.outputSize().width, 900);
  model.zoomTo(3); assert.equal(model.outputSize().width, 300);
  model.pan(50, -50); model.reset(); near(model.sourceRect().x, 0); assert.equal(model.snapshot().zoom, 1);
});
test('invalid dimensions reject and transient zero layout or non-finite input leaves state intact', () => {
  assert.throws(() => make({imageWidth: 0})); assert.throws(() => make({maxZoom: .5}));
  const model = make(), before = JSON.stringify(model.snapshot());
  model.resize(0, 0); model.pan(NaN, Infinity); model.zoomTo(NaN);
  assert.equal(JSON.stringify(model.snapshot()), before);
});
function element() {
  const listeners = new Map();
  return {style: {}, value: '', clientWidth: 600, clientHeight: 200,
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
    fire(name, values = {}) { const event = {preventDefault() { this.prevented = true; }, ...values}; listeners.get(name)?.(event); return event; },
    focus() {}, setAttribute() {}, setPointerCapture(id) { this.pointer = id; }, hasPointerCapture(id) { return this.pointer === id; }, releasePointerCapture() { this.pointer = null; },
    getBoundingClientRect() { return {left: 0, top: 0, width: 600, height: 200}; }, listeners};
}
test('bindings support keyboard, wheel, pointer cancellation, reset and deterministic cleanup', () => {
  const model = make(), viewport = element(), image = element(), zoomInput = element(), resetButton = element();
  const bound = bindControls({model, viewport, image, zoomInput, resetButton});
  assert.equal(viewport.fire('keydown', {key: '+'}).prevented, true); near(model.snapshot().zoom, 1.1);
  viewport.fire('wheel', {deltaY: -100, deltaMode: 0, clientX: 300, clientY: 100}); assert.ok(model.snapshot().zoom > 1.1);
  const z = model.snapshot().zoom; assert.equal(viewport.fire('wheel', {ctrlKey: true}).prevented, undefined); assert.equal(model.snapshot().zoom, z);
  viewport.fire('pointerdown', {button: 0, pointerId: 1, clientX: 20, clientY: 20});
  viewport.fire('pointermove', {pointerId: 1, clientX: 30, clientY: 50});
  viewport.fire('pointercancel', {pointerId: 1});
  const before = JSON.stringify(model.snapshot()); viewport.fire('pointermove', {pointerId: 1, clientX: 80, clientY: 80});
  assert.equal(JSON.stringify(model.snapshot()), before);
  resetButton.fire('click'); assert.equal(model.snapshot().zoom, 1);
  zoomInput.value = '2'; zoomInput.fire('input'); assert.equal(model.snapshot().zoom, 2);
  bound.destroy(); bound.destroy(); assert.equal(viewport.listeners.size, 0); assert.equal(zoomInput.listeners.size, 0); assert.equal(resetButton.listeners.size, 0);
});

test('saved source crop reopens identically at a different viewport size', () => {
  const first = make(); first.zoomTo(2.7); first.pan(-81, 29);
  const saved = JSON.parse(JSON.stringify(first.sourceRect()));
  const reopened = make({viewportWidth: 339, viewportHeight: 113}); reopened.restoreCrop(saved);
  for (const key of ['x', 'y', 'width', 'height']) near(reopened.sourceRect()[key], saved[key]);
  near(reopened.snapshot().zoom, first.snapshot().zoom);
});
test('invalid saved framing rejects atomically, including aspect and excessive zoom', () => {
  const model = make(), before = JSON.stringify(model.snapshot());
  for (const rect of [null, {}, {x: NaN, y: 0, width: 300, height: 100},
    {x: -1, y: 0, width: 3000, height: 1000}, {x: 2, y: 0, width: 3000, height: 1000},
    {x: 0, y: 0, width: 3000, height: 999}, {x: 0, y: 0, width: 30, height: 10},
    {x: 0, y: 0, width: 0, height: 0}]) {
    assert.throws(() => model.restoreCrop(rect)); assert.equal(JSON.stringify(model.snapshot()), before);
  }
});
test('cover raster dimensions preserve 3:1 exactly without exceeding any source or target limit', () => {
  for (const imageWidth of [901, 1921, 3841, 7001]) {
    const model = make({imageWidth, imageHeight: 2501}); model.zoomTo(1.37);
    for (const [maxWidth, maxHeight] of [[3840, 1280], [1919, 640], [900, 299]]) {
      const out = model.outputSize(maxWidth, maxHeight), crop = model.sourceRect();
      assert.equal(out.width / out.height, 3);
      assert.ok(out.width <= maxWidth && out.height <= maxHeight && out.width <= crop.width && out.height <= crop.height);
    }
  }
  assert.throws(() => make({imageWidth: 1, imageHeight: 1}).outputSize());
});

test('binding resize preserves exact aspect despite rounded DOM height', () => {
  let resize;
  context.ResizeObserver = class { constructor(fn) { resize = fn; } observe() {} disconnect() {} };
  const model = make(), viewport = element();
  const binding = bindControls({model, viewport, image: element()});
  const saved = model.sourceRect(); viewport.clientWidth = 601; viewport.clientHeight = 200;
  resize(); near(model.snapshot().height, 601 / 3);
  for (const key of ['x', 'y', 'width', 'height']) near(model.sourceRect()[key], saved[key]);
  binding.destroy(); delete context.ResizeObserver;
});
test('pointer motion accounts for CSS-scaled viewport coordinates', () => {
  const model = make(); model.zoomTo(2);
  const viewport = element(); viewport.getBoundingClientRect = () => ({left: 0, top: 0, width: 300, height: 100});
  const binding = bindControls({model, viewport, image: element()});
  const initial = model.snapshot();
  viewport.fire('pointerdown', {button: 0, pointerId: 1, clientX: 10, clientY: 10});
  viewport.fire('pointermove', {pointerId: 1, clientX: 20, clientY: 20});
  near(model.snapshot().x - initial.x, 20); near(model.snapshot().y - initial.y, 20);
  binding.destroy();
});
