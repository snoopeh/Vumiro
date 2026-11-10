import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source = fs.readFileSync(new URL('../Vumiro.Client/WebServer/profile-cover.js', import.meta.url), 'utf8');
function png(width = 900, height = 300) {
  const bytes = new Uint8Array(32), v = new DataView(bytes.buffer);
  bytes.set([137,80,78,71,13,10,26,10]); v.setUint32(8, 13);
  bytes.set(new TextEncoder().encode('IHDR'), 12); v.setUint32(16, width); v.setUint32(20, height);
  return bytes;
}
function harness(options = {}) {
  const state = {closed: 0, draws: [], encodes: [], revoked: [], created: []};
  const sandbox = {Blob, TextEncoder, Uint8Array, DataView, crypto: webcrypto, btoa,
    URL: {createObjectURL(blob) { const url = `blob:test-${state.created.length}`; state.created.push({url, blob}); return url; }, revokeObjectURL(url) { state.revoked.push(url); }},
    async createImageBitmap(blob) {
      const size = sandbox.VumiroCoverMedia.rasterSize(new Uint8Array(await blob.arrayBuffer()), blob.type);
      return {...(size || {width: 900, height: 300}), close() { state.closed++; }};
    },
    document: {createElement() {
      const canvas = {width: 0, height: 0,
        getContext() { return {drawImage(...args) { state.draws.push(args); }, getImageData() { return {data: new Uint8Array(options.transparent ? [0,0,0,0] : [0,0,0,255])}; }}; },
        toBlob(callback, type, quality) {
          state.encodes.push({type,quality,width: canvas.width,height: canvas.height});
          const encoded = options.encode ? options.encode(type, quality, canvas) : new Blob([png(canvas.width, canvas.height)], {type});
          callback(encoded);
        }};
      state.canvas = canvas; return canvas;
    }}
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  return {api: sandbox.VumiroCoverMedia, state, sandbox};
}
async function manifestFor(api, blob = new Blob([png()], {type: 'image/png'}), banner = 'thumbnail') {
  return {version: 1, revision: webcrypto.randomUUID(), digest: await api.digest(blob), mime: blob.type,
    width: 900, height: 300, bytes: blob.size, thumbnailDigest: await api.digest(banner)};
}
test('manifest schema rejects unknown properties, invalid revisions, sizes and formats', async () => {
  const {api} = harness(), manifest = await manifestFor(api);
  assert.equal(api.validateManifest(manifest).width, 900);
  for (const patch of [{extra: 1}, {version: 2}, {revision: 'bad'}, {digest: 'bad'}, {mime: 'image/svg+xml'}, {width: 3841}, {height: 1281}, {bytes: 1024*1024+1}, {bytes: 0}])
    assert.throws(() => api.validateManifest({...manifest, ...patch}));
});
test('raster header parser reads PNG and JPEG dimensions and rejects truncation', () => {
  const {api} = harness(); assert.equal(api.rasterSize(png(), 'image/png').width, 900);
  const jpeg = Uint8Array.from([255,216,255,192,0,7,8,1,44,3,132]);
  assert.equal(api.rasterSize(jpeg, 'image/jpeg').width, 900); assert.equal(api.rasterSize(jpeg, 'image/jpeg').height, 300);
  for (const bytes of [new Uint8Array(), png().slice(0, 20), jpeg.slice(0, 10)])
    assert.equal(api.rasterSize(bytes, bytes[0] === 255 ? 'image/jpeg' : 'image/png'), null);
});
test('blob validation binds content, dimensions and thumbnail, then closes decoded image', async () => {
  const {api, state} = harness(), blob = new Blob([png()], {type: 'image/png'}), manifest = await manifestFor(api, blob);
  await api.validateBlob(manifest, blob, 'thumbnail'); assert.equal(state.closed, 1);
  await assert.rejects(api.validateBlob(manifest, blob, 'different thumbnail'));
  await assert.rejects(api.validateBlob({...manifest, width: 899}, blob, 'thumbnail'));
  const altered = png(); altered[31] = 1;
  await assert.rejects(api.validateBlob(manifest, new Blob([altered], {type: 'image/png'}), 'thumbnail'));
  assert.equal(state.closed, 1);
});
test('high-resolution render remains independent of compatibility thumbnail and retains local original', async () => {
  const {api, state} = harness(), input = new Blob([png(6000,2000)], {type: 'image/png'});
  const result = await api.render(input, {x: 0,y: 0,width: 6000,height: 2000}, {width: 3840,height: 1280}, {thumbnailer: async () => 'tiny preview'});
  assert.equal(result.manifest.width, 3840); assert.equal(result.manifest.height, 1280); assert.equal(result.source, input);
  assert.equal(result.banner, 'tiny preview'); assert.equal(state.encodes.length, 1); assert.equal(state.encodes[0].type, 'image/png');
  assert.equal(state.draws[0][7], 3840); assert.equal(state.draws[0][8], 1280);
  assert.equal(state.closed, 2); assert.equal(state.canvas.width, 0); assert.equal(state.canvas.height, 0);
});
test('render rejects upscaling and invalid crop bounds and frees source bitmap', async () => {
  const {api, state} = harness(), input = new Blob([png()], {type: 'image/png'});
  await assert.rejects(api.render(input,{x: 0,y: 0,width: 900,height: 300},{width: 1800,height: 600}));
  await assert.rejects(api.render(input,{x: -1,y: 0,width: 900,height: 300},{width: 900,height: 300}));
  assert.equal(state.closed, 2); assert.equal(state.encodes.length, 0);
});
test('stale selection aborts after thumbnail work and frees canvas and bitmap', async () => {
  const {api, state} = harness(), input = new Blob([png()], {type: 'image/png'}); let current = true;
  await assert.rejects(api.render(input,{x: 0,y: 0,width: 900,height: 300},{width: 900,height: 300}, {
    isCurrent: () => current, thumbnailer: async () => {current = false; return 'preview';}
  }), /selection changed/);
  assert.equal(state.closed, 1); assert.equal(state.canvas.width, 0);
});
test('transparent oversized output never falls back to JPEG or lower dimensions/quality', async () => {
  const {api, state} = harness({transparent: true, encode: type => new Blob([new Uint8Array(1024*1024+1)], {type})});
  const input = new Blob([png()], {type: 'image/png'});
  await assert.rejects(api.render(input,{x: 0,y: 0,width: 900,height: 300},{width: 900,height: 300}), /1 MiB/);
  assert.deepEqual(state.encodes.map(value => value.type), ['image/png','image/webp','image/webp']);
  assert.deepEqual(state.encodes.slice(1).map(value => value.quality), [.92,.88]);
  assert.ok(state.encodes.every(value => value.width === 900 && value.height === 300));
});
test('display ignores stale lookup, revokes old URLs and preserves preview on storage failure', async () => {
  const {api,state} = harness(), image = {removeAttribute() { delete this.src; }};
  let resolveOld;
  const old = api.display(image,'old','old preview',{validateBanner: value => value, getCover: () => new Promise(resolve => {resolveOld = resolve;})});
  await api.display(image,'new','new preview',{validateBanner: value => value, getCover: async () => ({blob: new Blob(['new'])})});
  resolveOld({blob: new Blob(['old'])}); await old;
  assert.equal(state.created.length,1); assert.equal(image.src,'blob:test-0');
  await api.display(image,'failed','fallback',{validateBanner: value => value, getCover: async () => {throw Error('storage');}});
  assert.equal(image.src,'fallback'); assert.deepEqual(state.revoked,['blob:test-0']);
  await api.display(image,'none','',{}); assert.equal(image.hidden,true); assert.equal(image.src,undefined);
});
