// Real-Postgres proof for fix-audit-enforcement-logging (#594).
//
// Live 2-tenant E2E re-run (2026-06-18): a 4th-workspace create returned 402 QUOTA_EXCEEDED
// and a cross-tenant access returned 403, yet `quota_enforcement_log` and
// `scope_enforcement_denials` both had 0 rows. The enforcement points must write a correlated
// audit row. This drives the two writers against the REAL tables (exact migration DDL).
// Run: PGHOST=localhost PGPORT=55432 PGUSER=falcone PGPASSWORD=falcone node --test <file>
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { recordQuotaEnforcement, recordRouteDenial } from '../../apps/control-plane/audit-writer.mjs';

const { Pool } = pg;
const ADMIN_URL =
  process.env.DB_URL ??
  `postgres://${process.env.PGUSER ?? 'falcone'}:${process.env.PGPASSWORD ?? 'falcone'}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '55432'}/${process.env.PGDATABASE ?? 'falcone_test'}`;
const PROBE_DB = 'cp_audit_enforce_probe';
const url = (db) => ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/, `/${db}$1`);

const TEN_A = '11111111-1111-1111-1111-111111111111';
const TEN_B = '22222222-2222-2222-2222-222222222222';
const WS_A = '33333333-3333-3333-3333-333333333333';

// Exact migration DDL (093 scope_enforcement_denials, 103 quota_enforcement_log + its FK catalog).
const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE quota_dimension_catalog (dimension_key VARCHAR(64) PRIMARY KEY, display_label TEXT, unit TEXT, default_value BIGINT);
  INSERT INTO quota_dimension_catalog (dimension_key, default_value) VALUES ('max_workspaces', 3);
  CREATE TABLE quota_enforcement_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    workspace_id VARCHAR(255),
    dimension_key VARCHAR(64) NOT NULL REFERENCES quota_dimension_catalog(dimension_key),
    attempted_action VARCHAR(128),
    current_usage BIGINT,
    effective_limit BIGINT NOT NULL,
    quota_type VARCHAR(10) NOT NULL CHECK (quota_type IN ('hard','soft')),
    grace_margin INTEGER NOT NULL DEFAULT 0 CHECK (grace_margin >= 0),
    effective_ceiling BIGINT NOT NULL,
    source VARCHAR(16) NOT NULL CHECK (source IN ('override','plan','default')),
    decision VARCHAR(32) NOT NULL CHECK (decision IN ('allowed','hard_blocked','soft_grace_allowed','soft_grace_exhausted','unlimited','metering_unavailable')),
    actor_id VARCHAR(255),
    correlation_id VARCHAR(255),
    warning TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE scope_enforcement_denials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    workspace_id UUID,
    actor_id TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','anonymous')),
    denial_type TEXT NOT NULL CHECK (denial_type IN ('SCOPE_INSUFFICIENT','PLAN_ENTITLEMENT_DENIED','WORKSPACE_SCOPE_MISMATCH','CONFIG_ERROR')),
    http_method TEXT NOT NULL,
    request_path TEXT NOT NULL,
    required_scopes TEXT[],
    presented_scopes TEXT[],
    missing_scopes TEXT[],
    required_entitlement TEXT,
    current_plan_id TEXT,
    source_ip INET,
    correlation_id TEXT NOT NULL,
    denied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX uq_sed_correlation_denied_at ON scope_enforcement_denials (correlation_id, denied_at);
`;

let bootstrap;
let pool;
const silent = { warn() {} };

before(async () => {
  bootstrap = new Pool({ connectionString: ADMIN_URL, max: 1 });
  await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  await bootstrap.query(`CREATE DATABASE ${PROBE_DB}`);
  pool = new Pool({ connectionString: url(PROBE_DB), max: 2 });
  await pool.query(SCHEMA);
});

after(async () => {
  await pool?.end().catch(() => {});
  if (bootstrap) {
    await bootstrap.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`).catch(() => {});
    await bootstrap.end().catch(() => {});
  }
});

test('a hard quota denial is written to quota_enforcement_log WITH its correlation id', async () => {
  const correlationId = 'corr-quota-001';
  await recordQuotaEnforcement(pool, {
    tenantId: TEN_A, dimensionKey: 'max_workspaces', attemptedAction: 'workspace.create',
    currentUsage: 3, effectiveLimit: 3, quotaType: 'hard', graceMargin: 0, effectiveCeiling: 3,
    source: 'default', decision: 'hard_blocked', actorId: 'acme-ops', correlationId,
  });
  const r = await pool.query('SELECT * FROM quota_enforcement_log WHERE correlation_id=$1', [correlationId]);
  assert.equal(r.rowCount, 1);
  assert.equal(r.rows[0].decision, 'hard_blocked');
  assert.equal(r.rows[0].dimension_key, 'max_workspaces');
  assert.equal(r.rows[0].tenant_id, TEN_A);
  assert.equal(Number(r.rows[0].effective_limit), 3);
});

test('recordRouteDenial writes a scope-enforcement denial for a 403 (correlated, tenant-scoped)', async () => {
  const route = { method: 'GET', path: '/v1/workspaces/{workspaceId}' };
  const ctx = { identity: { tenantId: TEN_A, sub: 'acme-ops', actorType: 'tenant_owner' }, params: { workspaceId: WS_A } };
  const row = await recordRouteDenial(pool, route, ctx, { statusCode: 403 }, 'corr-deny-001', silent);
  assert.ok(row, 'a denial row should be written');
  const r = await pool.query('SELECT * FROM scope_enforcement_denials WHERE correlation_id=$1', ['corr-deny-001']);
  assert.equal(r.rowCount, 1);
  assert.equal(r.rows[0].tenant_id, TEN_A);
  assert.equal(r.rows[0].actor_id, 'acme-ops');
  assert.equal(r.rows[0].actor_type, 'user');
  assert.equal(r.rows[0].denial_type, 'SCOPE_INSUFFICIENT');
  assert.equal(r.rows[0].request_path, '/v1/workspaces/{workspaceId}');
});

test('recordRouteDenial records nothing for a successful (non-403) response', async () => {
  const before = (await pool.query('SELECT count(*)::int n FROM scope_enforcement_denials')).rows[0].n;
  const out = await recordRouteDenial(pool, { method: 'GET', path: '/x' },
    { identity: { tenantId: TEN_B, sub: 'globex-ops', actorType: 'tenant_owner' }, params: {} },
    { statusCode: 200 }, 'corr-ok-001', silent);
  assert.equal(out, null);
  const after = (await pool.query('SELECT count(*)::int n FROM scope_enforcement_denials')).rows[0].n;
  assert.equal(after, before);
});

test('recordRouteDenial generates a correlation id when the request did not carry one', async () => {
  const row = await recordRouteDenial(pool, { method: 'POST', path: '/v1/iam/realms/{realmId}/users' },
    { identity: { tenantId: TEN_B, sub: 'globex-ops', actorType: 'tenant_owner' }, params: {} },
    { statusCode: 403 }, null, silent);
  assert.ok(row, 'a denial row should still be written with a generated correlation id');
  assert.ok(row.correlation_id, 'correlation id is non-null');
  assert.equal(row.tenant_id, TEN_B);
});

test('recordRouteDenial cannot attribute a denial without a tenant/actor → records nothing', async () => {
  const out = await recordRouteDenial(pool, { method: 'GET', path: '/x' },
    { identity: { actorType: 'superadmin' }, params: {} }, { statusCode: 403 }, 'corr-na-001', silent);
  assert.equal(out, null);
});
