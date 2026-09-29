import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createFlowAuditRelay } from '../../apps/control-plane-executor/src/runtime/flow-audit-relay.mjs';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
let Pool;
try { ({ Pool } = await import('pg')); } catch { /* CI installs workspace dependencies */ }
if (process.env.FLOW_AUDIT_PG_REQUIRED === '1' && (!connectionString || !Pool)) {
  throw new Error('Flow audit PostgreSQL integration test requires TEST_DATABASE_URL and pg');
}

test('two PostgreSQL relay replicas never claim the same pending event concurrently',
  { skip: !connectionString || !Pool }, async () => {
    const schema = `flow_audit_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString, max: 2 });
    let pool;
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
      const { createFlowStore } = await import('../../apps/control-plane-executor/src/runtime/flow-executor.mjs');
      const store = createFlowStore({ pool });
      await store.ensureSchema();
      await store.ensureSchema(); // The real DDL and indexes must be idempotent.
      const indexes = await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1
        AND tablename = 'flow_audit_outbox'`, [schema]);
      assert.ok(indexes.rows.some((row) => row.indexname === 'flow_audit_outbox_pending_idx'));
      const scope = { tenantId: 'tenant-test', workspaceId: 'workspace-test', flowId: randomUUID() };
      const invalidAudit = { eventId: 'invalid-uuid', eventType: 'flow.definition_created',
        tenantId: scope.tenantId, workspaceId: scope.workspaceId };
      const definition = { apiVersion: 'v1.0', name: 'original', nodes: [] };
      const create = (auditEvent) => store.createDefinition({ ...scope, name: 'original', definition,
        createdBy: 'actor-test', auditEvent });
      await assert.rejects(create(invalidAudit), (err) => err.code === 'AUDIT_UNAVAILABLE');
      assert.equal(await store.getDefinition(scope), null, 'create rolls back with the outbox insert');
      await create();

      await assert.rejects(store.updateDefinition({ ...scope, changes: { name: 'changed' },
        auditEvent: invalidAudit }), (err) => err.code === 'AUDIT_UNAVAILABLE');
      assert.equal((await store.getDefinition(scope)).name, 'original', 'update rolls back');
      await assert.rejects(store.insertVersion({ ...scope, definition, createdBy: 'actor-test',
        auditEvent: () => invalidAudit }), (err) => err.code === 'AUDIT_UNAVAILABLE');
      assert.deepEqual(await store.listVersions(scope), [], 'publish rolls back');
      await assert.rejects(store.deleteDefinition({ ...scope, auditEvent: invalidAudit }),
        (err) => err.code === 'AUDIT_UNAVAILABLE');
      assert.ok(await store.getDefinition(scope), 'delete rolls back');

      const eventIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const eventId of eventIds) {
        await store.enqueueAudit({ eventId, eventType: 'flow.definition_created',
          tenantId: 'tenant-test', workspaceId: 'workspace-test' });
      }
      const published = [];
      const publish = async (event) => { await delay(25); published.push(event.eventId); };
      const first = createFlowAuditRelay({ pool, publish });
      const second = createFlowAuditRelay({ pool, publish });
      await Promise.all([first.runOnce(), second.runOnce()]);
      assert.equal(published.length, eventIds.length);
      assert.deepEqual([...new Set(published)].sort(), [...eventIds].sort());
      const result = await pool.query('SELECT event_id, state, attempts FROM flow_audit_outbox');
      assert.ok(result.rows.every((row) => row.state === 'delivered' && row.attempts === 1));

      const failedEventId = randomUUID();
      await store.enqueueAudit({ eventId: failedEventId, eventType: 'flow.definition_created',
        tenantId: 'tenant-test', workspaceId: 'workspace-test' });
      const failingRelay = createFlowAuditRelay({ pool, publish: async () => {
        throw Object.assign(new Error('broker unavailable'), { code: 'KAFKA_ERROR' });
      }, logger: { error() {} } });
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await failingRelay.runOnce();
        await pool.query(`UPDATE flow_audit_outbox SET next_attempt_at = now()
          WHERE event_id = $1 AND state = 'pending'`, [failedEventId]);
      }
      const failed = await pool.query('SELECT state, attempts FROM flow_audit_outbox WHERE event_id = $1', [failedEventId]);
      assert.deepEqual(failed.rows[0], { state: 'dead_letter', attempts: 12 });

      await pool.query(`UPDATE flow_audit_outbox SET state = 'pending', attempts = 0, next_attempt_at = now()
        WHERE state = 'dead_letter' AND event_id = $1`, [failedEventId]);
      const redriven = [];
      const recoveredRelay = createFlowAuditRelay({ pool, publish: async (event) => redriven.push(event.eventId) });
      await recoveredRelay.runOnce();
      await recoveredRelay.runOnce();
      assert.deepEqual(redriven, [failedEventId]);
      const delivered = await pool.query('SELECT state, attempts FROM flow_audit_outbox WHERE event_id = $1', [failedEventId]);
      assert.deepEqual(delivered.rows[0], { state: 'delivered', attempts: 1 });
    } finally {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
