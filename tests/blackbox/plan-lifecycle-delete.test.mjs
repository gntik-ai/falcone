/**
 * Black-box regression suite for Falcone issue #802.
 *
 * Public surface under test: the kind control-plane route table that serves the
 * web console's plan-management API, plus the routed provisioning-orchestrator
 * action invoked through that route contract.
 *
 * Scenario coverage:
 *   bbx-802-01 | fn-plan-lifecycle-console-route, fn-plan-delete-retire-console-route
 *     Scenario: Superadmin manages plan lifecycle and obsolete plan deletion through the console-served API
 *   bbx-802-02 | fn-plan-lifecycle-transition
 *     Scenario: Superadmin transitions draft -> active -> deprecated -> archived through the console-served API
 *   bbx-802-03 | fn-plan-delete-retire-authz
 *     Scenario: Plan deletion/retirement is superadmin-only
 *   bbx-802-04 | fn-plan-delete-retire-guard
 *     Scenario: Active, in-use, or assigned plans cannot be deleted/retired
 *   bbx-802-05 | fn-plan-delete-retire-safe-obsolete
 *     Scenario: A never-assigned obsolete/draft plan can be removed or retired
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { routes } from '../../apps/control-plane/routes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

const SUPERADMIN = { actor: { id: 'sa-802', type: 'superadmin' } };
const TENANT_OWNER = { actor: { id: 'owner-802', type: 'tenant_owner' }, tenantId: 'tenant-802' };
const LIFECYCLE_PATH = '/v1/plans/{planId}/lifecycle';
const DELETE_PATH = '/v1/plans/{planId}';

function findRoute(method, path) {
  return routes.find((route) => route.method === method && route.path === path);
}

function assertActionRoute(route, { method, path, expectedNamePattern }) {
  assert.ok(route, `${method} ${path} must be registered in the served kind route table`);
  assert.equal(route.auth, 'superadmin', `${method} ${path} must be guarded as superadmin-only at the route layer`);
  assert.equal(route.invoke, 'callercontext-overrides', `${method} ${path} must receive trusted callerContext`);
  assert.ok(route.module, `${method} ${path} must route to a public action module`);
  assert.equal(route.export ?? 'main', 'main', `${method} ${path} must invoke the action's public main export`);
  assert.match(route.module, expectedNamePattern, `${method} ${path} must target the expected plan action`);
  assert.ok(route.deps?.includes('db'), `${method} ${path} must receive the control-plane db dependency`);
}

async function loadActionFor(method, path) {
  const route = findRoute(method, path);
  assert.ok(route, `${method} ${path} route is required before the action can be exercised`);
  assert.ok(route.module, `${method} ${path} must be module-backed so it can run through the action contract`);
  const modulePath = route.module.replace(/^\/repo\//, `${REPO_ROOT}/`);
  try {
    const mod = await import(pathToFileURL(modulePath).href);
    const action = mod[route.export ?? 'main'];
    assert.equal(typeof action, 'function', `${route.module} must export ${route.export ?? 'main'}()`);
    return action;
  } catch (error) {
    assert.fail(`expected routed action module to import: ${route.module} (${error.message})`);
  }
}

function planRow({ id, slug, status = 'draft' }) {
  return {
    id,
    slug,
    display_name: slug.replaceAll('-', ' '),
    description: null,
    status,
    capabilities: {},
    quota_dimensions: {},
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    created_by: 'sa-802',
    updated_by: 'sa-802',
  };
}

function makePlanStore({ plans = [], assignments = [] } = {}) {
  const byId = new Map(plans.map((plan) => [plan.id, { ...plan }]));
  const auditEvents = [];
  const normalized = (sql) => String(sql).replace(/\s+/g, ' ').trim();
  const assignmentsFor = (planId, { activeOnly = false } = {}) => assignments
    .filter((assignment) => assignment.plan_id === planId)
    .filter((assignment) => !activeOnly || assignment.superseded_at == null)
    .map((assignment) => ({ tenant_id: assignment.tenant_id, superseded_at: assignment.superseded_at ?? null }));

  return {
    plans: byId,
    auditEvents,
    async query(sqlText, params = []) {
      const sql = normalized(sqlText);

      if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql) || /^SET LOCAL\b/i.test(sql)) return { rows: [] };

      if (/INSERT INTO plan_audit_events\b/i.test(sql)) {
        auditEvents.push({ sql, params });
        return { rows: [] };
      }

      if (/^UPDATE plan_audit_events\b/i.test(sql)) return { rows: [] };

      if (/FROM tenant_plan_assignments\b/i.test(sql) && /^SELECT\b/i.test(sql)) {
        const planId = params[0];
        return { rows: assignmentsFor(planId, { activeOnly: /superseded_at IS NULL/i.test(sql) }) };
      }

      if (/SELECT COUNT\(\*\)/i.test(sql) && /FROM plans\b/i.test(sql)) {
        const rows = [...byId.values()].filter((plan) => !/WHERE status = \$1/i.test(sql) || plan.status === params[0]);
        return { rows: [{ total: rows.length }] };
      }

      if (/^SELECT \* FROM plans WHERE id = \$1\b/i.test(sql)) {
        const plan = byId.get(params[0]);
        return { rows: plan ? [{ ...plan }] : [] };
      }

      if (/^SELECT \* FROM plans\b/i.test(sql)) {
        const rows = [...byId.values()]
          .filter((plan) => !/WHERE status = \$1/i.test(sql) || plan.status === params[0])
          .map((plan) => ({ ...plan }));
        return { rows };
      }

      if (/^UPDATE plans\b/i.test(sql) && /\bRETURNING \*/i.test(sql)) {
        const id = params[0];
        const plan = byId.get(id);
        if (!plan) return { rows: [] };
        let targetStatus = null;
        if (/status\s*=\s*\$2/i.test(sql)) targetStatus = params[1];
        if (/status\s*=\s*'archived'/i.test(sql)) targetStatus = 'archived';
        if (/status\s*=\s*'deprecated'/i.test(sql)) targetStatus = 'deprecated';
        if (targetStatus) plan.status = targetStatus;
        if (/\bdeleted_at\b/i.test(sql)) plan.deleted_at = '2026-07-01T00:00:00.000Z';
        if (/\bretired_at\b/i.test(sql)) plan.retired_at = '2026-07-01T00:00:00.000Z';
        plan.updated_at = '2026-07-01T00:00:01.000Z';
        byId.set(id, plan);
        return { rows: [{ ...plan }] };
      }

      if (/\bDELETE FROM plans\b/i.test(sql)) {
        const id = params[0];
        const plan = byId.get(id);
        if (!plan) return { rows: [] };
        if (/NOT EXISTS\s*\(SELECT 1 FROM (tenant_plan_assignments|assignment_history)/i.test(sql) && assignmentsFor(id).length > 0) {
          return { rows: [] };
        }
        byId.delete(id);
        return { rows: [{ ...plan }] };
      }

      throw new Error(`Unexpected SQL in black-box fake pg: ${sql}`);
    },
  };
}

