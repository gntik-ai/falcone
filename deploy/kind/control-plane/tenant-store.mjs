// Tenant registry (domain B) — pg-backed CRUD over the `tenants` table.
//
// No in-repo migration creates `tenants` (it is deployment-owned), yet the real
// plan/quota actions key on it (e.g. plan-assign.mjs::ensureTenantExists does
// `SELECT 1 FROM tenants WHERE id=$1 OR tenant_id=$1`). ensureSchema() creates a
// minimal table compatible with that check; `tenant_id` mirrors `id` so a caller
// passing the tenant uuid as tenantId matches.
export async function ensureSchema(pool) {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  // id is TEXT (not uuid): the product actions compare `id = $1` with a text
  // param (e.g. plan-assign.ensureTenantExists `WHERE id=$1 OR tenant_id=$1`),
  // and the whole plan/quota schema keys the tenant as VARCHAR text. A uuid id
  // column breaks those with "operator does not exist: text = uuid".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      slug TEXT UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      iam_realm TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )`);
  await pool.query(`UPDATE tenants SET tenant_id = id WHERE tenant_id IS NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      slug TEXT,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      environment TEXT NOT NULL DEFAULT 'dev',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      UNIQUE (tenant_id, slug)
    )`);
  // First-class environment (add-environment-first-class-isolation, #503): a workspace is the
  // delivery boundary for ONE runtime environment (prod/staging/dev/...). Backfill the column on
  // pre-existing tables; carry it on the workspace_databases registry so the per-workspace
  // database (D2) is attributable to its environment.
  await pool.query("ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'dev'");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS service_accounts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      iam_realm TEXT NOT NULL,
      kc_client_id TEXT NOT NULL,
      kc_client_uuid TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )`);
  // ---- data plane: one provisioned database per workspace ------------------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_databases (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      engine TEXT NOT NULL DEFAULT 'postgresql',
      database_name TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      username TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT
    )`);
  await pool.query("ALTER TABLE workspace_databases ADD COLUMN IF NOT EXISTS environment TEXT");
  // ---- data plane: object-store buckets mapped to a workspace -------------
  // CANONICAL tenant-to-bucket mapping (bucket-per-workspace). This table is the
  // single source of truth for storage reconciliation (add-seaweedfs-bucket-
  // lifecycle-migration). Coverage note: `bucket_name` is globally UNIQUE but
  // `workspace_id` is NOT unique here, so a workspace may map to 0..N buckets and a
  // bucket created out-of-band on the backend may have no row — the migration
  // reconciler's discover-and-merge step backfills those missing rows.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_buckets (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      bucket_name TEXT NOT NULL UNIQUE,
      region TEXT NOT NULL DEFAULT 'us-east-1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // ---- data plane: event topics mapped to a workspace (resourceId <-> kafka) -
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_topics (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      topic_name TEXT NOT NULL,
      physical_topic_name TEXT NOT NULL UNIQUE,
      partitions INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (workspace_id, topic_name)
    )`);
  // ---- data plane: function registry (execution pends OpenWhisk) -----------
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workspace_functions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'nodejs:20',
      handler TEXT,
      source_ref TEXT,
      runtime_status TEXT NOT NULL DEFAULT 'pending_data_plane',
      status TEXT NOT NULL DEFAULT 'registered',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      UNIQUE (workspace_id, name)
    )`);
  // ---- data plane: deployed function actions + activations (real executor) --
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fn_actions (
      resource_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      action_name TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'nodejs:22',
      entrypoint TEXT NOT NULL DEFAULT 'main',
      source_code TEXT NOT NULL,
      parameters JSONB,
      memory_mb INTEGER NOT NULL DEFAULT 256,
      timeout_ms INTEGER NOT NULL DEFAULT 60000,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT,
      UNIQUE (workspace_id, action_name)
    )`);
  // Knative-backed functions: the ksvc name (added after the Job-era table).
  await pool.query('ALTER TABLE fn_actions ADD COLUMN IF NOT EXISTS ksvc_name TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fn_activations (
      activation_id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      status TEXT NOT NULL,
      status_code INTEGER,
      result JSONB,
      logs JSONB,
      duration_ms INTEGER,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )`);
}

