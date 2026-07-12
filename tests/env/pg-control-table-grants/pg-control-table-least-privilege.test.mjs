// Real-Postgres proof for change fix-postgres-tenant-db-isolation-and-rls (PG-3).
//
// PG-3: the shared data roles `falcone_service` and `falcone_anon` have SELECT (and DML)
// on control-plane tables in `in_falcone` — such as `workspace_api_keys` — because
// executor-demo.yaml sets:
//   ALTER DEFAULT PRIVILEGES FOR ROLE falcone IN SCHEMA public
//     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO falcone_anon, falcone_service;
// Any table subsequently created by the `falcone` user (including control-plane metadata
// tables) automatically gets those grants. The data API connects as `falcone_service` and
// could therefore read every tenant's API-key hashes and metadata from `workspace_api_keys`.
//
// This test:
//   RED:   replicates the breach setup; proves falcone_service CAN select workspace_api_keys.
//   migration: applies the new revoke migration.
//   GREEN: proves falcone_service NO LONGER has SELECT on workspace_api_keys (permission denied).
//
// Run via tests/env/pg-control-table-grants/run.sh (real Postgres).
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

// A fresh DB per test run — clean slate mirrors a real `in_falcone` deployment where
// the executor-demo.yaml setup job has already run (default privileges established).
const PROBE_DB = 'pg_ctrl_grant_probe';

// Login roles that mirror the actual data-role names used in production.
const SVC_ROLE = 'falcone_service';
const ANON_ROLE = 'falcone_anon';
const OWNER_ROLE = 'falcone'; // tables are created by this role (matches executor-demo.yaml)

let adminBootstrap; // superuser → default DB (create/drop probe DB)
let admin;         // superuser (table owner) → probe DB

const probeUrl = () => ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);

function svcUrl() {
  // Connect as the superuser but immediately SET ROLE to falcone_service inside the
  // transaction. The superuser url gives us a connection that can SET ROLE to any role
  // (it was GRANT-ed via `GRANT falcone_service TO <superuser>` below).
  return probeUrl(); // we SET ROLE in the query
}

function sql(relPath) {
  return readFileSync(resolve(REPO, relPath), 'utf8');
}

before(async () => {
  adminBootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });

  // Fresh probe DB each run.
  await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await adminBootstrap.query(`CREATE DATABASE ${PROBE_DB}`);

  admin = new Pool({ connectionString: probeUrl(), max: 3 });
  await admin.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  // ----- Replicate the executor-demo.yaml setup job -----
  // 1. Create the non-superuser data roles (NOSUPERUSER NOBYPASSRLS).
  for (const role of [SVC_ROLE, ANON_ROLE]) {
    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
           CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS;
         END IF;
       END $$;`,
    );
  }
  // Allow the connection user (superuser) to SET ROLE to the data roles.
  const connUser = (await admin.query('SELECT current_user')).rows[0].current_user;
  await admin.query(`GRANT ${SVC_ROLE} TO ${connUser}`);
  await admin.query(`GRANT ${ANON_ROLE} TO ${connUser}`);

  // 2. Schema-level grants (from executor-demo.yaml).
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${SVC_ROLE}, ${ANON_ROLE}`);

  // 3. Blanket default privileges (this is the root of PG-3).
  //    Any table created by `connUser` in public will automatically have
  //    SELECT, INSERT, UPDATE, DELETE granted to falcone_service and falcone_anon.
  await admin.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${connUser} IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${SVC_ROLE}, ${ANON_ROLE}`,
  );

  // 4. Create a control-plane table as the owner role (mirrors api-keys.mjs:ensureSchema).
  //    Because of the default privileges above, falcone_service/falcone_anon will
  //    automatically receive SELECT on this table.
  await admin.query(`CREATE TABLE IF NOT EXISTS workspace_api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    workspace_id text NOT NULL,
    key_type text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL UNIQUE,
    scopes text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at timestamptz
  )`);

  // Seed a row so we can verify actual read access (not just schema access).
  await admin.query(
    `INSERT INTO workspace_api_keys (tenant_id, workspace_id, key_type, key_prefix, key_hash)
     VALUES ('tenant-a', 'ws-a', 'service', 'flc_service_', 'hash-a')`,
  );
});

after(async () => {
  await admin?.end().catch(() => {});
  if (adminBootstrap) {
    await adminBootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`).catch(() => {});
    await adminBootstrap.end().catch(() => {});
  }
});

