// Real-Postgres proof for change add-flows-activity-catalog (#360), task 10.2 + spec
// scenario "Cross-tenant isolation via RLS".
//
// Proves the cardinal property END-TO-END THROUGH THE db.query ACTIVITY PATH: a tenant-A
// `db.query` activity (the production activity → real executePostgresData → real connection
// registry, run under the non-superuser, NON-BYPASSRLS `falcone_service` role) can NEVER
// read tenant-B rows, even with a forgotten/absent WHERE predicate. RLS is a real-DB
// behaviour, so this lives in tests/env (docker-compose Postgres), self-skipping when the
// database is unreachable (repo precedent: pgvector / flows-rls real-stack tests).
//
//   bash tests/env/flows-api/run.sh   (or any tests/env Postgres bring-up)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../apps/control-plane/src/runtime/connection-registry.mjs';
import { executePostgresData } from '../../apps/control-plane/src/runtime/postgres-data-executor.mjs';
import { dbQuery } from '../../services/workflow-worker/src/activities/db-query.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'flows_act_dbq_probe';
const APP_LOGIN = 'flows_act_service_login';
const APP_PW = 'flows_act_local_only';

const TEN_A = 'ten_a';
const WS_A = 'ws_a';
const TEN_B = 'ten_b';
const WS_B = 'ws_b';
const DB = 'appdb';

let bootstrap; // superuser → default db (create/drop probe db)
let admin; // superuser → probe db (DDL + seed)
let registry; // executor connection registry (connects as the non-superuser falcone_service role)
let available = false;

function probeUrl(role, pw) {
  const base = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  return role ? base.replace(/\/\/[^:]+:[^@]+@/, `//${role}:${pw}@`) : base;
}

before(async () => {
  try {
    bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
    await bootstrap.query('SELECT 1');
  } catch {
    available = false;
    return; // Postgres not reachable → tests self-skip
  }
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);

  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // A plain tenant-scoped table the activity reads/writes via the data API.
  await admin.query(`CREATE TABLE public.items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL,
      workspace_id text NOT NULL,
      name text NOT NULL
    )`);

  // The production service role: non-superuser, NON-BYPASSRLS (RLS only enforces against
  // such a role — a superuser bypasses FORCE). `db.query` runs under exactly this dbRole.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_service') THEN
      CREATE ROLE falcone_service NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS IN ROLE falcone_service`);
  await admin.query('GRANT USAGE ON SCHEMA public TO falcone_service');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO falcone_service');

  // RLS policy bound to the GUC the connection registry sets (app.tenant_id).
  await admin.query('ALTER TABLE public.items ENABLE ROW LEVEL SECURITY');
  await admin.query('ALTER TABLE public.items FORCE ROW LEVEL SECURITY');
  await admin.query(`CREATE POLICY items_tenant_isolation ON public.items
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`);

  // Seed rows for BOTH tenants as the superuser (bypasses RLS for seeding).
  await admin.query(`INSERT INTO public.items (tenant_id, workspace_id, name) VALUES ($1,$2,'a-one')`, [TEN_A, WS_A]);
  await admin.query(`INSERT INTO public.items (tenant_id, workspace_id, name) VALUES ($1,$2,'a-two')`, [TEN_A, WS_A]);
  await admin.query(`INSERT INTO public.items (tenant_id, workspace_id, name) VALUES ($1,$2,'b-secret')`, [TEN_B, WS_B]);

  const appDsn = probeUrl(APP_LOGIN, APP_PW);
  // Both workspaces resolve to the same probe DB; isolation comes from RLS + the GUC, not
  // from separate databases (shared-DB strategy).
  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: appDsn }) });
  available = true;
});

after(async () => {
  await registry?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

// The activity input envelope for a db.query, with the tenant-scoped credential carrying
// the falcone_service db role (the consumption side of the per-execution credential).
function activityInput(tenantId, workspaceId, params) {
  return {
    params: { engine: 'postgres', databaseName: DB, schemaName: 'public', tableName: 'items', ...params },
    tenant: { tenantId, workspaceId },
    credential: { dbRole: 'falcone_service', roleName: APP_LOGIN },
  };
}

const deps = () => ({ pgRegistry: registry, executePostgresData });

test('db.query activity: tenant A list returns ONLY tenant A rows (RLS via falcone_service)', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  const out = await dbQuery(activityInput(TEN_A, WS_A, { operation: 'list' }), deps());
  assert.equal(out.status, 'success');
  const items = out.result.items ?? out.result.rows ?? [];
  assert.ok(items.length > 0, 'tenant A sees its own rows');
  assert.ok(items.every((r) => r.tenant_id === TEN_A), `no tenant-B rows leaked: ${JSON.stringify(items.map((r) => r.tenant_id))}`);
  assert.ok(items.every((r) => r.name !== 'b-secret'), "tenant B's secret row is excluded");
});

test('db.query activity: tenant A CANNOT read tenant B rows even by targeting WS_B', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  // Tenant A credential but pointing at tenant B's workspace: RLS still filters on
  // app.tenant_id = TEN_A, so zero tenant-B rows are visible (no leak).
  const out = await dbQuery(
    {
      params: { engine: 'postgres', databaseName: DB, schemaName: 'public', tableName: 'items', operation: 'list' },
      tenant: { tenantId: TEN_A, workspaceId: WS_B },
      credential: { dbRole: 'falcone_service', roleName: APP_LOGIN },
    },
    deps(),
  );
  const items = out.result.items ?? out.result.rows ?? [];
  assert.ok(items.every((r) => r.tenant_id !== TEN_B), 'tenant B data must never be exposed to tenant A');
});

test('db.query activity: tenant B sees only its own row', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  const out = await dbQuery(activityInput(TEN_B, WS_B, { operation: 'list' }), deps());
  const items = out.result.items ?? out.result.rows ?? [];
  assert.ok(items.length > 0 && items.every((r) => r.tenant_id === TEN_B), 'tenant B is isolated to its own rows');
});

test('db.query activity: insert stamps the executing tenant_id (WITH CHECK enforced)', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  const out = await dbQuery(
    activityInput(TEN_A, WS_A, { operation: 'insert', values: { name: 'a-three' } }),
    deps(),
  );
  assert.equal(out.status, 'success');
  // Re-read as tenant A: the new row is visible and tagged tenant A.
  const after = await dbQuery(activityInput(TEN_A, WS_A, { operation: 'list' }), deps());
  const items = after.result.items ?? after.result.rows ?? [];
  assert.ok(items.some((r) => r.name === 'a-three' && r.tenant_id === TEN_A), 'inserted row is stamped tenant A');
});

test('db.query activity: unknown table → non-retryable SCHEMA_ERROR', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  await assert.rejects(
    () => dbQuery(activityInput(TEN_A, WS_A, { operation: 'list', tableName: 'does_not_exist' }), deps()),
    (err) => {
      assert.equal(err.name, 'ApplicationFailure');
      assert.equal(err.nonRetryable, true, 'schema error must be non-retryable');
      return true;
    },
  );
});
