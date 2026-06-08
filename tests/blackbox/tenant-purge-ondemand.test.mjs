// Black-box test suite for change add-tenant-purge-executor (on-demand handler).
// Drives only the PUBLIC exported handler of the control-plane tenant-management
// module. The handler is a pure function (no real HTTP) that re-gates via
// evaluateTenantLifecycleMutation and dispatches a saga through an injected dep.
//
// Tests: bbx-purge-ondemand-01 .. bbx-purge-ondemand-05
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleTenantPurgeRequest, getTenantRoute } from '../../apps/control-plane/src/tenant-management.mjs';
import { readDomainSeedFixtures } from '../../scripts/lib/domain-model.mjs';

const NOW = '2026-03-24T00:00:00Z';

function deletedEligibleTenant() {
  const fixtures = readDomainSeedFixtures();
  const growth = fixtures.profiles.find((p) => p.id === 'growth-multi-workspace');
  return {
    ...growth.tenant,
    state: 'deleted',
    governance: {
      ...growth.tenant.governance,
      retentionPolicy: {
        ...growth.tenant.governance.retentionPolicy,
        purgeEligibleAt: '2026-03-20T00:00:00Z',
      },
    },
    // growth fixture already carries exportProfile.lastConsistencyCheckpoint
  };
}

test('bbx-purge-ondemand-00: handler wires to the existing purgeTenant route, not a /v1/admin path', () => {
  // Correction #1: the real route is /v1/tenants/{tenantId}/purge (operationId purgeTenant).
  assert.equal(getTenantRoute('purgeTenant').path, '/v1/tenants/{tenantId}/purge');
});

test('bbx-purge-ondemand-01: missing elevated access is rejected with a blocker (no dispatch)', async () => {
  let dispatched = 0;
  const res = await handleTenantPurgeRequest({
    tenant: deletedEligibleTenant(),
    actorUserId: 'usr_01betatenantadmin',
    approvalTicket: 'APR-42',
    hasElevatedAccess: false,
    hasSecondConfirmation: false,
    now: NOW,
    dispatchPurge: async () => { dispatched += 1; },
  });

  assert.ok(res.statusCode === 403 || res.statusCode === 409, `expected 403/409, got ${res.statusCode}`);
  assert.match(res.body.blocker, /elevated access/);
  assert.equal(dispatched, 0, 'must not dispatch when blocked');
});

test('bbx-purge-ondemand-02: non-deleted tenant returns 409 Conflict (no dispatch)', async () => {
  let dispatched = 0;
  const fixtures = readDomainSeedFixtures();
  const growth = fixtures.profiles.find((p) => p.id === 'growth-multi-workspace');
  const res = await handleTenantPurgeRequest({
    tenant: { ...growth.tenant, state: 'active' },
    actorUserId: 'usr_01betatenantadmin',
    approvalTicket: 'APR-42',
    hasElevatedAccess: true,
    hasSecondConfirmation: true,
    now: NOW,
    dispatchPurge: async () => { dispatched += 1; },
  });

  assert.equal(res.statusCode, 409);
  assert.ok(typeof res.body.blocker === 'string' && res.body.blocker.length > 0, `expected a blocker message, got ${JSON.stringify(res.body)}`);
  assert.equal(dispatched, 0, 'must not dispatch for non-deleted tenant');
});

test('bbx-purge-ondemand-03: valid dual-confirmation returns 202 Accepted with an async-operation reference and dispatches the saga', async () => {
  let dispatchedArg = null;
  const res = await handleTenantPurgeRequest({
    tenant: deletedEligibleTenant(),
    actorUserId: 'usr_01betatenantadmin',
    approvalTicket: 'APR-42',
    hasElevatedAccess: true,
    hasSecondConfirmation: true,
    now: NOW,
    dispatchPurge: async (arg) => { dispatchedArg = arg; return { operationId: arg.operationId }; },
  });

  assert.equal(res.statusCode, 202);
  assert.ok(res.body.operationId, `expected an operationId reference, got ${JSON.stringify(res.body)}`);
  assert.ok(dispatchedArg, 'expected the saga to be dispatched');
  assert.equal(dispatchedArg.tenantId, deletedEligibleTenant().tenantId);
});

test('bbx-purge-ondemand-04: a 202 response carries the purge draft (approvalTicket + actor) for the saga', async () => {
  let dispatchedArg = null;
  const res = await handleTenantPurgeRequest({
    tenant: deletedEligibleTenant(),
    actorUserId: 'usr_01betatenantadmin',
    approvalTicket: 'APR-77',
    hasElevatedAccess: true,
    hasSecondConfirmation: true,
    now: NOW,
    dispatchPurge: async (arg) => { dispatchedArg = arg; },
  });

  assert.equal(res.statusCode, 202);
  assert.equal(dispatchedArg.approvalTicket, 'APR-77');
  assert.equal(dispatchedArg.actorUserId, 'usr_01betatenantadmin');
});

test('bbx-purge-ondemand-05: handler does not throw when dispatchPurge is omitted (safe default)', async () => {
  const res = await handleTenantPurgeRequest({
    tenant: deletedEligibleTenant(),
    actorUserId: 'usr_01betatenantadmin',
    approvalTicket: 'APR-42',
    hasElevatedAccess: true,
    hasSecondConfirmation: true,
    now: NOW,
  });
  assert.equal(res.statusCode, 202);
  assert.ok(res.body.operationId);
});