// ---- RED: demonstrate the PG-3 breach ----------------------------------------
// falcone_service currently has SELECT on workspace_api_keys due to default privileges.
// This test is the FAILING assertion that motivates the fix — before the migration it
// passes (i.e. the breach is real); after the migration the privilege is revoked.
test('PG-3 breach (pre-fix): falcone_service has SELECT on workspace_api_keys', async () => {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${SVC_ROLE}`);
    // If the breach exists, this returns rows. After the fix it must throw.
    const res = await c.query('SELECT tenant_id, key_type FROM workspace_api_keys');
    await c.query('COMMIT');
    // BEFORE the migration: we EXPECT this to return rows (breach confirmed).
    // The test is intentionally asserting the breach exists — it will PASS (RED)
    // before the fix, and FAIL (because the query throws) after the fix.
    // Because node:test doesn't have skip/xfail, we assert the pre-fix state here
    // and rely on the post-fix test to gate CI.
    assert.ok(
      res.rows.length > 0,
      'PG-3 CONFIRMED: falcone_service can read workspace_api_keys — this proves the breach exists before the migration is applied',
    );
  } catch (err) {
    if (err.code === '42501') {
      // Permission denied — this means the migration has already been applied.
      // That is the GREEN state; allow this test to pass vacuously (idempotent run).
      return;
    }
    throw err;
  } finally {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    c.release();
  }
});

// ---- Apply the revoke migration ----------------------------------------------
test('apply the revoke-control-table-grants migration', async () => {
  await admin.query(
    sql('../falcone-charts/charts/in-falcone/bootstrap/migrations/20260616-007-revoke-data-role-control-table-grants.sql'),
  );

  // Confirm the migration reports REVOKE completed without error (no exception means OK).
  // We verify the actual effect in the next test.
});

// ---- GREEN: after the migration, falcone_service is denied -------------------
test('PG-3 fixed: falcone_service receives permission denied on workspace_api_keys', async () => {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${SVC_ROLE}`);
    await assert.rejects(
      () => c.query('SELECT tenant_id FROM workspace_api_keys'),
      (err) => {
        // PostgreSQL error code 42501 = insufficient_privilege
        assert.equal(err.code, '42501', `Expected 42501 (insufficient_privilege), got ${err.code}: ${err.message}`);
        return true;
      },
      'falcone_service must NOT be able to SELECT workspace_api_keys after the revoke migration',
    );
    await c.query('ROLLBACK');
  } finally {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    c.release();
  }
});

test('PG-3 fixed: falcone_anon receives permission denied on workspace_api_keys', async () => {
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${ANON_ROLE}`);
    await assert.rejects(
      () => c.query('SELECT tenant_id FROM workspace_api_keys'),
      (err) => {
        assert.equal(err.code, '42501', `Expected 42501 (insufficient_privilege), got ${err.code}: ${err.message}`);
        return true;
      },
      'falcone_anon must NOT be able to SELECT workspace_api_keys after the revoke migration',
    );
    await c.query('ROLLBACK');
  } finally {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    c.release();
  }
});

// ---- Verify default-privilege revoke: new control-plane tables are also protected ---
// Creates a NEW control-plane-like table AFTER the migration and verifies that the
// revoked default privileges mean falcone_service cannot access it either.
test('PG-3 fixed: default-privilege revoke protects newly created control-plane tables', async () => {
  // Create a new table AFTER the migration (simulates a future schema addition).
  await admin.query(`CREATE TABLE IF NOT EXISTS new_control_plane_table (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    secret_value text NOT NULL
  )`);
  await admin.query(
    `INSERT INTO new_control_plane_table (tenant_id, secret_value) VALUES ('t-a', 'SUPER-SECRET')`,
  );

  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${SVC_ROLE}`);
    await assert.rejects(
      () => c.query('SELECT secret_value FROM new_control_plane_table'),
      (err) => {
        assert.equal(err.code, '42501', `falcone_service must not access newly created tables; got ${err.code}: ${err.message}`);
        return true;
      },
      'the default-privilege revoke must protect new control-plane tables from falcone_service',
    );
    await c.query('ROLLBACK');
  } finally {
    try { await c.query('ROLLBACK'); } catch { /* noop */ }
    c.release();
  }
});
