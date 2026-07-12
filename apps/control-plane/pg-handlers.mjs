// Console PostgreSQL data-browser handlers — REAL Postgres (kind deploy).
//
// The web-console Postgres page browses databases -> schemas -> tables ->
// columns/indexes/policies/security, plus views and materialized views. We answer
// from `pg_catalog` / `information_schema` using the `pg` driver already in the
// image. Each per-database query opens a short-lived Client to THAT database
// (Postgres catalogs are per-database) using the same PG* creds; the database list
// is cluster-wide so it uses the shared control-plane pool. Read-only.
import pg from 'pg';
import * as store from './tenant-store.mjs';
import { callerTenantScope, canManageTenant } from './tenant-scope.mjs';
import { withPostgresSsl } from './transport-security.mjs';

const { Client } = pg;
const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const coll = (items) => ({ items, page: { total: items.length } });
const D = (s) => decodeURIComponent(s);

// Tenant-scope guard for the by-name database browse routes (route auth is only
// `authenticated`, so any verified caller reaches these). A database is owned by
// the tenant recorded in `workspace_databases`; the platform control DB
// `in_falcone` (and any unmapped system DB) has no such row. Mirrors the P0
// browse fixes (ISO-MONGO/ISO-EVENTS): platform callers (superadmin/internal) may
// browse any DB; a tenant caller may browse ONLY a DB its tenant owns; everything
// else 404s with NO existence leak. (#551 ISO-PG-META)
async function assertDbScope(ctx) {
  const db = D(ctx.params.db);
  const map = await store.databaseWorkspaceMap(ctx.pool);
  const owningTenant = map[db]?.tenant_id ?? null;
  if (!canManageTenant(ctx?.identity, owningTenant)) {
    return err(404, 'PG_DATABASE_NOT_FOUND', `database ${db} not found`);
  }
  return null;
}

async function withDb(database, fn, injectedClient = null) {
  // Test seam (#683): the export/import handlers may inject a per-DB client (mirrors mongo-handlers'
  // ctx.mongoClient) so the data round-trip is unit-testable without a live Postgres. Production
  // never injects — server.mjs builds ctx without pgClient — so the live path opens a real Client.
  if (injectedClient) return fn(injectedClient);
  const c = new Client(withPostgresSsl({
    host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER, password: process.env.PGPASSWORD, database,
    connectionTimeoutMillis: 5000, statement_timeout: 10000
  }));
  await c.connect();
  try { return await fn(c); } finally { await c.end().catch(() => {}); }
}

// GET /v1/postgres/databases — non-template databases. The raw cluster scan would
// list EVERY tenant's `wsdb_*` databases plus the platform control DB `in_falcone`
// (a cross-tenant metadata/structure leak). Restrict the result to the databases
// the caller's tenant owns (per `workspace_databases`); platform callers
// (superadmin/internal) still see the full cluster. (#551 ISO-PG-META)
async function pgListDatabases(ctx) {
  const { rows } = await ctx.pool.query(
    `SELECT d.datname, r.rolname AS owner
       FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
      WHERE d.datistemplate = false ORDER BY d.datname`);
  const map = await store.databaseWorkspaceMap(ctx.pool);
  const scope = callerTenantScope(ctx?.identity);
  const items = rows
    .map((x) => ({
      databaseName: x.datname, state: 'active', ownerRoleName: x.owner, placementMode: 'shared',
      tenantId: map[x.datname]?.tenant_id ?? null, workspaceId: map[x.datname]?.workspace_id ?? null
    }))
    // A tenant caller sees only databases mapped to its own tenant; this drops both
    // other tenants' `wsdb_*` and unmapped system DBs (`in_falcone`, postgres, …).
    .filter((it) => scope == null || it.tenantId === scope);
  return ok(200, coll(items));
}

