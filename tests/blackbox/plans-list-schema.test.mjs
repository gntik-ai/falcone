/**
 * Black-box regression suite for OpenSpec change fix-plans-list-500
 * (live E2E campaign 2026-06-17, finding F3).
 *
 * Drives the control-plane runtime schema setup (deploy/kind/control-plane/tenant-store.mjs) and the
 * REAL plan-list action (services/provisioning-orchestrator) through their public interface.
 * Deterministic: a recording fake pool captures the DDL; no live database is required.
 *
 * Defect: the plan/quota actions are the real provisioning-orchestrator modules, but no in-repo
 * migration runs in the hand-built control-plane runtime, so the `plans` relation never existed and
 * GET /v1/plans (plan-list) 500'd with `relation "plans" does not exist` (42P01).
 *
 * Fix: ensureSchema() now creates the canonical plan catalog schema (migration 097 — plans +
 * tenant_plan_assignments + plan_audit_events + the shared functions/triggers), idempotently.
 *
 * (Verified end-to-end against the real tests/env Postgres: plan-list 500/42P01 before, 200 with
 * the catalog envelope after; create+list round-trips; non-superadmin 403; ensureSchema re-runs
 * cleanly. This suite locks the contract in deterministically.)
 *
 * Scenario coverage (capability: quotas-plans / spec.md):
 *   bbx-f3-01  ensureSchema creates the `plans` relation with the columns the catalog reads
 *   bbx-f3-02  plan-list returns a 200 catalog envelope once the relation exists
 *   bbx-f3-03  plan-list still requires superadmin (403 otherwise) and validates paging
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema } from '../../deploy/kind/control-plane/tenant-store.mjs';
import * as planList from '../../services/provisioning-orchestrator/src/actions/plan-list.mjs';

/** Fake pool that records every SQL string. ensureSchema issues only DDL/UPDATE (reads no rows). */
function recordingPool() {
  const sql = [];
  return { sql, query: async (text) => { sql.push(String(text)); return { rows: [] }; } };
}

const SUPERADMIN = { actor: { id: 'sa-1', type: 'superadmin' } };

// -------------------------------------------------------------------------
// bbx-f3-01: the runtime schema setup creates the plan catalog relation
// -------------------------------------------------------------------------
test('bbx-f3-01: ensureSchema creates the `plans` relation the catalog reads', async () => {
  const pool = recordingPool();
  await ensureSchema(pool);
  const joined = pool.sql.join('\n;;\n');

  const createPlans = pool.sql.find((s) => /CREATE TABLE IF NOT EXISTS\s+plans\b/i.test(s));
  assert.ok(createPlans, 'ensureSchema must create the `plans` table (else plan-list 500s with 42P01)');
  // columns plan-repository.mapPlan / list rely on
  for (const col of ['slug', 'display_name', 'status', 'capabilities', 'quota_dimensions', 'created_at', 'created_by', 'updated_by']) {
    assert.match(createPlans, new RegExp(`\\b${col}\\b`), `plans table must declare the "${col}" column`);
  }
  // creation is idempotent and the slug catalog key is unique (case-insensitive)
  assert.match(joined, /uq_plans_slug_lower/, 'must create the case-insensitive unique slug index');
  // the wider /v1/plans family (create + change-history) needs the audit relation too
  assert.match(joined, /CREATE TABLE IF NOT EXISTS\s+plan_audit_events\b/i, 'must create plan_audit_events for plan-create/change-history');
});

// -------------------------------------------------------------------------
// bbx-f3-02: with the relation present, plan-list returns a 200 catalog envelope
// -------------------------------------------------------------------------
test('bbx-f3-02: plan-list returns a 200 catalog envelope once `plans` exists', async () => {
  // fake db modelling the now-existing `plans` relation: COUNT then the page rows
  const db = {
    query: async (text) => {
      if (/COUNT\(\*\)/i.test(text)) return { rows: [{ total: 1 }] };
      return { rows: [{ id: 'pln-1', slug: 'starter', display_name: 'Starter', description: null, status: 'active', capabilities: {}, quota_dimensions: {}, created_at: 't', updated_at: 't', created_by: 'sa', updated_by: 'sa' }] };
    },
  };
  const res = await planList.main({ page: 1, pageSize: 20, callerContext: SUPERADMIN }, { db });
  assert.equal(res.statusCode, 200, 'plan-list must return 200 (not 500) when the relation exists');
  assert.equal(res.body.total, 1);
  assert.equal(res.body.plans[0].slug, 'starter');
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 20);
});

// -------------------------------------------------------------------------
// bbx-f3-03: superadmin gate + paging validation are preserved
// -------------------------------------------------------------------------
test('bbx-f3-03: plan-list requires superadmin and validates paging', async () => {
  const emptyDb = { query: async (t) => ({ rows: /COUNT\(\*\)/i.test(t) ? [{ total: 0 }] : [] }) };

  await assert.rejects(
    () => planList.main({ callerContext: { actor: { id: 'u', type: 'tenant_owner' } } }, { db: emptyDb }),
    (e) => e.statusCode === 403,
    'a non-superadmin caller must be forbidden',
  );
  await assert.rejects(
    () => planList.main({ callerContext: {} }, { db: emptyDb }),
    (e) => e.statusCode === 403,
    'a caller with no actor must be forbidden',
  );
  await assert.rejects(
    () => planList.main({ page: 0, callerContext: SUPERADMIN }, { db: emptyDb }),
    (e) => e.statusCode === 400,
    'page < 1 must be a 400 validation error',
  );
  // an empty catalog is a valid 200 (fresh platform, no plans created yet)
  const res = await planList.main({ callerContext: SUPERADMIN }, { db: emptyDb });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.plans, []);
});
