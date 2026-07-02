/**
 * Black-box regression suite for spec change fix-console-create-tenant-plan.
 *
 * Drives the control-plane tenant-create plan-resolution contract through its public helpers
 * (deploy/kind/control-plane/b-handlers.mjs). Deterministic: loaders are injected, no DB / no /repo.
 *
 * Defect (surfaced by the live console E2E): the CreateTenantWizard submits a plan SLUG ("starter"),
 * but createTenant's assignPlan step passed it to the real plan-assign action, which casts it to a
 * UUID -> "invalid input syntax for type uuid" -> the saga rolled the tenant back with a 502. So a
 * tenant could not be created via the console.
 *
 * Fix: plan assignment is best-effort and slug-aware — resolve slug->id, assign when the plan
 * exists, otherwise create the tenant anyway and report {assigned:false, reason}; never throw on a
 * non-uuid planId.
 *
 * Scenario coverage (capability: tenant-lifecycle / spec.md):
 *   bbx-tp-01  isPlanUuid distinguishes a UUID from a slug
 *   bbx-tp-02  a slug with no catalog match -> {assigned:false} (no throw); plan-assign NOT called
 *   bbx-tp-03  a resolvable slug -> looked up -> assigned with the resolved UUID
 *   bbx-tp-04  a UUID planId -> assigned directly (no slug lookup)
 *   bbx-tp-05  a plan-assign error -> {assigned:false, reason} (best-effort never throws)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlanUuid, assignPlanBestEffort } from '../../deploy/kind/control-plane/b-handlers.mjs';

const UUID = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';
const POOL = {}; // unused by the injected loaders

// -------------------------------------------------------------------------
// bbx-tp-01: UUID vs slug detection
// -------------------------------------------------------------------------
test('bbx-tp-01: isPlanUuid distinguishes a UUID from a slug', () => {
  assert.equal(isPlanUuid(UUID), true);
  assert.equal(isPlanUuid('starter'), false);
  assert.equal(isPlanUuid('growth'), false);
  assert.equal(isPlanUuid(''), false);
  assert.equal(isPlanUuid(undefined), false);
});

// -------------------------------------------------------------------------
// bbx-tp-02: unknown slug -> assigned:false, never throws, plan-assign untouched
// -------------------------------------------------------------------------
test('bbx-tp-02: a slug with no catalog match degrades to assigned:false (no 502)', async () => {
  let assignCalled = false;
  const res = await assignPlanBestEffort(POOL, { tenantId: 't1', planId: 'starter', assignedBy: 'sa' }, {
    loadPlanRepo: async () => ({ findBySlug: async () => null }),
    loadPlanAssign: async () => { assignCalled = true; return async () => ({ body: {} }); },
  });
  assert.equal(res.assigned, false, 'an unresolvable plan must not assign');
  assert.equal(res.requestedPlanId, 'starter');
  assert.match(res.reason, /no plan matches "starter"/);
  assert.equal(assignCalled, false, 'plan-assign must not be invoked when the slug has no match');
});

// -------------------------------------------------------------------------
// bbx-tp-03: resolvable slug -> resolved to the catalog UUID and assigned
// -------------------------------------------------------------------------
test('bbx-tp-03: a resolvable slug is looked up and assigned with the resolved UUID', async () => {
  let assignedPlanId;
  const res = await assignPlanBestEffort(POOL, { tenantId: 't1', planId: 'starter', assignedBy: 'sa' }, {
    loadPlanRepo: async () => ({ findBySlug: async (_pool, slug) => (slug === 'starter' ? { id: UUID, slug } : null) }),
    loadPlanAssign: async () => async (params) => { assignedPlanId = params.planId; return { body: { planId: params.planId, status: 'assigned' } }; },
  });
  assert.equal(res.assigned, true);
  assert.equal(assignedPlanId, UUID, 'plan-assign must receive the resolved UUID, not the slug');
  assert.equal(res.status, 'assigned');
});

// -------------------------------------------------------------------------
// bbx-tp-04: a UUID planId is assigned directly (no slug lookup)
// -------------------------------------------------------------------------
test('bbx-tp-04: a UUID planId is assigned directly (no slug lookup)', async () => {
  let lookedUp = false;
  const res = await assignPlanBestEffort(POOL, { tenantId: 't1', planId: UUID, assignedBy: 'sa' }, {
    loadPlanRepo: async () => ({ findBySlug: async () => { lookedUp = true; return null; } }),
    loadPlanAssign: async () => async (params) => ({ body: { planId: params.planId } }),
  });
  assert.equal(res.assigned, true);
  assert.equal(lookedUp, false, 'a UUID must skip the slug lookup');
});

// -------------------------------------------------------------------------
// bbx-tp-05: a plan-assign error degrades to assigned:false (never throws)
// -------------------------------------------------------------------------
test('bbx-tp-05: a plan-assign error degrades to assigned:false (best-effort)', async () => {
  const res = await assignPlanBestEffort(POOL, { tenantId: 't1', planId: UUID, assignedBy: 'sa' }, {
    loadPlanRepo: async () => ({ findBySlug: async () => null }),
    loadPlanAssign: async () => async () => { throw new Error('plan-assign boom'); },
  });
  assert.equal(res.assigned, false);
  assert.match(res.reason, /plan-assign boom/);
});
