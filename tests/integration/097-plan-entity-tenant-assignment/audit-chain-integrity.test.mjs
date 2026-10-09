import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ensureSchema, insertTenant, insertWorkspace } from '../../../apps/control-plane/tenant-store.mjs';
import { recordAuditEvent } from '../../../apps/control-plane/audit-store.mjs';
import { verifyAuditChain } from '../../../apps/control-plane/audit-hash.mjs';
import { main as createPlan } from '../../../packages/provisioning-orchestrator/src/actions/plan-create.mjs';
import { main as lifecyclePlan } from '../../../packages/provisioning-orchestrator/src/actions/plan-lifecycle.mjs';
import { main as assignPlan } from '../../../packages/provisioning-orchestrator/src/actions/plan-assign.mjs';
import { main as deletePlan } from '../../../packages/provisioning-orchestrator/src/actions/plan-delete.mjs';
import { main as setSubQuota } from '../../../packages/provisioning-orchestrator/src/actions/workspace-sub-quota-set.mjs';
import { main as removeSubQuota } from '../../../packages/provisioning-orchestrator/src/actions/workspace-sub-quota-remove.mjs';

const admin = { callerContext: { actor: { id: 'admin-978', type: 'superadmin' } } };

// Independent schema avoids truncating any shared test data. PostgreSQL is the
// public seam for guard enforcement, legacy-safe startup, and durable chain order.
test('978 PostgreSQL: legacy-safe guard and tenant/global orchestrator chains', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL not set; PostgreSQL required');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const schema = `audit_chain_978_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const migration = (name) => readFile(new URL(`../../../packages/provisioning-orchestrator/src/migrations/${name}.sql`, import.meta.url), 'utf8');
    await client.query(await migration('097-plan-entity-tenant-assignment'));
    const legacyPlanId = randomUUID();
    await client.query("INSERT INTO plans (id, slug, display_name, status, created_by, updated_by) VALUES ($1, 'legacy-draft-978', 'Legacy draft', 'draft', 'admin-978', 'admin-978')", [legacyPlanId]);
    await client.query("INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, new_state) VALUES ('legacy', 'admin-978', 'legacy-scope', '{}')");
    await client.query("INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, new_state) VALUES ('plan.created', 'admin-978', 'legacy-scope', $1, '{}')", [legacyPlanId]);
    const legacyBefore = (await client.query('SELECT * FROM plan_audit_events WHERE plan_id = $1', [legacyPlanId])).rows[0];
    // Upgrade from the previous attempt too: NOT VALID checks allow existing
    // NULLs at startup but still reject their plan-reference detach on UPDATE.
    await client.query('ALTER TABLE plan_audit_events ADD COLUMN prev_hash TEXT, ADD COLUMN row_hash TEXT');
    await client.query('ALTER TABLE plan_audit_events ADD CONSTRAINT plan_audit_events_hashes_required CHECK (prev_hash IS NOT NULL AND row_hash IS NOT NULL) NOT VALID');
    await assert.rejects(deletePlan({ ...admin, planId: legacyPlanId }, { db: client }), (error) => error.code === '23514' && error.constraint === 'plan_audit_events_hashes_required', 'the previous guard blocks legacy plan deletion');
    await ensureSchema(client);
    await ensureSchema(client); // Idempotent guard, without validating legacy NULLs.
    const legacy = await client.query("SELECT * FROM plan_audit_events WHERE action_type = 'legacy'");
    assert.equal(legacy.rows[0].row_hash, null);
    assert.equal(legacy.rows[0].prev_hash, null);
    await assert.rejects(client.query("INSERT INTO plan_audit_events (action_type, actor_id, new_state) VALUES ('raw', 'admin-978', '{}')"), (error) => error.code === '23514' && error.constraint === 'plan_audit_events_hashes_required');
    const deleted = await deletePlan({ ...admin, planId: legacyPlanId }, { db: client });
    assert.equal(deleted.statusCode, 200, 'an unassigned legacy draft remains deletable');
    assert.deepEqual(deleted.body, { planId: legacyPlanId, deleted: true });
    assert.equal((await client.query('SELECT * FROM plans WHERE id = $1', [legacyPlanId])).rowCount, 0);
    const legacyAfter = (await client.query('SELECT * FROM plan_audit_events WHERE id = $1', [legacyBefore.id])).rows[0];
    assert.deepEqual(legacyAfter, { ...legacyBefore, plan_id: null, prev_hash: null, row_hash: null, outcome: null }, 'only the unhashed plan reference is detached');
    await assert.rejects(client.query('UPDATE plan_audit_events SET row_hash = NULL WHERE action_type = $1', ['plan.deleted']), (error) => error.code === '23514' && error.constraint === 'plan_audit_events_hashes_required');
    await assert.rejects(client.query("INSERT INTO plan_audit_events (action_type, actor_id, new_state, prev_hash) VALUES ('partial', 'admin-978', '{}', '')"), (error) => error.code === '23514');
    await client.query(await migration('100-plan-change-impact-history'));
    await client.query(await migration('105-effective-limit-resolution'));
    await client.query("INSERT INTO quota_dimension_catalog (dimension_key, display_label, unit, default_value) VALUES ('max_workspaces', 'Workspaces', 'count', 10)");
    const tenant = await insertTenant(client, { id: 'tenant-978', slug: 'audit-978', displayName: 'Audit 978', createdBy: 'admin-978' });
    const tenantId = tenant.id;
    const owner = { callerContext: { actor: { id: 'owner-978', type: 'tenant_owner', tenantId } }, tenantId };
    await recordAuditEvent(client, { actionType: 'tenant.create', actorId: 'admin-978', tenantId });
    const workspace = await insertWorkspace(client, { id: randomUUID(), tenantId, slug: 'one', displayName: 'One', createdBy: 'owner-978' });
    await recordAuditEvent(client, { actionType: 'workspace.create', actorId: 'owner-978', tenantId, workspaceId: workspace.id });
    await setSubQuota({ ...owner, workspaceId: workspace.id, dimensionKey: 'max_workspaces', allocatedValue: 4 }, { db: client });
    const second = await insertWorkspace(client, { id: randomUUID(), tenantId, slug: 'two', displayName: 'Two', createdBy: 'owner-978' });
    await recordAuditEvent(client, { actionType: 'workspace.create', actorId: 'owner-978', tenantId, workspaceId: second.id });
    const chain = async (scope) => (await client.query('SELECT * FROM plan_audit_events WHERE tenant_id IS NOT DISTINCT FROM $1 ORDER BY created_at, id', [scope])).rows;
    const repro = await chain(tenantId);
    assert.equal(repro.length, 4);
    assert.deepEqual(verifyAuditChain(repro), { valid: true, brokenAt: null });
    await removeSubQuota({ ...owner, workspaceId: workspace.id, dimensionKey: 'max_workspaces' }, { db: client });
    await recordAuditEvent(client, { actionType: 'workspace.create', actorId: 'owner-978', tenantId, workspaceId: 'three' });
    const plan = await createPlan({ ...admin, slug: 'hashed-978', displayName: 'Hashed 978' }, { db: client });
    await lifecyclePlan({ ...admin, planId: plan.body.id, targetStatus: 'active' }, { db: client });
    await assignPlan({ ...admin, tenantId, planId: plan.body.id, assignedBy: 'admin-978' }, { db: client, logger: { info() {} } });
    const tenantRows = await chain(tenantId);
    assert.deepEqual(verifyAuditChain(tenantRows), { valid: true, brokenAt: null });
    assert.equal(tenantRows.filter((row) => row.prev_hash === '').length, 1);
    assert.ok(tenantRows.filter((row) => row.action_type === 'assignment.created' || row.action_type === 'plan.change_impact_recorded').every((row) => row.plan_id === plan.body.id));
    const global = await chain(null);
    assert.deepEqual(verifyAuditChain(global), { valid: true, brokenAt: null });
    assert.deepEqual(verifyAuditChain(await chain('legacy-scope')), { valid: false, brokenAt: 0 }, 'legacy rows remain visible as invalid');
    const concurrent = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` });
    try {
      await Promise.all(Array.from({ length: 8 }, (_, index) => recordAuditEvent(concurrent, { tenantId, actorId: 'admin-978', actionType: 'workspace.create', newState: { index } })));
      assert.deepEqual(verifyAuditChain(await chain(tenantId)), { valid: true, brokenAt: null });
    } finally { await concurrent.end(); }
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
