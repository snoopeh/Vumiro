import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = new URL('../Vumiro.Client/WebServer/community-ui.js', import.meta.url);
function load() {
  const window = {};
  const context = vm.createContext({window});
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  return window.VumiroCommunityUI;
}
function safeDocument() {
  return {createElementNS(namespace, tagName) {
    assert.equal(namespace, 'http://www.w3.org/2000/svg');
    assert.ok(['svg', 'path', 'circle', 'rect', 'line', 'polyline'].includes(tagName));
    return {
      namespaceURI: namespace, tagName, attributes: {}, children: [],
      setAttribute(name, value) {
        assert.ok(!/^on/i.test(name), 'SVG must not carry event handlers');
        assert.ok(!['href', 'xlink:href', 'style'].includes(name), 'SVG must not load or execute content');
        this.attributes[name] = String(value);
      },
      append(...children) { this.children.push(...children); },
      set innerHTML(_) { throw Error('Markup parsing is forbidden'); }
    };
  }};
}

test('visual primitives load without accessing a document', () => {
  const ui = load();
  assert.ok(ui, 'shared visual primitive module must be available');
  assert.equal(typeof ui.css, 'string');
  assert.ok(ui.css.length > 0);
  assert.equal(typeof ui.icon, 'function');
});

test('each supported icon is a fresh decorative SVG built with safe DOM calls', () => {
  const ui = load();
  assert.ok(ui, 'shared visual primitive module must be available');
  const document = safeDocument();
  for (const name of ['hash', 'voice', 'folder', 'space', 'chevron', 'plus', 'settings', 'close', 'menu', 'send', 'mic', 'mic-off', 'disconnect', 'home', 'arrow-left', 'search', 'check', 'globe', 'lock', 'more']) {
    const icon = ui.icon(document, name);
    assert.equal(icon.tagName, 'svg', name);
    assert.equal(icon.attributes['aria-hidden'], 'true', name);
    assert.equal(icon.attributes.focusable, 'false', name);
    assert.ok(icon.attributes.viewBox, name);
    assert.ok(icon.children.length > 0, name);
    assert.notEqual(ui.icon(document, name), icon, 'icons may be mounted independently');
  }
});

test('untrusted icon names cannot become SVG markup or URLs', () => {
  const ui = load();
  assert.ok(ui, 'shared visual primitive module must be available');
  const document = safeDocument();
  const fallback = ui.icon(document, 'hash');
  for (const name of ['<script>alert(1)</script>', '__proto__', 'constructor', 'https://example.test/icon.svg', null]) {
    const icon = ui.icon(document, name);
    assert.deepEqual(icon.children.map(n => n.attributes), fallback.children.map(n => n.attributes));
  }
});
