import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAuditChain } from '../../apps/control-plane/audit-hash.mjs';
import { recordAuditEvent } from '../../apps/control-plane/audit-store.mjs';
import { main as setSubQuota } from '../../packages/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs';
import { main as removeSubQuota } from '../../packages/provisioning-orchestrator/src/actions/workspace-sub-quota-remove.mjs';
import { createFakeDb, seedPlans, seedAssignments } from '../integration/105-effective-limit-resolution/fixtures/seed-plans-with-quotas-and-capabilities.mjs';

const owner = { callerContext: { actor: { id: 'owner', type: 'tenant_owner', tenantId: 'tenant-a' } }, tenantId: 'tenant-a', workspaceId: 'ws-a', dimensionKey: 'max_pg_databases', correlationId: 'corr-978' };

function memoryDb() {
  const db = createFakeDb();
  seedPlans(db); seedAssignments(db);
  return db;
}

// Persistence boundary for the shared writer; the action and repository stay real.
function auditClient(rows) {
  return { async connect() { throw new Error('Client has already been connected'); }, async query(sql, params = []) {
    if (sql.includes('SELECT row_hash')) {
      const head = rows.filter((row) => row.tenant_id === params[0] && row.row_hash != null).at(-1);
      return { rows: head ? [head] : [] };
    }
    if (sql.includes('INSERT INTO plan_audit_events')) {
      const [id, action_type, actor_id, tenant_id, previous, next, outcome, correlation_id, created_at, prev_hash, row_hash, plan_id] = params;
      const row = { id, action_type, actor_id, tenant_id, plan_id, previous_state: previous == null ? null : JSON.parse(previous), new_state: JSON.parse(next), outcome, correlation_id, created_at, prev_hash, row_hash };
      rows.push(row); return { rows: [row] };
    }
    return { rows: [] };
  } };
}

test('978 sub-quota set: tenant owner cannot reset a tenant/workspace chain', async () => {
  const db = memoryDb();
  const client = auditClient(db._planAuditEvents);
  await recordAuditEvent(client, { actionType: 'tenant.create', tenantId: 'tenant-a', actorId: 'owner' });
  await recordAuditEvent(client, { actionType: 'workspace.create', tenantId: 'tenant-a', actorId: 'owner', workspaceId: 'ws-a' });
  await setSubQuota({ ...owner, allocatedValue: 4 }, { db });
  await recordAuditEvent(client, { actionType: 'workspace.create', tenantId: 'tenant-a', actorId: 'owner', workspaceId: 'ws-b' });
  const rows = db._planAuditEvents;
  assert.deepEqual(verifyAuditChain(rows), { valid: true, brokenAt: null });
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((row) => row.prev_hash === '').length, 1);
  assert.equal(rows[2].action_type, 'quota.sub_quota.set');
  assert.equal(rows[2].actor_id, 'owner');
  assert.equal(rows[2].correlation_id, 'corr-978');
  assert.equal(rows[2].plan_id, null);
  assert.deepEqual(rows[2].new_state, { workspaceId: 'ws-a', dimensionKey: 'max_pg_databases', allocatedValue: 4 });
});

test('978 sub-quota remove: a tenant owner deletion remains in the same chain', async () => {
  const db = memoryDb();
  await setSubQuota({ ...owner, allocatedValue: 4 }, { db });
  await removeSubQuota(owner, { db });
  assert.deepEqual(verifyAuditChain(db._planAuditEvents), { valid: true, brokenAt: null });
  assert.deepEqual(db._planAuditEvents[1].previous_state, { workspaceId: 'ws-a', dimensionKey: 'max_pg_databases', allocatedValue: 4 });
  assert.deepEqual(db._planAuditEvents[1].new_state, { removed: true });
});

const planId = '00000000-0000-4000-8000-000000000978';
const admin = { callerContext: { actor: { id: 'admin', type: 'superadmin' } }, correlationId: 'corr-978' };

