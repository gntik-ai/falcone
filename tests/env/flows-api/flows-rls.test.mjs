// Real-Postgres proof for change `add-flows-control-plane-api` (#361).
//
// RLS is a PostgreSQL feature — it cannot be exercised by the in-memory/fake-pg black-box
// suite, so this lives in tests/env (real docker-compose Postgres). Bring up Postgres + run via
// tests/env/flows-api/run.sh.
//
// The default `falcone` DB user is a SUPERUSER and superusers bypass RLS even with FORCE — so
// the policies only enforce against a NON-superuser, NON-BYPASSRLS role. This test creates such
// a role (member of the `falcone_app` group the migration grants to) and runs the cross-tenant
// probes as that role, using the superuser connection for seeding + the legitimate-sweep path.
//
// It proves:
//   1. (RED) without RLS a forgotten predicate LEAKS flow_definitions/flow_versions across tenants
//   2. the shipped migrations ENABLE + FORCE RLS and create policies
//   3. (GREEN) cross-tenant probes return zero rows; unscoped session is fail-closed; WITH CHECK
//      blocks cross-tenant writes
//   4. (D6) flow_versions is IMMUTABLE for falcone_app: UPDATE and DELETE are denied (no grant)
//
// Maps to openspec/changes/add-flows-control-plane-api/specs/workflows/spec.md scenarios:
//   "Create a new flow definition … inaccessible to any other tenant under falcone_app"
//   "List flow definitions returns only the requesting tenant's flows"
//   "Published version is immutable … falcone_app cannot UPDATE or DELETE it"
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'flows_rls_probe';
const APP_LOGIN = 'flows_app_login';
const APP_PW = 'flows_rls_probe_local_only';

const TEN_A = '11111111-1111-1111-1111-111111111111';
const TEN_B = '22222222-2222-2222-2222-222222222222';
const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const DEFS_MIGRATION = 'charts/in-falcone/bootstrap/migrations/20260612-003-flow-definitions-and-versions.sql';
const RLS_MIGRATION = 'charts/in-falcone/bootstrap/migrations/20260612-004-flow-rls.sql';

function sql(relPath) {
  return readFileSync(resolve(REPO, relPath), 'utf8');
}

let adminBootstrap; // connection to the default DB to create/drop the probe DB
let admin; // superuser connection INTO the probe DB (migration runner / sweep role)
let app; // non-superuser application role connection INTO the probe DB

before(async () => {
  adminBootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await adminBootstrap.query(`CREATE DATABASE ${PROBE_DB}`);

  const probeUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl, max: 2 });

  // Base tables (the shipped migration) — RLS not yet applied.
  await admin.query(sql(DEFS_MIGRATION));

  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
      CREATE ROLE falcone_app NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' IN ROLE falcone_app`);
  // Pre-RLS world: grant flow_definitions full DML (the RED leak demo + WITH CHECK probe), but
  // grant flow_versions ONLY SELECT + INSERT — exactly the privileges production gives (the RLS
  // migration grants SELECT, INSERT and NEVER UPDATE/DELETE, per design.md D6). The immutability
  // assertion therefore reflects the real shipped grant set, not a test-only over-grant.
  await admin.query('GRANT USAGE ON SCHEMA public TO falcone_app');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON flow_definitions TO falcone_app');
  await admin.query('GRANT SELECT, INSERT ON flow_versions TO falcone_app');

  // Seed one flow + one version per tenant AS THE SUPERUSER.
  for (const [ten, ws, flowId, name] of [
    [TEN_A, WS_A, 'flow-a', 'Flow A'],
    [TEN_B, WS_B, 'flow-b', 'Flow B'],
  ]) {
    await admin.query(
      `INSERT INTO flow_definitions (tenant_id, workspace_id, flow_id, name, definition_json, created_by)
       VALUES ($1,$2,$3,$4,'{"apiVersion":"v1.0"}'::jsonb,'seed')`,
      [ten, ws, flowId, name],
    );
    await admin.query(
      `INSERT INTO flow_versions (tenant_id, workspace_id, flow_id, version, definition_json, created_by)
       VALUES ($1,$2,$3,1,'{"apiVersion":"v1.0"}'::jsonb,'seed')`,
      [ten, ws, flowId],
    );
  }

  const appUrl = probeUrl.replace(/\/\/[^:]+:[^@]+@/, `//${APP_LOGIN}:${APP_PW}@`);
  app = new Pool({ connectionString: appUrl, max: 2 });
});

