// Black-box test suite for change add-tenant-purge-executor (sweep action).
// Drives only the PUBLIC `main` entrypoint of the tenant-purge-sweep action,
// injecting all dependencies (candidates, teardown fns, hard-delete, transition,
// publishEvent). No internal knowledge.
//
// Tests: bbx-purge-sweep-01 .. bbx-purge-sweep-07 (incl. cross-tenant probe)
import test from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../../packages/provisioning-orchestrator/src/actions/tenant-purge-sweep.mjs';

const PAST = '2026-03-20T00:00:00Z';
const NOW = '2026-03-24T00:00:00Z';

/** Build a deleted, purge-eligible tenant past its retention window with a checkpoint. */
function eligibleTenant(tenantId) {
  return {
    tenantId,
    slug: tenantId,
    state: 'deleted',
    governance: {
      retentionPolicy: {
        purgeRequiresElevatedAccess: true,
        purgeRequiresDualConfirmation: true,
        purgeEligibleAt: PAST,
      },
    },
    exportProfile: { lastConsistencyCheckpoint: `chk_${tenantId}` },
    // Candidate query is responsible for returning only authorized purges; the
    // sweep re-gates via evaluateTenantLifecycleMutation using these flags.
    purgeAuthorization: {
      hasElevatedAccess: true,
      hasSecondConfirmation: true,
      actorUserId: 'usr_sweep_operator',
      approvalTicket: `APR-${tenantId}`,
    },
    domains: {
      iam: { realm: `${tenantId}-realm` },
      postgres_metadata: { schema: tenantId.replace(/-/g, '_') },
      mongo_metadata: { database: tenantId.replace(/-/g, '_') },
      kafka: { topics: [{ name: `${tenantId}.events` }] },
      storage: { buckets: [{ name: `${tenantId}-bucket` }] },
      functions: { namespace: `${tenantId}-ns` },
    },
  };
}

