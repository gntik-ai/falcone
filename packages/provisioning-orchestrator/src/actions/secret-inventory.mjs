function hasRequiredRole(auth = {}, domain, tenantId) {
  const roles = auth.roles ?? [];
  if (roles.includes('superadmin') || roles.includes('platform-operator')) {
    return true;
  }
  if (domain === 'tenant' && roles.includes('tenant-operator')) {
    return Boolean(auth.tenantId) && (!tenantId || auth.tenantId === tenantId);
  }
  return false;
}

function ensureNoSecretMaterial(record) {
  if (!record || typeof record !== 'object') return;
  const forbidden = ['value', 'data'];
  for (const key of Object.keys(record)) {
    if (forbidden.includes(key)) {
      throw new Error('Secret material exposure is forbidden');
    }
    ensureNoSecretMaterial(record[key]);
  }
}

export async function secretInventory(params = {}, { query = async () => ({ rows: [] }) } = {}) {
  const { domain } = params;
  const auth = params.auth ?? {};
  let tenantId = params.tenantId ?? null;
  if (!domain) {
    return { statusCode: 400, body: { error: 'domain is required' } };
  }
  if (!['platform', 'tenant', 'functions', 'gateway', 'iam'].includes(domain)) {
    return { statusCode: 400, body: { error: 'invalid domain' } };
  }
  const parseInteger = (value, fallback) => value === undefined ? fallback
    : typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  const offset = parseInteger(params.offset, 0);
  const limit = parseInteger(params.limit, 50);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    return { statusCode: 400, body: { error: 'invalid pagination' } };
  }
  if (!hasRequiredRole(auth, domain, tenantId)) {
    return { statusCode: 403, body: { error: 'forbidden' } };
  }
  if (!auth.roles?.some(role => ['superadmin', 'platform-operator'].includes(role))) {
    tenantId = auth.tenantId;
  }

  const result = await query(
    `WITH inventory AS (
       SELECT secret_name, domain, secret_path, created_at, updated_at,
              status, secret_type, tenant_id FROM secret_metadata
        WHERE domain = $1
          AND ($2::uuid IS NULL OR tenant_id = $2::uuid)
        ORDER BY updated_at DESC, secret_path ASC
        OFFSET $3 LIMIT $4
     )
     SELECT m.secret_name AS name, m.domain, m.secret_path AS path,
            m.created_at AS "createdAt", m.updated_at AS "updatedAt", m.status,
            m.secret_type AS "secretType", m.tenant_id AS "tenantId",
            v."currentVersion", v."versionCount"
       FROM inventory m
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object('vaultVersion', vault_version, 'state', state,
                                   'activatedAt', activated_at) AS "currentVersion",
                count(*) OVER () AS "versionCount"
           FROM secret_version_states
          WHERE secret_path = m.secret_path AND domain = m.domain
            AND tenant_id IS NOT DISTINCT FROM m.tenant_id
            AND state IN ('active', 'grace')
          ORDER BY vault_version DESC, activated_at DESC
          LIMIT 1
       ) v ON true
      ORDER BY m.updated_at DESC, m.secret_path ASC`,
    [domain, tenantId, offset, limit]
  );

  const secrets = result.rows.map((row) => {
    ensureNoSecretMaterial(row);
    const currentVersion = row.currentVersion ?? null;
    const item = {
      name: row.name, domain: row.domain, path: row.path,
      createdAt: row.createdAt, updatedAt: row.updatedAt, status: row.status,
      secretType: row.secretType, tenantId: row.tenantId ?? null,
      currentVersion: currentVersion ? {
        vaultVersion: currentVersion.vaultVersion, state: currentVersion.state,
        activatedAt: currentVersion.activatedAt
      } : null,
      requiresForce: currentVersion !== null && Number(row.versionCount) === 1
    };
    ensureNoSecretMaterial(item);
    return item;
  });

  return { statusCode: 200, body: { secrets, offset, limit } };
}

export default secretInventory;