// SQL boundary model: accepts both the former unhashed INSERT and the shared
// append's INSERT. Transaction nesting is rejected just as an outer caller would
// require; audit failures roll back the pending audit rows.
function sqlDb({ subQuotas = false } = {}) {
  const audit = [];
  const plan = { id: planId, slug: 'audit-plan', display_name: 'Audit Plan', status: 'draft', created_by: 'admin', updated_by: 'admin', quota_dimensions: { max_workspaces: 5 }, capabilities: {} };
  let transaction = false;
  let checkpoint = 0;
  let history;
  let subQuota;
  return { audit, plan,
    // pg.Client and checked-out PoolClient both expose connect(). Reconnecting
    // them fails; release() belongs to the caller that checked out the client.
    async connect() { throw new Error('Client has already been connected'); },
    release() { throw new Error('Action must not release the caller connection'); },
    async query(sql, params = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (text === 'BEGIN') { assert.equal(transaction, false, 'audit must not begin a nested transaction'); transaction = true; checkpoint = audit.length; return { rows: [] }; }
    if (text === 'COMMIT' || text === 'ROLLBACK') { assert.equal(transaction, true); if (text === 'ROLLBACK') audit.splice(checkpoint); transaction = false; return { rows: [] }; }
    if (text.startsWith('SET LOCAL') || text.includes('pg_advisory_xact_lock')) { assert.equal(transaction, true); return { rows: [] }; }
    if (text.startsWith('SELECT row_hash')) {
      assert.ok(text.includes('row_hash IS NOT NULL'));
      const head = audit.filter((row) => row.tenant_id === params[0] && row.row_hash != null).at(-1);
      return { rows: head ? [head] : [] };
    }
    if (text.startsWith('INSERT INTO plan_audit_events')) {
      // Interpret column/value bindings at the database boundary, not positional
      // knowledge of one implementation. Literals support the old NULL plan_id.
      const columns = text.match(/plan_audit_events \(([^)]+)\)/)[1].split(',').map((column) => column.trim());
      const values = text.match(/VALUES \(([^)]+)\)/)[1].split(',').map((value) => value.trim());
      const row = Object.fromEntries(columns.map((column, index) => {
        const binding = values[index].match(/^\$(\d+)/);
        let value = binding ? params[Number(binding[1]) - 1] : null;
        if (['previous_state', 'new_state'].includes(column) && value != null) value = JSON.parse(value);
        return [column, value];
      }));
      audit.push(row); return { rows: [row] };
    }
    if (text.startsWith('INSERT INTO plans')) return { rows: [{ ...plan }] };
    if (text.includes('DELETE FROM plans')) return { rows: [{ ...plan }] };
    if (text.startsWith('UPDATE plans')) {
      if (text.includes('SET status')) plan.status = params[1];
      else if (text.includes('SET display_name')) { plan.display_name = params[1]; plan.description = params[2]; }
      else if (text.includes('SET capabilities')) plan.capabilities = JSON.parse(params[1]);
      else if (text.includes('jsonb_build_object')) plan.quota_dimensions[params[1]] = params[2];
      else if (text.includes('- $2::text')) delete plan.quota_dimensions[params[1]];
      return { rows: [{ ...plan }] };
    }
    if (text.includes('FROM plans')) return { rows: [{ ...plan }] };
    if (text.includes('FROM tenants')) return { rows: [{ present: 1 }] };
    if (text.includes('FROM quota_dimension_catalog')) return { rows: subQuotas ? [{ id: 1, dimension_key: 'max_workspaces', display_label: 'Workspaces', unit: 'count', default_value: 10, effective_value: 10, source: 'catalog_default', quota_type: 'hard', grace_margin: 0 }] : [] };
    if (text.includes('FROM workspace_sub_quotas')) {
      if (text.startsWith('DELETE')) { const row = subQuota; subQuota = null; return { rows: row ? [row] : [] }; }
      if (text.includes('SUM(allocated_value)')) return { rows: [{ total: 0 }] };
      return { rows: subQuota ? [subQuota] : [] };
    }
    if (text.startsWith('INSERT INTO workspace_sub_quotas')) {
      subQuota = { id: 'sub-978', tenant_id: params[0], workspace_id: params[1], dimension_key: params[2], allocated_value: params[3], created_by: params[4], updated_by: params[4] };
      return { rows: [subQuota] };
    }
    if (text.includes('FROM boolean_capability_catalog')) return { rows: [{ capability_key: 'realtime', display_label: 'Realtime', description: 'Realtime subscriptions', is_active: true, platform_default: false }] };
    if (text.startsWith('INSERT INTO tenant_plan_assignments')) return { rows: [{ id: '00000000-0000-4000-8000-000000000979', tenant_id: params[0], plan_id: params[1], assigned_by: params[2], effective_from: '2026-10-09T00:00:00.000Z', assignment_metadata: {} }] };
    if (text.startsWith('INSERT INTO tenant_plan_change_history')) {
      history = { id: '00000000-0000-4000-8000-000000000980', plan_assignment_id: params[0], tenant_id: params[1], previous_plan_id: params[2], new_plan_id: params[3], actor_id: params[4], effective_at: params[5], correlation_id: params[6], change_direction: params[8], usage_collection_status: params[9], over_limit_dimension_count: params[10] };
      return { rows: [history] };
    }
    if (text.startsWith('INSERT INTO tenant_plan_capability_impacts')) return { rows: [{ capability_key: params[2], previous_state: params[4], new_state: params[5], comparison: params[6] }] };
    if (text.includes('FROM tenant_plan_change_history')) return { rows: history ? [history] : [] };
    if (/FROM (tenant_plan_assignments|tenant_plan_adjustments|tenant_plan_quota_impacts|tenant_plan_capability_impacts)/.test(text)) return { rows: [] };
    throw new Error(`Unhandled SQL: ${text}`);
  } };
}

