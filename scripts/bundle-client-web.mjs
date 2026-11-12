import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Installed v1/v2 updaters accept an exact file set. Keep small source modules
// during development, but fold them into existing entries in release staging.
export const bundles = {
  'local-profile.js': ['ui-controls.js', 'controller-art.js', 'gaming-view.js', 'gaming-lab.js', 'controller-mapping.js', 'gaming-directory.js', 'gaming-session.js', 'gaming-client.js', 'profile-cover.js', 'profile-crop.js', 'cover-editor.js', 'cover-transfer.js', 'settings-drafts.js', 'motion.js', 'i18n.js', 'notification-center.js', 'nudge.js', 'friend-nudges.js', 'chat-pane.js', 'chat-scrollbar.js', 'chat-storage.js', 'incoming-call.js', 'direct-messages.js', 'direct-chat.js','server-workspace.js','community-ui.js','community-model.js','community-themes.js','community-studio.js','community-theme-sharing.js','community-live.js','community-voice.js','community-workspace.js'],
  'call-client.js': ['stream-mosaic.js'],
  'friends-client.js': ['app-extras.js']
};
export async function bundleClientWeb(webRoot) {
  const pending = [];
  for (const [target, modules] of Object.entries(bundles)) {
    const targetText = await readFile(path.join(webRoot, target), 'utf8');
    if (targetText.startsWith('/* Vumiro packaged modules */')) throw Error('Web assets were already bundled.');
    const inputs = await Promise.all(modules.map(name => readFile(path.join(webRoot, name), 'utf8')));
    pending.push([target, '/* Vumiro packaged modules */\n' + inputs.map((text, i) => `/* ${modules[i]} */\n${text}\n;`).join('\n') + '\n' + targetText]);
  }
  const modules = Object.values(bundles).flat();
  for (const page of ['friends.html', 'call.html', 'auth.html']) {
    let html = await readFile(path.join(webRoot, page), 'utf8');
    for (const name of modules) html = html.replaceAll(`<script src="/${name}"></script>`, '');
    for (const name of modules) if (html.includes(`src="/${name}"`)) throw Error(`Unsupported script tag for ${name} in ${page}.`);
    pending.push([page, html]);
  }
  // Read and validate every input before changing the disposable staging copy.
  for (const [name, contents] of pending) await writeFile(path.join(webRoot, name), contents);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw Error('Pass the copied WebServer staging directory.');
  await bundleClientWeb(path.resolve(process.argv[2]));
}
