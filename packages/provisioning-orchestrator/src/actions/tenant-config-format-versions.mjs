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
import { parseConfigIdentity } from './tenant-config-identity.mjs';

/**
 * @param {Object} params - OpenWhisk action params
 * @param {Object} [overrides] - DI overrides for testing
 * @returns {Promise<{statusCode: number, headers?: object, body: object}>}
 */
export async function main(params = {}, overrides = {}) {
  // --- Auth ---
  // This is a tenant-AGNOSTIC platform catalog read (supported config schema versions), so
  // a platform operator (superadmin/sre) — who carries no own-tenant claim — must be able to
  // call it. requireTenant:false lets identity resolve from the trusted role/scope headers
  // even without x-tenant-id. (Previously a superadmin JWT → no x-tenant-id → null → 401.)
  const auth = overrides.auth ?? parseConfigIdentity(params, { requireTenant: false });
  if (!auth) {
    return { statusCode: 401, body: { code: 'UNAUTHORIZED', error: 'Unauthorized: missing identity headers' } };
  }
  const authorized = !!overrides.auth
    || auth.actor_type === 'superadmin'
    || auth.actor_type === 'sre'
    || auth.scopes?.includes('platform:admin:config:export');
  if (!authorized) {
    return { statusCode: 403, body: { error: 'Forbidden: insufficient role or missing scope platform:admin:config:export' } };
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
