import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {lstat, mkdir, readFile, readdir, readlink, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

const generated = new Set(['.git', 'dist', 'node_modules', 'bin', 'obj', '.vs']);
const digest = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.split(path.sep).join('/');
const excluded = name => normalized(name).split('/').some(part => generated.has(part) || part.startsWith('.wrangler'));

export async function snapshotInputs(root) {
  const listing = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  let files;
  if (listing.status === 0) files = [...new Set(listing.stdout.split('\0').filter(Boolean))];
  else {
    files = [];
    async function walk(folder = '') {
      for (const entry of await readdir(path.join(root, folder), {withFileTypes: true})) {
        const relative = normalized(path.join(folder, entry.name));
        if (excluded(relative)) continue;
        if (entry.isDirectory()) await walk(relative);
        else files.push(relative);
      }
    }
    await walk();
  }
  const hash = createHash('sha256');
  let cacheable = true;
  for (const name of files.filter(name => !excluded(name)).sort()) {
    const file = path.join(root, name);
    hash.update(name).update('\0');
    try {
      const info = await lstat(file);
      // External symlink targets cannot safely participate in local reuse.
      if (info.isSymbolicLink()) {
        hash.update('symlink:').update(await readlink(file));
        cacheable = false;
        continue;
      }
      if (!info.isFile()) {
        hash.update('non-file\0');
        cacheable = false;
        continue;
      }
      hash.update(String(info.mode)).update('\0').update(await readFile(file)).update('\0');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('deleted\0');
    }
  }
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
  return {fingerprint: hash.digest('hex'), cacheable, source: revision.status === 0 ? revision.stdout.trim() : null};
}

export function checkKey({root, fingerprint, command, env = process.env, runtime = `${process.version}/${process.platform}/${process.arch}`}) {
  const environment = Object.entries(env).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return digest(JSON.stringify({schema: 1, root: path.resolve(root), fingerprint, command, runtime, environment}));
}

export async function loadReceipt(directory, name, key) {
  try {
    const saved = JSON.parse(await readFile(path.join(directory, `${name}.json`), 'utf8'));
    if (saved.schema !== 1 || saved.key !== key || saved.record.state !== 'passed') return null;
    if (digest(await readFile(saved.record.log)) !== saved.logHash) return null;
    return saved.record;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code) || error instanceof SyntaxError || error instanceof TypeError) return null;
    throw error;
  }
}

export async function saveReceipt(directory, key, record) {
  if (record.state !== 'passed') return;
  await mkdir(directory, {recursive: true});
  const target = path.join(directory, `${record.name}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({schema: 1, key, logHash: digest(await readFile(record.log)), record}) + '\n');
  await rename(temporary, target);
}
