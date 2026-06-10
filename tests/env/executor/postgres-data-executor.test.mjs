// Real-Postgres proof for change add-control-plane-executor (+ add-workspace-db-connection-registry).
//
// Proves the keystone thesis: the spec-only PostgREST-style adapter plans now ACTUALLY
// EXECUTE against a real Postgres through the executor + connection registry, scoped to
// the caller's tenant, as a NON-superuser role. RLS is a real-DB behavior, so this lives
// in tests/env (run via tests/env/executor/run.sh), like the rest of the real stack.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../../apps/control-plane/src/runtime/connection-registry.mjs';
import { executePostgresData } from '../../../apps/control-plane/src/runtime/postgres-data-executor.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'cp_exec_probe';
const APP_LOGIN = 'cp_exec_app';
const APP_PW = 'cp_exec_local_only';

const TEN_A = 'ten_a';
const WS_A = 'ws_a';
const TEN_B = 'ten_b';
const WS_B = 'ws_b';
const DB = 'appdb';

let bootstrap; // superuser → default db (create/drop probe db)
let admin; // superuser → probe db (seed)
let registry; // executor connection registry (connects as the non-superuser app role)
const seeded = {}; // remembers seeded row ids per tenant

function probeUrl(role, pw) {
  const base = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  return role ? base.replace(/\/\/[^:]+:[^@]+@/, `//${role}:${pw}@`) : base;
}

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);

  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await admin.query(`CREATE TABLE public.notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL,
      workspace_id text NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS`);
  await admin.query('CREATE UNIQUE INDEX notes_tenant_body_uq ON public.notes (tenant_id, body)');
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_LOGIN}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.notes TO ${APP_LOGIN}`);

  // Seed as superuser (bypasses any scoping): 2 rows for tenant A, 1 for tenant B.
  const a1 = await admin.query(`INSERT INTO public.notes (tenant_id, workspace_id, body) VALUES ($1,$2,'a-one') RETURNING id`, [TEN_A, WS_A]);
  await admin.query(`INSERT INTO public.notes (tenant_id, workspace_id, body) VALUES ($1,$2,'a-two')`, [TEN_A, WS_A]);
  const b1 = await admin.query(`INSERT INTO public.notes (tenant_id, workspace_id, body) VALUES ($1,$2,'b-one') RETURNING id`, [TEN_B, WS_B]);
  seeded.a = a1.rows[0].id;
  seeded.b = b1.rows[0].id;

  // Registry: every workspace maps to the probe db, connecting as the non-superuser app role.
  const appDsn = probeUrl(APP_LOGIN, APP_PW);
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appDsn }) });
});

after(async () => {
  await registry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`).catch(() => {});
    await bootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

const reqBase = (tenantId, workspaceId) => ({
  workspaceId,
  databaseName: DB,
  schemaName: 'public',
  tableName: 'notes',
  identity: { tenantId, workspaceId, roleName: APP_LOGIN },
});

test('list returns ONLY the caller tenant rows (adapter plan executed)', async () => {
  const a = await executePostgresData(registry, { ...reqBase(TEN_A, WS_A), operation: 'list' });
  assert.equal(a.items.length, 2, 'tenant A sees its 2 rows');
  assert.ok(a.items.every((r) => r.tenant_id === TEN_A), 'no cross-tenant rows');

  const b = await executePostgresData(registry, { ...reqBase(TEN_B, WS_B), operation: 'list' });
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].tenant_id, TEN_B);
});

test('insert stamps the verified tenant and is then visible to that tenant only', async () => {
  // Attempt to forge tenant_id = B while authenticated as A; executor must stamp A.
  const ins = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A),
    operation: 'insert',
    values: { body: 'a-three', tenant_id: TEN_B },
  });
  assert.equal(ins.item.tenant_id, TEN_A, 'forged tenant_id ignored; stamped from identity');

  const a = await executePostgresData(registry, { ...reqBase(TEN_A, WS_A), operation: 'list' });
  assert.equal(a.items.length, 3, 'tenant A now sees 3 rows');

  const b = await executePostgresData(registry, { ...reqBase(TEN_B, WS_B), operation: 'list' });
  assert.equal(b.items.length, 1, 'tenant B unaffected by A insert');
});

test('get by primary key is tenant-scoped (cross-tenant id returns not found)', async () => {
  const own = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A),
    operation: 'get',
    primaryKey: { id: seeded.a },
  });
  assert.equal(own.found, true);
  assert.equal(own.item.tenant_id, TEN_A);

  // Tenant A asks for tenant B's row by id → blocked by the injected predicate.
  const cross = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A),
    operation: 'get',
    primaryKey: { id: seeded.b },
  });
  assert.equal(cross.found, false, 'cross-tenant get returns nothing');
});

test('filter is applied within tenant scope', async () => {
  const res = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A),
    operation: 'list',
    filters: [{ columnName: 'body', operator: 'eq', value: 'a-one' }],
  });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].body, 'a-one');
});

test('delete by primary key is tenant-scoped (cannot delete another tenant row)', async () => {
  // Tenant A tries to delete tenant B's seeded row → 0 affected (predicate blocks it).
  const crossDel = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A),
    operation: 'delete',
    primaryKey: { id: seeded.b },
  });
  assert.equal(crossDel.affected, 0, 'cannot delete across tenants');

  // Tenant B can delete its own row.
  const ownDel = await executePostgresData(registry, {
    ...reqBase(TEN_B, WS_B),
    operation: 'delete',
    primaryKey: { id: seeded.b },
  });
  assert.equal(ownDel.affected, 1);
});

test('bulk_insert stamps tenant on every row and inserts all', async () => {
  const res = await executePostgresData(registry, {
    ...reqBase(TEN_A, WS_A),
    operation: 'bulk_insert',
    rows: [{ body: 'bulk1' }, { body: 'bulk2' }, { body: 'bulk3' }],
  });
  assert.equal(res.affected, 3);
  assert.equal(res.items.length, 3);
  assert.ok(res.items.every((r) => r.tenant_id === TEN_A));
});

test('list with countMode=exact returns a numeric count', async () => {
  const res = await executePostgresData(registry, { ...reqBase(TEN_A, WS_A), operation: 'list', countMode: 'exact' });
  assert.equal(typeof res.count, 'number');
  assert.equal(res.count, res.items.length, 'count matches the returned rows (within one page)');
});

test('unknown table → 404 client error (sanitized)', async () => {
  await assert.rejects(
    () => executePostgresData(registry, { ...reqBase(TEN_A, WS_A), operation: 'list', tableName: 'does_not_exist' }),
    (e) => e.statusCode === 404 && e.code === 'TABLE_NOT_FOUND',
  );
});

test('unique violation → 409 (sanitized, no SQL/detail leak)', async () => {
  await assert.rejects(
    () => executePostgresData(registry, { ...reqBase(TEN_A, WS_A), operation: 'insert', values: { body: 'a-one' } }),
    (e) => e.statusCode === 409 && e.code === 'UNIQUE_VIOLATION' && !/notes_tenant_body_uq|INSERT/i.test(e.message),
  );
});

test('missing tenant identity → 401', async () => {
  await assert.rejects(
    () => executePostgresData(registry, { ...reqBase(undefined, WS_A), operation: 'list' }),
    (e) => e.statusCode === 401,
  );
});