after(async () => {
  await app?.end().catch(() => {});
  await admin?.end().catch(() => {});
  if (adminBootstrap) {
    await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`).catch(() => {});
    await adminBootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await adminBootstrap.end().catch(() => {});
  }
});

// --- RED: without RLS, a forgotten predicate leaks across tenants -----------------------------
test('baseline (no RLS): unscoped query as app role LEAKS both tenants', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    const defs = await c.query('SELECT tenant_id FROM flow_definitions'); // forgotten WHERE
    const vers = await c.query('SELECT tenant_id FROM flow_versions');
    await c.query('COMMIT');
    assert.equal(defs.rows.length, 2, 'without RLS the unscoped flow_definitions query returns all rows');
    assert.equal(vers.rows.length, 2, 'without RLS the unscoped flow_versions query returns all rows');
    assert.ok(new Set(defs.rows.map((r) => r.tenant_id)).has(TEN_B), 'tenant B leaks into tenant A session');
  } finally {
    c.release();
  }
});

// --- Apply the shipped RLS migration ----------------------------------------------------------
test('apply RLS migration (ENABLE + FORCE + policies on both tables)', async () => {
  await admin.query(sql(RLS_MIGRATION));
  for (const tbl of ['flow_definitions', 'flow_versions']) {
    const forced = await admin.query(
      'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1', [tbl],
    );
    assert.equal(forced.rows[0].relrowsecurity, true, `${tbl}: RLS enabled`);
    assert.equal(forced.rows[0].relforcerowsecurity, true, `${tbl}: RLS forced`);
    const pol = await admin.query(
      "SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=$1", [tbl],
    );
    assert.ok(pol.rows.length >= 1, `${tbl}: a policy exists`);
  }
});

// --- GREEN: spec scenarios --------------------------------------------------------------------
test('scenario: query with correct tenant context returns only that tenant (definitions + versions)', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    const defs = await c.query('SELECT tenant_id FROM flow_definitions'); // no WHERE
    const vers = await c.query('SELECT tenant_id FROM flow_versions');
    await c.query('COMMIT');
    assert.equal(defs.rows.length, 1);
    assert.equal(defs.rows[0].tenant_id, TEN_A);
    assert.equal(vers.rows.length, 1);
    assert.equal(vers.rows[0].tenant_id, TEN_A);
  } finally {
    c.release();
  }
});

test('scenario: cross-tenant probe for tenant B from tenant A session returns zero rows', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    const defs = await c.query('SELECT * FROM flow_definitions WHERE tenant_id = $1', [TEN_B]);
    const vers = await c.query('SELECT * FROM flow_versions WHERE tenant_id = $1', [TEN_B]);
    await c.query('COMMIT');
    assert.equal(defs.rows.length, 0, 'cross-tenant definition probe is empty');
    assert.equal(vers.rows.length, 0, 'cross-tenant version probe is empty');
  } finally {
    c.release();
  }
});

test('scenario: unscoped session is fail-closed (zero rows under FORCE RLS)', async () => {
  const c = await app.connect();
  try {
    const defs = await c.query('SELECT * FROM flow_definitions'); // no set_config at all
    const vers = await c.query('SELECT * FROM flow_versions');
    assert.equal(defs.rows.length, 0, 'unscoped flow_definitions sees nothing');
    assert.equal(vers.rows.length, 0, 'unscoped flow_versions sees nothing');
  } finally {
    c.release();
  }
});

test('scenario: WITH CHECK blocks inserting a definition for a different tenant', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    await assert.rejects(
      () => c.query(
        `INSERT INTO flow_definitions (tenant_id, workspace_id, flow_id, name, definition_json)
         VALUES ($1,$2,'evil','Evil','{}'::jsonb)`,
        [TEN_B, WS_B],
      ),
      /row-level security/i,
    );
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
});

// --- D6: flow_versions immutability for falcone_app ------------------------------------------
test('scenario: flow_versions is immutable for falcone_app (no UPDATE / DELETE privilege)', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    // UPDATE is denied at the GRANT level (42501 insufficient_privilege), not merely RLS.
    await assert.rejects(
      () => c.query("UPDATE flow_versions SET definition_json = '{}'::jsonb WHERE flow_id = 'flow-a'"),
      /permission denied|insufficient/i,
    );
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    await assert.rejects(
      () => c.query("DELETE FROM flow_versions WHERE flow_id = 'flow-a'"),
      /permission denied|insufficient/i,
    );
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
});

test('scenario: a NEW version row CAN be inserted by falcone_app (publish path works)', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    await c.query(
      `INSERT INTO flow_versions (tenant_id, workspace_id, flow_id, version, definition_json, created_by)
       VALUES ($1,$2,'flow-a',2,'{"apiVersion":"v1.0"}'::jsonb,'app')`,
      [TEN_A, WS_A],
    );
    await c.query('COMMIT');
    const v = await admin.query("SELECT version FROM flow_versions WHERE flow_id='flow-a' ORDER BY version");
    assert.deepEqual(v.rows.map((r) => Number(r.version)), [1, 2], 'INSERT-only publish appends a new version');
  } finally {
    c.release();
  }
});

test('scenario: superuser / migration-runner role bypasses RLS (sweeps still work)', async () => {
  const res = await admin.query('SELECT tenant_id FROM flow_definitions');
  const tenants = new Set(res.rows.map((r) => r.tenant_id));
  assert.ok(tenants.has(TEN_A) && tenants.has(TEN_B), 'superuser sees all tenants');
});
