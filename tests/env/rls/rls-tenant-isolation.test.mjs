// Real-Postgres proof for change `add-rls-enforced-tenant-migrations`.
//
// RLS is a PostgreSQL feature — it cannot be exercised by the fake-pg unit/contract
// suites, so this lives in tests/env (real docker-compose Postgres) like the rest of
// the real-stack slice. Bring up Postgres + run via tests/env/rls/run.sh.
//
// Critical: the default `falcone` DB user is a SUPERUSER, and superusers bypass RLS
// even with FORCE. So policies only enforce against a NON-superuser, NON-BYPASSRLS
// role. This test creates such a role (member of the `falcone_app` group the
// migrations grant to) and runs the cross-tenant probes as that role, while using
// the superuser connection as the migration-runner / legitimate-sweep path.
//
// It first proves the LEAK exists without RLS (red), then applies the shipped RLS
// migration and proves isolation (green) — mapping to the spec scenarios in
// openspec/changes/add-rls-enforced-tenant-migrations/specs/tenant-isolation/spec.md.
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

const PROBE_DB = 'rls_probe';
const APP_LOGIN = 'falcone_app_login';
const APP_PW = 'rls_probe_local_only';

const TEN_A = '11111111-1111-1111-1111-111111111111';
const TEN_B = '22222222-2222-2222-2222-222222222222';
const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function sql(relPath) {
  return readFileSync(resolve(REPO, relPath), 'utf8');
}

let adminBootstrap; // connection to the default DB to create/drop the probe DB
let admin; // superuser connection INTO the probe DB (migration runner / sweep role)
let app; // non-superuser application role connection INTO the probe DB

