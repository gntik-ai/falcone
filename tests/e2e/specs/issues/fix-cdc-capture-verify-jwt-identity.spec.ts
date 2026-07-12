/**
 * REAL-stack E2E for change `fix-cdc-capture-verify-jwt-identity` (GitHub issue #249, P0 tenant-isolation).
 *
 * Falcone ships as pure-logic libraries with no runnable HTTP app, so the REAL
 * stack here is the backing Postgres booted by `tests/env` (see tests/env/up.sh).
 * This spec drives the CDC capture action entrypoints directly — importing their
 * default `main` export — against a LIVE Postgres and asserts the core security
 * invariant:
 *
 *   Identity is derived ONLY from gateway-injected headers (x-tenant-id,
 *   x-workspace-id, x-auth-subject, x-actor-roles) on params.__ow_headers.
 *   A forged Authorization: Bearer <jwt> claiming a different tenant MUST be
 *   completely ignored. Any write is scoped to the gateway-supplied tenant, not
 *   the JWT payload. Missing gateway headers → 401, no DB write.
 *
 * The forged-JWT scenario (e2e-cdc-01) is the CORE SECURITY ASSERTION: an
 * attacker carrying a self-minted JWT for TENANT_B while the gateway forwards
 * headers for TENANT_A must produce a row owned by TENANT_A, not TENANT_B.
 * Scenarios e2e-cdc-03 and e2e-cdc-04 are cross-tenant read probes: an
 * authenticated TENANT_A principal must never observe TENANT_B's captures.
 *
 * Connection: env from `source tests/env/env.sh` (DB_URL / PG*), with a
 * fallback to the documented test-env DSN so the spec is runnable standalone.
 *
 * No Kafka / no HTTP server needed: PgCaptureLifecyclePublisher uses optional
 * chaining (this.kafkaProducer?.send?.(...)) and publish is fire-and-forget
 * with .catch(), so `deps.producer = undefined` is safe.
 *
 * Covers: fn-cdc-identity-parse, fn-cdc-tenant-scope, fn-cdc-list-scope,
 *         fn-cdc-tenant-summary-authz, us-cdc-enable, uc-cdc-cross-tenant-probe.
 */

import { test, expect } from '@playwright/test';
import pg from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { main as pgCaptureEnable } from '../../../../packages/provisioning-orchestrator/src/actions/realtime/pg-capture-enable.mjs';
import { main as pgCaptureList } from '../../../../packages/provisioning-orchestrator/src/actions/realtime/pg-capture-list.mjs';
import { main as pgCaptureTenantSummary } from '../../../../packages/provisioning-orchestrator/src/actions/realtime/pg-capture-tenant-summary.mjs';

// deps.db must be a Pool: CaptureConfigRepository.create() calls pool.connect()
// to run the quota check + insert inside an advisory-locked transaction (exactly
// as in production). A single Client cannot satisfy that, so we use a Pool here.
const { Pool } = pg;

const DSN = process.env.DB_URL || 'postgres://falcone:falcone@localhost:55432/falcone_test';
const TENANT_A = process.env.TESTENV_TENANT_A || '11111111-1111-1111-1111-111111111111';
const TENANT_B = process.env.TESTENV_TENANT_B || '22222222-2222-2222-2222-222222222222';
const WS_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * Build an unsigned, self-minted JWT-like token claiming the given tenant/workspace.
 * This token is never verified by the fixed code path; it must be ignored wholesale.
 * Format: base64url(header).base64url(payload) — no signature segment.
 */
function forgeToken(tenantId: string, workspaceId: string, sub = 'attacker'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ tenant_id: tenantId, workspace_id: workspaceId, sub }),
  ).toString('base64url');
  return `Bearer ${header}.${payload}`;
}

/** @type {import('pg').Pool} */
let pool: InstanceType<typeof Pool>;

// All scenarios share a single DB connection and must run in declaration order.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  pool = new Pool({ connectionString: DSN });

  // Apply the CDC migration (idempotent — all statements use IF NOT EXISTS).
  // Read ONLY the "-- up" section; never execute the "-- down" DROP section.
  const migrationPath = path.resolve(
    fileURLToPath(import.meta.url),
    '../../../../../packages/provisioning-orchestrator/src/migrations/080-pg-capture-config.sql',
  );
  const migrationSrc = fs.readFileSync(migrationPath, 'utf8');
  // Split on the first line that contains the "-- down" marker.
  const downMarkerIdx = migrationSrc.split('\n').findIndex((line) => /^--\s*down\s*$/i.test(line.trim()));
  const upSql = downMarkerIdx >= 0
    ? migrationSrc.split('\n').slice(0, downMarkerIdx).join('\n')
    : migrationSrc;
  await pool.query(upSql);

  // Deterministic fixture cleanup so the spec is idempotent across re-runs.
  await pool.query(
    'DELETE FROM pg_capture_audit_log WHERE tenant_id = ANY($1::uuid[])',
    [[TENANT_A, TENANT_B]],
  );
  await pool.query(
    'DELETE FROM pg_capture_configs WHERE tenant_id = ANY($1::uuid[])',
    [[TENANT_A, TENANT_B]],
  );
});

test.afterAll(async () => {
  if (!pool) return;
  try {
    await pool.query(
      'DELETE FROM pg_capture_audit_log WHERE tenant_id = ANY($1::uuid[])',
      [[TENANT_A, TENANT_B]],
    );
    await pool.query(
      'DELETE FROM pg_capture_configs WHERE tenant_id = ANY($1::uuid[])',
      [[TENANT_A, TENANT_B]],
    );
  } finally {
    await pool.end();
  }
});

