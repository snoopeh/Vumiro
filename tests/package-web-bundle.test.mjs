import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { bundleClientWeb, bundles } from '../scripts/bundle-client-web.mjs';
const source = new URL('../Vumiro.Client/WebServer/', import.meta.url);

test('release staging bundles new modules into the frozen updater file set', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vumiro-package-web-'));
  try {
    await cp(source, root, { recursive: true });
    await bundleClientWeb(root);
    const v2 = (await readFile(new URL('../scripts/windows-package-v2.txt', import.meta.url), 'utf8')).split(/\r?\n/).filter(line=>line && !line.startsWith('#'));
    for (const [target, modules] of Object.entries(bundles)) {
      const text = await readFile(path.join(root, target), 'utf8');
      new vm.Script(text);
      assert.ok(v2.includes('WebServer/'+target));
      for (const name of modules) {
        assert.ok(text.includes(await readFile(new URL(name, source), 'utf8')));
        assert.ok(!v2.includes('WebServer/'+name));
      }
    }
    for (const page of ['friends.html','call.html','auth.html']) {
      const html = await readFile(path.join(root,page),'utf8');
      for (const match of html.matchAll(/<script[^>]+src="\/([^"?]+)"/g)) assert.ok(v2.includes('WebServer/'+match[1]), `Missing packaged script: ${match[1]}`);
    }
    await assert.rejects(bundleClientWeb(root), /already bundled/);
    assert.ok(!(await readFile(new URL('local-profile.js',source),'utf8')).startsWith('/* Vumiro packaged modules */'));
  } finally { await rm(root,{recursive:true,force:true}); }
});
