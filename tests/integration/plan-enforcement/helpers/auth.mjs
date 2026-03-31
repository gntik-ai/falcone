/**
 * Keycloak authentication helper.
 *
 * Obtains and caches JWT tokens for superadmin, tenant owner, and
 * workspace admin actors. Tokens are refreshed automatically when
 * they expire (based on `expires_in`).
 */

import { env } from '../config/test-env.mjs';

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/** @type {Map<string, { token: string, expiresAt: number }>} */
const tokenCache = new Map();

/**
 * Build the Keycloak token endpoint URL.
 * @returns {string}
 */
function tokenEndpoint() {
  return `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`;
}

/**
 * Request a token from Keycloak.
 * @param {URLSearchParams} params
 * @returns {Promise<{ access_token: string, expires_in: number }>}
 */
async function requestToken(params) {
  const url = tokenEndpoint();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
  } catch (err) {
    throw new AuthError(`Keycloak unreachable at ${url}: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AuthError(
      `Keycloak token request failed (${res.status}): ${body}`,
    );
  }

  return res.json();
}

/**
 * Get or refresh a cached token.
 * @param {string} cacheKey
 * @param {() => URLSearchParams} paramsFn
 * @returns {Promise<string>}
 */
async function getCachedToken(cacheKey, paramsFn) {
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const data = await requestToken(paramsFn());
  const bufferMs = 10_000; // refresh 10s before actual expiry
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000 - bufferMs,
  });
  return data.access_token;
}

/**
 * Get a superadmin token via client_credentials grant.
 * @returns {Promise<string>}
 */
export function getSuperadminToken() {
  return getCachedToken('superadmin', () => {
    const params = new URLSearchParams();
    params.set('grant_type', 'client_credentials');
    params.set('client_id', env.SUPERADMIN_CLIENT_ID);
    params.set('client_secret', env.SUPERADMIN_CLIENT_SECRET);
    return params;
  });
}

/**
 * Get a tenant-owner token (uses token exchange / impersonation).
 * @param {string} tenantId
 * @returns {Promise<string>}
 */
export function getTenantOwnerToken(tenantId) {
  return getCachedToken(`tenant-owner:${tenantId}`, () => {
    const params = new URLSearchParams();
    params.set('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
    params.set('client_id', env.SUPERADMIN_CLIENT_ID);
    params.set('client_secret', env.SUPERADMIN_CLIENT_SECRET);
    params.set('requested_subject', tenantId);
    params.set('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    params.set('requested_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    return params;
  });
}

/**
 * Get a workspace-admin token.
 * @param {string} tenantId
 * @param {string} workspaceId
 * @returns {Promise<string>}
 */
export function getWorkspaceAdminToken(tenantId, workspaceId) {
  return getCachedToken(`ws-admin:${tenantId}:${workspaceId}`, () => {
    const params = new URLSearchParams();
    params.set('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
    params.set('client_id', env.SUPERADMIN_CLIENT_ID);
    params.set('client_secret', env.SUPERADMIN_CLIENT_SECRET);
    params.set('requested_subject', tenantId);
    params.set('audience', workspaceId);
    params.set('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    params.set('requested_token_type', 'urn:ietf:params:oauth:token-type:access_token');
    return params;
  });
}

/**
 * Clear all cached tokens (call in global teardown).
 */
export function clearTokenCache() {
  tokenCache.clear();
}
