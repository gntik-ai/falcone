// Tenant configuration export assembler (#683, data-export-import-clone).
//
// Builds a READ-ONLY, portable snapshot of a tenant's NON-SENSITIVE configuration from already-
// fetched rows (so it is a pure, unit-testable function — no DB/IO here). The snapshot deliberately
// EXCLUDES every secret, credential, BYOK key, service-account material, Keycloak client secret, and
// raw token: only tenant metadata, the tenant's workspaces (slug/environment/database NAME), and the
// resolved quota LIMITS (numbers, never credentials) are emitted. The caller (b-handlers) authorizes
// own-tenant access BEFORE invoking this, so the snapshot is always scoped to a tenant the caller owns.

// Fields that must NEVER appear in an exported snapshot (defense in depth: if an upstream row ever
// grows one of these columns, the assembler strips it rather than leaking it).
const FORBIDDEN_KEYS = new Set([
  'password', 'secret', 'secretRef', 'clientSecret', 'client_secret', 'apiKey', 'api_key',
  'token', 'accessToken', 'refreshToken', 'privateKey', 'private_key', 'credential', 'credentials',
  'byok', 'kc_client_secret', 'connectionString', 'connection_string', 'dsn'
]);

// Recursively drop any forbidden key from a plain object/array. Returns a deep, sanitized copy.
export function stripSensitive(value) {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    out[k] = stripSensitive(v);
  }
  return out;
}

// Project a workspace row to its portable, non-sensitive config.
function workspaceConfig(ws) {
  return {
    workspaceId: ws.id ?? ws.workspaceId ?? null,
    slug: ws.slug ?? null,
    displayName: ws.display_name ?? ws.displayName ?? null,
    environment: ws.environment ?? null,
    state: ws.status ?? ws.state ?? null
  };
}

// Project a resolved quantitative entitlement/limit to its number-only config (NO credentials).
function quotaConfig(limit) {
  return {
    dimension: limit.dimensionKey ?? limit.dimension ?? null,
    displayLabel: limit.displayLabel ?? null,
    effectiveValue: typeof limit.effectiveValue === 'number' ? limit.effectiveValue : null,
    quotaType: limit.quotaType ?? null
  };
}

// Assemble the snapshot. All inputs are already-authorized, already-fetched data.
//   tenant         : the tenants row ({ id, slug, display_name, status, ... })
//   workspaces     : array of workspace rows for the tenant
//   environments   : the tenant's first-class environments (listTenantEnvironments output)
//   quotaLimits    : resolved quantitative limits (entitlements action output) — may be []
//   environmentCatalog : the platform environment catalog
//   generatedAt    : ISO timestamp
export function buildTenantConfigExport({
  tenant,
  workspaces = [],
  environments = [],
  quotaLimits = [],
  environmentCatalog = [],
  generatedAt = new Date().toISOString()
} = {}) {
  if (!tenant?.id) {
    const e = new Error('tenant is required to build a tenant configuration export.');
    e.statusCode = 400;
    throw e;
  }
  return stripSensitive({
    entityType: 'tenant_configuration_export',
    formatVersion: 1,
    generatedAt,
    tenant: {
      tenantId: tenant.id,
      slug: tenant.slug ?? null,
      displayName: tenant.display_name ?? null,
      state: tenant.status ?? null
    },
    environmentCatalog: [...environmentCatalog],
    environments: environments.map((env) => ({
      environment: env.environment ?? null,
      workspaceCount: env.workspaceCount ?? (Array.isArray(env.workspaces) ? env.workspaces.length : 0)
    })),
    workspaces: workspaces.map(workspaceConfig),
    quotas: quotaLimits.map(quotaConfig),
    // Make the exclusion explicit + machine-readable (the consumer knows these were intentionally
    // withheld, not merely absent).
    excluded: ['secrets', 'credentials', 'byok-keys', 'service-accounts', 'api-keys', 'tokens']
  });
}