async function runPlanAction(name, params, db) {
  const { main } = await import(`../../packages/provisioning-orchestrator/src/actions/${name}.mjs`);
  return main({ ...admin, ...params }, { db, logger: { info() {} } });
}

function assertHashed(db, actions, expectedPlanId = planId, tenantId = null) {
  assert.deepEqual(db.audit.map((row) => row.action_type), actions);
  assert.deepEqual(verifyAuditChain(db.audit), { valid: true, brokenAt: null });
  for (const row of db.audit) {
    assert.equal(row.plan_id, expectedPlanId);
    assert.equal(row.actor_id, 'admin');
    assert.equal(row.tenant_id, tenantId);
    assert.equal(row.correlation_id, 'corr-978');
  }
}

test('978 plan-create: platform plan creation is hashed with its plan reference', async () => {
  const db = sqlDb();
  await runPlanAction('plan-create', { slug: 'audit-plan', displayName: 'Audit Plan' }, db);
  assertHashed(db, ['plan.created']);
});

test('978 plan-update: updates preserve previous and new state in a hashed row', async () => {
  const db = sqlDb();
  await runPlanAction('plan-update', { planId, description: 'Updated' }, db);
  assertHashed(db, ['plan.updated']);
  assert.equal(db.audit[0].previous_state.displayName, 'Audit Plan');
  assert.equal(db.audit[0].new_state.description, 'Updated');
});

test('978 plan-lifecycle: lifecycle rows extend the platform chain', async () => {
  const db = sqlDb();
  await runPlanAction('plan-create', { slug: 'audit-plan', displayName: 'Audit Plan' }, db);
  await runPlanAction('plan-lifecycle', { planId, targetStatus: 'active' }, db);
  assertHashed(db, ['plan.created', 'plan.lifecycle_transitioned']);
  assert.deepEqual(db.audit[1].previous_state, { status: 'draft' });
  assert.deepEqual(db.audit[1].new_state, { status: 'active' });
});

test('978 plan-delete: deletion is hashed with its intentionally detached plan reference', async () => {
  const db = sqlDb();
  await runPlanAction('plan-delete', { planId }, db);
  assertHashed(db, ['plan.deleted'], null);
  assert.equal(db.audit[0].previous_state.id, planId);
  assert.equal(db.audit[0].new_state.deleted, true);
});

test('978 plan-assign: assignment and impact rows link in the tenant chain', async () => {
  const db = sqlDb(); db.plan.status = 'active';
  await runPlanAction('plan-assign', { planId, tenantId: 'tenant-a', assignedBy: 'admin' }, db);
  assertHashed(db, ['assignment.created', 'plan.change_impact_recorded'], planId, 'tenant-a');
  assert.equal(db.audit[0].new_state.planId, planId);
  assert.equal(db.audit[1].new_state.historyEntryId, '00000000-0000-4000-8000-000000000980');
});

test('978 plan-limits: limit changes append without committing the caller transaction', async () => {
  const db = sqlDb();
  const { setLimit, removeLimit } = await import('../../packages/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs');
  await setLimit(db, { planId, dimensionKey: 'max_workspaces', value: 12, actorId: 'admin', correlationId: 'corr-978' });
  await removeLimit(db, { planId, dimensionKey: 'max_workspaces', actorId: 'admin', correlationId: 'corr-978' });
  assertHashed(db, ['plan.limit.set', 'plan.limit.removed']);
  assert.equal(db.audit[0].previous_state.previousValue, 5);
  assert.equal(db.audit[0].new_state.newValue, 12);
});

