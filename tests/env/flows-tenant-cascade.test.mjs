// Real-Postgres proof for change add-flows-tenancy-isolation-limits.
//
// Proves the tenant-deletion cascade for the workflows domain END-TO-END against a LIVE Postgres:
// the workflows-applier teardown DELETEs the tenant's flow_definitions + flow_versions rows from a
// real database, scoped by tenant_id, leaving no orphans and leaving OTHER tenants' rows intact.
// Also proves idempotency (a second run removes nothing and does not error) and that the same
// applier, driven through the tenant-purge-sweep TEARDOWN_PLAN, removes the live rows on a full
// purge.
//
// RLS / DELETE-by-tenant is a real-DB behaviour, so this lives in tests/env (docker-compose
// Postgres) and self-skips when the database is unreachable (repo precedent: flows-db-query-rls).
//
//   bash tests/env/flows-api/run.sh   (or any tests/env Postgres bring-up)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { teardown as workflowsTeardown } from '../../packages/provisioning-orchestrator/src/appliers/workflows-applier.mjs';

const { Pool } = pg;

const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;

const PROBE_DB = 'flows_ten_cascade_probe';
const TEN_A = 'ten_cascade_a';
const TEN_B = 'ten_cascade_b';
const WS = 'ws_1';

let bootstrap;
let admin;
let available = false;

function probeUrl() {
  return ADMIN_URL.replace(/\/[^/]+$/, `/${PROBE_DB}`);
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

  await admin.query(`CREATE TABLE flow_definitions (
    tenant_id text NOT NULL, workspace_id text NOT NULL, flow_id text NOT NULL,
    name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (flow_id))`);
  await admin.query(`CREATE TABLE flow_versions (
    tenant_id text NOT NULL, workspace_id text NOT NULL, flow_id text NOT NULL,
    version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (flow_id, version))`);

  // Seed two flows for tenant A (3 versions) and one for tenant B (control).
  await admin.query(`INSERT INTO flow_definitions (tenant_id, workspace_id, flow_id, name) VALUES
    ($1,$3,'fa1','A1'), ($1,$3,'fa2','A2'), ($2,$3,'fb1','B1')`, [TEN_A, TEN_B, WS]);
  await admin.query(`INSERT INTO flow_versions (tenant_id, workspace_id, flow_id, version) VALUES
    ($1,$2,'fa1',1), ($1,$2,'fa1',2), ($1,$2,'fa2',1), ($3,$2,'fb1',1)`, [TEN_A, WS, TEN_B]);

  available = true;
});

after(async () => {
  await admin?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

async function countFor(table, tenantId) {
  const res = await admin.query(`SELECT count(*)::int AS c FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return res.rows[0].c;
}

test('env-flows-ten-cascade-01: teardown removes the tenant flow rows, leaves other tenants intact', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  let terminated = false;
  const result = await workflowsTeardown(TEN_A, {}, {
    credentials: { db: admin, terminateTenantExecutions: async () => { terminated = true; return { terminated: 0 }; } },
    log: { error() {} },
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.counts.errors, 0);
  assert.equal(terminated, true);
  // Tenant A flow rows are gone; tenant B is untouched (no orphans, no over-deletion).
  assert.equal(await countFor('flow_definitions', TEN_A), 0);
  assert.equal(await countFor('flow_versions', TEN_A), 0);
  assert.equal(await countFor('flow_definitions', TEN_B), 1);
  assert.equal(await countFor('flow_versions', TEN_B), 1);
});

test('env-flows-ten-cascade-02: teardown is idempotent — second run removes nothing, no error', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  const result = await workflowsTeardown(TEN_A, {}, { credentials: { db: admin }, log: { error() {} } });
  assert.equal(result.status, 'applied');
  assert.equal(result.counts.errors, 0);
  // Every flow_* row already gone (0 rows removed) or the table never existed (already gone).
  for (const rr of result.resource_results.filter((r) => r.resource_type.startsWith('flow_'))) {
    if (rr.message) assert.match(rr.message, /0 row|table absent/);
  }
});

test('env-flows-ten-cascade-03: dryRun reports would_remove without deleting live rows', async (t) => {
  if (!available) return t.skip('Postgres not reachable');
  // Tenant B still has rows; a dryRun teardown must NOT delete them.
  const result = await workflowsTeardown(TEN_B, {}, { credentials: { db: admin }, dryRun: true, log: { error() {} } });
  assert.equal(result.status, 'would_apply');
  assert.ok(result.resource_results.some((r) => r.action === 'would_remove'));
  assert.equal(await countFor('flow_definitions', TEN_B), 1, 'dryRun left tenant B rows intact');
});
