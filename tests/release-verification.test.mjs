import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const moduleUrl = new URL('../scripts/lib/release-verification.mjs', import.meta.url);
const load = () => import(moduleUrl);
const repo = 'owner/repo', tag = 'client-v1.2.3', sha = 'a'.repeat(40);
const names = ['Vumiro-win-x64.zip', 'Vumiro-win-x64-v2.zip', 'SHA256SUMS.txt', 'Vumiro-linux-x64.AppImage', 'Vumiro-linux-x64.deb', 'Vumiro-linux-x64.rpm', 'SHA256SUMS-linux.txt'];
const digest = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const bytes = Object.fromEntries(names.map(name => [name, Buffer.from(`fixture ${name}`)]));
  bytes['SHA256SUMS.txt'] = Buffer.from(names.slice(0, 2).map(name => `${digest(bytes[name])}  ${name}`).join('\n') + '\n');
  bytes['SHA256SUMS-linux.txt'] = Buffer.from(names.slice(3, 6).map(name => `${digest(bytes[name])}  ${name}`).join('\n') + '\n');
  const release = { id:91,tag_name: tag, draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z', assets: names.map((name, index) => ({ id: index + 1, name, state: 'uploaded', size: bytes[name].length, digest: `sha256:${digest(bytes[name])}`, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` })) };
  return { release, bytes };
}

test('validates exactly seven published stable assets and strict metadata', async () => {
  const { validateReleaseMetadata } = await load();
  const { release } = fixture();
  assert.equal(Object.keys(validateReleaseMetadata(release, { repo, tag })).length, 7);
  const mutations = [r => r.assets.pop(), r => r.assets.push(r.assets[0]), r => r.assets[0].size = 0, r => r.assets[0].digest = null, r => r.assets[1].size = 16 * 1024 * 1024 + 1, r => r.assets[0].browser_download_url += '?download=1', r => r.draft = true, r => r.prerelease = true, r => r.published_at = null, r => r.assets[0].state = 'new'];
  for (const mutate of mutations) { const changed = structuredClone(release); mutate(changed); assert.throws(() => validateReleaseMetadata(changed, { repo, tag })); }
  assert.throws(() => validateReleaseMetadata(release, { repo, tag: 'client-v1.2.3-beta' }));
});

test('actual GitHub draft placeholder URLs are accepted only for one safe repository segment and exact filenames',async()=>{
  const {validateReleaseMetadata}=await load(),{release}=fixture(),placeholder='untagged-1f8443f2f1091daef0a9';
  release.id=440079937;release.tag_name='client-v1.22.3';release.draft=true;release.published_at=null;
  for(const asset of release.assets){asset.url=`https://api.github.com/repos/snoopeh/Vumiro/releases/assets/${asset.id}`;asset.browser_download_url=`https://github.com/snoopeh/Vumiro/releases/download/${placeholder}/${asset.name}`;}
  const options={repo:'snoopeh/Vumiro',tag:'client-v1.22.3',draftCheck:true};
  assert.equal(Object.keys(validateReleaseMetadata(release,options)).length,7);
  const published={...release,draft:false,published_at:'2026-11-10T00:00:00Z'};assert.throws(()=>validateReleaseMetadata(published,{...options,draftCheck:false}),/canonical/);
  for(const mutate of [
    url=>url.replace('https:','http:'),url=>url.replace('github.com','evil.example'),url=>url.replace('github.com/','secret@github.com/'),url=>url.replace('snoopeh/Vumiro','another/repository'),
    url=>url+'?download=1',url=>url+'#fragment',url=>url.replace(placeholder,'untagged-'+('a'.repeat(65))),url=>url.replace(placeholder,'untagged-..'),url=>url.replace(placeholder,placeholder+'%2Fother'),url=>url.replace('/'+names[0],'/other.zip')
  ]){const changed=structuredClone(release);changed.assets[0].browser_download_url=mutate(changed.assets[0].browser_download_url);assert.throws(()=>validateReleaseMetadata(changed,options),/canonical/);}
  const mixed=structuredClone(release);mixed.assets[0].browser_download_url=mixed.assets[0].browser_download_url.replace(placeholder,'untagged-'+('a'.repeat(20)));assert.throws(()=>validateReleaseMetadata(mixed,options),/consistent|same|segment/);
});

