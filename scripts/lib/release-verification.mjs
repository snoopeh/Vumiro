import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const REQUIRED_ASSETS = Object.freeze([
  'Vumiro-win-x64.zip', 'Vumiro-win-x64-v2.zip', 'SHA256SUMS.txt',
  'Vumiro-linux-x64.AppImage', 'Vumiro-linux-x64.deb', 'Vumiro-linux-x64.rpm', 'SHA256SUMS-linux.txt'
]);
export const WINDOWS_LIMIT = 16 * 1024 * 1024;
const TAG = /^client-v([0-9]+)\.([0-9]+)\.([0-9]+)$/;
const SHA = /^[0-9a-fA-F]{40}$/;
const DIGEST = /^sha256:([0-9a-fA-F]{64})$/;
const fail = message => { throw new Error(message); };
const hex = asset => DIGEST.exec(asset?.digest ?? '')?.[1].toLowerCase();
const canonicalUrl = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateOptions({ repo, tag, sha, draftCheck, assetsDir }) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo ?? '')) fail('--repo must be owner/name.');
  if (!TAG.test(tag ?? '')) fail('--tag must be a stable client-vX.Y.Z tag.');
  if (!SHA.test(sha ?? '')) fail('--sha must be a full 40-character commit SHA.');
  if (draftCheck && !assetsDir) fail('--draft-check requires --assets-dir to verify all seven built files.');
}

function validateAsset(asset, repo, tag) {
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) fail(`${asset.name}: size must be a positive integer.`);
  if (!hex(asset)) fail(`${asset.name}: GitHub SHA256 digest is missing or invalid.`);
  if (asset.state !== 'uploaded') fail(`${asset.name}: asset is not uploaded.`);
  if (asset.browser_download_url !== canonicalUrl(repo, tag, asset.name)) fail(`${asset.name}: download URL is not canonical.`);
  if (asset.name === 'Vumiro-win-x64-v2.zip' && asset.size > WINDOWS_LIMIT) fail(`${asset.name}: exceeds the 16 MiB updater limit.`);
}

export function validateReleaseMetadata(release, { repo, tag, draftCheck = false }) {
  if (!TAG.test(tag ?? '') || release?.tag_name !== tag) fail('Release tag does not match the requested stable tag.');
  if (draftCheck) {
    if (release.draft !== true || release.prerelease !== false) fail('Release must be a stable draft during --draft-check.');
  } else if (release.draft !== false || release.prerelease !== false || !release.published_at || !Number.isFinite(Date.parse(release.published_at))) fail('Release must be published, stable, and not a draft.');
  if (!Array.isArray(release.assets) || release.assets.length !== REQUIRED_ASSETS.length) fail('Release must contain exactly the seven required assets.');
  const assets = Object.create(null);
  for (const asset of release.assets) {
    if (!asset || !REQUIRED_ASSETS.includes(asset.name) || assets[asset.name]) fail('Release has an unexpected or duplicate asset.');
    validateAsset(asset, repo, tag); assets[asset.name] = asset;
  }
  return assets;
}

function compareVersions(a, b) {
  const left = TAG.exec(a)?.slice(1).map(BigInt), right = TAG.exec(b)?.slice(1).map(BigInt);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

// Mirrors ClientUpdates.CheckAsync: only the complete Windows package determines eligibility.
export function selectWindowsRelease(releases, repo) {
  if (!Array.isArray(releases)) fail('Release list is not an array.');
  let selected = null;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease || !TAG.test(release.tag_name ?? '')) continue;
    // System.Version stores each component as a nonnegative Int32.
    if (TAG.exec(release.tag_name).slice(1).some(v => BigInt(v) > 2147483647n)) continue;
    const packages = (Array.isArray(release.assets) ? release.assets : []).filter(a => a?.name === 'Vumiro-win-x64-v2.zip');
    if (packages.length !== 1) continue;
    const asset = packages[0];
    if (asset.browser_download_url !== canonicalUrl(repo, release.tag_name, asset.name) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > WINDOWS_LIMIT || !hex(asset)) continue;
    if (!selected || compareVersions(release.tag_name, selected.tag_name) > 0) selected = release;
  }
  return selected;
}

