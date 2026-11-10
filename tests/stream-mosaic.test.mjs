import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const htmlUrl = new URL('../Vumiro.Client/WebServer/call.html', import.meta.url);
const roomSource = fs.readFileSync(new URL('../Vumiro.Client/WebServer/call-client.js', import.meta.url), 'utf8');
const layoutStart = roomSource.indexOf('/* Local room layout only.');
const layoutEnd = roomSource.indexOf('/* Vumiro room:', layoutStart);
const layoutSource = layoutStart >= 0 && layoutEnd > layoutStart ? roomSource.slice(layoutStart, layoutEnd) : '';

function mosaic(fakeWindow = {innerHeight: 900, addEventListener(){}, removeEventListener(){}}) {
  const sandbox = {window: fakeWindow};
  vm.runInNewContext(layoutSource, sandbox);
  return fakeWindow.VumiroStreamMosaic || {};
}

test('one to four wide streams choose balanced cells', () => {
  const {plan} = mosaic();
  assert.equal(plan([16 / 9], 1000, 600).columns, 1);
  assert.equal(plan([16 / 9, 16 / 9], 1000, 600).columns, 2);
  assert.equal(plan([16 / 9, 16 / 9, 16 / 9], 1000, 600).columns, 2);
  assert.equal(plan(Array(4).fill(16 / 9), 1000, 600).columns, 2);
});

test('narrow scenes stack streams and preserve usable row heights', () => {
  const {plan} = mosaic();
  const result = plan([16 / 9, 9 / 16, 16 / 9, 16 / 9], 420, 380);
  assert.equal(result.columns, 1);
  assert.ok(result.rowHeight >= 150);
  assert.ok(Number.isFinite(result.rowHeight));
});

test('portrait and late video dimensions change the layout without invalid geometry', () => {
  const {plan} = mosaic();
  const before = plan([0, NaN], 1000, 600);
  const after = plan([9 / 16, 9 / 16], 1000, 600);
  assert.equal(before.columns, 2);
  assert.equal(after.columns, 2);
  assert.ok(before.rowHeight !== after.rowHeight);
  assert.ok(plan([Infinity, -1], 1000, 600).rowHeight > 0);
});

test('mosaic moves existing tiles between video grid and compact participant strip', () => {
  class Element {
    constructor(width = 1000) {
      this.children = []; this.parentNode = null; this.hidden = false; this.width = width;
      this.dataset = {}; this.values = new Set();
      this.classList = {toggle: (name, enabled) => enabled ? this.values.add(name) : this.values.delete(name)};
      this.style = {values: {}, setProperty: (name, value) => { this.style.values[name] = value; }};
    }
    appendChild(child) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      this.children.push(child); child.parentNode = this;
    }
    insertBefore(child, next) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      const at = next ? this.children.indexOf(next) : this.children.length;
      this.children.splice(at, 0, child); child.parentNode = this;
    }
    getBoundingClientRect() { return {width: this.width, top: 100}; }
  }
  const root = new Element(), grid = new Element(), strip = new Element();
  const one = new Element(), two = new Element(), three = new Element();
  const entries = [
    {id: 'one', tile: {element: one, video: {videoWidth: 1920, videoHeight: 1080}, sharing: true}},
    {id: 'two', tile: {element: two, video: {videoWidth: 0, videoHeight: 0}, sharing: false}},
    {id: 'three', tile: {element: three, video: {videoWidth: 1080, videoHeight: 1920}, sharing: true}}
  ];
  const layout = mosaic().create({root, grid, strip});
  layout.update(entries, 'three');
  assert.deepEqual(grid.children, [one, three]);
  assert.deepEqual(strip.children, [two]);
  assert.equal(grid.hidden, false);
  assert.equal(three.values.has('focused'), true);
  assert.equal(one.values.has('focused'), false);
  assert.equal(grid.style.values['--mosaic-columns'], '2');
  const original = two;
  entries[1].tile.sharing = true;
  layout.update(entries, 'two');
  assert.deepEqual(grid.children, [one, original, three]);
  assert.deepEqual(strip.children, []);
  assert.equal(strip.hidden, true);
  entries[0].tile.sharing = false;
  layout.update(entries, 'two');
  assert.deepEqual(grid.children, [original, three]);
  assert.deepEqual(strip.children, [one]);
  // After the last screen stops, idle participants fill the scene in stable order.
  entries[1].tile.sharing = false;
  entries[2].tile.sharing = false;
  // Stale portrait metadata from a stopped screen must not size an avatar card.
  entries[0].tile.video = {videoWidth: 100, videoHeight: 400};
  layout.update(entries, 'two');
  assert.deepEqual(grid.children, [one, two, three]);
  assert.deepEqual(strip.children, []);
  assert.equal(grid.hidden, false);
  assert.equal(strip.hidden, true);
  const idlePlan = mosaic().plan([16 / 9, 16 / 9, 16 / 9], 1000, 640);
  assert.equal(grid.style.values['--mosaic-columns'], String(idlePlan.columns));
  assert.equal(grid.style.values['--mosaic-row-height'], idlePlan.rowHeight + 'px');
  // Restarting a screen returns the same idle nodes to the strip, without replacing media.
  entries[2].tile.sharing = true;
  layout.update(entries, 'three');
  assert.deepEqual(grid.children, [three]);
  assert.deepEqual(strip.children, [one, two]);
  // An empty room hides both containers instead of retaining the previous gallery.
  layout.update([], '');
  assert.equal(grid.hidden, true);
  assert.equal(strip.hidden, true);
  layout.dispose();
});

