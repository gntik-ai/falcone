import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowAuditEvent, FLOW_AUDIT_EVENT_TYPES } from '../../../../packages/audit/src/flow-lifecycle-events.mjs';
import { createFlowAuditRelay, withFlowAuditTransaction } from './flow-audit-relay.mjs';

test('mutation and outbox insert commit together; an insert error rolls both back', async () => {
  const rows = [];
  let failInsert = false;
  const pool = { async connect() {
    let staged = [];
    return { async query(sql) {
      if (sql === 'BEGIN') staged = [];
      if (sql === 'COMMIT') rows.push(...staged);
      if (sql === 'ROLLBACK') staged = [];
      if (sql.startsWith('INSERT INTO flow_definitions')) staged.push('flow');
      if (sql.startsWith('INSERT INTO flow_audit_outbox')) {
        if (failInsert) throw new Error('insert unavailable');
        staged.push('audit');
      }
      return { rows: [] };
    }, release() {} };
  } };
  const mutate = (store) => store.create();
  const store = (client) => ({ async create() {
    await client.query('INSERT INTO flow_definitions');
    return { flowId: 'f' };
  } });
  const event = () => ({ eventId: 'e', flowId: 'f' });
  await withFlowAuditTransaction(pool, mutate, event, store);
  assert.deepEqual(rows, ['flow', 'audit']);
  failInsert = true;
  await assert.rejects(withFlowAuditTransaction(pool, mutate, event, store),
    (err) => err.statusCode === 503 && err.code === 'AUDIT_UNAVAILABLE');
  assert.deepEqual(rows, ['flow', 'audit']);
});

function fakePool() {
  const rows = [{ event_id: 'event-1', event_payload: { eventId: 'event-1' }, attempts: 0, delivered: false, failed: false }];
  let locked = false;
  return {
    rows,
    async connect() {
      return {
        async query(sql, args = []) {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
          if (sql.includes('FOR UPDATE SKIP LOCKED')) {
            if (locked || rows[0].delivered || rows[0].failed) return { rows: [] };
            locked = true;
            return { rows: [rows[0]] };
          }
          if (sql.includes('SET delivered_at')) rows[0].delivered = true;
          if (sql.includes('SET attempts')) {
            rows[0].attempts = args[1];
            rows[0].failed = args[1] >= args[2];
          }
          return { rows: [] };
        },
        release() { locked = false; },
      };
    },
    async query() {
      return { rows: [{ pending: Number(!rows[0].delivered && !rows[0].failed), failed: Number(rows[0].failed) }] };
    },
  };
}

test('definition audit envelope echoes request correlation and outcome', () => {
  const event = buildFlowAuditEvent({ eventType: FLOW_AUDIT_EVENT_TYPES.VERSION_PUBLISHED,
    tenantId: 't', workspaceId: 'w', actorId: 'a', flowId: 'f', flowVersion: 3,
    correlationId: 'request-123', outcome: 'succeeded', eventId: 'event-1' });
  assert.equal(event.correlationId, 'request-123');
  assert.equal(event.outcome, 'succeeded');
  assert.equal(event.flowVersion, '3');
  assert.equal(event.eventId, 'event-1');
  assert.throws(() => buildFlowAuditEvent({ ...event, eventType: 'flow.unknown' }));
  assert.throws(() => buildFlowAuditEvent({ ...event, workspaceId: null }));
});

test('relay retries a failed publish, keeps the event ID, and locks out a concurrent relay', async () => {
  const pool = fakePool();
  const seen = [];
  let release;
  const producer = async (event) => {
    seen.push(event.eventId);
    if (seen.length === 1) throw new Error('Kafka down');
    await new Promise((resolve) => { release = resolve; });
  };
  const relay = createFlowAuditRelay({ pool, publish: producer });
  await relay.tick();
  assert.equal(pool.rows[0].attempts, 1);
  const pending = relay.tick();
  await new Promise((resolve) => setImmediate(resolve));
  const other = createFlowAuditRelay({ pool, publish: producer });
  await other.tick();
  release();
  await pending;
  assert.deepEqual(seen, ['event-1', 'event-1']);
  assert.equal(pool.rows[0].delivered, true);
});

test('exhausted row remains persisted and is counted as failed', async () => {
  const pool = fakePool();
  let backlog;
  const relay = createFlowAuditRelay({ pool, publish: async () => { throw new Error('Kafka down'); }, maxAttempts: 2,
    onBacklog: (value) => { backlog = value; } });
  await relay.tick();
  await relay.tick();
  assert.equal(pool.rows[0].failed, true);
  assert.equal(backlog.failed, 1);
  assert.equal(pool.rows.length, 1);
});