export function validateChecksumManifest(content, expectedNames, assets) {
  const rows = Object.create(null);
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-fA-F]{64}) [ *]([^\r\n]+)$/.exec(line);
    if (!match || !expectedNames.includes(match[2]) || rows[match[2]]) fail('Checksum manifest contains an invalid, unexpected, or duplicate entry.');
    const [, digest, name] = match;
    if (digest.toLowerCase() !== hex(assets[name])) fail(`${name}: manifest SHA256 differs from GitHub metadata.`);
    rows[name] = digest.toLowerCase();
  }
  if (Object.keys(rows).length !== expectedNames.length) fail('Checksum manifest is missing required package entries.');
  return rows;
}

export async function resolveTagCommit(object, readTag) {
  const seen = new Set();
  for (let depth = 0; depth <= 10; depth++) {
    if (!object || !SHA.test(object.sha ?? '')) fail('Tag contains an invalid object SHA.');
    if (object.type === 'commit') return object.sha.toLowerCase();
    if (object.type !== 'tag') fail('Tag does not resolve to a commit.');
    if (seen.has(object.sha)) fail('Annotated tag cycle detected.');
    seen.add(object.sha);
    object = (await readTag(object.sha)).object;
  }
  fail('Annotated tag nesting exceeds ten levels.');
}

function client({ fetch: fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN } = {}) {
  return async function read(url, { json = false, limit = 4 * 1024 * 1024, allow404 = false } = {}) {
    // One deadline covers headers, redirects, and the entire response body.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      let current = new URL(url);
      for (let redirects = 0; redirects <= 5; redirects++) {
        const api = current.hostname === 'api.github.com';
        if (current.protocol !== 'https:' || current.username || current.password || current.port || !['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(current.hostname)) fail('Download redirect left the allowed GitHub hosts.');
        const headers = { 'User-Agent': 'Vumiro-Release-Verification', Accept: api && json ? 'application/vnd.github+json' : 'application/octet-stream' };
        if (api) { headers['X-GitHub-Api-Version'] = '2022-11-28'; if (token) headers.Authorization = `Bearer ${token}`; }
        let response;
        try { response = await fetchImpl(current.href, { method: 'GET', headers, signal: controller.signal, redirect: 'manual' }); }
        catch { fail(controller.signal.aborted ? 'GitHub request exceeded 30 seconds.' : 'GitHub request failed.'); }
        if (response.status >= 300 && response.status < 400) {
          const next = response.headers.get('location');
          await response.body?.cancel();
          if (!next || redirects === 5) fail('GitHub download has invalid or excessive redirects.');
          current = new URL(next, current); continue;
        }
        if (allow404 && response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok) { await response.body?.cancel(); fail(`GitHub returned HTTP ${response.status}.`); }
        const declared = response.headers.get('content-length');
        if (declared !== null && Number(declared) > limit) { await response.body?.cancel(); fail('GitHub response exceeds the permitted size.'); }
        const chunks = []; let size = 0;
        if (!response.body) fail('GitHub returned an empty response.');
        try {
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > limit) fail('GitHub response exceeds the permitted size.');
            chunks.push(Buffer.from(chunk));
          }
        } catch (error) { if (controller.signal.aborted) fail('GitHub request exceeded 30 seconds.'); throw error; }
        const bytes = Buffer.concat(chunks);
        if (!json) return bytes;
        try { return JSON.parse(bytes.toString('utf8')); } catch { fail('GitHub returned invalid JSON.'); }
      }
    } finally { clearTimeout(timer); }
  };
}

function verifyBytes(bytes, asset) {
  if (bytes.length !== asset.size) fail(`${asset.name}: downloaded size differs from release metadata.`);
  const actual = hashBytes(bytes);
  if (actual !== hex(asset)) fail(`${asset.name}: downloaded SHA256 differs from release metadata.`);
  return { size: bytes.length, sha256: actual };
}

async function findLocalAssets(root) {
  const found = Object.create(null); let visited = 0;
  async function walk(dir, depth) {
    if (depth > 8) fail('Local assets directory nesting exceeds eight levels.');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++visited > 10_000) fail('Local assets directory contains too many entries.');
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(filename, depth + 1);
      else if (entry.isFile() && REQUIRED_ASSETS.includes(entry.name)) {
        if (found[entry.name]) fail(`${entry.name}: multiple local copies found.`);
        found[entry.name] = filename;
      }
    }
  }
  await walk(path.resolve(root), 0); return found;
}