// ---- function actions (real executor) --------------------------------------
export async function upsertFnAction(pool, a) {
  const { rows } = await pool.query(
    `INSERT INTO fn_actions (resource_id, workspace_id, tenant_id, action_name, runtime, entrypoint, source_code, parameters, memory_mb, timeout_ms, ksvc_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (workspace_id, action_name) DO UPDATE SET
       source_code=EXCLUDED.source_code, runtime=EXCLUDED.runtime, entrypoint=EXCLUDED.entrypoint,
       parameters=EXCLUDED.parameters, memory_mb=EXCLUDED.memory_mb, timeout_ms=EXCLUDED.timeout_ms,
       ksvc_name=EXCLUDED.ksvc_name, version=fn_actions.version+1, updated_at=NOW()
     RETURNING *`,
    [a.resourceId, a.workspaceId, a.tenantId, a.actionName, a.runtime, a.entrypoint, a.sourceCode,
     a.parameters ? JSON.stringify(a.parameters) : null, a.memoryMb, a.timeoutMs, a.ksvcName, a.createdBy]);
  return rows[0];
}
export async function getFnAction(pool, resourceId, tenantId = null) {
  if (tenantId != null) {
    const { rows } = await pool.query(
      'SELECT * FROM fn_actions WHERE resource_id=$1 AND tenant_id=$2 LIMIT 1',
      [resourceId, tenantId]);
    return rows[0] ?? null;
  }
  const { rows } = await pool.query('SELECT * FROM fn_actions WHERE resource_id=$1 LIMIT 1', [resourceId]);
  return rows[0] ?? null;
}
export async function listFnActions(pool, workspaceId) {
  const { rows } = await pool.query('SELECT * FROM fn_actions WHERE workspace_id=$1 ORDER BY created_at DESC', [workspaceId]);
  return rows;
}
export async function insertFnActivation(pool, a) {
  const { rows } = await pool.query(
    `INSERT INTO fn_activations (activation_id, resource_id, workspace_id, status, status_code, result, logs, duration_ms, started_at, finished_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [a.activationId, a.resourceId, a.workspaceId, a.status, a.statusCode,
     a.result != null ? JSON.stringify(a.result) : null, a.logs != null ? JSON.stringify(a.logs) : null,
     a.durationMs, a.startedAt, a.finishedAt]);
  return rows[0];
}
export async function listFnActivations(pool, resourceId, limit = 50) {
  const { rows } = await pool.query('SELECT * FROM fn_activations WHERE resource_id=$1 ORDER BY started_at DESC LIMIT $2', [resourceId, limit]);
  return rows;
}
export async function getFnActivation(pool, activationId) {
  const { rows } = await pool.query('SELECT * FROM fn_activations WHERE activation_id=$1 LIMIT 1', [activationId]);
  return rows[0] ?? null;
}
export async function latestFnActivation(pool, resourceId) {
  const { rows } = await pool.query('SELECT * FROM fn_activations WHERE resource_id=$1 ORDER BY started_at DESC LIMIT 1', [resourceId]);
  return rows[0] ?? null;
}

// ---- workspace databases ---------------------------------------------------
export async function insertWorkspaceDatabase(pool, d) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_databases (id, workspace_id, tenant_id, engine, database_name, mode, username, host, port, environment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, workspace_id, tenant_id, engine, database_name, mode, username, host, port, environment, status, created_at, created_by`,
    [d.id, d.workspaceId, d.tenantId, d.engine, d.databaseName, d.mode, d.username, d.host, d.port, d.environment ?? 'dev', d.createdBy]);
  return rows[0];
}
export async function databaseWorkspaceMap(pool) {
  const { rows } = await pool.query('SELECT database_name, workspace_id, tenant_id FROM workspace_databases');
  const map = {};
  for (const r of rows) map[r.database_name] = r;
  return map;
}
export async function getWorkspaceDatabase(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, engine, database_name, mode, username, host, port, status, created_at, created_by
       FROM workspace_databases WHERE workspace_id=$1 LIMIT 1`, [workspaceId]);
  return rows[0] ?? null;
}
export async function deleteWorkspaceDatabaseRecord(pool, id) {
  await pool.query('DELETE FROM workspace_databases WHERE id=$1', [id]);
}

// ---- workspace buckets (object store mapping) ------------------------------
export async function insertBucket(pool, { workspaceId, tenantId, bucketName, region }) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_buckets (workspace_id, tenant_id, bucket_name, region)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (bucket_name) DO UPDATE SET workspace_id=EXCLUDED.workspace_id, tenant_id=EXCLUDED.tenant_id
     RETURNING id, workspace_id, tenant_id, bucket_name, region, created_at`,
    [workspaceId, tenantId, bucketName, region]);
  return rows[0];
}
export async function listBucketsForWorkspace(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, bucket_name, region, created_at
       FROM workspace_buckets WHERE workspace_id=$1 ORDER BY created_at`, [workspaceId]);
  return rows;
}
export async function bucketWorkspaceMap(pool) {
  const { rows } = await pool.query('SELECT bucket_name, workspace_id, tenant_id, region, created_at FROM workspace_buckets');
  const map = {};
  for (const r of rows) map[r.bucket_name] = r;
  return map;
}
export async function getBucketRecord(pool, bucketName) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, bucket_name, region, created_at
       FROM workspace_buckets WHERE bucket_name=$1 LIMIT 1`, [bucketName]);
  return rows[0] ?? null;
}