before(async () => {
  adminBootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  // Recreate a clean probe database (DDL that cannot run in a transaction).
  await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await adminBootstrap.query(`CREATE DATABASE ${PROBE_DB}`);

  const probeUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
  admin = new Pool({ connectionString: probeUrl, max: 2 });

  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  // Base schema (the real shipped migration) — RLS not yet applied.
  await admin.query(sql('services/scheduling-engine/migrations/001-scheduling-tables.sql'));

  // A non-superuser LOGIN role to act as the application. Drop first for idempotency.
  await admin.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`);
  // `falcone_app` group is created by the RLS migration; ensure it exists for the
  // pre-RLS (red) phase too, then make the login role a member so it inherits grants.
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'falcone_app') THEN
      CREATE ROLE falcone_app NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`CREATE ROLE ${APP_LOGIN} LOGIN PASSWORD '${APP_PW}' IN ROLE falcone_app`);
  // Pre-RLS world: app role can read/write the tables (grants), but no policy yet.
  await admin.query('GRANT USAGE ON SCHEMA public TO falcone_app');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_jobs TO falcone_app');

  // Seed one job per tenant AS THE SUPERUSER (bypasses any later RLS for seeding).
  for (const [ten, ws, name] of [
    [TEN_A, WS_A, 'job-a'],
    [TEN_B, WS_B, 'job-b'],
  ]) {
    await admin.query(
      `INSERT INTO scheduled_jobs (tenant_id, workspace_id, name, cron_expression, target_action, created_by)
       VALUES ($1, $2, $3, '*/5 * * * *', 'noop', 'seed')`,
      [ten, ws, name],
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
    // role is dropped with the database's objects gone; drop explicitly too
    await adminBootstrap.query(`DROP ROLE IF EXISTS ${APP_LOGIN}`).catch(() => {});
    await adminBootstrap.end().catch(() => {});
  }
});

// --- RED: without RLS, a forgotten predicate leaks across tenants -------------
test('baseline (no RLS): unscoped query as app role LEAKS both tenants', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    const res = await c.query('SELECT tenant_id FROM scheduled_jobs'); // forgotten WHERE
    await c.query('COMMIT');
    const tenants = new Set(res.rows.map((r) => r.tenant_id));
    // Demonstrates the vulnerability the change closes: B is visible to A.
    assert.equal(res.rows.length, 2, 'without RLS the unscoped query returns all rows');
    assert.ok(tenants.has(TEN_B), 'without RLS, tenant B leaks into tenant A session');
  } finally {
    c.release();
  }
});

// --- Apply the shipped RLS migration -----------------------------------------
test('apply RLS migration (ENABLE + FORCE + policies)', async () => {
  await admin.query(sql('services/scheduling-engine/migrations/002-rls-scheduling-tables.sql'));
  const pol = await admin.query(
    "SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='scheduled_jobs'",
  );
  assert.ok(pol.rows.length >= 1, 'a policy now exists on scheduled_jobs');
  const forced = await admin.query(
    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='scheduled_jobs'",
  );
  assert.equal(forced.rows[0].relrowsecurity, true, 'RLS enabled');
  assert.equal(forced.rows[0].relforcerowsecurity, true, 'RLS forced');
});

// --- GREEN: spec scenarios ----------------------------------------------------
test('scenario: query with correct tenant context returns only that tenant', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    const res = await c.query('SELECT tenant_id FROM scheduled_jobs'); // no WHERE
    await c.query('COMMIT');
    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].tenant_id, TEN_A);
  } finally {
    c.release();
  }
});

test('scenario: forgotten WHERE tenant_id no longer leaks tenant B to tenant A', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    const res = await c.query("SELECT * FROM scheduled_jobs WHERE tenant_id = $1", [TEN_B]);
    await c.query('COMMIT');
    assert.equal(res.rows.length, 0, 'cross-tenant probe returns zero rows');
  } finally {
    c.release();
  }
});

test('scenario: direct query without any tenant context is fail-closed (zero rows)', async () => {
  const c = await app.connect();
  try {
    // No set_config at all -> current_setting(...) is NULL -> policy denies.
    const res = await c.query('SELECT * FROM scheduled_jobs');
    assert.equal(res.rows.length, 0, 'unscoped session sees nothing under FORCE RLS');
  } finally {
    c.release();
  }
});

test('scenario: WITH CHECK blocks inserting a row for a different tenant', async () => {
  const c = await app.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [TEN_A]);
    await c.query("SELECT set_config('app.workspace_id', $1, true)", [WS_A]);
    await assert.rejects(
      () =>
        c.query(
          `INSERT INTO scheduled_jobs (tenant_id, workspace_id, name, cron_expression, target_action, created_by)
           VALUES ($1, $2, 'evil', '*/5 * * * *', 'noop', 'attacker')`,
          [TEN_B, WS_B], // attempt to write into tenant B while scoped to A
        ),
      /row-level security/i,
    );
    await c.query('ROLLBACK');
  } finally {
    c.release();
  }
});

test('scenario: superuser / migration-runner role bypasses RLS (sweeps still work)', async () => {
  const res = await admin.query('SELECT tenant_id FROM scheduled_jobs');
  const tenants = new Set(res.rows.map((r) => r.tenant_id));
  assert.ok(tenants.has(TEN_A) && tenants.has(TEN_B), 'superuser sees all tenants');
});

// --- Coverage: every shipped RLS migration applies and forces RLS + policies ---
test('all four service RLS migrations apply cleanly and FORCE RLS with policies', async () => {
  // Stand up the base tables each RLS migration needs, in a separate clean DB so we
  // do not depend on which service slices tests/env happened to load.
  await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}_cov WITH (FORCE)`);
  await adminBootstrap.query(`CREATE DATABASE ${PROBE_DB}_cov`);
  const covUrl = ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}_cov`);
  const cov = new Pool({ connectionString: covUrl, max: 2 });
  try {
    await cov.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    const groups = [
      {
        base: ['services/webhook-engine/migrations/001-webhook-subscriptions.sql',
               'services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql'],
        rls: 'services/webhook-engine/migrations/003-rls-webhook-tables.sql',
        tables: ['webhook_subscriptions', 'webhook_signing_secrets', 'webhook_deliveries', 'webhook_delivery_attempts'],
      },
      {
        base: ['services/realtime-gateway/src/migrations/003-create-realtime-sessions.sql'],
        rls: 'services/realtime-gateway/src/migrations/004-rls-realtime-sessions.sql',
        tables: ['realtime_sessions'],
      },
      {
        base: ['services/provisioning-orchestrator/src/migrations/089-api-key-rotation.sql'],
        rls: 'services/provisioning-orchestrator/src/migrations/090-rls-rotation-tables.sql',
        tables: ['service_account_rotation_states', 'service_account_rotation_history', 'tenant_rotation_policies'],
      },
    ];

    for (const g of groups) {
      for (const b of g.base) await cov.query(sql(b));
      await cov.query(sql(g.rls));
      for (const t of g.tables) {
        const r = await cov.query(
          'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname=$1',
          [t],
        );
        assert.equal(r.rows[0]?.relrowsecurity, true, `${t}: RLS enabled`);
        assert.equal(r.rows[0]?.relforcerowsecurity, true, `${t}: RLS forced`);
        const p = await cov.query(
          "SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=$1",
          [t],
        );
        assert.ok(p.rows.length >= 1, `${t}: has an RLS policy`);
      }
    }
  } finally {
    await cov.end().catch(() => {});
    await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}_cov WITH (FORCE)`).catch(() => {});
  }
});