export async function verifyRelease(options, dependencies = {}) {
  const report = { schemaVersion: 1, mode: options.draftCheck ? 'draft' : 'published', status: 'failed', repo: options.repo, tag: options.tag, expectedCommit: options.sha, startedAt: new Date().toISOString(), checks: [], assets: [] };
  const check = async (name, operation) => {
    try { const details = await operation(); report.checks.push({ name, status: 'passed', details }); return details; }
    catch (error) { report.checks.push({ name, status: 'failed', message: error.message }); return null; }
  };
  if (!await check('inputs', () => { validateOptions(options); return { valid: true }; })) return finish();
  const read = client(dependencies), api = `https://api.github.com/repos/${options.repo}`;
  const assets = await check('release-metadata', async () => {
    const release = await read(`${api}/releases/tags/${options.tag}`, { json: true });
    const result = validateReleaseMetadata(release, options);
    report.releaseUrl = `https://github.com/${options.repo}/releases/tag/${options.tag}`;
    report.assets = REQUIRED_ASSETS.map(name => ({ name, size: result[name].size, sha256: hex(result[name]), url: result[name].browser_download_url }));
    return result;
  });
  await check('tag-commit', async () => {
    const ref = await read(`${api}/git/ref/tags/${options.tag}`, { json: true });
    const commit = await resolveTagCommit(ref.object, id => read(`${api}/git/tags/${id}`, { json: true }));
    report.resolvedCommit = commit;
    if (commit !== options.sha.toLowerCase()) fail(`Tag resolves to ${commit}, expected ${options.sha.toLowerCase()}.`);
    return { commit };
  });
  if (options.draftCheck) await check('draft-version-order', async () => {
    let publishedStableReleases = 0, newestPublishedTag = null;
    // Release creation order can differ from version order after failed draft reruns.
    // A full final page cannot prove that a newer version is absent beyond this bound.
    for (let page = 1; page <= 5; page++) {
      const entries = await read(`${api}/releases?per_page=100&page=${page}`, { json: true });
      if (!Array.isArray(entries) || entries.length > 100) fail('Release list is not a valid page of at most 100 entries.');
      for (const release of entries) {
        if (!release || release.draft !== false || release.prerelease !== false || !TAG.test(release.tag_name ?? '')) continue;
        if (!release.published_at || !Number.isFinite(Date.parse(release.published_at))) fail(`${release.tag_name}: published release metadata has an invalid publication time.`);
        publishedStableReleases++;
        if (!newestPublishedTag || compareVersions(release.tag_name, newestPublishedTag) > 0) newestPublishedTag = release.tag_name;
        if (compareVersions(release.tag_name, options.tag) > 0) fail(`Cannot promote ${options.tag}: newer stable release ${release.tag_name} is already published.`);
      }
      if (entries.length < 100) return { pages: page, publishedStableReleases, newestPublishedTag };
    }
    fail('Cannot prove draft version order: release enumeration reached the five-page pagination bound.');
  });
  // Four attempts, 5/10/15 second waits. Only stale/missing feed visibility is retried.
  if (!options.draftCheck) await check('updater-feeds', async () => {
    const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    for (let attempt = 1; attempt <= 4; attempt++) {
      const releases = [];
      for (let page = 1; page <= 5; page++) {
        const entries = await read(`${api}/releases?per_page=100&page=${page}`, { json: true });
        if (!Array.isArray(entries)) fail('Release list is not an array.');
        releases.push(...entries); if (entries.length < 100) break;
      }
      const visible = releases.filter(r => r?.tag_name === options.tag);
      if (visible.length > 1) fail('Release list contains the expected tag more than once.');
      if (visible.length) compareFeedMetadata(visible[0]);
      const selected = selectWindowsRelease(releases, options.repo);
      const latest = await read(`${api}/releases/latest`, { json: true, allow404: true });
      if (latest?.tag_name === options.tag) compareFeedMetadata(latest);
      for (const observed of [selected?.tag_name, latest?.tag_name]) if (observed && compareVersions(observed, options.tag) > 0) fail(`A newer release ${observed} is selected instead of ${options.tag}.`);
      report.feed = { attempts: attempt, windowsSelectedTag: selected?.tag_name ?? null, latestTag: latest?.tag_name ?? null };
      if (selected?.tag_name === options.tag && latest?.tag_name === options.tag) return report.feed;
      if (attempt === 4) fail(`Expected tag was not selected by both feeds after ${attempt} attempts (Windows: ${selected?.tag_name ?? 'none'}; latest: ${latest?.tag_name ?? 'none'}).`);
      await sleep(attempt * 5000);
    }
  });
  if (assets) {
    for (const [name, packages, label] of [
      ['SHA256SUMS.txt', REQUIRED_ASSETS.slice(0, 2), 'windows-checksums'],
      ['SHA256SUMS-linux.txt', REQUIRED_ASSETS.slice(3, 6), 'linux-checksums']
    ]) await check(label, async () => {
      if (options.draftCheck && (!Number.isSafeInteger(assets[name].id) || assets[name].id <= 0)) fail(`${name}: draft asset ID is missing or invalid.`);
      const url = options.draftCheck ? `${api}/releases/assets/${assets[name].id}` : assets[name].browser_download_url;
      const bytes = await read(url, { limit: 64 * 1024 });
      const verified = verifyBytes(bytes, assets[name]);
      const entries = validateChecksumManifest(bytes.toString('utf8'), packages, assets);
      return { ...verified, entries };
    });
    if (!options.draftCheck) await check('windows-download', async () => {
      const asset = assets['Vumiro-win-x64-v2.zip'];
      return verifyBytes(await read(asset.browser_download_url, { limit: WINDOWS_LIMIT }), asset);
    });
    if (options.assetsDir) {
      const local = await check('local-assets-directory', async () => findLocalAssets(options.assetsDir));
      if (local) for (const name of REQUIRED_ASSETS) await check(`local:${name}`, async () => {
        if (!local[name]) fail(`${name}: local asset was not found.`);
        const info = await stat(local[name]);
        if (info.size !== assets[name].size) fail(`${name}: local size differs from release metadata.`);
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(local[name])) hash.update(chunk);
        const actual = hash.digest('hex');
        if (actual !== hex(assets[name])) fail(`${name}: local SHA256 differs from release metadata.`);
        return { size: info.size, sha256: actual };
      });
    }
  } else report.checks.push({ name: 'asset-integrity', status: 'skipped', message: 'Release metadata did not pass validation.' });
  return finish();
  function compareFeedMetadata(release) {
    const candidate = validateReleaseMetadata(release, options);
    if (assets) for (const name of REQUIRED_ASSETS) if (candidate[name].size !== assets[name].size || hex(candidate[name]) !== hex(assets[name])) fail(`${name}: feed metadata differs from the tag release.`);
  }
  function finish() { report.finishedAt = new Date().toISOString(); report.status = report.checks.some(c => c.status === 'failed') ? 'failed' : 'passed'; return report; }
}

export function renderReport(report) {
  const escape = value => String(value ?? '').replace(/[\r\n|]/g, ' ');
  const lines = [`## Release verification: ${report.status.toUpperCase()}`, '', `Tag: \`${escape(report.tag)}\` · Repository: \`${escape(report.repo)}\``, `Commit: \`${escape(report.resolvedCommit ?? report.expectedCommit)}\``, '', '| Check | Result | Detail |', '| --- | --- | --- |'];
  for (const check of report.checks) lines.push(`| ${escape(check.name)} | ${check.status} | ${escape(check.message ?? (check.name === 'updater-feeds' ? `${check.details.attempts} attempt(s)` : ''))} |`);
  lines.push('', `Verified asset metadata: ${report.assets.length}/7.`, '');
  return lines.join('\n');
}

export async function writeReports(report, outputDir, summaryFile = process.env.GITHUB_STEP_SUMMARY) {
  await mkdir(outputDir, { recursive: true });
  const markdown = renderReport(report);
  await writeFile(path.join(outputDir, 'release-report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(outputDir, 'release-report.md'), markdown);
  if (summaryFile) await appendFile(summaryFile, markdown + '\n');
}