/** Track teardown invocations per domain. Returns a successful DomainResult. */
function recordingTeardowns(record) {
  const make = (domainKey) => async (tenantId, domainData, options = {}) => {
    record.push({ domain: domainKey, tenantId, dryRun: options.dryRun === true });
    return {
      domain_key: domainKey,
      status: options.dryRun ? 'would_apply' : 'applied',
      resource_results: [{ resource_type: domainKey, resource_name: tenantId, resource_id: tenantId, action: options.dryRun ? 'would_remove' : 'removed', message: null, warnings: [], diff: null }],
      counts: { created: 0, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
      message: null,
    };
  };
  return {
    iamTeardown: make('iam'),
    postgresTeardown: make('postgres_metadata'),
    mongoTeardown: make('mongo_metadata'),
    kafkaTeardown: make('kafka'),
    storageTeardown: make('storage'),
    functionsTeardown: make('functions'),
  };
}

test('bbx-purge-sweep-01: eligible deleted tenant is purged across all six domains, rows hard-deleted, state transitioned, tenant.purged emitted', async () => {
  const record = [];
  const events = [];
  const hardDeleted = [];
  const transitions = [];
  const result = await main({
    now: NOW,
    listEligibleTenants: async () => [eligibleTenant('tenant-a')],
    ...recordingTeardowns(record),
    hardDeleteServiceRows: async (tenantId) => { hardDeleted.push(tenantId); },
    transitionTenantState: async (tenantId, state) => { transitions.push({ tenantId, state }); },
    publishEvent: async (topic, payload) => { events.push({ topic, payload }); },
  });

  // all six domains torn down
  const domains = record.filter((r) => r.tenantId === 'tenant-a').map((r) => r.domain).sort();
  assert.deepEqual(domains, ['functions', 'iam', 'kafka', 'mongo_metadata', 'postgres_metadata', 'storage']);

  assert.deepEqual(hardDeleted, ['tenant-a'], 'service rows hard-deleted once');
  assert.ok(transitions.some((t) => t.tenantId === 'tenant-a' && t.state === 'purged'), `expected transition to purged, got ${JSON.stringify(transitions)}`);

  const purged = events.find((e) => e.topic === 'tenant.purged' || e.payload?.eventType === 'tenant.purged');
  assert.ok(purged, `expected a tenant.purged event, got: ${JSON.stringify(events.map((e) => e.topic))}`);
  assert.equal(purged.payload.tenantId, 'tenant-a');
  assert.ok(Array.isArray(purged.payload.destroyedResources) && purged.payload.destroyedResources.length >= 6,
    `expected a non-empty destruction manifest across domains, got: ${JSON.stringify(purged.payload.destroyedResources)}`);

  assert.equal(result.purged, 1);
  assert.equal(result.processed, 1);
});

test('bbx-purge-sweep-02: tenant inside the retention window is skipped (no teardown, no event)', async () => {
  const record = [];
  const events = [];
  const future = eligibleTenant('tenant-future');
  future.governance.retentionPolicy.purgeEligibleAt = '2026-04-01T00:00:00Z'; // after NOW

  const result = await main({
    now: NOW,
    listEligibleTenants: async () => [future],
    ...recordingTeardowns(record),
    hardDeleteServiceRows: async () => {},
    transitionTenantState: async () => {},
    publishEvent: async (topic, payload) => { events.push({ topic, payload }); },
  });

  assert.equal(record.length, 0, 'no teardown for tenant inside retention window');
  assert.equal(events.filter((e) => e.payload?.eventType === 'tenant.purged' || e.topic === 'tenant.purged').length, 0, 'no purged event');
  assert.equal(result.skipped, 1);
  assert.equal(result.purged, 0);
});

test('bbx-purge-sweep-03: tenant missing export checkpoint is skipped and the blocker is recorded', async () => {
  const record = [];
  const noCheckpoint = eligibleTenant('tenant-nocheck');
  noCheckpoint.exportProfile = { lastConsistencyCheckpoint: null };

  const result = await main({
    now: NOW,
    listEligibleTenants: async () => [noCheckpoint],
    ...recordingTeardowns(record),
    hardDeleteServiceRows: async () => {},
    transitionTenantState: async () => {},
    publishEvent: async () => {},
  });

  assert.equal(record.length, 0, 'no teardown without export checkpoint');
  assert.equal(result.purged, 0);
  assert.equal(result.skipped, 1);
  assert.ok(result.errors.length === 0, 'skip is not an error');
  // blocker text surfaced in the skip log
  const blob = JSON.stringify(result);
  assert.ok(/export checkpoint/i.test(blob), `expected export-checkpoint blocker recorded, got: ${blob}`);
});

test('bbx-purge-sweep-04: partial failure does NOT emit tenant.purged, does NOT transition, emits purge.failed', async () => {
  const events = [];
  const transitions = [];
  const teardowns = recordingTeardowns([]);
  // Make postgres teardown fail
  teardowns.postgresTeardown = async () => ({
    domain_key: 'postgres_metadata',
    status: 'error',
    resource_results: [{ resource_type: 'schema', resource_name: 'x', resource_id: null, action: 'error', message: 'boom', warnings: [], diff: null }],
    counts: { created: 0, skipped: 0, conflicts: 0, errors: 1, warnings: 0 },
    message: 'boom',
  });

  const result = await main({
    now: NOW,
    listEligibleTenants: async () => [eligibleTenant('tenant-a')],
    ...teardowns,
    hardDeleteServiceRows: async () => { throw new Error('should not hard-delete on partial failure'); },
    transitionTenantState: async (tenantId, state) => { transitions.push({ tenantId, state }); },
    publishEvent: async (topic, payload) => { events.push({ topic, payload }); },
  });

  assert.equal(events.filter((e) => e.payload?.eventType === 'tenant.purged' || e.topic === 'tenant.purged').length, 0, 'no tenant.purged on partial failure');
  assert.ok(events.some((e) => e.payload?.eventType === 'purge.failed' || e.topic === 'purge.failed'), `expected a purge.failed event, got ${JSON.stringify(events.map((e) => e.topic))}`);
  assert.equal(transitions.filter((t) => t.state === 'purged').length, 0, 'must not transition to purged on failure');
  assert.equal(result.purged, 0);
  assert.equal(result.errors.length, 1);
});

test('bbx-purge-sweep-05: dryRun drives teardowns in dryRun mode and does not hard-delete or transition', async () => {
  const record = [];
  const events = [];
  let hardDeletes = 0;
  let transitions = 0;
  const result = await main({
    now: NOW,
    dryRun: true,
    listEligibleTenants: async () => [eligibleTenant('tenant-a')],
    ...recordingTeardowns(record),
    hardDeleteServiceRows: async () => { hardDeletes += 1; },
    transitionTenantState: async () => { transitions += 1; },
    publishEvent: async (topic, payload) => { events.push({ topic, payload }); },
  });

  assert.ok(record.every((r) => r.dryRun === true), 'all teardowns invoked in dryRun mode');
  assert.equal(hardDeletes, 0, 'no hard-delete under dryRun');
  assert.equal(transitions, 0, 'no transition under dryRun');
  assert.equal(events.filter((e) => e.payload?.eventType === 'tenant.purged' || e.topic === 'tenant.purged').length, 0, 'no purged event under dryRun');
  assert.equal(result.purged, 0);
});

test('bbx-purge-sweep-06: defaults are safe — with no dependencies it processes zero candidates', async () => {
  const result = await main();
  assert.equal(result.processed, 0);
  assert.equal(result.purged, 0);
  assert.deepEqual(result.errors, []);
});

// Cross-tenant probe: purging Tenant A must not touch Tenant B's resources.
test('bbx-purge-sweep-07: cross-tenant probe — Tenant B untouched after Tenant A is purged', async () => {
  const record = [];
  const events = [];
  const hardDeleted = [];
  const transitions = [];

  // Only Tenant A is eligible; Tenant B is active and not returned by the candidate query.
  await main({
    now: NOW,
    listEligibleTenants: async () => [eligibleTenant('tenant-a')],
    ...recordingTeardowns(record),
    hardDeleteServiceRows: async (tenantId) => { hardDeleted.push(tenantId); },
    transitionTenantState: async (tenantId, state) => { transitions.push({ tenantId, state }); },
    publishEvent: async (topic, payload) => { events.push({ topic, payload }); },
  });

  // Every teardown invocation must scope to tenant-a only.
  assert.ok(record.every((r) => r.tenantId === 'tenant-a'), `teardowns must scope to tenant-a, got: ${JSON.stringify(record)}`);
  assert.ok(hardDeleted.every((t) => t === 'tenant-a'), `hard-deletes must scope to tenant-a, got: ${JSON.stringify(hardDeleted)}`);
  assert.ok(transitions.every((t) => t.tenantId === 'tenant-a'), `transitions must scope to tenant-a, got: ${JSON.stringify(transitions)}`);

  // The destruction manifest references only Tenant A's resources.
  const purged = events.find((e) => e.payload?.eventType === 'tenant.purged' || e.topic === 'tenant.purged');
  assert.ok(purged, 'expected a tenant.purged event');
  assert.ok(purged.payload.destroyedResources.every((d) => !String(d.resourceId ?? '').includes('tenant-b')),
    `no Tenant B resource may appear in the manifest, got: ${JSON.stringify(purged.payload.destroyedResources)}`);
  assert.equal(purged.payload.tenantId, 'tenant-a');
});
