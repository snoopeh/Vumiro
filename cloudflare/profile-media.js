import { inspectRaster } from './profile-media-raster.js';
const MAX_BYTES = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const fields = ['version', 'revision', 'digest', 'mime', 'width', 'height', 'bytes', 'thumbnailDigest'];
const json = (value, status = 200, cors = {}) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
export function validCover(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)) &&
    value.version === 1 && UUID.test(value.revision) && DIGEST.test(value.digest) && DIGEST.test(value.thumbnailDigest) && ['image/png', 'image/jpeg', 'image/webp'].includes(value.mime) &&
    Number.isInteger(value.width) && value.width > 0 && value.width <= 3840 && Number.isInteger(value.height) && value.height > 0 && value.height <= 1280 && value.width === value.height * 3 && Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_BYTES;
}
export async function mediaDigest(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export const newMediaBudget = () => ({ remaining: 20, used: 0 });
function spend(budget, count) { if (budget.remaining < count) return false; budget.remaining -= count; budget.used += count; return true; }
const currentReference = `EXISTS (SELECT 1 FROM account_data d WHERE d.account_id = account_profile_media.account_id AND json_extract(d.payload, '$.profile.cover.revision') = account_profile_media.revision)`;
export async function cleanupProfileMedia(env, accountId = null, deletingAccount = false, budget = newMediaBudget()) {
  if (!env.PROFILE_MEDIA) return !deletingAccount; // Absence must never silently complete deletion of stored media.
  if (!spend(budget, 2)) return false;
  const db = env.ACCOUNT_DB, cutoff = Date.now() - 3600000;
  const scope = accountId ? ' AND account_id = ?' : '';
  const args = accountId ? [accountId] : [];
  // Claim before object deletion. Snapshot CAS only accepts ready rows, so it cannot resurrect a claimed object.
  await db.prepare(`UPDATE account_profile_media SET state = 'deleting' WHERE rowid IN (SELECT rowid FROM account_profile_media WHERE state = 'ready' AND NOT ${currentReference}${deletingAccount ? '' : ' AND created_at < ?'}${scope} LIMIT 4)`).bind(...(deletingAccount ? [] : [cutoff]), ...args).run();
  const rows = await db.prepare(`SELECT account_id, revision, object_key FROM account_profile_media WHERE state = 'deleting'${scope} LIMIT 4`).bind(...args).all();
  for (const row of rows.results || []) {
    if (!spend(budget, 2)) return false;
    await env.PROFILE_MEDIA.delete(row.object_key);
    await db.prepare("DELETE FROM account_profile_media WHERE account_id = ? AND revision = ? AND state = 'deleting'").bind(row.account_id, row.revision).run();
  }
  // A crashed upload may have written its object before dying. Preserve its row until the object was removed.
  // A bucket-orphan sweep also covers late puts after stale reservation cleanup.
  if (!spend(budget, deletingAccount ? 2 : 1)) return false;
  await db.prepare(`UPDATE account_profile_media SET state = 'deleting' WHERE rowid IN (SELECT rowid FROM account_profile_media WHERE state = 'writing' AND created_at < ?${scope} LIMIT 4)`).bind(cutoff, ...args).run();
  if (!deletingAccount) return true;
  const remaining = await db.prepare('SELECT COUNT(*) AS count FROM account_profile_media WHERE account_id = ?').bind(accountId).first();
  return remaining.count === 0;
}
export async function deleteProfileMedia(env, accountId, budget = newMediaBudget()) {
  // Legacy installations without the optional binding/table retain their original deletion behavior.
  if (!env.PROFILE_MEDIA) {
    try { if (!spend(budget, 1)) return false; const row = await env.ACCOUNT_DB.prepare('SELECT COUNT(*) AS count FROM account_profile_media WHERE account_id = ?').bind(accountId).first(); return row.count === 0; }
    catch (error) { if (/no such table.*account_profile_media/i.test(String(error))) return true; throw error; }
  }
  return cleanupProfileMedia(env, accountId, true, budget);
}
export async function validateCoverReference(env, accountId, profile, allowStoredWithoutBinding = false) {
  if (!Object.hasOwn(profile, 'cover')) return true;
  if ((!env.PROFILE_MEDIA && !allowStoredWithoutBinding) || !validCover(profile.cover) || !profile.banner || await mediaDigest(profile.banner) !== profile.cover.thumbnailDigest) return false;
  const row = await env.ACCOUNT_DB.prepare("SELECT manifest FROM account_profile_media WHERE account_id = ? AND revision = ? AND state = 'ready'").bind(accountId, profile.cover.revision).first();
  return !!row && fields.every(key => JSON.parse(row.manifest)[key] === profile.cover[key]);
}
// Append to account INSERT/UPDATE statements to close validation-versus-cleanup races.
export const coverReadyGuard = `EXISTS (SELECT 1 FROM account_profile_media WHERE account_id = ? AND revision = ? AND state = 'ready' AND manifest = ?)`;
export const canonicalCover = value => JSON.stringify(Object.fromEntries(fields.map(key => [key, value[key]])));
async function readBinary(request) {
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new Error('size');
  if (!request.body) throw new Error('empty');
  const reader = request.body.getReader(), parts = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) { await reader.cancel(); throw new Error('size'); } parts.push(value); } }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
