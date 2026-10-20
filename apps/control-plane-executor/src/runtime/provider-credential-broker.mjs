// Tokens live only in this process. Adapters remain pure protocol translators.
import { readFile } from 'node:fs/promises';
import { identityProfile, normalizeProviderAuth } from './provider-auth.mjs';
import { createHash } from 'node:crypto';
import { assertEndpointAllowed, assertSecretRefAllowed } from './byok-provider-guard.mjs';
import { AdapterError, adapterError } from './llm-adapters/contract.mjs';

const authFailed = () => adapterError('LLM_PROVIDER_AUTH_FAILED');
export function createCredentialBroker({ fetchImpl = globalThis.fetch, now = Date.now, secretResolver,
  prefixes, endpointOptions, skewSeconds = 60, identityProfiles = {}, readTokenFile = path => readFile(path, 'utf8') } = {}) {
  if (!Number.isFinite(skewSeconds) || skewSeconds < 0) throw new TypeError('Invalid provider token expiry skew');
  const cache = new Map();
  const keyFor = config => JSON.stringify([config.tenantId, config.workspaceId, config.connectionId,
    config.configVersion ?? null,
    createHash('sha256').update(JSON.stringify({ auth: config.auth, endpoint: config.endpoint, providerType: config.providerType })).digest('hex')]);
  async function exchange(endpoint, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    timeout.unref?.();
    try {
      let response;
      try {
        response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      } catch { throw adapterError('LLM_PROVIDER_UNAVAILABLE'); }
      if (response.status >= 500) {
        void response.body?.cancel().catch(() => {});
        throw adapterError('LLM_PROVIDER_UNAVAILABLE');
      }
      let json;
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.byteLength;
          if (size > 64 * 1024) throw new Error('Token response too large');
          chunks.push(chunk);
        }
        json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      catch { throw adapterError(controller.signal.aborted ? 'LLM_PROVIDER_UNAVAILABLE' : 'LLM_PROVIDER_RESPONSE_INVALID'); }
      return { response, json };
    } finally { clearTimeout(timeout); }
  }
  async function prepare(config) {
    const auth = normalizeProviderAuth(config.auth);
    const profile = auth.mode === 'workloadIdentity' ? identityProfile(auth, config.tenantId, identityProfiles) : undefined;
    assertSecretRefAllowed(auth.clientSecretRef, prefixes);
    assertSecretRefAllowed(auth.refreshTokenRef, prefixes);
    const key = keyFor(config);
    // Prune expired credentials on activity and discard superseded versions.
    // Existing prepared requests retain their entry without retaining it in cache.
    for (const [oldKey, oldEntry] of cache) {
      const [tenant, workspace, connection] = JSON.parse(oldKey);
      if ((!oldEntry.pending && oldEntry.expiresAt <= now())
        || (oldKey !== key && tenant === config.tenantId && workspace === config.workspaceId && connection === config.connectionId)) cache.delete(oldKey);
    }
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
          throw adapterError('LLM_PROVIDER_SECRET_UNRESOLVED');
        };
        const body = new URLSearchParams();
        if (profile) {
          let assertion;
          try { assertion = (await readTokenFile(profile.tokenFile ?? '/var/run/secrets/falcone/llm-identity/token')).trim(); }
          catch { /* Fixed error below. */ }
          if (!assertion) throw adapterError('LLM_PROVIDER_SECRET_UNRESOLVED');
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
        const { response, json } = await exchange(endpoint, body);
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
      if (error instanceof AdapterError) throw error;
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