// ---------------------------------------------------------------------------
// e2e-cdc-01 — forged JWT claiming TENANT_B is ignored; write is scoped to the
//              gateway tenant (TENANT_A).  CORE SECURITY ASSERTION.
// ---------------------------------------------------------------------------
test('e2e-cdc-01: forged JWT is ignored; create is scoped to gateway-supplied tenant A, NOT JWT tenant B', async () => {
  const forgedToken = forgeToken(TENANT_B, WS_B);

  const result = await pgCaptureEnable(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_A,
        'x-workspace-id': WS_A,
        'x-auth-subject': 'user-a',
        'x-actor-roles': 'member',
        authorization: forgedToken,
      },
      body: { data_source_ref: 'ds_a', table_name: 'orders', schema_name: 'public' },
      requestId: '00000001-0001-0001-0001-000000000001',
    },
    { db: pool },
  );

  // Must succeed and return a 201 owned by TENANT_A / WS_A.
  expect(result.statusCode).toBe(201);
  expect(result.body.tenant_id).toBe(TENANT_A);
  expect(result.body.workspace_id).toBe(WS_A);

  // Live DB must reflect TENANT_A ownership.
  const rowA = await pool.query(
    "SELECT count(*)::int AS n FROM pg_capture_configs WHERE tenant_id = $1 AND data_source_ref = 'ds_a'",
    [TENANT_A],
  );
  expect(rowA.rows[0].n).toBe(1);

  // CRITICAL: zero rows must belong to TENANT_B from this operation.
  const rowB = await pool.query(
    'SELECT count(*)::int AS n FROM pg_capture_configs WHERE tenant_id = $1',
    [TENANT_B],
  );
  expect(rowB.rows[0].n).toBe(0);
});

// ---------------------------------------------------------------------------
// e2e-cdc-02 — absent gateway headers → 401, no DB write.
// ---------------------------------------------------------------------------
test('e2e-cdc-02: missing x-tenant-id / x-workspace-id gateway headers → 401 UNAUTHORIZED, no DB insert', async () => {
  // Count rows before the call so we can verify nothing was written.
  const before = await pool.query(
    "SELECT count(*)::int AS n FROM pg_capture_configs WHERE tenant_id = $1 AND data_source_ref = 'ds_noheaders'",
    [TENANT_A],
  );
  const countBefore: number = before.rows[0].n;

  // Only the Authorization header is present — no gateway identity headers.
  const result = await pgCaptureEnable(
    {
      __ow_headers: {
        authorization: forgeToken(TENANT_A, WS_A),
      },
      body: { data_source_ref: 'ds_noheaders', table_name: 'events', schema_name: 'public' },
      requestId: '00000002-0002-0002-0002-000000000002',
    },
    { db: pool },
  );

  expect(result.statusCode).toBe(401);
  expect(result.body.code).toBe('UNAUTHORIZED');

  // The DB must be unchanged — no row was inserted.
  const after = await pool.query(
    "SELECT count(*)::int AS n FROM pg_capture_configs WHERE tenant_id = $1 AND data_source_ref = 'ds_noheaders'",
    [TENANT_A],
  );
  expect(after.rows[0].n).toBe(countBefore);
});

// ---------------------------------------------------------------------------
// e2e-cdc-03 — CROSS-TENANT PROBE (list): TENANT_A's list never returns
//              TENANT_B's captures.
// ---------------------------------------------------------------------------
test('e2e-cdc-03: cross-tenant list probe — authenticated TENANT_A sees only its own captures, never TENANT_B entries', async () => {
  // Seed a TENANT_B capture directly via SQL — bypassing any action logic so
  // the row definitely exists in the DB before the probe.
  await pool.query(
    `INSERT INTO pg_capture_configs
       (tenant_id, workspace_id, data_source_ref, schema_name, table_name, status, actor_identity)
     VALUES ($1, $2, 'ds_b_secret', 'public', 'private_table', 'active', 'seed')`,
    [TENANT_B, WS_B],
  );

  // Call the list action as TENANT_A / WS_A.
  const result = await pgCaptureList(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_A,
        'x-workspace-id': WS_A,
        'x-auth-subject': 'user-a',
        'x-actor-roles': 'member',
      },
    },
    { db: pool },
  );

  expect(result.statusCode).toBe(200);
  const items: Array<{ tenant_id: string; data_source_ref: string }> = result.body.items;

  // All returned items must belong to TENANT_A.
  for (const item of items) {
    expect(item.tenant_id).toBe(TENANT_A);
  }

  // TENANT_B's seeded capture must not appear.
  const hasTenantBEntry = items.some(
    (item) => item.data_source_ref === 'ds_b_secret' || item.tenant_id === TENANT_B,
  );
  expect(hasTenantBEntry).toBe(false);
});

// ---------------------------------------------------------------------------
// e2e-cdc-04 — CROSS-TENANT PROBE (tenant-summary authz): a tenant_owner of
//              TENANT_A cannot read TENANT_B's summary.
// ---------------------------------------------------------------------------
test('e2e-cdc-04: cross-tenant summary probe — TENANT_A tenant_owner requesting TENANT_B summary → 401 UNAUTHORIZED', async () => {
  // Identity: TENANT_A gateway headers with tenant_owner role.
  // Requested resource: params.tenantId = TENANT_B (a different tenant).
  // The action compares identity.tenantId !== params.tenantId and must reject.
  const result = await pgCaptureTenantSummary(
    {
      __ow_headers: {
        'x-tenant-id': TENANT_A,
        'x-workspace-id': WS_A,
        'x-auth-subject': 'user-a',
        'x-actor-roles': 'tenant_owner',
      },
      tenantId: TENANT_B,
    },
    { db: pool },
  );

  expect(result.statusCode).toBe(401);
  expect(result.body.code).toBe('UNAUTHORIZED');
});
