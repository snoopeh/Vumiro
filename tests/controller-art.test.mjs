import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function load(){const context={window:{}};vm.runInNewContext(readFileSync(new URL('../Vumiro.Client/WebServer/controller-art.js',import.meta.url),'utf8'),context);return context.window.VumiroControllerArt;}
const targets=['leftUp','leftDown','leftLeft','leftRight','rightUp','rightDown','rightLeft','rightRight','a','b','x','y','lb','rb','lt','rt','back','start','ls','rs','dpadUp','dpadDown','dpadLeft','dpadRight'];
test('mapping targets stay aligned with the supported controller mapping engine',()=>{
  const context={window:{}};
  vm.runInNewContext(readFileSync(new URL('../Vumiro.Client/WebServer/controller-mapping.js',import.meta.url),'utf8'),context);
  assert.deepEqual(Object.keys(context.window.VumiroControllerMapping.DEFAULT_BINDINGS).sort(),[...targets].sort());
});
test('renders all 24 mapping targets exactly once with accessible usable hit areas',()=>{
  const art=load(),svg=art.render();
  const controls=[...svg.matchAll(/<(?:path|circle|rect)\b[^>]*\bdata-control="([^"]+)"[^>]*>/g)];
  assert.equal(controls.length,24);assert.deepEqual(controls.map(value=>value[1]).sort(),[...targets].sort());
  for(const [tag] of controls){assert.match(tag,/\btabindex="0"/);assert.match(tag,/\brole="button"/);assert.match(tag,/\baria-label="Map [^"]+"/);assert.match(tag,/\bdata-pressed="false"/);}
  assert.match(svg,/role="group"/);assert.match(svg,/class="gamingController controller-art"/);
});
test('embeds licensed actual Xbox Series geometry and uses a controller-shaped viewBox',()=>{
  const art=load(),svg=art.render();
  const box=/viewBox="([^"]+)"/.exec(svg)[1].split(' ').map(Number);
  assert.ok(box[2]/box[3]>1.4&&box[2]/box[3]<1.9);assert.ok(svg.length>14000&&svg.length<60000);
  assert.match(svg,/data-art-source="xelu-xbox-series"/);assert.equal(art.source.license,'CC0-1.0');
  const original=readFileSync(new URL('../vendor/controller-art/xelu-xbox-series.svg',import.meta.url),'utf8');
  const path=/d="(m 151\.8,-143\.8[^\"]+)"/.exec(original)[1];
  assert.ok(svg.includes(path),'the sourced shell and hardware geometry are retained');
});
test('contains only local vector content with safe scoped painting and no asset fetches',()=>{
  const art=load();for(const svg of [art.render(),art.render({style:'"><script>alert(1)</script>'})]){
    assert.doesNotMatch(svg,/<(?:script|foreignObject|image|feImage|iframe|animate|set)\b/i);
    assert.doesNotMatch(svg,/\bon[a-z]+\s*=/i);assert.doesNotMatch(svg,/(?:href|src)\s*=\s*["'](?!#)/i);
    for(const match of svg.matchAll(/url\(([^)]+)\)/g))assert.match(match[1],/^#[a-z0-9-]+$/i);
    assert.match(svg,/\.controller-art-controls \.control/);assert.match(svg,/\[data-pressed="true"\]/);
  }
});
test('stick directions surround real caps and multiple diagrams have independent paint ids',()=>{
  const art=load(),first=art.render(),second=art.render();
  const firstIds=[...first.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const secondIds=[...second.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(firstIds).size,firstIds.length);assert.ok(firstIds.every(id=>!secondIds.includes(id)));
  for(const match of first.matchAll(/url\(#([^)]+)\)/g))assert.ok(firstIds.includes(match[1]),'all local paint references resolve');
  for(const target of targets.filter(target=>/^(?:left|right)/.test(target)))assert.match(first,new RegExp('<path[^>]+data-control="'+target+'"[^>]+data-stick-ring="true"'));
  assert.doesNotMatch(first,/<text[^>]*>\s*[↑↓←→]\s*<\/text>/);
});
