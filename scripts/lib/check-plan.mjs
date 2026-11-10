import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const unique = values => [...new Set(values)].sort();
const isDocumentation = file => /^(?:docs\/.*\.(?:md|txt)|(?:README|COPYING|THIRD-PARTY)(?:\.md)?)$/i.test(file);

function relativePath(file) {
  if (typeof file !== 'string' || !file || /[\0\r\n]/.test(file)) throw new Error('Invalid changed file path');
  const normalized = file.replaceAll('\\', '/').replace(/^\.\//, '');
  if (path.posix.isAbsolute(normalized) || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Changed file path must stay inside the repository: ${file}`);
  }
  return normalized;
}

/** Build a conservative, explicit test list. Omitted changes mean full; [] means no changes. */
export async function createCheckPlan({ root, groups = [], changedFiles, skipBackend = false }) {
  if (!Array.isArray(groups) || (changedFiles !== undefined && !Array.isArray(changedFiles))) {
    throw new Error('Groups and changedFiles must be arrays');
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'scripts/feature-checks.json'), 'utf8'));
  const names = Object.keys(manifest.groups);
  for (const group of groups) {
    if (group !== 'all' && !names.includes(group)) throw new Error(`Unknown check group: ${group}`);
  }
  const allTests = (await readdir(path.join(root, 'tests'), { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.mjs')).map(entry => `tests/${entry.name}`).sort();
  const available = new Set(allTests);
  const selected = new Set(groups.filter(group => group !== 'all'));
  const changed = changedFiles?.map(relativePath) ?? [];
  let full = groups.includes('all') || (changedFiles === undefined && groups.length === 0);
  let reason = full ? 'Full suite requested (default).' : 'No executable changes.';
  let webChanged = false;
  for (const file of changed) {
    if (isDocumentation(file)) continue;
    if (manifest.sharedSources.includes(file)) {
      full = true; reason = `Full suite: shared source ${file}.`; break;
    }
    const owners = names.filter(name => {
      const group = manifest.groups[name];
      return group.sources.includes(file) || group.tests.includes(file);
    });
    if (owners.length === 0) {
      full = true; reason = `Full suite: unclassified path ${file}.`; break;
    }
    for (const owner of owners) selected.add(owner);
    webChanged ||= file.startsWith('Vumiro.Client/WebServer/');
  }
  if (full) {
    return { groups: names, tests: allTests, backend: !skipBackend, native: manifest.nativeChecks, reason, full: true };
  }
  const selectedNames = names.filter(name => selected.has(name));
  const features = selectedNames.map(name => manifest.groups[name]);
  // A classified test deleted in this diff must not become a nonexistent Node input.
  const tests = unique([...features.flatMap(group => group.tests), ...(webChanged ? manifest.webConsumers : [])])
    .filter(file => available.has(file));
  const nativeNames = new Set(features.flatMap(group => group.native));
  if (selectedNames.length) reason = `Feature checks: ${selectedNames.join(', ')}${webChanged ? '; shared web packaging consumers included' : ''}.`;
  return {
    groups: selectedNames,
    tests,
    backend: !skipBackend && features.some(group => group.backend),
    native: manifest.nativeChecks.filter(check => nativeNames.has(check.name)),
    reason,
    full: false
  };
}

/** Include committed, staged, unstaged and untracked paths; disabling rename detection retains both sides. */
export async function changedFilesSince(root, ref) {
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('A Git reference is required');
  async function git(args) {
    try {
      const { stdout } = await execute('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      throw new Error(`Git change detection failed: ${error.stderr?.trim() || error.message}`, { cause: error });
    }
  }
  const commit = (await git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
  const outputs = await Promise.all([
    git(['diff', '--name-only', '--no-renames', '-z', commit, 'HEAD', '--']),
    git(['diff', '--cached', '--name-only', '--no-renames', '-z', '--']),
    git(['diff', '--name-only', '--no-renames', '-z', '--']),
    git(['ls-files', '--others', '--exclude-standard', '-z'])
  ]);
  return unique(outputs.flatMap(output => output.split('\0').filter(Boolean)).map(relativePath));
}
