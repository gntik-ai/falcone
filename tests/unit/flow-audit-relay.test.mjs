import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowAuditRelay, createPlatformFlowAuditProducer } from '../../apps/control-plane-executor/src/runtime/flow-audit-relay.mjs';
import { renderMetrics } from '../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';

function fakePool(events) {
  const rows = events.map((event) => ({ event_id: event.eventId, payload: event, attempts: 0,
    state: 'pending', due: true }));
  const pool = {
    rows,
    async connect() {
      return {
        async query(sql, args = []) {
          if (sql.startsWith('SELECT event_id')) {
            const row = rows.find((item) => item.state === 'pending' && item.due);
            return { rows: row ? [row] : [] };
          }
          if (sql.startsWith('UPDATE flow_audit_outbox')) {
            const row = rows.find((item) => item.event_id === args[0]);
            if (sql.includes("state = 'delivered'")) {
              row.state = 'delivered';
              row.attempts += 1;
            } else {
              row.state = args[1];
              row.attempts = args[2];
              row.delayMs = args[3];
              row.due = false;
            }
          }
          return { rows: [] };
        },
        release() {},
      };
    },
    async query(sql) {
      if (sql.startsWith('SELECT')) return { rows: [{ pending: rows.filter((r) => r.state === 'pending').length,
        dead_letter: rows.filter((r) => r.state === 'dead_letter').length, oldest_seconds: 0 }] };
      return { rows: [] };
    },
  };
  return pool;
}

test('Kafka outage keeps event pending; recovery drains backlog once per eventId', async () => {
  const events = Array.from({ length: 3 }, (_, i) => ({ eventId: `event-${i}` }));
  const pool = fakePool(events);
  const published = [];
  let unavailable = true;
  const logs = [];
  const relay = createFlowAuditRelay({ pool, publish: async (event) => {
    if (unavailable) throw Object.assign(new Error('private broker detail'), { cause: { code: 'KAFKA_ERROR' } });
    published.push(event.eventId);
  }, logger: { error: (...args) => logs.push(args) } });

  await relay.runOnce();
  assert.equal(pool.rows.filter((r) => r.state === 'pending').length, 3);
  assert.deepEqual(pool.rows.map((r) => r.attempts), [1, 0, 0]);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0][1], { eventId: 'event-0', attempts: 1, errorClass: 'KAFKA_ERROR' });
  assert.equal(JSON.stringify(logs).includes('private broker detail'), false);
  assert.match(renderMetrics(), /# HELP falcone_flow_audit_outbox_failures_total /);
  assert.match(renderMetrics(), /# TYPE falcone_flow_audit_outbox_failures_total counter/);

  unavailable = false;
  for (const row of pool.rows) row.due = true;
  await relay.runOnce();
  assert.deepEqual(published, events.map((event) => event.eventId));
  assert.ok(pool.rows.every((row) => row.state === 'delivered'));
  await relay.runOnce();
  assert.equal(published.length, 3);
});

test('retry delay grows to its cap and the twelfth failure retains a dead letter', async () => {
  const pool = fakePool([{ eventId: 'event-dead' }]);
  const relay = createFlowAuditRelay({ pool, publish: async () => { throw Object.assign(new Error('secret'), { code: 'KAFKA_ERROR' }); },
    logger: { error() {} } });
  const delays = [];
  for (let i = 0; i < 12; i += 1) {
    pool.rows[0].due = true;
    await relay.runOnce();
    delays.push(pool.rows[0].delayMs);
  }
  assert.deepEqual(delays.slice(0, 4), [1000, 2000, 4000, 8000]);
  assert.equal(delays.at(-1), 30 * 60 * 1000);
  assert.equal(pool.rows[0].attempts, 12);
  assert.equal(pool.rows[0].state, 'dead_letter');
  await relay.runOnce();
  assert.equal(pool.rows.length, 1);
  assert.equal(pool.rows[0].attempts, 12);
});

test('relay refreshes depth with no producer and drains more than one row per run', async () => {
  const pool = fakePool(Array.from({ length: 5 }, (_, i) => ({ eventId: `event-${i}` })));
  const offline = createFlowAuditRelay({ pool });
  assert.equal(await offline.runOnce(), false);
  assert.ok(pool.rows.every((row) => row.attempts === 0));
  assert.match(renderMetrics(), /falcone_flow_audit_outbox_pending 5\n/);
  const sent = [];
  const online = createFlowAuditRelay({ pool, publish: async (event) => sent.push(event.eventId) });
  assert.equal(await online.runOnce(), true);
  assert.equal(sent.length, 5);
});

test('platform producer refuses a tenant namespace topic', () => {
  assert.throws(() => createPlatformFlowAuditProducer({ brokers: 'unused:9092',
    topic: 'evt.workspace-a.falcone.audit.flow-lifecycle' }), /platform-owned/);
});