async function assertRejectsStatus(fn, statusCode, message) {
  await assert.rejects(
    fn,
    (error) => error?.statusCode === statusCode,
    message,
  );
}

function assertSafeDeleteOrRetireAccepted(result, store, planId) {
  assert.ok([200, 202, 204].includes(result.statusCode), `safe delete/retire must return 2xx, got ${result.statusCode}`);
  const stored = store.plans.get(planId);
  if (!stored) return;
  assert.ok(
    ['deprecated', 'archived', 'retired'].includes(stored.status) || stored.deleted_at || stored.retired_at,
    'a safe obsolete/draft plan must be removed or visibly retired by public state',
  );
}

// bbx-802-01 | fn-plan-lifecycle-console-route, fn-plan-delete-retire-console-route
// Scenario: Superadmin manages plan lifecycle and obsolete plan deletion through the console-served API
test('bbx-802-01: console-served plan lifecycle and delete/retire routes are registered as superadmin actions', () => {
  assertActionRoute(findRoute('POST', LIFECYCLE_PATH), {
    method: 'POST',
    path: LIFECYCLE_PATH,
    expectedNamePattern: /\/plan-lifecycle\.mjs$/,
  });

  assertActionRoute(findRoute('DELETE', DELETE_PATH), {
    method: 'DELETE',
    path: DELETE_PATH,
    expectedNamePattern: /\/plan-(delete|retire)\.mjs$/,
  });
});

