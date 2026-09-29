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
      await pool.query(`CREATE TABLE flow_audit_outbox (
        event_id uuid PRIMARY KEY, payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0,
        state text NOT NULL DEFAULT 'pending', next_attempt_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz)`);
      const eventIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const eventId of eventIds) {
        await pool.query('INSERT INTO flow_audit_outbox (event_id, payload) VALUES ($1, $2)',
          [eventId, { eventId }]);
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
      await pool.query('INSERT INTO flow_audit_outbox (event_id, payload) VALUES ($1, $2)',
        [failedEventId, { eventId: failedEventId }]);
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
    } finally {
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
