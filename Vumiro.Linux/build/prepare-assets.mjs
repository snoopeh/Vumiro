import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(projectDir, '..');
const sourceDir = path.join(repoDir, 'Vumiro.Client', 'WebServer');
const targetDir = path.join(projectDir, 'webserver');
const licenseDir = path.join(projectDir, 'resources', 'legal');
const expectedAssets = [
  'call-client.js',
  'call.html',
  'friends-client.js',
  'friends.html',
  'auth.html',
  'local-profile.js',
  'profile-cover.js',
  'profile-crop.js',
  'cover-editor.js',
  'cover-transfer.js',
  'peer-profile.js',
  'account-client.js',
  'identity-recovery.js'
];

function assertGeneratedPath(candidate, expectedRelative) {
  const resolved = path.resolve(candidate);
  const expected = path.resolve(projectDir, expectedRelative);
  const relative = path.relative(projectDir, resolved).split(path.sep).join('/');
  if (resolved !== expected || relative !== expectedRelative || relative.startsWith('../')) {
    throw new Error(`Refusing to clear unexpected generated path: ${candidate}`);
  }
}

assertGeneratedPath(targetDir, 'webserver');
await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
for (const name of expectedAssets) {
  const source = path.join(sourceDir, name);
  const contents = await readFile(source);
  await writeFile(path.join(targetDir, name), contents);
}

assertGeneratedPath(licenseDir, 'resources/legal');
await rm(licenseDir, { recursive: true, force: true });
await mkdir(licenseDir, { recursive: true });
await cp(path.join(repoDir, 'COPYING'), path.join(licenseDir, 'COPYING'));
await cp(path.join(repoDir, 'THIRD-PARTY.md'), path.join(licenseDir, 'THIRD-PARTY.md'));
await cp(path.join(repoDir, 'Vumiro.Client', 'Brand', 'Sora-OFL.txt'), path.join(licenseDir, 'Sora-OFL.txt'));
await cp(path.join(repoDir, 'docs', 'PRIVACY.md'), path.join(licenseDir, 'PRIVACY.md'));

console.log(`Prepared ${expectedAssets.length} shared assets and license notices for Linux packaging.`);
