// bbx-flows-ten-teardown
//
// Tenant-deletion cascade for the workflows domain (change add-flows-tenancy-isolation-limits).
// Drives the PUBLIC appliers + tenant-purge-sweep action with injected fakes (no live DB), proving
// the workflows domain is wired into TEARDOWN_PLAN with the same partial-failure semantics as the
// other six domains.
//
// Scenarios:
//   bbx-flows-ten-teardown-01: workflows applier deletes flow_definitions + flow_versions rows
//   bbx-flows-ten-teardown-02: applier terminates the tenant's Temporal executions (no orphans)
//   bbx-flows-ten-teardown-03: applier is idempotent — second run deletes nothing, no error
//   bbx-flows-ten-teardown-04: applier failure → counts.errors>0 → sweep emits purge.failed, NOT purged
//   bbx-flows-ten-teardown-05: full success purge removes workflows rows + transitions to purged
//   bbx-flows-ten-teardown-06: a missing flows table (42P01) is "already gone", not an error
import test from 'node:test';
import assert from 'node:assert/strict';

import { teardown as workflowsTeardown } from '../../packages/provisioning-orchestrator/src/appliers/workflows-applier.mjs';
import { main as purgeSweep } from '../../packages/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs';

// A fake DB that records DELETEs against named tables; rows is a per-table count.
function makeFakeDb(rows = {}) {
  const deleted = [];
  return {
    deleted,
    async query(sql, params) {
      const m = /DELETE FROM (\w+) WHERE tenant_id = \$1/.exec(sql);
      if (!m) return { rowCount: 0 };
      const table = m[1];
      const rowCount = rows[table] ?? 0;
      deleted.push({ table, tenantId: params[0], rowCount });
      rows[table] = 0; // idempotent: a second delete removes nothing
      return { rowCount };
    },
  };
}

const ELIGIBLE_TENANT = {
  tenantId: 'tenant_A',
  state: 'deleted',
  // The purge gate (evaluateTenantLifecycleMutation) requires: retention window elapsed
  // (purgeEligibleAt in the past), an export checkpoint, and elevated + dual confirmation.
  governance: { retentionPolicy: { purgeEligibleAt: '2000-01-01T00:00:00.000Z' } },
  exportProfile: { lastConsistencyCheckpoint: '2000-01-02T00:00:00.000Z' },
  workspaces: [],
  managedResources: [],
  purgeAuthorization: { hasElevatedAccess: true, hasSecondConfirmation: true, actorUserId: 'op-1', approvalTicket: 'TCK-1' },
  domains: { workflows: {} },
};

test('bbx-flows-ten-teardown-01: applier deletes flow_definitions + flow_versions rows', async () => {
  const db = makeFakeDb({ flow_definitions: 3, flow_versions: 7, flow_schedules: 1 });
  const result = await workflowsTeardown('tenant_A', {}, { credentials: { db }, log: { error() {} } });
  assert.equal(result.status, 'applied');
  assert.equal(result.counts.errors, 0);
  const tables = db.deleted.map((d) => d.table);
  assert.ok(tables.includes('flow_definitions'));
  assert.ok(tables.includes('flow_versions'));
});

test('bbx-flows-ten-teardown-02: applier terminates the tenant Temporal executions', async () => {
  let terminatedFor = null;
  const db = makeFakeDb({ flow_definitions: 1, flow_versions: 1 });
  const result = await workflowsTeardown('tenant_A', {}, {
    credentials: { db, terminateTenantExecutions: async (tid) => { terminatedFor = tid; return { terminated: 4 }; } },
    log: { error() {} },
  });
  assert.equal(terminatedFor, 'tenant_A');
  const temporal = result.resource_results.find((r) => r.resource_type === 'temporal_executions');
  assert.equal(temporal.action, 'removed');
  assert.match(temporal.message, /4 execution/);
});

