import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, '..', 'Vumiro.Linux');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, label) {
  const result = spawnSync(args[0], args.slice(1), {
    cwd: projectDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
}

const unpacked = process.argv.includes('--unpacked');
if (process.argv.slice(2).some(value => value !== '--unpacked')) throw Error('Only --unpacked is supported.');
run([process.execPath, 'build/prepare-assets.mjs'], 'Preparing Linux assets');
run([npm, 'exec', '--', 'electron-builder', '--publish', 'never', ...(unpacked ? ['--dir', '--linux'] : ['--linux', 'AppImage', 'deb', 'rpm']), '--x64'], 'electron-builder');

if (!unpacked) {
  const outputDir = path.resolve(projectDir, '..', 'dist', 'linux-release');
  const expectedArtifacts = [
    'Vumiro-linux-x64.AppImage',
    'Vumiro-linux-x64.deb',
    'Vumiro-linux-x64.rpm'
  ];
  const outputFiles = new Set(await readdir(outputDir));
  const checksumRows = [];
  for (const filename of expectedArtifacts) {
    if (!outputFiles.has(filename)) throw new Error(`Expected Linux package was not created: ${filename}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path.join(outputDir, filename))) hash.update(chunk);
    const digest = hash.digest('hex');
    checksumRows.push(`${digest}  ${filename}`);
  }
  await writeFile(path.join(outputDir, 'SHA256SUMS-linux.txt'), `${checksumRows.join('\n')}\n`, 'utf8');
}
