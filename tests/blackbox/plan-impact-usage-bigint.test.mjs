/**
 * Black-box tests for fix-plan-impact-usage-bigint (P1, live E2E re-run 2026-06-18
 * BUG-PLAN-INT-OVERFLOW).
 *
 * Defect: `tenant_plan_quota_impacts.observed_usage` (and the sibling effective-value
 * columns) were INTEGER. Quota usage is reported in the dimension's unit — BYTES for
 * storage — so a multi-GB value overflowed INTEGER (max ~2.1e9) and EVERY
 * `POST /v1/tenants/{id}/plan` returned 500; no tenant could hold a plan.
 *
 * Fix: those columns are BIGINT (matching the sibling 098/103 limit columns), with an
 * idempotent guarded ALTER to upgrade existing deployments.
 *
 * Drives the public governance bootstrap (applyGovernanceSchema) with a capturing pool —
 * the same SQL that is applied to in_falcone at boot.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyGovernanceSchema } from '../../apps/control-plane/governance-schema.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function captureMigration100() {
  const sqls = [];
  const pool = { async query(sql) { sqls.push(sql); return { rows: [] }; } };
  await applyGovernanceSchema(pool, { repoRoot: REPO_ROOT, log: { log() {} } });
  const sql = sqls.find((s) => s.includes('tenant_plan_quota_impacts'));
  assert.ok(sql, 'migration 100 (tenant_plan_quota_impacts) must be applied by the governance bootstrap');
  return sql;
}

test('bbx-plan-bigint-01: observed_usage + effective-value columns are BIGINT, not INTEGER', async () => {
  const sql = await captureMigration100();
  const norm = sql.replace(/[ \t]+/g, ' ');
  for (const col of ['observed_usage', 'previous_effective_value', 'new_effective_value']) {
    assert.match(norm, new RegExp(`${col} BIGINT`), `${col} must be BIGINT`);
    assert.ok(!new RegExp(`${col} INTEGER`).test(norm), `${col} must NOT be INTEGER (overflow on byte usage)`);
  }
});

test('bbx-plan-bigint-02: an idempotent guarded ALTER upgrades existing INTEGER tables', async () => {
  const sql = (await captureMigration100()).toLowerCase().replace(/\s+/g, ' ');
  assert.ok(sql.includes('alter table tenant_plan_quota_impacts'), 'must ALTER existing tables');
  assert.ok(sql.includes('type bigint'), 'must convert to BIGINT');
  // Guarded so an already-BIGINT table is not needlessly rewritten on every boot.
  assert.ok(sql.includes("data_type = 'integer'"), 'the ALTER must be guarded on the current integer type');
});