async function pgListSchemas(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT n.nspname AS schema, pg_get_userbyid(n.nspowner) AS owner,
           (SELECT count(*) FROM pg_class WHERE relnamespace=n.oid AND relkind='r') AS tables,
           (SELECT count(*) FROM pg_class WHERE relnamespace=n.oid AND relkind='v') AS views,
           (SELECT count(*) FROM pg_class WHERE relnamespace=n.oid AND relkind='m') AS matviews,
           (SELECT count(*) FROM pg_class WHERE relnamespace=n.oid AND relkind='i') AS indexes
         FROM pg_namespace n
         WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
           AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast_temp%'
         ORDER BY n.nspname`);
      return ok(200, coll(rows.map((r) => ({
        schemaName: r.schema, state: 'active', ownerRoleName: r.owner,
        objectCounts: { tables: Number(r.tables), views: Number(r.views), materializedViews: Number(r.matviews), indexes: Number(r.indexes) }
      }))));
    });
  } catch (e) { return err(502, 'PG_SCHEMAS_FAILED', String(e.message ?? e)); }
}

async function pgListTables(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  const schema = D(ctx.params.schema);
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT c.relname AS table_name,
           (SELECT count(*) FROM information_schema.columns col WHERE col.table_schema=$1 AND col.table_name=c.relname) AS cols
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND c.relkind='r' ORDER BY c.relname`, [schema]);
      return ok(200, coll(rows.map((r) => ({ tableName: r.table_name, state: 'active', columnCount: Number(r.cols) }))));
    });
  } catch (e) { return err(502, 'PG_TABLES_FAILED', String(e.message ?? e)); }
}

async function pgColumns(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  const schema = D(ctx.params.schema); const table = D(ctx.params.table);
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
         FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, table]);
      return ok(200, coll(rows.map((r) => ({
        columnName: r.column_name, dataType: { typeName: r.data_type },
        nullable: r.is_nullable === 'YES', defaultExpression: r.column_default ?? undefined, ordinalPosition: r.ordinal_position
      }))));
    });
  } catch (e) { return err(502, 'PG_COLUMNS_FAILED', String(e.message ?? e)); }
}

async function pgIndexes(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  const schema = D(ctx.params.schema); const table = D(ctx.params.table);
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT i.relname AS index_name, am.amname AS method, ix.indisunique AS is_unique,
           ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
                 FROM generate_subscripts(ix.indkey, 1) k) AS keys
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         WHERE n.nspname=$1 AND t.relname=$2 ORDER BY i.relname`, [schema, table]);
      return ok(200, coll(rows.map((r) => ({
        indexName: r.index_name, indexMethod: r.method, unique: r.is_unique,
        keys: (r.keys ?? []).map((k) => ({ columnName: k }))
      }))));
    });
  } catch (e) { return err(502, 'PG_INDEXES_FAILED', String(e.message ?? e)); }
}

async function pgPolicies(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  const schema = D(ctx.params.schema); const table = D(ctx.params.table);
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT policyname, permissive, roles, cmd, qual, with_check
         FROM pg_policies WHERE schemaname=$1 AND tablename=$2 ORDER BY policyname`, [schema, table]);
      return ok(200, coll(rows.map((r) => ({
        policyName: r.policyname, policyMode: r.permissive === 'PERMISSIVE' ? 'permissive' : 'restrictive', state: 'active',
        appliesTo: { command: r.cmd, roles: r.roles ?? [] },
        usingExpression: r.qual ?? undefined, withCheckExpression: r.with_check ?? undefined
      }))));
    });
  } catch (e) { return err(502, 'PG_POLICIES_FAILED', String(e.message ?? e)); }
}

