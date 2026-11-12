'use strict';

const ACCOUNT_ORIGIN = 'https://vumiro-rooms.vumiro-signaling.workers.dev';
const FILTER = { urls: [`${ACCOUNT_ORIGIN}/*`, 'https://*.supabase.co/*'] };

function accountOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (url.origin === ACCOUNT_ORIGIN && url.pathname.startsWith('/api/v1/account/')) return url.origin;
    if (/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) && url.pathname.startsWith('/auth/v1/')) return url.origin;
  } catch { /* Invalid or unrelated targets have no diagnostic state. */ }
  return '';
}

function classifyNetworkError(error) {
  if (typeof error !== 'string') return 'NETWORK_FAILED';
  const code = error.replace(/^net::/, '');
  if (/^ERR_CERT_[A-Z_]+$/.test(code) || ['ERR_SSL_PROTOCOL_ERROR', 'ERR_SSL_VERSION_OR_CIPHER_MISMATCH'].includes(code)) return 'NETWORK_CERTIFICATE';
  if (['ERR_NAME_NOT_RESOLVED', 'ERR_NAME_RESOLUTION_FAILED', 'ERR_DNS_TIMED_OUT', 'ERR_DNS_SERVER_FAILED'].includes(code)) return 'NETWORK_DNS';
  if (['ERR_TIMED_OUT', 'ERR_CONNECTION_TIMED_OUT'].includes(code)) return 'NETWORK_TIMEOUT';
  if (['ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED'].includes(code)) return 'NETWORK_OFFLINE';
  return 'NETWORK_FAILED';
}

// Observe the existing Chromium requests. Never replay authentication, retain
// request bodies/headers/URLs, or override certificate verification.
function createNetworkDiagnostics({ webRequest, isOnline = () => true, now = Date.now, isTrustedRequest = () => true }) {
  const outcomes = new Map();
  function record(details, code) {
    if (!isTrustedRequest(details)) return;
    const origin = accountOrigin(details.url);
    if (!origin) return;
    for (const [key, entry] of outcomes) if (now() - entry.time > 30000) outcomes.delete(key);
    outcomes.delete(origin);
    if (outcomes.size >= 32) outcomes.delete(outcomes.keys().next().value);
    outcomes.set(origin, { code, time: now() });
  }
  return Object.freeze({
    install() {
      webRequest.onErrorOccurred(FILTER, details => record(details, classifyNetworkError(details.error)));
      webRequest.onCompleted(FILTER, details => record(details, ''));
    },
    check(value = `${ACCOUNT_ORIGIN}/api/v1/account/config`) {
      const origin = accountOrigin(value);
      if (!origin) return { ok: false, code: 'NETWORK_FAILED' };
      if (!isOnline()) return { ok: false, code: 'NETWORK_OFFLINE' };
      const entry = outcomes.get(origin);
      if (!entry || now() - entry.time > 30000) return { ok: false, code: 'NETWORK_FAILED' };
      return { ok: !entry.code, code: entry.code };
    }
  });
}

module.exports = { createNetworkDiagnostics, classifyNetworkError };