test('978 plan-capabilities: capability changes append within their transaction', async () => {
  const db = sqlDb();
  const { setCapabilities } = await import('../../packages/provisioning-orchestrator/src/repositories/plan-capability-repository.mjs');
  await setCapabilities(db, { planId, capabilitiesToSet: { realtime: true }, actorId: 'admin', correlationId: 'corr-978' });
  await setCapabilities(db, { planId, capabilitiesToSet: { realtime: false }, actorId: 'admin', correlationId: 'corr-978' });
  assertHashed(db, ['plan.capability.enabled', 'plan.capability.disabled']);
  assert.deepEqual(db.audit[1].previous_state, { capabilityKey: 'realtime', previousState: true });
  assert.deepEqual(db.audit[1].new_state, { capabilityKey: 'realtime', newState: false });
});

test('978 quota-overrides: override lifecycle uses hashed in-memory equivalents', async () => {
  const db = memoryDb();
  const { createOverride, modifyOverride, revokeOverride } = await import('../../packages/provisioning-orchestrator/src/repositories/quota-override-repository.mjs');
  const { override } = await createOverride(db, { tenantId: 'tenant-a', dimensionKey: 'max_pg_databases', overrideValue: 12, quotaType: 'hard', justification: 'Pilot', createdBy: 'admin' });
  await modifyOverride(db, { overrideId: override.overrideId, actorId: 'admin', justification: 'Adjust', changes: { overrideValue: 14 } });
  await revokeOverride(db, { overrideId: override.overrideId, actorId: 'admin', justification: 'Done' });
  assert.deepEqual(db._planAuditEvents.map((row) => row.action_type), ['quota.override.created', 'quota.override.modified', 'quota.override.revoked']);
  assert.deepEqual(verifyAuditChain(db._planAuditEvents), { valid: true, brokenAt: null });
  assert.ok(db._planAuditEvents.every((row) => row.plan_id === null && row.tenant_id === 'tenant-a' && row.actor_id === 'admin'));
});

test('978 image layout: the control-plane ships the shared writer at its repository import path', async () => {
  const { readFile } = await import('node:fs/promises');
  const dockerfile = await readFile(new URL('../../apps/control-plane/Dockerfile', import.meta.url), 'utf8');
  for (const name of ['audit-store', 'audit-hash']) {
    assert.ok(dockerfile.includes(`COPY apps/control-plane/${name}.mjs`) && dockerfile.includes(`/repo/apps/control-plane/${name}.mjs`), `${name} must resolve for /repo/packages/provisioning-orchestrator`);
  }
  const executor = await readFile(new URL('../../apps/control-plane-executor/Dockerfile', import.meta.url), 'utf8');
  for (const name of ['audit-store', 'audit-hash']) assert.ok(executor.includes(`/app/apps/control-plane/${name}.mjs`));
});


test('978 sub-quota SQL path: owner set and remove persist hashes and keep one genesis', async () => {
  const db = sqlDb({ subQuotas: true });
  const request = { ...owner, dimensionKey: 'max_workspaces', allocatedValue: 4 };
  await recordAuditEvent(db, { actionType: 'workspace.create', actorId: 'owner', tenantId: 'tenant-a' });
  await setSubQuota(request, { db });
  await removeSubQuota(request, { db });
  await recordAuditEvent(db, { actionType: 'workspace.create', actorId: 'owner', tenantId: 'tenant-a' });
  assert.deepEqual(db.audit.map((row) => row.action_type), ['workspace.create', 'quota.sub_quota.set', 'quota.sub_quota.removed', 'workspace.create']);
  assert.deepEqual(verifyAuditChain(db.audit), { valid: true, brokenAt: null });
  assert.equal(db.audit.filter((row) => row.prev_hash === '').length, 1);
  assert.ok(db.audit.every((row) => row.actor_id === 'owner' && row.tenant_id === 'tenant-a' && row.plan_id === null));
  assert.equal(db.audit[1].correlation_id, 'corr-978');
  assert.equal(db.audit[2].correlation_id, 'corr-978');
});
