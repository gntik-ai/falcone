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
  const auth = overrides.auth ?? parseConfigIdentity(params);
  if (!auth) {
    return { statusCode: 401, body: { code: 'UNAUTHORIZED', error: 'Unauthorized: missing identity headers' } };
  }
  if (!auth.actor_type || (!auth.scopes?.includes('platform:admin:config:export') && !overrides.auth)) {
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
