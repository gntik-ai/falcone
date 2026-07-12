/**
 * REAL-stack E2E for change `fix-pg-capture-insert-conflict-arbiter`.
 *
 * Falcone ships as pure-logic libraries with no runnable HTTP app, so the REAL
 * stack here is the backing Postgres booted by `tests/env` (see tests/env/up.sh).
 * This spec drives the `pg-capture-enable` action entrypoint directly against a
 * LIVE Postgres provisioned by the service migration `080-pg-capture-config.sql`.
 *
 * Bug under test: that migration declared the uniqueness key
 *   UNIQUE (workspace_id, data_source_ref, schema_name, table_name) DEFERRABLE INITIALLY IMMEDIATE
 * while CaptureConfigRepository.create() uses those same columns as an
 * `ON CONFLICT (...)` arbiter. PostgreSQL forbids a DEFERRABLE unique constraint
 * as an ON CONFLICT arbiter, so EVERY enable INSERT raised
 *   ERROR: ON CONFLICT does not support deferrable unique constraints/exclusion constraints as arbiters
 * and the action re-threw it (→ 500). pg-capture-enable could never persist a
 * capture on real Postgres. The fix makes the constraint non-deferrable.
 *
 * deps.db is a Pool: CaptureConfigRepository.create() calls pool.connect() to run
 * the quota check + insert inside an advisory-locked transaction (as in prod).
 *
 * No Kafka / no HTTP server needed: PgCaptureLifecyclePublisher uses optional
 * chaining and publish is fire-and-forget with .catch(), so producer is omitted.
 */

import { test, expect } from '@playwright/test';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { main as pgCaptureEnable } from '../../../../packages/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs';

const { Pool } = pg;

const DSN = process.env.DB_URL || 'postgres://falcone:falcone@localhost:55432/falcone_test';
// A dedicated tenant/workspace for this spec so it never collides with other specs.
const TENANT = '33333333-3333-3333-3333-333333333333';
const WS = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** @type {import('pg').Pool} */
let pool: InstanceType<typeof Pool>;

test.describe.configure({ mode: 'serial' });

function gatewayHeaders() {
  return {
    'x-tenant-id': TENANT,
    'x-workspace-id': WS,
    'x-auth-subject': 'user-c',
    'x-actor-roles': 'member',
  };
}

test.beforeAll(async () => {
  pool = new Pool({ connectionString: DSN });

  // Apply the CDC migration (idempotent — all statements use IF NOT EXISTS).
  // Read ONLY the "-- up" section; never execute the "-- down" DROP section.
  const migrationPath = path.resolve(
    fileURLToPath(import.meta.url),
    '../../../../../packages/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql',
  );
  const migrationSrc = fs.readFileSync(migrationPath, 'utf8');
  const downMarkerIdx = migrationSrc.split('\n').findIndex((line) => /^--\s*down\s*$/i.test(line.trim()));
  const upSql = downMarkerIdx >= 0
    ? migrationSrc.split('\n').slice(0, downMarkerIdx).join('\n')
    : migrationSrc;
  await pool.query(upSql);

  // Deterministic fixtures so the spec is idempotent across re-runs.
  await pool.query('DELETE FROM pg_capture_audit_log WHERE tenant_id = $1', [TENANT]);
  await pool.query('DELETE FROM pg_capture_configs WHERE tenant_id = $1', [TENANT]);
});

test.afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM pg_capture_audit_log WHERE tenant_id = $1', [TENANT]);
    await pool.query('DELETE FROM pg_capture_configs WHERE tenant_id = $1', [TENANT]);
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// Scenario 1 — enabling a PG capture persists against a real Postgres: the
// INSERT ... ON CONFLICT statement executes without an arbiter error → 201.
// ---------------------------------------------------------------------------
test('e2e-pgcap-conflict-01: enabling a PG capture returns 201 (INSERT ... ON CONFLICT executes, no deferrable-arbiter error)', async () => {
  const result = await pgCaptureEnable(
    {
      __ow_headers: gatewayHeaders(),
      body: { data_source_ref: 'ds_conflict', table_name: 'invoices', schema_name: 'public' },
      requestId: '00000003-0003-0003-0003-000000000003',
    },
    { db: pool },
  );

  expect(result.statusCode).toBe(201);
  expect(result.body.tenant_id).toBe(TENANT);
  expect(result.body.workspace_id).toBe(WS);

  // The row is really persisted.
  const row = await pool.query(
    "SELECT count(*)::int AS n FROM pg_capture_configs WHERE tenant_id = $1 AND data_source_ref = 'ds_conflict' AND table_name = 'invoices'",
    [TENANT],
  );
  expect(row.rows[0].n).toBe(1);
});

// ---------------------------------------------------------------------------
// Scenario 2 — re-enabling the SAME table resolves via the ON CONFLICT DO UPDATE
// path WITHOUT a SQL arbiter error (it does not raise a 500) and creates no dup.
// ---------------------------------------------------------------------------
test('e2e-pgcap-conflict-02: re-enabling the same table is idempotent via ON CONFLICT (no 500, no duplicate row)', async () => {
  const result = await pgCaptureEnable(
    {
      __ow_headers: gatewayHeaders(),
      body: { data_source_ref: 'ds_conflict', table_name: 'invoices', schema_name: 'public' },
      requestId: '00000004-0004-0004-0004-000000000004',
    },
    { db: pool },
  );

  // The defining symptom of the bug was a re-thrown arbiter error → 500.
  expect(result.statusCode).not.toBe(500);
  // The ON CONFLICT DO UPDATE path keeps the active capture (returns it as 201).
  expect(result.statusCode).toBe(201);

  // Still exactly one row for this (workspace, data_source_ref, schema, table).
  const row = await pool.query(
    "SELECT count(*)::int AS n FROM pg_capture_configs WHERE workspace_id = $1 AND data_source_ref = 'ds_conflict' AND schema_name = 'public' AND table_name = 'invoices'",
    [WS],
  );
  expect(row.rows[0].n).toBe(1);
});
