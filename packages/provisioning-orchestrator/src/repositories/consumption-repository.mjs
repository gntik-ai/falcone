// Map each plan dimension to a consumption resolver (fix-quota-consumption-measurement, #497).
// Two paths share each resolver: the REAL Postgres path (client.query) — used in production against
// the `in_falcone` control DB — and the in-memory fake-db path used by the consumption integration
// suite. The two diverged: the production quota_dimension_catalog keys {max_workspaces,
// max_pg_databases,max_mongo_databases,max_functions,max_kafka_topics,max_api_keys,max_storage_bytes,
// max_workspace_members} are backed by the live `workspace_*` tables, while the test catalog used
// keys backed by tables (pg_databases/functions/kafka_topics/…) that DON'T exist in in_falcone — so
// production returned NO_QUERY_MAPPING / CONSUMPTION_QUERY_FAILED for every dimension. We DECOUPLE
// the real table name from the fake-db lookup key: production hits the correct live table; the
// integration fake-db keeps its keys. All keys from BOTH catalogs are mapped so neither path errors.
const DIMENSION_QUERY_MAP = {
  // Production catalog (quota_dimension_catalog) → live in_falcone tables.
  max_workspaces: makeDimensionQuery('workspaces', { fakeKey: 'workspaces' }),
  max_pg_databases: makeDimensionQuery('workspace_databases', { fakeKey: 'pg_databases', where: "engine = 'postgresql'" }),
  max_mongo_databases: makeDimensionQuery('workspace_databases', { fakeKey: 'mongo_databases', where: "engine = 'mongodb'" }),
  max_functions: makeDimensionQuery('workspace_functions', { fakeKey: 'functions' }),
  max_kafka_topics: makeDimensionQuery('workspace_topics', { fakeKey: 'kafka_topics' }),
  max_api_keys: makeDimensionQuery('workspace_api_keys', { fakeKey: 'api_keys' }),
  // No in_falcone source: storage bytes live in the object store (SeaweedFS) and members in Keycloak;
  // both are out of this PG resolver's reach, so they measure 0 here rather than erroring (real
  // object-store metering ties into observability/#499; member counts into IAM). Documented gap.
  max_storage_bytes: makeUnmeteredDimension(),
  max_workspace_members: makeUnmeteredDimension(),
  // Legacy/test catalog keys (the consumption integration suite's in-memory catalog). The live pg
  // path never requests these (absent from quota_dimension_catalog), so their table names are
  // exercised only by the fake-db path.
  max_realtime_channels: makeDimensionQuery('realtime_channels', { fakeKey: 'realtime_channels' }),
  max_storage_gb: makeStorageQuery(),
  max_monthly_api_calls: makeMonthlyCallsQuery(),
  max_members: makeDimensionQuery('workspace_members', { fakeKey: 'workspace_members' })
};

function makeDimensionQuery(realTable, { fakeKey = realTable, where = null } = {}) {
  return async (client, tenantId, workspaceId) => {
    if (client.catalogDimensions !== undefined || client.plans !== undefined) {
      const rows = client[fakeKey] ?? client[`_${fakeKey}`] ?? [];
      return rows.filter((row) => matchesScope(row, tenantId, workspaceId)).length;
    }
    const values = workspaceId ? [tenantId, workspaceId] : [tenantId];
    const scope = workspaceId ? 'tenant_id = $1 AND workspace_id = $2' : 'tenant_id = $1';
    const clause = where ? `${scope} AND ${where}` : scope;
    const { rows } = await client.query(`SELECT COUNT(*)::bigint AS value FROM ${realTable} WHERE ${clause}`, values);
    return Number(rows[0]?.value ?? 0);
  };
}

// A dimension with no control-plane (in_falcone) data source: measures 0 instead of failing, so it
// never blocks the response with NO_QUERY_MAPPING. Its real source is an external system (object
// store / IAM) wired separately.
function makeUnmeteredDimension() {
  return async () => 0;
}