async function pgSecurity(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  const schema = D(ctx.params.schema); const table = D(ctx.params.table);
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
           (SELECT count(*) FROM pg_policies WHERE schemaname=$1 AND tablename=$2) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND c.relname=$2`, [schema, table]);
      const r = rows[0];
      if (!r) return err(404, 'TABLE_NOT_FOUND', `table ${schema}.${table} not found`);
      return ok(200, { rlsEnabled: r.rls, forceRls: r.force_rls, policyCount: Number(r.policies), state: 'active' });
    });
  } catch (e) { return err(502, 'PG_SECURITY_FAILED', String(e.message ?? e)); }
}

async function pgViews(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  const schema = D(ctx.params.schema);
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT table_name AS view_name, view_definition AS def
         FROM information_schema.views WHERE table_schema=$1 ORDER BY table_name`, [schema]);
      return ok(200, coll(rows.map((r) => ({ viewName: r.view_name, state: 'active', query: r.def ?? undefined }))));
    });
  } catch (e) { return err(502, 'PG_VIEWS_FAILED', String(e.message ?? e)); }
}

async function pgMatViews(ctx) {
  const denied = await assertDbScope(ctx); if (denied) return denied;
  const schema = D(ctx.params.schema);
  try {
    return await withDb(D(ctx.params.db), async (c) => {
      const { rows } = await c.query(
        `SELECT matviewname AS view_name, definition AS def, ispopulated AS populated
         FROM pg_matviews WHERE schemaname=$1 ORDER BY matviewname`, [schema]);
      return ok(200, coll(rows.map((r) => ({
        viewName: r.view_name, state: 'active', query: r.def ?? undefined, withData: r.populated,
        integrityProfile: { populationState: r.populated ? 'populated' : 'unpopulated', withData: r.populated }
      }))));
    });
  } catch (e) { return err(502, 'PG_MATVIEWS_FAILED', String(e.message ?? e)); }
}

// ---- table data export / import (#683, data-export-import-clone) ------------
// Bounded, synchronous, inline-row movement, WORKSPACE-addressed. CRITICAL SQL-injection guard: the
// schema/table/column identifiers arrive in the path/body and CANNOT be bound as parameters (only
// VALUES can), so every identifier is (1) validated to EXIST in information_schema for the target
// database and (2) double-quote-escaped — never string-interpolated raw. Row VALUES are always bound
// via $N placeholders. v1 caps the operation at PG_IO_MAX_ROWS rows (no async/streaming pipeline).
const PG_IO_MAX_ROWS = (() => { const n = Number(process.env.PG_IO_MAX_ROWS); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10000; })();

// Quote a SQL identifier: double the embedded double-quotes and wrap in double quotes. This is the
// canonical Postgres identifier-quoting rule (equivalent to pg-format %I). Applied ONLY to
// identifiers that have ALSO been validated against information_schema (defense in depth).
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

// Own-tenant gate the workspace AND verify the named database is mapped to THAT workspace (so a
// caller cannot export from another workspace's — or another tenant's — database). 404 on any
// mismatch (no existence leak). Returns { ws, database } or { error }.
async function ownedWorkspaceDb(ctx) {
  const ws = await store.getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!ws || !canManageTenant(ctx.identity, ws.tenant_id)) {
    return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
  }
  const database = D(ctx.params.databaseName);
  const map = await store.databaseWorkspaceMap(ctx.pool);
  const row = map[database];
  // Superadmin/internal may reach any mapped db; a tenant caller's db must be mapped to THIS
  // workspace and tenant.
  const sup = ctx.identity?.actorType === 'superadmin' || ctx.identity?.actorType === 'internal';
  if (!row || (!sup && (row.workspace_id !== ws.id || row.tenant_id !== ws.tenant_id))) {
    return { error: err(404, 'PG_DATABASE_NOT_FOUND', `database ${database} not found`) };
  }
  return { ws, database };
}

