/**
 * Black-box tests for workspace-count quota enforcement
 * (fix-workspace-quota-enforcement, #556 BUG-QUOTA-ENFORCE, P1).
 *
 * The bug: `POST /v1/tenants/{id}/workspaces` had NO quota gate — a tenant created a
 * 4th workspace under a max_workspaces=3 entitlement (all 201). The fix gates the
 * create on the tenant's RESOLVED max_workspaces limit (override → plan → seeded
 * default 3) using the product governance model, denying the create that would
 * exceed it (402 QUOTA_EXCEEDED).
 *
 * Drives the kind handler's quota helper `checkWorkspaceQuota` against the REAL
 * product governance model (`resolveEffectiveLimit` + `evaluateQuotaDecision`) over a
 * stub pool that answers the dimension-catalog / plan-assignment / override queries —
 * proving precedence + the hard-quota boundary without a live cluster. (The
 * create-path 402 is confirmed in the consolidated live run.)
 *
 * bbx-556-01: at usage < default limit (3) → allowed
 * bbx-556-02: at usage == default limit (3) → denied (the 4th create)
 * bbx-556-03: a quota override raises the ceiling (precedence honoured)
 * bbx-556-04: governance model unavailable → fails OPEN (never blocks a create)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkWorkspaceQuota } from '../../apps/control-plane/workspace-quota.mjs';

// Load the real product governance model via repo-relative paths (the runtime uses
// /repo; tests run from the repo root).
const load = async () => {
  const [repo, model] = await Promise.all([
    import('../../packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs'),
    import('../../packages/provisioning-orchestrator/src/models/quota-enforcement.mjs'),
  ]);
  return { resolveEffectiveLimit: repo.resolveEffectiveLimit, evaluateQuotaDecision: model.evaluateQuotaDecision };
};

// The seeded max_workspaces dimension (098-plan-base-limits.sql): default 3.
const DIMENSION_ROWS = [
  { dimension_key: 'max_workspaces', display_label: 'Maximum Workspaces', unit: 'count', default_value: 3, description: 'x' },
];

// A stub governance pool. `overrides` lets a test inject an active quota override.
function pool({ overrides = [] } = {}) {
  return {
    query: async (sql) => {
      if (/FROM\s+quota_dimension_catalog/i.test(sql)) return { rows: DIMENSION_ROWS };
      if (/FROM\s+tenant_plan_assignments/i.test(sql)) return { rows: [] };   // no plan assigned → default
      if (/FROM\s+quota_overrides/i.test(sql)) return { rows: overrides };
      return { rows: [] };
    },
  };
}

const TENANT = 'acme-78848e21';

test('bbx-556-01: usage below the default limit is allowed', async () => {
  const d = await checkWorkspaceQuota(pool(), TENANT, 2, { load });
  assert.equal(d.allowed, true, `2 < 3 must be allowed (decision ${d.decision})`);
});

test('bbx-556-02: usage at the default limit denies the next create', async () => {
  const d = await checkWorkspaceQuota(pool(), TENANT, 3, { load });
  assert.equal(d.allowed, false, 'creating the 4th workspace under max_workspaces=3 must be denied');
  assert.equal(d.decision, 'hard_blocked');
  assert.equal(d.effectiveLimit, 3);
});

test('bbx-556-03: an active quota override raises the ceiling', async () => {
  const overrides = [{
    id: 'ovr-1', tenant_id: TENANT, dimension_key: 'max_workspaces',
    override_value: 5, status: 'active', quota_type: 'hard', grace_margin: 0,
    expires_at: null, created_at: '2026-06-18T00:00:00Z', justification: 'expansion',
  }];
  const atFour = await checkWorkspaceQuota(pool({ overrides }), TENANT, 4, { load });
  assert.equal(atFour.allowed, true, '4 < 5 (override) must be allowed');
  const atFive = await checkWorkspaceQuota(pool({ overrides }), TENANT, 5, { load });
  assert.equal(atFive.allowed, false, '5 >= 5 (override) must be denied');
});

test('bbx-556-04: governance model unavailable fails open', async () => {
  const failing = async () => { throw new Error('governance model not on /repo'); };
  const d = await checkWorkspaceQuota(pool(), TENANT, 99, { load: failing });
  assert.equal(d.allowed, true, 'must never block a create when the quota model is unavailable');
  assert.equal(d.decision, 'quota_unavailable');
});
