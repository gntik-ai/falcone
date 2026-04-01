/**
 * OpenWhisk action: Query supported config export format versions.
 * GET /v1/admin/config/format-versions
 * @module actions/tenant-config-format-versions
 */

import {
  getCurrentVersion,
  getMinMigratable,
  getSupportedVersions,
} from '../schemas/index.mjs';

/**
 * Extract and validate JWT claims from OpenWhisk params.
 * @returns {{ actor_id: string, actor_type: string, scopes: string[] } | null}
 */
function extractAuth(params) {
  const authHeader = params?.__ow_headers?.authorization ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    const roles = payload.realm_access?.roles ?? [];
    const scopes = (payload.scope ?? '').split(' ').filter(Boolean);
    let actor_type = null;
    if (roles.includes('superadmin')) actor_type = 'superadmin';
    else if (roles.includes('sre')) actor_type = 'sre';
    else if (payload.azp && !roles.includes('tenant_owner') && scopes.includes('platform:admin:config:export')) actor_type = 'service_account';

    return actor_type ? { actor_id: payload.sub ?? payload.preferred_username ?? 'unknown', actor_type, scopes } : null;
  } catch {
    return null;
  }
}

/**
 * @param {Object} params - OpenWhisk action params
 * @param {Object} [overrides] - DI overrides for testing
 * @returns {Promise<{statusCode: number, headers?: object, body: object}>}
 */
export async function main(params = {}, overrides = {}) {
  // --- Auth ---
  const auth = overrides.auth ?? extractAuth(params);
  if (!auth) {
    return { statusCode: 403, body: { error: 'Forbidden: insufficient role or missing scope platform:admin:config:export' } };
  }
  if (!auth.scopes?.includes('platform:admin:config:export') && !overrides.auth) {
    return { statusCode: 403, body: { error: 'Forbidden: missing scope platform:admin:config:export' } };
  }

  const registryFns = overrides.registry ?? { getCurrentVersion, getMinMigratable, getSupportedVersions };

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      current_version: registryFns.getCurrentVersion(),
      min_migratable_version: registryFns.getMinMigratable(),
      versions: registryFns.getSupportedVersions(),
    },
  };
}