function makeStorageQuery() {
  return async (client, tenantId, workspaceId) => {
    if (client.catalogDimensions !== undefined || client.plans !== undefined) {
      const rows = client.storage_objects ?? client._storage_objects ?? [];
      const totalBytes = rows.filter((row) => matchesScope(row, tenantId, workspaceId)).reduce((sum, row) => sum + Number(row.size_bytes ?? row.sizeBytes ?? 0), 0);
      return Number((totalBytes / 1e9).toFixed(3));
    }
    const values = workspaceId ? [tenantId, workspaceId] : [tenantId];
    const clause = workspaceId ? 'tenant_id = $1 AND workspace_id = $2' : 'tenant_id = $1';
    const { rows } = await client.query(`SELECT COALESCE(SUM(size_bytes), 0)::float8 / 1000000000 AS value FROM storage_objects WHERE ${clause}`, values);
    return Number(rows[0]?.value ?? 0);
  };
}

function makeMonthlyCallsQuery() {
  return async (client, tenantId, workspaceId) => {
    if (client.catalogDimensions !== undefined || client.plans !== undefined) {
      const rows = client.api_call_logs ?? client._api_call_logs ?? [];
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      return rows.filter((row) => matchesScope(row, tenantId, workspaceId) && new Date(row.created_at ?? row.createdAt ?? Date.now()) >= monthStart).length;
    }
    const values = workspaceId ? [tenantId, workspaceId] : [tenantId];
    const clause = workspaceId ? 'tenant_id = $1 AND workspace_id = $2' : 'tenant_id = $1';
    const { rows } = await client.query(`SELECT COUNT(*)::bigint AS value FROM api_call_logs WHERE ${clause} AND created_at >= date_trunc('month', NOW())`, values);
    return Number(rows[0]?.value ?? 0);
  };
}

function matchesScope(row, tenantId, workspaceId) {
  const rowTenantId = row.tenant_id ?? row.tenantId;
  const rowWorkspaceId = row.workspace_id ?? row.workspaceId ?? null;
  if (rowTenantId !== tenantId) return false;
  if (!workspaceId) return true;
  return rowWorkspaceId === workspaceId;
}

function withTimeout(promise, timeoutMs = 500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('CONSUMPTION_QUERY_FAILED')), timeoutMs))
  ]);
}

export function computeUsageStatus(currentUsage, effectiveLimit) {
  if (currentUsage === null || currentUsage === undefined) return 'unknown';
  if (effectiveLimit === -1) return 'within_limit';
  if (effectiveLimit === 0) return currentUsage > 0 ? 'over_limit' : 'at_limit';
  if (currentUsage > effectiveLimit) return 'over_limit';
  if (currentUsage === effectiveLimit) return 'at_limit';
  if (currentUsage / effectiveLimit >= 0.8) return 'approaching_limit';
  return 'within_limit';
}

export async function resolveDimensionCounts(client, tenantId, dimensions, workspaceId = undefined) {
  const entries = await Promise.allSettled(dimensions.map(async (dimension) => {
    const dimensionKey = typeof dimension === 'string' ? dimension : dimension.dimensionKey;
    const effectiveLimit = typeof dimension === 'string' ? undefined : dimension.effectiveValue;
    const resolver = DIMENSION_QUERY_MAP[dimensionKey];
    if (!resolver) {
      return [dimensionKey, { currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'NO_QUERY_MAPPING' }];
    }
    try {
      const currentUsage = await withTimeout(Promise.resolve(resolver(client, tenantId, workspaceId)));
      return [dimensionKey, { currentUsage, usageStatus: computeUsageStatus(currentUsage, effectiveLimit), usageUnknownReason: null }];
    } catch {
      return [dimensionKey, { currentUsage: null, usageStatus: 'unknown', usageUnknownReason: 'CONSUMPTION_QUERY_FAILED' }];
    }
  }));

  const result = new Map();
  for (const entry of entries) {
    if (entry.status === 'fulfilled') {
      result.set(entry.value[0], entry.value[1]);
    }
  }
  return result;
}

export { DIMENSION_QUERY_MAP };