// bbx-802-02 | fn-plan-lifecycle-transition
// Scenario: Superadmin transitions draft -> active -> deprecated -> archived through the console-served API
test('bbx-802-02: superadmin can transition draft -> active -> deprecated -> archived via the served lifecycle action', async () => {
  const action = await loadActionFor('POST', LIFECYCLE_PATH);
  const planId = 'pln-802-lifecycle';
  const store = makePlanStore({ plans: [planRow({ id: planId, slug: 'issue-802-lifecycle' })] });

  await assertRejectsStatus(
    () => action({ planId, targetStatus: 'active', callerContext: TENANT_OWNER }, { db: store }),
    403,
    'non-superadmin callers must not transition plan lifecycle',
  );

  for (const targetStatus of ['active', 'deprecated', 'archived']) {
    const result = await action({ planId, targetStatus, callerContext: SUPERADMIN }, { db: store });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.planId, planId);
    assert.equal(result.body.newStatus, targetStatus);
    assert.equal(store.plans.get(planId).status, targetStatus);
  }
});

// bbx-802-03 | fn-plan-delete-retire-authz
// Scenario: Plan deletion/retirement is superadmin-only
test('bbx-802-03: plan delete/retire action rejects non-superadmin callers', async () => {
  const action = await loadActionFor('DELETE', DELETE_PATH);
  const planId = 'pln-802-authz';
  const store = makePlanStore({ plans: [planRow({ id: planId, slug: 'issue-802-authz', status: 'draft' })] });

  await assertRejectsStatus(
    () => action({ planId, callerContext: TENANT_OWNER }, { db: store }),
    403,
    'delete/retire must be forbidden without a superadmin actor',
  );
  assert.ok(store.plans.has(planId), 'forbidden delete/retire must not mutate the plan');
});

// bbx-802-04 | fn-plan-delete-retire-guard
// Scenario: Active, in-use, or assigned plans cannot be deleted/retired
test('bbx-802-04: plan delete/retire refuses active or assigned plans server-side', async () => {
  const action = await loadActionFor('DELETE', DELETE_PATH);
  const planId = 'pln-802-assigned';
  const activeNeverAssignedId = 'pln-802-active-never-assigned';
  const store = makePlanStore({
    plans: [
      planRow({ id: planId, slug: 'issue-802-assigned', status: 'deprecated' }),
      planRow({ id: activeNeverAssignedId, slug: 'issue-802-active-never-assigned', status: 'active' }),
    ],
    assignments: [{ tenant_id: 'tenant-802-a', plan_id: planId, superseded_at: null }],
  });

  await assertRejectsStatus(
    () => action({ planId: activeNeverAssignedId, callerContext: SUPERADMIN }, { db: store }),
    409,
    'active plan delete must be rejected as a conflict even when it has no assignments',
  );
  assert.equal(store.plans.get(activeNeverAssignedId).status, 'active', 'rejected delete/retire must leave the active plan unchanged');

  await assertRejectsStatus(
    () => action({ planId, callerContext: SUPERADMIN }, { db: store }),
    409,
    'assigned/in-use plan delete must be rejected as a conflict',
  );
  assert.equal(store.plans.get(planId).status, 'deprecated', 'rejected delete/retire must leave the assigned plan unchanged');
});

// bbx-802-05 | fn-plan-delete-retire-safe-obsolete
// Scenario: A never-assigned obsolete/draft plan can be removed or retired
test('bbx-802-05: plan delete/retire accepts never-assigned obsolete and draft plans', async () => {
  const lifecycleAction = await loadActionFor('POST', LIFECYCLE_PATH);
  const deleteAction = await loadActionFor('DELETE', DELETE_PATH);

  const obsoleteId = 'pln-802-obsolete';
  const draftId = 'pln-802-draft';
  const store = makePlanStore({
    plans: [
      planRow({ id: obsoleteId, slug: 'issue-802-obsolete' }),
      planRow({ id: draftId, slug: 'issue-802-draft' }),
    ],
  });

  for (const targetStatus of ['active', 'deprecated', 'archived']) {
    const result = await lifecycleAction({ planId: obsoleteId, targetStatus, callerContext: SUPERADMIN }, { db: store });
    assert.equal(result.statusCode, 200);
  }

  assertSafeDeleteOrRetireAccepted(
    await deleteAction({ planId: obsoleteId, callerContext: SUPERADMIN }, { db: store }),
    store,
    obsoleteId,
  );
  assertSafeDeleteOrRetireAccepted(
    await deleteAction({ planId: draftId, callerContext: SUPERADMIN }, { db: store }),
    store,
    draftId,
  );
});