// ---- workspace topics (event store mapping) --------------------------------
export async function insertTopic(pool, { id, workspaceId, tenantId, topicName, physicalTopicName, partitions }) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_topics (id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (physical_topic_name) DO UPDATE SET topic_name=EXCLUDED.topic_name
     RETURNING id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions, created_at`,
    [id, workspaceId, tenantId, topicName, physicalTopicName, partitions]);
  return rows[0];
}
export async function listTopicsForWorkspace(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions, created_at
       FROM workspace_topics WHERE workspace_id=$1 ORDER BY created_at`, [workspaceId]);
  return rows;
}
export async function getTopicByResourceId(pool, resourceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, topic_name, physical_topic_name, partitions, created_at
       FROM workspace_topics WHERE id=$1 LIMIT 1`, [resourceId]);
  return rows[0] ?? null;
}

// ---- workspace functions (registry) ----------------------------------------
export async function functionNameTaken(pool, workspaceId, name) {
  const { rows } = await pool.query('SELECT 1 FROM workspace_functions WHERE workspace_id=$1 AND name=$2 LIMIT 1', [workspaceId, name]);
  return rows.length > 0;
}
export async function insertFunction(pool, f) {
  const { rows } = await pool.query(
    `INSERT INTO workspace_functions (id, workspace_id, tenant_id, name, runtime, handler, source_ref, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, workspace_id, tenant_id, name, runtime, handler, source_ref, runtime_status, status, created_at, created_by`,
    [f.id, f.workspaceId, f.tenantId, f.name, f.runtime, f.handler, f.sourceRef, f.createdBy]);
  return rows[0];
}
export async function listFunctions(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, name, runtime, handler, source_ref, runtime_status, status, created_at, created_by
       FROM workspace_functions WHERE workspace_id=$1 ORDER BY created_at DESC`, [workspaceId]);
  return { items: rows, total: rows.length };
}

// ---- workspaces ------------------------------------------------------------
export async function workspaceSlugTaken(pool, tenantId, slug) {
  const { rows } = await pool.query('SELECT 1 FROM workspaces WHERE tenant_id=$1 AND slug=$2 LIMIT 1', [tenantId, slug]);
  return rows.length > 0;
}
export async function insertWorkspace(pool, { id, tenantId, slug, displayName, environment = 'dev', createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO workspaces (id, tenant_id, slug, display_name, environment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, tenant_id, slug, display_name, status, environment, created_at, created_by`,
    [id, tenantId, slug, displayName, environment, createdBy]);
  return rows[0];
}
export async function listWorkspaces(pool, { tenantId = null, limit = 100, offset = 0 } = {}) {
  const where = tenantId ? 'WHERE tenant_id = $3' : '';
  const params = tenantId ? [limit, offset, tenantId] : [limit, offset];
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, environment, created_at, created_by, COUNT(*) OVER() AS total
       FROM workspaces ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, params);
  return { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}
export async function getWorkspace(pool, idOrSlug) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, environment, created_at, created_by
       FROM workspaces WHERE id = $1 OR slug = $1 LIMIT 1`, [idOrSlug]);
  return rows[0] ?? null;
}
// List a tenant's first-class environments (#503): one entry per environment, each with its
// workspaces + provisioned databases — proving multiple isolated environments per project, every
// environment carrying its own isolated resource set (the per-workspace wsdb_* DB from D2/#502).
export async function listTenantEnvironments(pool, tenantId) {
  const { rows } = await pool.query(
    `SELECT w.environment,
            COUNT(*)::int AS workspace_count,
            json_agg(json_build_object('workspaceId', w.id, 'slug', w.slug, 'displayName', w.display_name,
                                       'database', d.database_name) ORDER BY w.created_at) AS workspaces
       FROM workspaces w
       LEFT JOIN workspace_databases d ON d.workspace_id = w.id
      WHERE w.tenant_id = $1
      GROUP BY w.environment
      ORDER BY w.environment`, [tenantId]);
  return rows.map((r) => ({ environment: r.environment, workspaceCount: r.workspace_count, workspaces: r.workspaces }));
}

// ---- service accounts ------------------------------------------------------
export async function insertServiceAccount(pool, sa) {
  const { rows } = await pool.query(
    `INSERT INTO service_accounts (id, workspace_id, tenant_id, iam_realm, kc_client_id, kc_client_uuid, display_name, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, workspace_id, tenant_id, kc_client_id, display_name, status, created_at, created_by`,
    [sa.id, sa.workspaceId, sa.tenantId, sa.iamRealm, sa.kcClientId, sa.kcClientUuid, sa.displayName, sa.createdBy]);
  return rows[0];
}
export async function getServiceAccount(pool, id) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, iam_realm, kc_client_id, kc_client_uuid, display_name, status, created_at, created_by
       FROM service_accounts WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}