test('Windows selection orders numeric versions and ignores ineligible releases', async () => {
  const { selectWindowsRelease } = await load();
  const { release } = fixture();
  function candidate(version) { const r = structuredClone(release); r.tag_name = `client-v${version}`; r.assets.forEach(a => a.browser_download_url = a.browser_download_url.replace(tag, r.tag_name)); return r; }
  const older = candidate('1.2.9'), newer = candidate('1.10.0'), invalid = candidate('99.0.0');
  invalid.assets[1].digest = 'sha256:bad';
  const prerelease = candidate('100.0.0'); prerelease.prerelease = true;
  assert.equal(selectWindowsRelease([older, invalid, newer, prerelease], repo).tag_name, 'client-v1.10.0');
  assert.equal(selectWindowsRelease([invalid, prerelease], repo), null);
});

test('checksum manifests reject duplicates, missing entries, wrong digests, and unsafe names', async () => {
  const { validateChecksumManifest } = await load();
  const { release, bytes } = fixture();
  const assets = Object.fromEntries(release.assets.map(a => [a.name, a]));
  const content = bytes['SHA256SUMS.txt'].toString().replaceAll('\n', '\r\n');
  assert.equal(Object.keys(validateChecksumManifest(content, names.slice(0, 2), assets)).length, 2);
  for (const bad of [content + content, content.split('\r\n')[0], content.replace(/[0-9a-f]/, 'f'), content.replace('Vumiro-win-x64.zip', '../Vumiro-win-x64.zip')]) {
    assert.throws(() => validateChecksumManifest(bad, names.slice(0, 2), assets));
  }
});

test('tag resolution supports lightweight, annotated, nested, and rejects cycles and wrong objects', async () => {
  const { resolveTagCommit } = await load();
  assert.equal(await resolveTagCommit({ type: 'commit', sha }, async () => { throw Error('must not fetch'); }), sha);
  const seen = [];
  assert.equal(await resolveTagCommit({ type: 'tag', sha: 'b'.repeat(40) }, async id => { seen.push(id); return { object: { type: 'commit', sha } }; }), sha);
  assert.equal(seen.length, 1);
  assert.equal(await resolveTagCommit({ type: 'tag', sha: 'b'.repeat(40) }, async id => ({ object: id[0] === 'b' ? { type: 'tag', sha: 'c'.repeat(40) } : { type: 'commit', sha } })), sha);
  await assert.rejects(resolveTagCommit({ type: 'tag', sha }, async () => ({ object: { type: 'tag', sha } })), /cycle/i);
  await assert.rejects(resolveTagCommit({ type: 'tree', sha }, async () => ({})), /commit/i);
});

function transport(f, { staleFeeds = 0, corrupt = null } = {}) {
  const calls = []; let feeds = 0;
  return { calls, fetch: async (url, options) => {
    calls.push({ url: String(url), authorization: options.headers?.Authorization });
    if (String(url).includes('/releases/tags/')) return Response.json(f.release);
    if (String(url).endsWith('/releases/'+f.release.id)) return Response.json(f.release);
    if (String(url).includes('/git/ref/')) return Response.json({ object: { type: 'commit', sha } });
    if (String(url).includes('/releases?')) { feeds++; return Response.json(feeds <= staleFeeds ? [] : [f.release]); }
    if (String(url).endsWith('/releases/latest')) return Response.json(f.release);
    if (String(url).includes('/releases/assets/')) return new Response(f.bytes[f.release.assets.find(a => a.id === Number(new URL(url).pathname.split('/').pop())).name]);
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (name in f.bytes) return new Response(name === corrupt ? Buffer.from('corrupt') : f.bytes[name]);
    throw Error(`Unexpected request ${url}`);
  } };
}