test('room markup exposes separate video and voice-only containers', () => {
  const html = fs.readFileSync(htmlUrl, 'utf8');
  assert.match(html, /id="streamTiles"/);
  assert.match(html, /id="idleTiles"/);
  assert.doesNotMatch(html, /src="\/stream-mosaic\.js"/);
  assert.match(html, /\.stream-grid \.stage video\{[^}]*object-fit:contain/);
});

test('the room layout fits the existing Windows update file sets', () => {
  const html = fs.readFileSync(htmlUrl, 'utf8');
  const legacy = fs.readFileSync(new URL('../scripts/windows-package-v1.txt', import.meta.url), 'utf8');
  const complete = fs.readFileSync(new URL('../scripts/windows-package-v2.txt', import.meta.url), 'utf8');
  const linux = fs.readFileSync(new URL('../Vumiro.Linux/build/prepare-assets.mjs', import.meta.url), 'utf8');
  const cloudflare = fs.readFileSync(new URL('../cloudflare/prepare-assets.mjs', import.meta.url), 'utf8');
  assert.match(legacy, /^WebServer\/call-client\.js$/m);
  assert.match(complete, /^WebServer\/call-client\.js$/m);
  assert.doesNotMatch(html, /src="\/stream-mosaic\.js"/);
  assert.doesNotMatch(linux, /'stream-mosaic\.js'/);
  assert.doesNotMatch(cloudflare, /'stream-mosaic\.js'/);
});

test('each tile exposes a keyboard select control with pressed state', () => {
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.hidden = false; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const tiles = new Element('section');
  const sandbox = {
    document: {createElement: tag => new Element(tag)},
    $: id => { assert.equal(id, 'tiles'); return tiles; },
    refreshLayout(){}, fallbackAvatar: name => 'fallback:' + name,
    peers: new Map(), selfId: 'self', identity: null, focusedId: '', manualFocus: false
  };
  vm.createContext(sandbox);
  const start = roomSource.indexOf('  function tile('), end = roomSource.indexOf('  function play(', start);
  vm.runInContext(roomSource.slice(start, end), sandbox);
  const tile = sandbox.tile('Mira', true);
  assert.equal(tile.element.tabIndex, -1);
  assert.equal(tile.selectButton.tagName, 'button');
  assert.equal(tile.selectButton.attributes['aria-label'], 'Show controls for Mira');
  assert.equal(tile.selectButton.attributes['aria-pressed'], 'false');
  tile.selectButton.onclick({stopPropagation(){}});
  assert.equal(sandbox.focusedId, 'self');
  assert.equal(sandbox.manualFocus, true);
  const stage = tile.element.children.find(child => child.className === 'stage');
  let fullscreenRequests = 0;
  stage.requestFullscreen = () => { fullscreenRequests++; return Promise.resolve(); };
  stage.ondblclick({preventDefault(){}});
  assert.equal(fullscreenRequests, 0, 'an idle avatar cannot fullscreen an empty video stage');
  tile.show(true);
  stage.ondblclick({preventDefault(){}});
  assert.equal(fullscreenRequests, 1, 'sharing restores fullscreen for the same tile');
});
