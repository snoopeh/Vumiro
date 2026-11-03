// Public production checks only: no account, email, password or service-role key.
const base = 'https://vumiro-rooms.vumiro-signaling.workers.dev';
async function request(url, options = {}) {
  return fetch(url, {...options, signal: AbortSignal.timeout(15000), redirect: 'error'});
}
function requireCondition(condition, message) { if (!condition) throw Error(message); }
const response = await request(base + '/api/v1/account/config');
requireCondition(response.ok, `Account configuration returned ${response.status}`);
const config = await response.json();
requireCondition(config.serviceEnabled === true, 'Account service is disabled');
requireCondition(typeof config.registrationEnabled === 'boolean', 'Registration configuration is invalid');
requireCondition(config.authUrl === 'https://rrrflwevxojheaejbcnp.supabase.co', 'Authentication project changed');
requireCondition(typeof config.publishableKey === 'string' && config.publishableKey.length > 20, 'Public authentication key unavailable');
const health = await request(config.authUrl + '/auth/v1/health', {headers: {apikey: config.publishableKey}});
requireCondition(health.ok, `Authentication health returned ${health.status}`);
const keysResponse = await request(config.authUrl + '/auth/v1/.well-known/jwks.json');
requireCondition(keysResponse.ok, `Signing-key endpoint returned ${keysResponse.status}`);
const jwks = await keysResponse.json();
requireCondition(Array.isArray(jwks.keys) && jwks.keys.some(key => key.kid && ['ES256', 'RS256'].includes(key.alg)), 'No supported signing key published');
const protectedResponse = await request(base + '/api/v1/account/snapshot');
requireCondition(protectedResponse.status === 401, `Unauthenticated account route returned ${protectedResponse.status}, expected 401`);
console.log('Account API, authentication provider, signing keys and authentication enforcement are healthy.');
