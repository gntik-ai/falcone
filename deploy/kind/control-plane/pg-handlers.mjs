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

const { Client } = pg;
const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const coll = (items) => ({ items, page: { total: items.length } });
const D = (s) => decodeURIComponent(s);

async function withDb(database, fn) {
  const c = new Client({
    host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER, password: process.env.PGPASSWORD, database,
    connectionTimeoutMillis: 5000, statement_timeout: 10000
  });
  await c.connect();
  try { return await fn(c); } finally { await c.end().catch(() => {}); }
}

// GET /v1/postgres/databases — all non-template databases (cluster-wide).
async function pgListDatabases(ctx) {
  const { rows } = await ctx.pool.query(
    `SELECT d.datname, r.rolname AS owner
       FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
      WHERE d.datistemplate = false ORDER BY d.datname`);
  const map = await store.databaseWorkspaceMap(ctx.pool);
  const items = rows.map((x) => ({
    databaseName: x.datname, state: 'active', ownerRoleName: x.owner, placementMode: 'shared',
    tenantId: map[x.datname]?.tenant_id ?? null, workspaceId: map[x.datname]?.workspace_id ?? null
  }));
  return ok(200, coll(items));
}

async function pgListSchemas(ctx) {
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

export const PG_HANDLERS = {
  pgListDatabases, pgListSchemas, pgListTables, pgColumns, pgIndexes, pgPolicies, pgSecurity, pgViews, pgMatViews
};