test('complete read-only verification retries feed visibility and verifies all local assets', async () => {
  const { verifyRelease, writeReports } = await load();
  const f = fixture(), http = transport(f, { staleFeeds: 1 });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vumiro-release-'));
  try {
    for (const [name, bytes] of Object.entries(f.bytes)) { const group = name.includes('linux') ? 'linux' : 'windows'; await mkdir(path.join(dir, group), { recursive: true }); await writeFile(path.join(dir, group, name), bytes); }
    let sleeps = 0;
    const report = await verifyRelease({ repo, tag, sha, assetsDir: dir }, { fetch: http.fetch, sleep: async () => { sleeps++; }, token: 'fixture-secret' });
    assert.equal(report.status, 'passed', JSON.stringify(report)); assert.equal(sleeps, 1);
    assert.equal(report.assets.length, 7);
    assert.ok(http.calls.some(c=>c.url.endsWith('/releases/tags/'+tag)),'published verification keeps the published tag endpoint');
    assert.ok(!http.calls.some(c=>c.url.endsWith('/releases/'+f.release.id)));
    assert.equal(http.calls.filter(c => c.url.includes('/releases/download/')).length, 3);
    assert.ok(http.calls.filter(c => c.url.includes('/releases/download/')).every(c => !c.authorization));
    const summary = path.join(dir, 'summary.md');
    await writeFile(summary, 'Existing summary\n');
    await writeReports(report, path.join(dir, 'report'), summary);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'report/release-report.json'))).status, 'passed');
    assert.match(await readFile(path.join(dir, 'report/release-report.md'), 'utf8'), /PASSED/);
    assert.match(await readFile(summary, 'utf8'), /^Existing summary\n## Release verification: PASSED/);
    assert.ok(!JSON.stringify(report).includes('fixture-secret'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('integrity failures are reported without retries and preserve independent diagnostics', async () => {
  const { verifyRelease } = await load();
  const f = fixture(), http = transport(f, { corrupt: 'Vumiro-win-x64-v2.zip' });
  let sleeps = 0;
  const report = await verifyRelease({ repo, tag, sha: 'f'.repeat(40) }, { fetch: http.fetch, sleep: async () => { sleeps++; } });
  assert.equal(report.status, 'failed'); assert.equal(sleeps, 0);
  assert.ok(report.checks.some(c => c.name === 'tag-commit' && c.status === 'failed'));
  assert.ok(report.checks.some(c => c.name === 'windows-download' && c.status === 'failed'));
  assert.ok(report.checks.some(c => c.name === 'linux-checksums' && c.status === 'passed'));
});

test('feed visibility retries have a fixed bound and HTTP failures are never retried', async () => {
  const { verifyRelease } = await load();
  const f = fixture(), http = transport(f, { staleFeeds: 99 });
  let sleeps = 0;
  const report = await verifyRelease({ repo, tag, sha }, { fetch: http.fetch, sleep: async () => { sleeps++; } });
  assert.equal(report.status, 'failed'); assert.equal(sleeps, 3);
  let calls = 0;
  const failed = await verifyRelease({ repo, tag, sha }, { fetch: async () => { calls++; return new Response('', { status: 403 }); }, sleep: async () => { throw Error('must not retry'); } });
  assert.equal(failed.status, 'failed'); assert.ok(calls <= 4);
});

test('CLI can be imported without executing or emitting output', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../scripts/Verify-Release.mjs', import.meta.url).href)})`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '');
});

test('draft verification requires local assets and checks private manifest bytes before promotion', async () => {
  const { verifyRelease, validateOptions, validateReleaseMetadata } = await load();
  const { parseArgs } = await import('../scripts/Verify-Release.mjs');
  const options = parseArgs(['--tag', tag, '--sha', sha, '--repo', repo, '--output', 'out', '--draft-check', '--assets-dir', 'assets']);
  assert.equal(options.draftCheck, true);
  assert.throws(() => validateOptions({ repo, tag, sha, draftCheck: true }), /assets-dir/);
  const f = fixture(); f.release.draft = true; f.release.published_at = null;
  assert.equal(Object.keys(validateReleaseMetadata(f.release, { repo, tag, draftCheck: true })).length, 7);
  assert.throws(() => validateReleaseMetadata(fixture().release, { repo, tag, draftCheck: true }), /draft/i);
  const http = transport(f), dir = await mkdtemp(path.join(os.tmpdir(), 'vumiro-draft-'));
  try {
    for (const [name, bytes] of Object.entries(f.bytes)) await writeFile(path.join(dir, name), bytes);
    const report = await verifyRelease({ repo, tag, sha, assetsDir: dir, draftCheck: true }, { fetch: http.fetch, token: 'draft-secret' });
    assert.equal(report.status, 'passed', JSON.stringify(report)); assert.equal(report.mode, 'draft');
    assert.equal(http.calls.filter(c => c.url.includes('/releases/assets/')).length, 2);
    assert.ok(http.calls.some(c => c.url.includes('/releases?')));
    assert.ok(!http.calls.some(c => c.url.endsWith('/latest') || c.url.includes('/releases/download/')));
    await writeFile(path.join(dir, names[0]), Buffer.alloc(f.bytes[names[0]].length, 0));
    const changed = await verifyRelease({ repo, tag, sha, assetsDir: dir, draftCheck: true }, { fetch: http.fetch, token:'draft-secret' });
    assert.equal(changed.status, 'failed'); assert.ok(changed.checks.some(c => c.name === `local:${names[0]}` && c.status === 'failed'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('authenticated draft discovery succeeds when published-by-tag returns 404 and draft is on a later page',async()=>{
  const {verifyRelease}=await load(),f=fixture();f.release.draft=true;f.release.published_at=null;
  for(const asset of f.release.assets)asset.browser_download_url=`https://github.com/${repo}/releases/download/untagged-1f8443f2f1091daef0a9/${asset.name}`;
  const dir=await mkdtemp(path.join(os.tmpdir(),'vumiro-draft-private-'));
  try{
    for(const [name,bytes]of Object.entries(f.bytes))await writeFile(path.join(dir,name),bytes);
    const calls=[],http=transport(f);
    const report=await verifyRelease({repo,tag,sha,assetsDir:dir,draftCheck:true},{token:'synthetic-push-token',fetch:async(url,options)=>{
      const parsed=new URL(url);calls.push({url,authorization:options.headers.Authorization,accept:options.headers.Accept});
      if(parsed.pathname.includes('/releases/tags/'))return new Response('',{status:404});
      if(parsed.pathname.endsWith('/releases'))return Response.json(parsed.searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>({id:1000+i,tag_name:'unrelated-'+i,draft:false,prerelease:false})):[f.release]);
      return http.fetch(url,options);
    }});
    assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.releaseId,91);
    assert.ok(!calls.some(call=>call.url.includes('/releases/tags/')),'draft mode must not use the published-only endpoint');
    assert.deepEqual(calls.filter(call=>new URL(call.url).pathname.endsWith('/releases')).map(call=>new URL(call.url).searchParams.get('page')),['1','2'],'complete enumeration is shared with the version-order guard');
    assert.ok(calls.some(call=>call.url.endsWith('/releases/91')));
    assert.ok(calls.every(call=>call.authorization==='Bearer synthetic-push-token'));
    assert.ok(calls.filter(call=>call.url.includes('/releases/assets/')).every(call=>call.accept==='application/octet-stream'));
    assert.ok(!JSON.stringify(report).includes('synthetic-push-token'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('draft lookup fails closed on missing credentials, permissions, ambiguity, schema errors or changed release identity',async()=>{
  const {verifyRelease}=await load(),f=fixture();f.release.draft=true;f.release.published_at=null;
  for(const scenario of ['no-token','forbidden','missing','duplicate','invalid-id','invalid-page','oversized-page','changed-id','published-id']){
    const http=transport(f),calls=[];
    const report=await verifyRelease({repo,tag,sha,assetsDir:'unused',draftCheck:true},{token:scenario==='no-token'?'':'synthetic-token',fetch:async(url,options)=>{
      calls.push(url);
      if(new URL(url).pathname.endsWith('/releases')){
        if(scenario==='forbidden')return new Response('',{status:403});
        if(scenario==='missing')return Response.json([]);
        if(scenario==='duplicate')return Response.json([f.release,{...f.release,id:92}]);
        if(scenario==='invalid-id')return Response.json([{...f.release,id:'91'}]);
        if(scenario==='invalid-page')return Response.json({message:'not a page'});
        if(scenario==='oversized-page')return Response.json(Array(101).fill(f.release));
        return Response.json([f.release]);
      }
      if(url.endsWith('/releases/91'))return Response.json({...f.release,...(scenario==='changed-id'?{id:92}:scenario==='published-id'?{draft:false,published_at:'2026-01-01T00:00:00Z'}:{})});
      return http.fetch(url,options);
    }});
    assert.equal(report.status,'failed',scenario);assert.equal(report.checks.find(check=>check.name==='release-metadata').status,'failed',scenario);
    assert.ok(!calls.some(url=>url.includes('/releases/assets/')),scenario+' must not download private assets without valid release discovery');
    if(scenario==='no-token')assert.ok(!calls.some(url=>new URL(url).pathname.endsWith('/releases')),'no unauthenticated draft enumeration');
    if(scenario==='forbidden')assert.equal(calls.filter(url=>new URL(url).pathname.endsWith('/releases')).length,1,'permission errors must not retry');
  }
});

test('draft discovery rejects duplicate exact tags across pages and invalid private asset identifiers',async()=>{
  const {verifyRelease,validateReleaseMetadata}=await load(),f=fixture();f.release.draft=true;f.release.published_at=null;
  const http=transport(f),pages=[];
  const report=await verifyRelease({repo,tag,sha,assetsDir:'unused',draftCheck:true},{token:'synthetic-token',fetch:(url,options)=>{
    if(!url.includes('/releases?'))return http.fetch(url,options);
    const page=Number(new URL(url).searchParams.get('page'));pages.push(page);
    return Response.json(page===1?[f.release,...Array.from({length:99},(_,i)=>({id:1000+i,tag_name:'other-'+i}))]:[{...f.release,id:92}]);
  }});
  assert.equal(report.status,'failed');assert.match(report.checks.find(c=>c.name==='release-metadata').message,/duplicate/i);assert.deepEqual(pages,[1,2]);
  for(const patch of [r=>r.assets[0].id=0,r=>r.assets[0].id='1',r=>r.assets[0].id=r.assets[1].id]){
    const changed=structuredClone(f.release);patch(changed);assert.throws(()=>validateReleaseMetadata(changed,{repo,tag,draftCheck:true}),/asset ID/);
  }
});

test('private draft manifest downloads accept CDN redirects without forwarding API credentials',async()=>{
  const {verifyRelease}=await load(),f=fixture();f.release.draft=true;f.release.published_at=null;
  const dir=await mkdtemp(path.join(os.tmpdir(),'vumiro-draft-cdn-'));
  try{
    for(const [name,bytes]of Object.entries(f.bytes))await writeFile(path.join(dir,name),bytes);
    const calls=[],http=transport(f);
    const report=await verifyRelease({repo,tag,sha,assetsDir:dir,draftCheck:true},{token:'synthetic-token',fetch:(url,options)=>{
      const parsed=new URL(url);calls.push({url,authorization:options.headers.Authorization,accept:options.headers.Accept});
      if(parsed.hostname==='api.github.com'&&parsed.pathname.includes('/releases/assets/'))return new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/fixture/'+parsed.pathname.split('/').pop()}});
      if(parsed.hostname==='release-assets.githubusercontent.com'){const id=Number(parsed.pathname.split('/').pop());return new Response(f.bytes[f.release.assets.find(asset=>asset.id===id).name]);}
      return http.fetch(url,options);
    }});
    assert.equal(report.status,'passed',JSON.stringify(report));
    const cdn=calls.filter(call=>new URL(call.url).hostname==='release-assets.githubusercontent.com');assert.equal(cdn.length,2);assert.ok(cdn.every(call=>!call.authorization&&call.accept==='application/octet-stream'));
    assert.ok(calls.filter(call=>new URL(call.url).hostname==='api.github.com').every(call=>call.authorization==='Bearer synthetic-token'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('draft promotion rejects newer published stable versions using numeric comparison', async () => {
  const { verifyRelease } = await load();
  const f = fixture(); f.release.draft = true; f.release.published_at = null;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vumiro-draft-order-'));
  try {
    for (const [name, bytes] of Object.entries(f.bytes)) await writeFile(path.join(dir, name), bytes);
    for (const scenario of [
      { tag_name: 'client-v1.10.0', draft: false, prerelease: false, reject: true },
      { tag_name: 'client-v1.2.2', draft: false, prerelease: false, reject: false },
      { tag_name: 'client-v1.10.0', draft: true, prerelease: false, reject: false },
      { tag_name: 'client-v1.10.0', draft: false, prerelease: true, reject: false },
      { tag_name: 'client-v1.10.0-beta', draft: false, prerelease: false, reject: false }
    ]) {
      const http = transport(f); let sleeps = 0;
      const report = await verifyRelease({ repo, tag, sha, assetsDir: dir, draftCheck: true }, {
        token:'draft-secret',fetch: (url, options) => url.includes('/releases?') ? Response.json([f.release,{ ...scenario, published_at: scenario.draft ? null : '2026-01-02T00:00:00Z' }]) : http.fetch(url, options),
        sleep: async () => { sleeps++; }
      });
      const guard = report.checks.find(c => c.name === 'draft-version-order');
      assert.equal(guard?.status, scenario.reject ? 'failed' : 'passed', JSON.stringify({ scenario, report }));
      assert.equal(report.status, scenario.reject ? 'failed' : 'passed');
      if (scenario.reject) assert.match(guard.message, /client-v1\.10\.0/);
      assert.equal(sleeps, 0);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('draft promotion scans later pages and fails closed when the enumeration bound is reached', async () => {
  const { verifyRelease } = await load();
  const f = fixture(); f.release.draft = true; f.release.published_at = null;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vumiro-draft-pages-'));
  try {
    for (const [name, bytes] of Object.entries(f.bytes)) await writeFile(path.join(dir, name), bytes);
    for (const scenario of ['newer-second-page', 'full-bound', 'complete-last-page']) {
      const http = transport(f), pages = [];
      const report = await verifyRelease({ repo, tag, sha, assetsDir: dir, draftCheck: true }, {
        token:'draft-secret',
        fetch: (url, options) => {
          if (!url.includes('/releases?')) return http.fetch(url, options);
          const page = Number(new URL(url).searchParams.get('page')); pages.push(page);
          if (scenario === 'newer-second-page' && page === 2) return Response.json([{ tag_name: 'client-v1.10.0', draft: false, prerelease: false, published_at: '2026-01-02T00:00:00Z' }]);
          if (scenario === 'complete-last-page' && page === 5) return Response.json([]);
          return Response.json(Array.from({ length: 100 }, (_,index) => page===1&&index===0?f.release:{ tag_name: 'legacy-release', draft: false, prerelease: false }));
        }, sleep: async () => { throw Error('Draft enumeration must not retry.'); }
      });
      const guard = report.checks.find(c => c.name === 'draft-version-order');
      assert.equal(guard?.status, scenario === 'complete-last-page' ? 'passed' : 'failed', JSON.stringify(report));
      assert.equal(report.status, scenario === 'complete-last-page' ? 'passed' : 'failed');
      if (scenario === 'newer-second-page') assert.deepEqual(pages, [1, 2]);
      else assert.deepEqual(pages, [1, 2, 3, 4, 5]);
      if (scenario === 'full-bound') assert.match(guard.message, /pagination|enumerat|bound/i);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('feed integrity differences fail immediately and unsafe redirects never receive credentials', async () => {
  const { verifyRelease } = await load();
  const f = fixture(), http = transport(f); let sleeps = 0;
  const report = await verifyRelease({ repo, tag, sha }, { fetch: async (url, options) => {
    if (url.includes('/releases?')) { const changed = structuredClone(f.release); changed.assets[0].digest = `sha256:${'0'.repeat(64)}`; return Response.json([changed]); }
    return http.fetch(url, options);
  }, sleep: async () => { sleeps++; } });
  assert.equal(report.status, 'failed'); assert.equal(sleeps, 0);
  assert.ok(report.checks.some(c => c.name === 'updater-feeds' && c.status === 'failed'));
  let offHostCalls = 0;
  const redirected = await verifyRelease({ repo, tag, sha }, { fetch: async (url, options) => {
    if (url.startsWith('https://evil.example/')) offHostCalls++;
    if (url.includes('/releases/download/')) return new Response(null, { status: 302, headers: { location: 'https://evil.example/asset' } });
    return http.fetch(url, options);
  }, token: 'secret' });
  assert.equal(redirected.status, 'failed'); assert.equal(offHostCalls, 0);
});
