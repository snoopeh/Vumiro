import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {bundles} from '../scripts/bundle-client-web.mjs';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('marketplace entry and shared engine ship to every desktop host and frozen updater bundles',()=>{
  const html=read('Vumiro.Client/WebServer/friends.html');
  for(const name of ['community-themes.js','profile-cosmetics.js','profile-style-samples.js','profile-style-studio.js','community-studio.js','marketplace-studio-entry.js','marketplace-model.js','marketplace-client.js','marketplace-external.js','marketplace-entry.js']){
    assert.ok(html.includes(`src="/${name}"`),`${name} loaded by main app`);
    assert.ok(Object.values(bundles).flat().includes(name),`${name} bundled for existing updater contracts`);
    for(const manifest of ['cloudflare/prepare-assets.mjs','cloudflare/worker.js','Vumiro.Linux/build/prepare-assets.mjs','Vumiro.Linux/main.cjs'])assert.ok(read(manifest).includes(name),`${manifest} includes ${name}`);
  }
  assert.ok(html.includes('id="marketplaceNav"'));assert.ok(html.includes('id="marketplaceWorkspace"'));
});

test('profile editor styles entry preserves its draft form and loads samples before marketplace catalog',()=>{const html=read('Vumiro.Client/WebServer/friends.html');assert.match(html,/<button type="button" id="profileStyleOpen"[^>]*>Profile styles<\/button>/);assert.ok(html.indexOf('src="/profile-style-samples.js"')<html.indexOf('src="/marketplace-model.js"'));assert.ok(html.indexOf('src="/marketplace-entry.js"')<html.indexOf('src="/profile-style-studio.js"'));});
