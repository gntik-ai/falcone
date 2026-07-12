/**
 * Black-box tests for cross-tenant Postgres metadata-browse scoping
 * (fix-pg-browse-tenant-scope, #551 ISO-PG-META, P1).
 *
 * The bug: the kind control-plane console-browser handlers run with route auth
 * `authenticated` only. `GET /v1/postgres/databases` scanned `pg_database`
 * cluster-wide — listing EVERY tenant's `wsdb_*` databases plus the platform
 * control DB `in_falcone` — and the by-name browse routes
 * (`/databases/{db}/schemas|tables|columns|...`) accepted any database name, so a
 * tenant operator could enumerate another tenant's schema/table/column structure.
 * (Row DATA stays RLS-protected; this is a metadata/structure leak.)
 *
 * The fix mirrors the P0 browse fixes (ISO-MONGO/ISO-EVENTS): a database is owned
 * by the tenant recorded in `workspace_databases`; platform callers
 * (superadmin/internal) may browse the whole cluster, a tenant caller may browse
 * ONLY databases its tenant owns, everything else 404s with no existence leak.
 *
 * Drives the canonical kind handlers (`PG_HANDLERS`) through a stub pool. The
 * tenant-scope guard short-circuits before any real DB connection, so the
 * cross-tenant denial + the list filtering are asserted deterministically.
 *
 * bbx-551-01: tenant caller's database list omits other tenants' + system DBs
 * bbx-551-02: platform (superadmin) caller still sees the full cluster
 * bbx-551-03: tenant caller browsing another tenant's DB → 404 (no existence leak)
 * bbx-551-04: tenant caller browsing the platform `in_falcone` DB → 404
 * bbx-551-05: every by-name browse route enforces the same cross-tenant 404
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PG_HANDLERS } from '../../apps/control-plane/pg-handlers.mjs';

const ACME = 'acme-78848e21';
const GLOBEX = 'globex-fe63fa39';

const DATABASES = [
  { datname: 'wsdb_acme_app_staging', owner: 'falcone' },
  { datname: 'wsdb_globex_app_prod', owner: 'falcone' },
  { datname: 'in_falcone', owner: 'postgres' },
];
const WORKSPACE_DATABASES = [
  { database_name: 'wsdb_acme_app_staging', workspace_id: 'ws-acme-1', tenant_id: ACME },
  { database_name: 'wsdb_globex_app_prod', workspace_id: 'ws-globex-1', tenant_id: GLOBEX },
];

// A stub pool that answers only the two metadata queries the scoping logic needs.
const pool = {
  query: async (sql) => {
    if (/FROM\s+workspace_databases/i.test(sql)) return { rows: WORKSPACE_DATABASES };
    if (/FROM\s+pg_database/i.test(sql)) return { rows: DATABASES };
    throw new Error(`unexpected query in stubbed scope test: ${sql}`);
  },
};

const acmeOwner = { actorType: 'tenant_owner', tenantId: ACME };
const superadmin = { actorType: 'superadmin' };

const ctx = (identity, params = {}) => ({ pool, identity, params, query: {} });

test('bbx-551-01: tenant caller sees only its own databases', async () => {
  const res = await PG_HANDLERS.pgListDatabases(ctx(acmeOwner));
  assert.equal(res.statusCode, 200);
  const names = res.body.items.map((i) => i.databaseName);
  assert.deepEqual(names, ['wsdb_acme_app_staging'], `acme must see only its own DB, got ${JSON.stringify(names)}`);
  assert.ok(!names.includes('in_falcone'), 'platform control DB must never be exposed to a tenant');
  assert.ok(!names.includes('wsdb_globex_app_prod'), "another tenant's DB must not be listed");
});

test('bbx-551-02: platform caller still sees the whole cluster', async () => {
  const res = await PG_HANDLERS.pgListDatabases(ctx(superadmin));
  assert.equal(res.statusCode, 200);
  const names = res.body.items.map((i) => i.databaseName).sort();
  assert.deepEqual(names, ['in_falcone', 'wsdb_acme_app_staging', 'wsdb_globex_app_prod']);
});

test("bbx-551-03: tenant caller browsing another tenant's DB → 404 no existence leak", async () => {
  const res = await PG_HANDLERS.pgListSchemas(ctx(acmeOwner, { db: 'wsdb_globex_app_prod' }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'PG_DATABASE_NOT_FOUND');
});

test('bbx-551-04: tenant caller browsing the platform in_falcone DB → 404', async () => {
  const res = await PG_HANDLERS.pgListSchemas(ctx(acmeOwner, { db: 'in_falcone' }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'PG_DATABASE_NOT_FOUND');
});

test('bbx-551-05: every by-name browse route enforces cross-tenant 404', async () => {
  const params = { db: 'wsdb_globex_app_prod', schema: 'public', table: 't', col: 'c' };
  const routes = ['pgListSchemas', 'pgListTables', 'pgColumns', 'pgIndexes', 'pgPolicies', 'pgSecurity', 'pgViews', 'pgMatViews'];
  for (const name of routes) {
    const res = await PG_HANDLERS[name](ctx(acmeOwner, params));
    assert.equal(res.statusCode, 404, `${name} must 404 cross-tenant (got ${res.statusCode})`);
    assert.equal(res.body.code, 'PG_DATABASE_NOT_FOUND', `${name} must not leak existence`);
  }
});