export async function listServiceAccounts(pool, workspaceId) {
  const { rows } = await pool.query(
    `SELECT id, workspace_id, tenant_id, kc_client_id, display_name, status, created_at, created_by
       FROM service_accounts WHERE workspace_id = $1 ORDER BY created_at DESC`, [workspaceId]);
  return { items: rows, total: rows.length };
}
export async function setServiceAccountStatus(pool, id, status) {
  await pool.query('UPDATE service_accounts SET status=$2 WHERE id=$1', [id, status]);
}

export async function slugTaken(pool, slug) {
  const { rows } = await pool.query('SELECT 1 FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
  return rows.length > 0;
}

export async function insertTenant(pool, { id, slug, displayName, iamRealm, createdBy }) {
  const { rows } = await pool.query(
    // $1 arrives as text; cast explicitly so it is not deduced as both uuid and text.
    `INSERT INTO tenants (id, tenant_id, slug, display_name, iam_realm, created_by)
     VALUES ($1, $1, $2, $3, $4, $5)
     RETURNING id, tenant_id, slug, display_name, status, iam_realm, created_at, created_by`,
    [id, slug, displayName, iamRealm, createdBy]
  );
  return rows[0];
}

export async function listTenants(pool, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, iam_realm, created_at, created_by,
            COUNT(*) OVER() AS total
       FROM tenants ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
  return { items: rows.map(({ total, ...r }) => r), total: Number(rows[0]?.total ?? 0) };
}

export async function getTenant(pool, idOrSlug) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, slug, display_name, status, iam_realm, created_at, created_by
       FROM tenants WHERE id = $1 OR slug = $1 LIMIT 1`, [idOrSlug]);
  return rows[0] ?? null;
}

export async function deleteTenant(pool, id) {
  await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
}

// Soft delete: mark the tenant 'deleted' (offboarding without destroying data yet).
export async function markTenantDeleted(pool, id) {
  const { rows } = await pool.query(
    `UPDATE tenants SET status='deleted' WHERE id=$1 RETURNING id, slug, display_name, status, iam_realm`, [id]);
  return rows[0] ?? null;
}

// Cascading purge of every row a tenant owns (add-tenant-delete-purge-cascade, #501). Collects
// the physical resources the caller must tear down (databases/buckets/topics/ksvcs) BEFORE
// deleting the registry rows, then deletes child rows before parents. Each table delete is
// best-effort (a table absent in this hand-built runtime — e.g. product-migration plan tables —
// must not abort the purge); the operation is idempotent, so a partial run can simply be retried.
export async function purgeTenant(pool, tenantId) {
  const collect = async (sql) => { try { return (await pool.query(sql, [tenantId])).rows; } catch { return []; } };
  const databases = (await collect('SELECT database_name FROM workspace_databases WHERE tenant_id=$1')).map((r) => r.database_name);
  const buckets = (await collect('SELECT bucket_name FROM workspace_buckets WHERE tenant_id=$1')).map((r) => r.bucket_name);
  const topics = (await collect('SELECT physical_topic_name FROM workspace_topics WHERE tenant_id=$1')).map((r) => r.physical_topic_name);
  const ksvcs = (await collect("SELECT ksvc_name FROM fn_actions WHERE tenant_id=$1 AND ksvc_name IS NOT NULL")).map((r) => r.ksvc_name);
  const workspaceIds = (await collect('SELECT id FROM workspaces WHERE tenant_id=$1')).map((r) => r.id);

  const del = async (sql, params) => { try { await pool.query(sql, params); } catch (e) { if (e.code !== '42P01') throw e; } }; // ignore undefined_table
  // fn_activations has no tenant_id — scope by the tenant's workspaces.
  if (workspaceIds.length) await del('DELETE FROM fn_activations WHERE workspace_id = ANY($1)', [workspaceIds]);
  for (const t of ['fn_actions', 'workspace_functions', 'workspace_topics', 'workspace_buckets',
                   'workspace_databases', 'workspace_api_keys', 'service_accounts',
                   'async_operation_log_entries', 'async_operation_transitions', 'async_operations',
                   'tenant_plan_assignments', 'tenant_custom_roles', 'effective_entitlements']) {
    await del(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
  }
  await del('DELETE FROM workspaces WHERE tenant_id = $1', [tenantId]);
  await del('DELETE FROM tenants WHERE id = $1', [tenantId]);
  return { databases, buckets, topics, ksvcs, workspaceIds };
}