test('bbx-flows-ten-teardown-03: applier is idempotent — second run deletes nothing, no error', async () => {
  const rows = { flow_definitions: 2, flow_versions: 5 };
  const db = makeFakeDb(rows);
  const first = await workflowsTeardown('tenant_A', {}, { credentials: { db }, log: { error() {} } });
  assert.equal(first.status, 'applied');
  const second = await workflowsTeardown('tenant_A', {}, { credentials: { db }, log: { error() {} } });
  assert.equal(second.status, 'applied');
  assert.equal(second.counts.errors, 0);
  const secondDefs = db.deleted.filter((d) => d.table === 'flow_definitions');
  assert.equal(secondDefs[secondDefs.length - 1].rowCount, 0, 'second run removes zero rows');
});

test('bbx-flows-ten-teardown-04: applier failure → sweep emits purge.failed, tenant NOT purged', async () => {
  const events = [];
  let transitioned = false;
  const summary = await purgeSweep({
    listEligibleTenants: async () => [ELIGIBLE_TENANT],
    // All other domains succeed; workflows fails.
    iamTeardown: async () => ({ status: 'applied', resource_results: [], counts: { errors: 0 } }),
    postgresTeardown: async () => ({ status: 'applied', resource_results: [], counts: { errors: 0 } }),
    mongoTeardown: async () => ({ status: 'applied', resource_results: [], counts: { errors: 0 } }),
    kafkaTeardown: async () => ({ status: 'applied', resource_results: [], counts: { errors: 0 } }),
    storageTeardown: async () => ({ status: 'applied', resource_results: [], counts: { errors: 0 } }),
    functionsTeardown: async () => ({ status: 'applied', resource_results: [], counts: { errors: 0 } }),
    workflowsTeardown: async () => ({ status: 'error', resource_results: [], counts: { errors: 1 }, message: 'temporal terminate failed' }),
    hardDeleteServiceRows: async () => {},
    transitionTenantState: async () => { transitioned = true; },
    publishEvent: async (type, payload) => { events.push({ type, payload }); },
    log: { warn() {}, error() {} },
  });
  assert.equal(transitioned, false, 'tenant is NOT transitioned to purged on a workflows failure');
  const failed = events.find((e) => e.type === 'purge.failed');
  assert.ok(failed, 'purge.failed emitted');
  assert.equal(failed.payload.failedDomain, 'workflows');
  assert.ok(!events.some((e) => e.type === 'tenant.purged'));
  assert.equal(summary.purged, 0);
});

test('bbx-flows-ten-teardown-05: full success purge removes workflows rows + transitions to purged', async () => {
  const events = [];
  let transitionedTo = null;
  const allOk = async () => ({ status: 'applied', resource_results: [], counts: { errors: 0 } });
  const summary = await purgeSweep({
    listEligibleTenants: async () => [ELIGIBLE_TENANT],
    iamTeardown: allOk, postgresTeardown: allOk, mongoTeardown: allOk, kafkaTeardown: allOk, storageTeardown: allOk, functionsTeardown: allOk,
    workflowsTeardown: async (tenantId) => ({
      status: 'applied',
      resource_results: [
        { resource_type: 'flow_definitions', resource_id: tenantId, action: 'removed' },
        { resource_type: 'flow_versions', resource_id: tenantId, action: 'removed' },
      ],
      counts: { errors: 0 },
    }),
    hardDeleteServiceRows: async () => {},
    transitionTenantState: async (_t, state) => { transitionedTo = state; },
    publishEvent: async (type, payload) => { events.push({ type, payload }); },
    log: { warn() {}, error() {} },
  });
  assert.equal(summary.purged, 1);
  assert.equal(transitionedTo, 'purged');
  const purged = events.find((e) => e.type === 'tenant.purged');
  assert.ok(purged);
  const wfRemovals = purged.payload.destroyedResources.filter((r) => r.domain === 'workflows');
  assert.ok(wfRemovals.some((r) => r.resourceType === 'flow_definitions'));
  assert.ok(wfRemovals.some((r) => r.resourceType === 'flow_versions'));
});

test('bbx-flows-ten-teardown-06: a missing flows table is "already gone", not an error', async () => {
  const db = { async query() { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); } };
  const result = await workflowsTeardown('tenant_A', {}, { credentials: { db }, log: { error() {} } });
  assert.equal(result.counts.errors, 0);
  assert.equal(result.status, 'applied');
  assert.ok(result.resource_results.some((r) => r.action === 'skipped' && r.message === 'table absent'));
});
