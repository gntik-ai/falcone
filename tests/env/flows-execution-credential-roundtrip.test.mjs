// Real-Postgres proof for change add-flows-tenancy-isolation-limits.
//
// Proves the per-execution credential round-trip END-TO-END through the activity dispatch gate
// against a LIVE RLS-backed Postgres: a token MINTED by the control-plane helper, carried in the
// tenant envelope, is VALIDATED by dispatchTask before the real db.query activity reaches the real
// executor (under the non-superuser, NON-BYPASSRLS falcone_service role). A valid token reads the
// tenant's own rows; an expired or cross-tenant token fails NON-RETRYABLY before any DB access.
//
// RLS is a real-DB behaviour, so this lives in tests/env (docker-compose Postgres) and self-skips
// when the database is unreachable (repo precedent: flows-db-query-rls).
//
//   bash tests/env/flows-api/run.sh   (or any tests/env Postgres bring-up)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { executePostgresData } from '../../apps/control-plane-executor/src/runtime/postgres-data-executor.mjs';
import { dispatchTask } from '../../apps/workflow-worker/src/activities/index.mjs';
import { mintExecutionToken } from '../../apps/control-plane-executor/src/runtime/execution-token.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'flows_ten_cred_probe';
const APP_LOGIN = 'flows_ten_cred_login';
const APP_PW = 'flows_ten_cred_local_only';
const TEN_A = 'ten_cred_a';
const WS_A = 'ws_a';
const TEN_B = 'ten_cred_b';
const WS_B = 'ws_b';
const DB = 'appdb';

let bootstrap;
let admin;
let registry;
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
    return;
  }
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl(), max: 2 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await admin.query(`CREATE TABLE public.items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id text NOT NULL, workspace_id text NOT NULL, name text NOT NULL)`);

  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_service') THEN
      CREATE ROLE falcone_service NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
  END $$;`);
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS IN ROLE falcone_service`);
  await admin.query('GRANT USAGE ON SCHEMA public TO falcone_service');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO falcone_service');

  await admin.query('ALTER TABLE public.items ENABLE ROW LEVEL SECURITY');
  await admin.query('ALTER TABLE public.items FORCE ROW LEVEL SECURITY');
  await admin.query(`CREATE POLICY items_tenant_isolation ON public.items
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`);

  await admin.query(`INSERT INTO public.items (tenant_id, workspace_id, name) VALUES
    ($1,$2,'a-one'), ($1,$2,'a-two'), ($3,$4,'b-secret')`, [TEN_A, WS_A, TEN_B, WS_B]);

  registry = createConnectionRegistry({ resolveConnection: () => ({ dsn: probeUrl(APP_LOGIN, APP_PW) }) });
  available = true;
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

function input(token, { tenantId = TEN_A, workspaceId = WS_A } = {}) {
  return {
    nodeId: 'n1',
    taskType: 'db.query',
    params: { engine: 'postgres', databaseName: DB, schemaName: 'public', tableName: 'items', operation: 'list', workspaceId },
    tenant: { tenantId, workspaceId, ...(token !== undefined ? { executionToken: token } : {}) },
  };
}
const deps = () => ({ pgRegistry: registry, executePostgresData, credential: { dbRole: 'falcone_service', roleName: APP_LOGIN } });

test('env-flows-ten-cred-01: valid minted token → activity reads ONLY its tenant rows', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  const token = mintExecutionToken(TEN_A, WS_A);
  const out = await dispatchTask(input(token), deps());
  const items = out.output.result.items ?? out.output.result.rows ?? [];
  assert.ok(items.length > 0 && items.every((r) => r.tenant_id === TEN_A), 'tenant A token reads only tenant A rows');
  assert.ok(items.every((r) => r.name !== 'b-secret'), "tenant B's secret never surfaces");
});

test('env-flows-ten-cred-02: expired token → non-retryable EXECUTION_TOKEN_EXPIRED, NO DB read', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  let dbHit = false;
  const expired = mintExecutionToken(TEN_A, WS_A, 1, { now: 0 });
  await assert.rejects(
    () => dispatchTask(input(expired), { pgRegistry: registry, executePostgresData: async () => { dbHit = true; return {}; }, credential: {} }),
    (err) => err.type === 'EXECUTION_TOKEN_EXPIRED' && err.nonRetryable === true,
  );
  assert.equal(dbHit, false, 'an expired token blocks the DB read entirely');
});

test('env-flows-ten-cred-03: cross-tenant token → non-retryable TENANT_MISMATCH, NO DB read', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  let dbHit = false;
  // Token minted for tenant B but the execution claims tenant A.
  const foreign = mintExecutionToken(TEN_B, WS_A);
  await assert.rejects(
    () => dispatchTask(input(foreign, { tenantId: TEN_A, workspaceId: WS_A }), { pgRegistry: registry, executePostgresData: async () => { dbHit = true; return {}; }, credential: {} }),
    (err) => err.type === 'EXECUTION_TOKEN_TENANT_MISMATCH' && err.nonRetryable === true,
  );
  assert.equal(dbHit, false);
});