export async function handleProfileMedia(request, env, accountId, cors, deviceId, credentialHash) {
  if (!env.PROFILE_MEDIA) return json({ error: 'Private high-resolution cover backup is not configured.', code: 'profile_media_unavailable' }, 503, cors);
  const path = new URL(request.url).pathname;
  if (path === '/api/v1/account/cover' && request.method === 'POST') {
    let manifest, bytes;
    try {
      const header = request.headers.get('X-Vumiro-Cover-Manifest') || '';
      if (header.length > 1024) throw new Error('manifest');
      manifest = JSON.parse(header);
      if (!validCover(manifest) || request.headers.get('Content-Type') !== manifest.mime || request.headers.has('Content-Encoding')) throw new Error('manifest');
      bytes = await readBinary(request);
      const dimensions = inspectRaster(bytes, manifest.mime);
      if (bytes.length !== manifest.bytes || dimensions.width !== manifest.width || dimensions.height !== manifest.height || await mediaDigest(bytes) !== manifest.digest) throw new Error('digest');
    } catch { return json({ error: 'The rendered cover, dimensions, or digest is invalid.' }, 400, cors); }
    await cleanupProfileMedia(env, accountId);
    const existing = await env.ACCOUNT_DB.prepare('SELECT manifest, state FROM account_profile_media WHERE account_id = ? AND revision = ?').bind(accountId, manifest.revision).first();
    const serialized = canonicalCover(manifest);
    if (existing) return existing.state === 'ready' && existing.manifest === serialized ? json({ cover: manifest }, 200, cors) : json({ error: 'Cover revision already exists. Use a new revision.' }, 409, cors);
    const key = `covers/${accountId}/${crypto.randomUUID()}`;
    const reserved = await env.ACCOUNT_DB.prepare(`INSERT INTO account_profile_media (account_id, revision, object_key, manifest, state, created_at)
      SELECT ?, ?, ?, ?, 'writing', ? WHERE (SELECT COUNT(*) FROM account_profile_media WHERE account_id = ?) < 4 AND NOT EXISTS (SELECT 1 FROM deleted_accounts WHERE account_id = ?)
      ON CONFLICT(account_id, revision) DO NOTHING`).bind(accountId, manifest.revision, key, serialized, Date.now(), accountId, accountId).run();
    if (!reserved.meta?.changes) return json({ error: 'Cover staging is full or this account is being deleted. Try again later.' }, 409, cors);
    try {
      await env.PROFILE_MEDIA.put(key, bytes, { httpMetadata: { contentType: manifest.mime, cacheControl: 'private, no-store' } });
      const result = await env.ACCOUNT_DB.prepare(`UPDATE account_profile_media SET state = 'ready' WHERE account_id = ? AND revision = ? AND state = 'writing' AND NOT EXISTS (SELECT 1 FROM deleted_accounts WHERE account_id = ?) AND EXISTS (SELECT 1 FROM account_devices WHERE account_id = ? AND device_id = ? AND revoked_at IS NULL AND credential_hash = ?)`)
        .bind(accountId, manifest.revision, accountId, accountId, deviceId, credentialHash).run();
      if (!result.meta?.changes) throw new Error('deleted');
    } catch {
      await env.ACCOUNT_DB.prepare("UPDATE account_profile_media SET state = 'deleting' WHERE account_id = ? AND revision = ?").bind(accountId, manifest.revision).run();
      return json({ error: 'Cover backup could not finish. Try again.' }, 503, cors);
    }
    return json({ cover: manifest }, 201, cors);
  }
  const revision = path.slice('/api/v1/account/cover/'.length);
  if (request.method === 'GET' && path.startsWith('/api/v1/account/cover/') && UUID.test(revision)) {
    const row = await env.ACCOUNT_DB.prepare(`SELECT object_key, manifest FROM account_profile_media WHERE account_id = ? AND revision = ? AND state = 'ready' AND ${currentReference}`).bind(accountId, revision).first();
    if (!row) return json({ error: 'Cover not found.' }, 404, cors);
    const manifest = JSON.parse(row.manifest), object = await env.PROFILE_MEDIA.get(row.object_key);
    if (!object) return json({ error: 'Cover not found.' }, 404, cors);
    const active = await env.ACCOUNT_DB.prepare('SELECT device_id FROM account_devices WHERE account_id = ? AND device_id = ? AND revoked_at IS NULL AND credential_hash = ?').bind(accountId, deviceId, credentialHash).first();
    if (!active) return json({ error: 'This device credential is no longer active.' }, 403, cors);
    return new Response(object.body, { headers: { ...cors, 'Content-Type': manifest.mime, 'Content-Length': String(manifest.bytes), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment; filename="cover"', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  }
  return json({ error: 'Not found.' }, 404, cors);
}

// Reconcile bucket-only objects too. This closes cross-store crash windows, including
// a delayed R2 write that finishes after a stale writing reservation was collected.
// A persisted cursor makes progress across large buckets; no account-wide key scan
// or private object identifier is exposed to a client.
export async function sweepProfileMediaOrphans(env, budget = newMediaBudget()) {
  if (!env.PROFILE_MEDIA) return;
  if (!spend(budget, 3)) return; // Cursor read + R2 list + cursor write.
  const row = await env.ACCOUNT_DB.prepare('SELECT cursor FROM profile_media_maintenance WHERE id = 1').first();
  const page = await env.PROFILE_MEDIA.list({ prefix: 'covers/', limit: 4, ...(row?.cursor ? { cursor: row.cursor } : {}) });
  for (const object of page.objects || []) {
    if (!object.uploaded || new Date(object.uploaded).getTime() > Date.now() - 3600000) continue;
    if (!spend(budget, 2)) return; // Keep the cursor unchanged when a page cannot finish.
    const tracked = await env.ACCOUNT_DB.prepare('SELECT object_key FROM account_profile_media WHERE object_key = ?').bind(object.key).first();
    if (!tracked) await env.PROFILE_MEDIA.delete(object.key);
  }
  await env.ACCOUNT_DB.prepare('UPDATE profile_media_maintenance SET cursor = ? WHERE id = 1').bind(page.truncated ? page.cursor : null).run();
}
