/**
 * Black-box regression suite for spec change fix-console-create-tenant-plan.
 *
 * Drives the control-plane tenant-create plan-resolution contract through its public helpers
 * (apps/control-plane/b-handlers.mjs). Deterministic: loaders are injected, no DB / no /repo.
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
 *   bbx-tp-06..15  fix-960 connection affinity, committed reads, rollback and release
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlanUuid, assignPlanBestEffort } from '../../apps/control-plane/b-handlers.mjs';
import { main as planAssign } from '../../packages/provisioning-orchestrator/src/actions/plan-assign.mjs';
import { main as getPlan } from '../../packages/provisioning-orchestrator/src/actions/plan-assignment-get.mjs';
import { main as getPlanHistory } from '../../packages/provisioning-orchestrator/src/actions/plan-change-history-query.mjs';
import * as planRepo from '../../packages/provisioning-orchestrator/src/repositories/plan-repository.mjs';

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

// Database boundary fake: writes inside a transaction become visible to another
// connection only on COMMIT. The pool models a possible dispatch schedule where
// BEGIN/writes use one session and COMMIT another. This is connection-affinity
// evidence, not a substitute for PostgreSQL integration or staging revalidation.
function assignmentDatabase({ status = 'active', failHistory = false, failCommit = false } = {}) {
  const plan = { id: UUID, slug: 'starter', display_name: 'Starter', status, capabilities: {}, quota_dimensions: {} };
  const assignmentId = '11111111-1111-4111-8111-111111111111';
  const historyEntryId = '22222222-2222-4222-8222-222222222222';
  let committed = { assignment: null, history: null };
  let connects = 0, releases = 0, poolQueries = 0;
  const sessions = [];
  function session() {
    let transaction = null;
    const client = {
      get inTransaction() { return transaction !== null; },
      release() { releases++; },
      async query(text, values = []) {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql === 'BEGIN') { transaction = { ...committed }; return { rows: [] }; }
        if (sql === 'COMMIT') {
          if (failCommit) throw new Error('commit failed');
          if (transaction) committed = transaction;
          transaction = null;
          return { rows: [] };
        }
        if (sql === 'ROLLBACK') { transaction = null; return { rows: [] }; }
        const data = transaction ?? committed;
        if (sql.startsWith('SELECT 1 AS present FROM tenants')) return { rows: [{ present: 1 }] };
        if (sql.includes('FROM plans WHERE')) {
          const matches = sql.includes('lower(slug)') ? values[0] === plan.slug : values[0] === plan.id;
          return { rows: matches ? [plan] : [] };
        }
        if (sql.startsWith('INSERT INTO tenant_plan_assignments')) {
          data.assignment = { id: assignmentId, tenant_id: values[0], plan_id: values[1], assigned_by: values[2],
            assignment_metadata: JSON.parse(values[3]), effective_from: '2026-10-12T00:00:00.000Z', superseded_at: null };
          return { rows: [data.assignment] };
        }
        if (sql.startsWith('INSERT INTO tenant_plan_change_history')) {
          if (failHistory) throw new Error('history write failed');
          data.history = { id: historyEntryId, plan_assignment_id: values[0], tenant_id: values[1],
            previous_plan_id: values[2], new_plan_id: values[3], actor_id: values[4], effective_at: values[5],
            correlation_id: values[6], change_reason: values[7], change_direction: values[8],
            usage_collection_status: values[9], over_limit_dimension_count: values[10], assignment_metadata: JSON.parse(values[11]) };
          return { rows: [data.history] };
        }
        if (sql.includes('FROM tenant_plan_assignments')) {
          return { rows: data.assignment ? [{ ...data.assignment, plan_slug: plan.slug, plan_status: plan.status,
            plan_display_name: plan.display_name, capabilities: {}, quota_dimensions: {} }] : [] };
        }
        if (sql.includes('FROM tenant_plan_change_history')) {
          if (sql.startsWith('SELECT COUNT')) return { rows: [{ total: data.history ? 1 : 0 }] };
          return { rows: data.history ? [data.history] : [] };
        }
        if (sql.startsWith('SET LOCAL') || sql.includes('pg_advisory_xact_lock')
          || sql.includes('FROM quota_dimension_catalog') || sql.includes('FROM boolean_capability_catalog')
          || sql.includes('FROM tenant_plan_adjustments') || sql.includes('FROM tenant_plan_quota_impacts')
          || sql.includes('FROM tenant_plan_capability_impacts') || sql.includes('FROM plan_audit_events')
          || sql.startsWith('INSERT INTO plan_audit_events')) return { rows: [] };
        throw new Error(`Unexpected SQL in assignment database fake: ${sql}`);
      },
    };
    sessions.push(client);
    return client;
  }
  const client = session(), reader = session();
  return {
    client, reader,
    pool: {
      async connect() { connects++; return client; },
      async query(sql, values) {
        poolQueries++;
        return (sql === 'COMMIT' || sql === 'ROLLBACK' ? reader : client).query(sql, values);
      },
    },
    get connects() { return connects; },
    get releases() { return releases; },
    get poolQueries() { return poolQueries; },
    get openTransactions() { return sessions.filter((item) => item.inTransaction).length; },
  };
}

const realLoaders = { loadPlanRepo: async () => planRepo, loadPlanAssign: async () => planAssign };
const assignmentRequest = { tenantId: 't1', planId: UUID, assignedBy: 'sa' };
const readRequest = { tenantId: 't1', callerContext: { actor: { id: 'sa', type: 'superadmin' } } };

test('bbx-tp-06: an active plan reported assigned is committed and readable with its history', async () => {
  const db = assignmentDatabase();
  const result = await assignPlanBestEffort(db.pool, assignmentRequest, realLoaders);
  assert.equal(result.assigned, true);
  const current = await getPlan(readRequest, { db: db.reader });
  assert.equal(current.body.assignment?.assignmentId, result.assignmentId, 'assigned=true must reference a committed assignment');
  assert.equal(current.body.plan.id, UUID);
  const history = await getPlanHistory(readRequest, { db: db.reader });
  assert.equal(history.body.total, 1);
  assert.equal(history.body.items[0].historyEntryId, result.historyEntryId);
  assert.equal(db.connects, 1);
  assert.equal(db.releases, 1);
  assert.equal(db.poolQueries, 0, 'all assignment statements must use the checked-out client');
  assert.equal(db.openTransactions, 0);
});

test('bbx-tp-07: an active slug resolves on the assignment connection and persists its UUID', async () => {
  const db = assignmentDatabase();
  const result = await assignPlanBestEffort(db.pool, { ...assignmentRequest, planId: 'starter' }, realLoaders);
  assert.equal(result.assigned, true);
  const current = await getPlan(readRequest, { db: db.reader });
  assert.equal(current.body.assignment.assignmentId, result.assignmentId);
  assert.equal(current.body.plan.id, UUID);
  const history = await getPlanHistory(readRequest, { db: db.reader });
  assert.equal(history.body.total, 1);
  assert.equal(history.body.items[0].historyEntryId, result.historyEntryId);
  assert.equal(db.connects, 1);
  assert.equal(db.releases, 1);
  assert.equal(db.poolQueries, 0);
  assert.equal(db.openTransactions, 0);
});

test('bbx-tp-08: unknown slug releases the client without assigning', async () => {
  const db = assignmentDatabase();
  const result = await assignPlanBestEffort(db.pool, { ...assignmentRequest, planId: 'unknown' }, realLoaders);
  assert.equal(result.assigned, false);
  assert.match(result.reason, /no plan matches "unknown"/);
  assert.equal((await getPlan(readRequest, { db: db.reader })).body.noAssignment, true);
  assert.equal(db.connects, 1);
  assert.equal(db.releases, 1);
  assert.equal(db.poolQueries, 0, 'slug lookup must also use the checked-out client');
  assert.equal(db.openTransactions, 0);
});

test('bbx-tp-09: assignment failure rolls back before release, leaving no assignment or history', async () => {
  const db = assignmentDatabase({ failHistory: true });
  const result = await assignPlanBestEffort(db.pool, assignmentRequest, realLoaders);
  assert.equal(result.assigned, false);
  assert.equal(result.reason, 'history write failed');
  assert.equal((await getPlan(readRequest, { db: db.reader })).body.noAssignment, true);
  assert.equal((await getPlanHistory(readRequest, { db: db.reader })).body.total, 0);
  assert.equal(db.connects, 1);
  assert.equal(db.releases, 1);
  assert.equal(db.poolQueries, 0);
  assert.equal(db.openTransactions, 0);
});

test('bbx-tp-10: a draft plan is not assigned and the client is released', async () => {
  const db = assignmentDatabase({ status: 'draft' });
  const result = await assignPlanBestEffort(db.pool, assignmentRequest, realLoaders);
  assert.equal(result.assigned, false);
  assert.equal(result.reason, 'Plan is not active');
  assert.equal((await getPlan(readRequest, { db: db.reader })).body.noAssignment, true);
  assert.equal(db.releases, 1);
  assert.equal(db.openTransactions, 0);
});

test('bbx-tp-11: a loader throwing before assignment still releases the client', async () => {
  for (const loader of ['loadPlanRepo', 'loadPlanAssign']) {
    const db = assignmentDatabase();
    const result = await assignPlanBestEffort(db.pool, { ...assignmentRequest, planId: 'starter' }, {
      ...realLoaders, [loader]: async () => { throw new Error('loader unavailable'); },
    });
    assert.equal(result.assigned, false);
    assert.equal(db.releases, 1);
    assert.equal(db.openTransactions, 0);
  }
});

test('bbx-tp-12: a plain client is used directly without releasing a borrowed connection', async () => {
  const db = assignmentDatabase();
  const result = await assignPlanBestEffort(db.client, assignmentRequest, realLoaders);
  assert.equal(result.assigned, true);
  assert.equal((await getPlan(readRequest, { db: db.reader })).body.assignment.assignmentId, result.assignmentId);
  assert.equal(db.connects, 0);
  assert.equal(db.releases, 0);
  assert.equal(db.openTransactions, 0);
});

test('bbx-tp-13: release failures never throw or erase a committed assignment', async () => {
  for (const asynchronous of [false, true]) {
    for (const failHistory of [false, true]) {
      const db = assignmentDatabase({ failHistory });
      let releases = 0;
      db.client.release = () => {
        releases++;
        if (asynchronous) return Promise.reject(new Error('release unavailable'));
        throw new Error('release unavailable');
      };
      const result = await assignPlanBestEffort(db.pool, assignmentRequest, realLoaders);
      assert.equal(result.assigned, !failHistory);
      const current = await getPlan(readRequest, { db: db.reader });
      if (failHistory) {
        assert.equal(result.reason, 'history write failed');
        assert.equal(current.body.noAssignment, true);
      } else {
        assert.equal(current.body.assignment.assignmentId, result.assignmentId);
      }
      assert.equal(releases, 1);
      assert.equal(db.openTransactions, 0);
    }
  }
});

test('bbx-tp-14: connection rejection returns assigned:false without exposing connection details', async () => {
  const db = assignmentDatabase();
  db.pool.connect = async () => { throw new Error('private connection configuration'); };
  const result = await assignPlanBestEffort(db.pool, assignmentRequest, realLoaders);
  assert.equal(result.assigned, false);
  assert.equal(result.requestedPlanId, UUID);
  assert.equal(result.reason, 'Plan assignment connection unavailable');
  assert.equal(db.poolQueries, 0);
  assert.equal(db.releases, 0);
});

test('bbx-tp-15: a rejected COMMIT is never reported assigned and rolls back before release', async () => {
  const db = assignmentDatabase({ failCommit: true });
  const result = await assignPlanBestEffort(db.pool, assignmentRequest, realLoaders);
  assert.equal(result.assigned, false);
  assert.equal(result.reason, 'commit failed');
  assert.equal((await getPlan(readRequest, { db: db.reader })).body.noAssignment, true);
  assert.equal((await getPlanHistory(readRequest, { db: db.reader })).body.total, 0);
  assert.equal(db.releases, 1);
  assert.equal(db.openTransactions, 0);
});
