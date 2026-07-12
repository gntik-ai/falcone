import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
const { Client } = pg;
import fs from 'node:fs/promises';
import { main as createPlan } from '../../../packages/provisioning-orchestrator/src/actions/plan-create.mjs';
import { main as deletePlan } from '../../../packages/provisioning-orchestrator/src/actions/plan-delete.mjs';

const migration = await fs.readFile(new URL('../../../packages/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql', import.meta.url), 'utf8');
const superadmin = { callerContext: { actor: { id: 'superadmin-1', type: 'superadmin' } } };
const tenantOwner = { callerContext: { actor: { id: 'owner-1', type: 'tenant_owner', tenantId: 'tenant-delete' } } };
const producerMessages = [];
const producer = { send: async (payload) => producerMessages.push(payload) };

async function db() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(migration);
  await client.query('TRUNCATE tenant_plan_assignments, plan_audit_events, plans RESTART IDENTITY CASCADE');
  producerMessages.length = 0;
  return client;
}

test('safe plan delete removes a never-assigned plan and preserves audit snapshots', async () => {
  if (!process.env.DATABASE_URL) return test.skip('DATABASE_URL not set');
  const client = await db();
  try {
    const created = await createPlan({ ...superadmin, db: client, producer, slug: 'delete-draft', displayName: 'Delete draft' });

    const deleted = await deletePlan({ ...superadmin, db: client, producer, planId: created.body.id });

    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.body, { planId: created.body.id, deleted: true });
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM plans WHERE id = $1', [created.body.id])).rows[0].count, 0);
    const audit = await client.query('SELECT action_type, plan_id, previous_state, new_state FROM plan_audit_events ORDER BY action_type');
    assert.deepEqual(audit.rows.map((row) => row.action_type), ['plan.created', 'plan.deleted']);
    assert.deepEqual(audit.rows.map((row) => row.plan_id), [null, null]);
    assert.equal(audit.rows.find((row) => row.action_type === 'plan.deleted').previous_state.id, created.body.id);
    assert.equal(producerMessages.some((message) => message.topic === 'console.plan.deleted'), true);
  } finally {
    await client.end();
  }
});

test('safe plan delete is superadmin-only and refuses plans with assignment history', async () => {
  if (!process.env.DATABASE_URL) return test.skip('DATABASE_URL not set');
  const client = await db();
  try {
    const created = await createPlan({ ...superadmin, db: client, producer, slug: 'delete-assigned', displayName: 'Delete assigned' });

    await assert.rejects(
      () => deletePlan({ ...tenantOwner, db: client, producer, planId: created.body.id }),
      { code: 'FORBIDDEN', statusCode: 403 }
    );

    await client.query('UPDATE plans SET status = $2 WHERE id = $1', [created.body.id, 'active']);
    await assert.rejects(
      () => deletePlan({ ...superadmin, db: client, producer, planId: created.body.id }),
      { code: 'PLAN_ACTIVE', statusCode: 409 }
    );

    await client.query('UPDATE plans SET status = $2 WHERE id = $1', [created.body.id, 'deprecated']);
    await client.query(
      `INSERT INTO tenant_plan_assignments (tenant_id, plan_id, assigned_by, superseded_at)
       VALUES ($1,$2,$3,NOW())`,
      ['tenant-delete', created.body.id, 'superadmin-1']
    );

    await assert.rejects(
      () => deletePlan({ ...superadmin, db: client, producer, planId: created.body.id }),
      (error) => {
        assert.equal(error.code, 'PLAN_HAS_ASSIGNMENT_HISTORY');
        assert.equal(error.statusCode, 409);
        assert.deepEqual(error.activeTenantIds, []);
        assert.deepEqual(error.historicalTenantIds, ['tenant-delete']);
        return true;
      }
    );
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM plans WHERE id = $1', [created.body.id])).rows[0].count, 1);
  } finally {
    await client.end();
  }
});
