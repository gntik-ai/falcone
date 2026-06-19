/**
 * OpenWhisk action: List exportable configuration domains for a tenant.
 * GET /v1/admin/tenants/{tenant_id}/config/export/domains
 * @module actions/tenant-config-export-domains
 */

import { getRegistry, KNOWN_DOMAINS, DOMAIN_DESCRIPTIONS } from '../collectors/registry.mjs';
import { parseConfigIdentity } from './tenant-config-identity.mjs';

/**
 * @param {Object} params
 * @param {Object} [overrides]
 * @returns {Promise<{statusCode: number, body: object}>}
 */
export async function main(params = {}, overrides = {}) {
  const registryFn = overrides.getRegistry ?? getRegistry;
  const tenantExistsFn = overrides.tenantExists ?? (async () => true);

  // --- Auth ---
  // The TARGET tenant is addressed by the URL path (below), so the CALLER may be a platform
  // operator (superadmin/sre) with no own-tenant claim. requireTenant:false lets identity
  // resolve from the trusted role/scope headers without x-tenant-id. (Previously a superadmin
  // JWT → no x-tenant-id → null → 401, even though the tenant is taken from the path.)
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

  // --- Tenant ---
  const tenantId = params.tenant_id ?? params.__ow_path?.split('/').find((_, i, arr) => arr[i - 1] === 'tenants');
  if (!tenantId) {
    return { statusCode: 400, body: { error: 'tenant_id is required' } };
  }

  const exists = await tenantExistsFn(tenantId);
  if (!exists) {
    return { statusCode: 404, body: { error: `Tenant '${tenantId}' not found` } };
  }

  // --- Build domains list ---
  const deploymentProfile = process.env.CONFIG_EXPORT_DEPLOYMENT_PROFILE ?? 'standard';
  const registry = registryFn(deploymentProfile);

  const domains = KNOWN_DOMAINS.map(domainKey => {
    const hasCollector = registry.has(domainKey);
    // Probe the collector to see if it would return not_available
    // We use the registry entry existence + env checks
    const owEnabled = process.env.CONFIG_EXPORT_OW_ENABLED === 'true';
    const mongoEnabled = process.env.CONFIG_EXPORT_MONGO_ENABLED === 'true';

    let availability = 'available';
    let reason;

    if (!hasCollector) {
      availability = 'not_available';
      reason = `No collector registered for domain '${domainKey}'`;
    } else if (domainKey === 'functions' && !owEnabled) {
      availability = 'not_available';
      reason = `OpenWhisk not in profile '${deploymentProfile}'`;
    } else if (domainKey === 'mongo_metadata' && !mongoEnabled) {
      availability = 'not_available';
      reason = `MongoDB not enabled in profile '${deploymentProfile}'`;
    }

    return {
      domain_key: domainKey,
      availability,
      description: DOMAIN_DESCRIPTIONS[domainKey] ?? domainKey,
      ...(reason ? { reason } : {}),
    };
  });

  return {
    statusCode: 200,
    body: {
      tenant_id: tenantId,
      deployment_profile: deploymentProfile,
      queried_at: new Date().toISOString(),
      domains,
    },
  };
}
