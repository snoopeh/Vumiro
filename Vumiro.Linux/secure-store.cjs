'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PROTECTED_BACKENDS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);
const success = value => ({ ok: true, value });
const failure = (code, backend = 'unknown') => ({ ok: false, error: { code, backend } });

function createSecureStore({ safeStorage, file }) {
  function status() {
    let backend = 'unknown';
    try {
      const selected = safeStorage.getSelectedStorageBackend();
      if (PROTECTED_BACKENDS.has(selected) || selected === 'basic_text') backend = selected;
      if (backend === 'basic_text') return { available: false, code: 'SECURE_STORAGE_UNPROTECTED', backend };
      if (PROTECTED_BACKENDS.has(backend) && safeStorage.isEncryptionAvailable()) return { available: true, code: null, backend };
    } catch { /* OS details and backend error messages must not cross IPC. */ }
    return { available: false, code: 'SECURE_STORAGE_UNAVAILABLE', backend };
  }

  return async request => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) return failure('SECURE_STORAGE_INVALID_REQUEST');
    const action = request.action;
    const keys = Object.keys(request).sort().join(',');
    if (!['get', 'set', 'delete', 'status'].includes(action) || keys !== (action === 'set' ? 'action,value' : 'action') ||
        action === 'set' && (typeof request.value !== 'string' || request.value.length > 8192)) return failure('SECURE_STORAGE_INVALID_REQUEST');
    if (action === 'status') return success(status());
    // Removing a saved session must work even when its encryption key is locked.
    if (action === 'delete') {
      try { await fs.unlink(file); }
      catch (error) { if (error.code !== 'ENOENT') return failure('SECURE_STORAGE_DELETE_FAILED'); }
      return success(true);
    }
    let encrypted;
    if (action === 'get') {
      try { encrypted = await fs.readFile(file); }
      catch (error) { return error.code === 'ENOENT' ? success('') : failure('SECURE_STORAGE_READ_FAILED', status().backend); }
    }
    const capability = status();
    if (!capability.available) return failure(capability.code, capability.backend);
    if (action === 'get') {
      try { return success(safeStorage.decryptString(encrypted)); }
      catch { return failure('SECURE_STORAGE_READ_FAILED', capability.backend); }
    }

    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
      // Encrypt before opening a file; no plaintext fallback is permitted.
      const ciphertext = safeStorage.encryptString(request.value);
      await fs.mkdir(path.dirname(file), { recursive: true });
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(ciphertext);
      await handle.sync();
      await handle.close(); handle = null;
      await fs.rename(temporary, file);
      return success(true);
    } catch {
      return failure('SECURE_STORAGE_WRITE_FAILED', capability.backend);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  };
}

function createSecureStoreHandler({ store, isTrusted }) {
  return async (event, request) => {
    if (!isTrusted(event)) return failure('SECURE_STORAGE_FORBIDDEN');
    return store(request);
  };
}

module.exports = { createSecureStore, createSecureStoreHandler };
