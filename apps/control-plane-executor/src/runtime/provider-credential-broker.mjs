// Tokens live only in this process. Adapters remain pure protocol translators.
import { readFile } from 'node:fs/promises';
import { clientError } from './errors.mjs';
import { identityProfile, normalizeProviderAuth } from './provider-auth.mjs';
import { createHash } from 'node:crypto';
import { assertEndpointAllowed, assertSecretRefAllowed } from './byok-provider-guard.mjs';
import { adapterError } from './llm-adapters/contract.mjs';

const authFailed = () => adapterError('LLM_PROVIDER_AUTH_FAILED');
export function createCredentialBroker({ fetchImpl = globalThis.fetch, now = Date.now, secretResolver,
  prefixes, endpointOptions, skewSeconds = 60, identityProfiles = {}, readTokenFile = path => readFile(path, 'utf8') } = {}) {
  if (!Number.isFinite(skewSeconds) || skewSeconds < 0) throw new TypeError('Invalid provider token expiry skew');
  const cache = new Map();
  const keyFor = config => JSON.stringify([config.tenantId, config.workspaceId, config.connectionId,
    config.configVersion ?? null,
    createHash('sha256').update(JSON.stringify({ auth: config.auth, endpoint: config.endpoint, providerType: config.providerType })).digest('hex')]);
  async function prepare(config) {
    const auth = normalizeProviderAuth(config.auth);
    const profile = auth.mode === 'workloadIdentity' ? identityProfile(auth, config.tenantId, identityProfiles) : undefined;
    assertSecretRefAllowed(auth.clientSecretRef, prefixes);
    assertSecretRefAllowed(auth.refreshTokenRef, prefixes);
    const key = keyFor(config);
    let entry = cache.get(key);
    const cached = Boolean(entry && !entry.pending && entry.expiresAt - now() >= skewSeconds * 1000);
    if (!entry || (!entry.pending && entry.expiresAt - now() < skewSeconds * 1000)) {
      entry = {};
      cache.set(key, entry);
      entry.pending = (async () => {
        const endpoint = profile?.tokenEndpoint ?? auth.tokenEndpoint;
        await assertEndpointAllowed(endpoint, endpointOptions);
        const resolve = async ref => {
          try {
            const value = await secretResolver(ref, config);
            if (typeof value === 'string' && value.length) return value;
          } catch { /* Do not expose resolver failures. */ }
          throw clientError('LLM provider secret could not be resolved', 500, 'LLM_PROVIDER_SECRET_UNRESOLVED');
        };
        const body = new URLSearchParams();
        if (profile) {
          let assertion;
          try { assertion = (await readTokenFile(profile.tokenFile ?? '/var/run/secrets/falcone/llm-identity/token')).trim(); }
          catch { /* Fixed error below. */ }
          if (!assertion) throw clientError('LLM provider secret could not be resolved', 500, 'LLM_PROVIDER_SECRET_UNRESOLVED');
          if (profile.grantType === 'jwt-bearer') {
            body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
            body.set('assertion', assertion);
          } else {
            body.set('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
            body.set('subject_token_type', 'urn:ietf:params:oauth:token-type:jwt');
            body.set('requested_token_type', 'urn:ietf:params:oauth:token-type:access_token');
            body.set('subject_token', assertion);
          }
          body.set('audience', profile.audience);
        } else {
          body.set('grant_type', auth.grantType);
          body.set('client_id', auth.clientId);
          body.set('client_secret', await resolve(auth.clientSecretRef));
        }
        let refreshToken;
        if (auth.grantType === 'refresh_token') {
          refreshToken = await resolve(auth.refreshTokenRef);
          body.set('refresh_token', refreshToken);
        }
        if (auth.audience) body.set('audience', auth.audience);
        if (auth.scopes?.length) body.set('scope', auth.scopes.join(' '));
        const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        const json = await response.json();
        if (!response.ok || !json || json.error !== undefined
          || typeof json.access_token !== 'string' || !json.access_token || /[\r\n]/.test(json.access_token)
          || (json.token_type !== undefined && String(json.token_type).toLowerCase() !== 'bearer')
          || !Number.isFinite(json.expires_in) || json.expires_in <= 0
          || !Number.isFinite(now() + json.expires_in * 1000)) throw authFailed();
        if (json.refresh_token !== undefined && json.refresh_token !== refreshToken) throw authFailed();
        entry.apiKey = json.access_token;
        entry.expiresAt = now() + json.expires_in * 1000;
      })();
    }
    try { await entry.pending; }
    catch (error) {
      if (cache.get(key) === entry) cache.delete(key);
      if (error.code === 'LLM_PROVIDER_SECRET_UNRESOLVED') throw error;
      throw authFailed();
    }
    entry.pending = null;
    let credential = entry;
    let mayRetry = cached;
    return { apiKey: entry.apiKey, async fetchImpl(url, init = {}, beforeSend) {
      const send = async () => {
        // Batch leases must still hold after a token re-acquisition.
        await beforeSend?.();
        const headers = new Headers(init.headers);
        headers.delete('x-api-key');
        headers.delete('x-goog-api-key');
        headers.set('Authorization', `Bearer ${credential.apiKey}`);
        return fetchImpl(url, { ...init, headers, redirect: 'error' });
      };
      let response = await send();
      if (response.status === 401 && mayRetry) {
        mayRetry = false;
        await response.body?.cancel().catch(() => {});
        if (cache.get(key) === credential) cache.delete(key);
        const renewed = await prepare(config);
        credential = { apiKey: renewed.apiKey };
        response = await send();
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => {});
        // A rejected token cannot be used by subsequent requests.
        cache.delete(key);
        throw Object.assign(authFailed(), { phase: 'response', httpStatus: response.status });
      }
      return response;
    } };
  }
  function invalidate({ tenantId, workspaceId, connectionId }) {
    for (const key of cache.keys()) {
      const [tenant, workspace, connection] = JSON.parse(key);
      if (tenant === tenantId && workspace === workspaceId && (connectionId === undefined || connection === connectionId)) cache.delete(key);
    }
  }
  return { prepare, invalidate };
}