// Resolve the validated, quoted (schema, table) and the validated column set for a table in `c`,
// using information_schema. Returns { schema, table, columns } (all RAW validated names) or { error }.
async function resolveTableColumns(c, schemaName, tableName) {
  const t = await c.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=$2 LIMIT 1`,
    [schemaName, tableName]);
  if (!t.rows.length) return { error: err(404, 'TABLE_NOT_FOUND', `table ${schemaName}.${tableName} not found`) };
  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
    [schemaName, tableName]);
  return { schema: schemaName, table: tableName, columns: cols.rows.map((r) => r.column_name) };
}

// POST .../schemas/{schemaName}/tables/{tableName}/exports
async function pgDataExport(ctx) {
  const { error, database } = await ownedWorkspaceDb(ctx);
  if (error) return error;
  const schemaName = D(ctx.params.schemaName);
  const tableName = D(ctx.params.tableName);
  const limit = Math.min(Math.max(Number(ctx.body?.limit ?? PG_IO_MAX_ROWS) || PG_IO_MAX_ROWS, 1), PG_IO_MAX_ROWS);
  try {
    return await withDb(database, async (c) => {
      const resolved = await resolveTableColumns(c, schemaName, tableName);
      if (resolved.error) return resolved.error;
      // Identifiers validated against information_schema above; quote (never interpolate raw).
      const sql = `SELECT * FROM ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)} LIMIT $1`;
      const { rows } = await c.query(sql, [limit]);
      return ok(200, {
        entityType: 'postgres_data_export',
        databaseName: database, schemaName: resolved.schema, tableName: resolved.table,
        columns: resolved.columns, exportedAt: new Date().toISOString(),
        rowCount: rows.length, rows
      });
    }, ctx.pgClient);
  } catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'PG_EXPORT_FAILED', String(e.message ?? e)); }
}

// POST .../schemas/{schemaName}/tables/{tableName}/imports
async function pgDataImport(ctx) {
  const { error, database } = await ownedWorkspaceDb(ctx);
  if (error) return error;
  const schemaName = D(ctx.params.schemaName);
  const tableName = D(ctx.params.tableName);
  const rows = Array.isArray(ctx.body?.rows) ? ctx.body.rows : null;
  if (!rows) return err(400, 'VALIDATION_ERROR', 'rows (array) is required');
  if (rows.length > PG_IO_MAX_ROWS) return err(413, 'PG_IMPORT_TOO_LARGE', `import exceeds the ${PG_IO_MAX_ROWS}-row limit`);
  try {
    return await withDb(database, async (c) => {
      const resolved = await resolveTableColumns(c, schemaName, tableName);
      if (resolved.error) return resolved.error;
      const allowed = new Set(resolved.columns);
      let imported = 0;
      const skipped = [];
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        if (!row || typeof row !== 'object' || Array.isArray(row)) { skipped.push({ index: i, reason: 'NOT_AN_OBJECT' }); continue; }
        // Keep ONLY columns that exist in the table (validated against information_schema). Any
        // unknown column key is dropped — an attacker cannot inject an identifier that isn't a real,
        // pre-validated column of this exact table.
        const keys = Object.keys(row).filter((k) => allowed.has(k));
        if (keys.length === 0) { skipped.push({ index: i, reason: 'NO_KNOWN_COLUMNS' }); continue; }
        const colSql = keys.map(quoteIdent).join(', ');
        const placeholders = keys.map((_, j) => `$${j + 1}`).join(', ');
        const values = keys.map((k) => row[k]);
        const sql = `INSERT INTO ${quoteIdent(resolved.schema)}.${quoteIdent(resolved.table)} (${colSql}) VALUES (${placeholders})`;
        try { await c.query(sql, values); imported += 1; }
        catch (e) { skipped.push({ index: i, reason: 'INSERT_FAILED', detail: String(e?.code ?? '') }); }
      }
      return ok(200, {
        entityType: 'postgres_data_import_result',
        databaseName: database, schemaName: resolved.schema, tableName: resolved.table,
        importedAt: new Date().toISOString(),
        totalEntries: rows.length, importedCount: imported, skippedCount: skipped.length, skipped
      });
    }, ctx.pgClient);
  } catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'PG_IMPORT_FAILED', String(e.message ?? e)); }
}

export const PG_HANDLERS = {
  pgListDatabases, pgListSchemas, pgListTables, pgColumns, pgIndexes, pgPolicies, pgSecurity, pgViews, pgMatViews,
  pgDataExport, pgDataImport
};
// Exported for unit testing the SQL-injection identifier guard in isolation.
export { quoteIdent };
