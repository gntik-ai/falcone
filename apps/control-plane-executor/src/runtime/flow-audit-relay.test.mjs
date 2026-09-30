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

function fakePool(size = 1) {
  const rows = Array.from({ length: size }, (_, i) => ({ event_id: `event-${i + 1}`,
    event_payload: { eventId: `event-${i + 1}` }, attempts: 0, delivered: false, failed: false, due: true }));
  const locked = new Set();
  const queries = [];
  return {
    rows,
    queries,
    advance() { for (const row of rows) row.due = true; },
    async connect() {
      const held = new Set();
      const unlock = () => { for (const id of held) locked.delete(id); held.clear(); };
      return {
        async query(sql, args = []) {
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'COMMIT' || sql === 'ROLLBACK') { unlock(); return { rows: [] }; }
          if (sql.includes('FOR UPDATE SKIP LOCKED')) {
            const row = rows.find((candidate) => !locked.has(candidate.event_id)
              && !candidate.delivered && !candidate.failed && candidate.due);
            if (!row) return { rows: [] };
            locked.add(row.event_id);
            held.add(row.event_id);
            return { rows: [row] };
          }
          const row = rows.find((candidate) => candidate.event_id === args[0]);
          if (sql.includes('SET delivered_at')) row.delivered = true;
          if (sql.includes('SET attempts')) {
            row.attempts = args[1];
            row.failed = args[1] >= args[2];
            row.due = false;
          }
          return { rows: [] };
        },
        release() { unlock(); },
      };
    },
    async query(sql) {
      queries.push(sql);
      if (sql.includes('count(*)')) return { rows: [{ count: rows.filter((row) => sql.includes('failed_at IS NOT NULL')
        ? row.failed : !row.delivered && !row.failed).length }] };
      return { rows: [] };
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
  pool.advance();
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
  pool.advance();
  await relay.tick();
  assert.equal(pool.rows[0].failed, true);
  assert.equal(backlog.failed, 1);
  assert.equal(pool.rows.length, 1);
});

test('default retry budget survives the former twelve-attempt cutoff', async () => {
  const pool = fakePool();
  const relay = createFlowAuditRelay({ pool, publish: async () => { throw new Error('Kafka down'); } });
  for (let i = 0; i < 13; i += 1) {
    pool.advance();
    await relay.tick();
  }
  assert.equal(pool.rows[0].attempts, 13);
  assert.equal(pool.rows[0].failed, false);
});

test('one tick drains a bounded batch and keeps remaining rows pending', async () => {
  const pool = fakePool(5);
  const seen = [];
  const relay = createFlowAuditRelay({ pool, publish: async (event) => { seen.push(event.eventId); }, batchSize: 3 });
  await relay.tick();
  assert.deepEqual(seen, ['event-1', 'event-2', 'event-3']);
  assert.equal(pool.rows.filter((row) => !row.delivered).length, 2);
  await relay.tick();
  assert.equal(pool.rows.filter((row) => !row.delivered).length, 0);
  assert.ok(pool.queries.some((sql) => sql.includes('DELETE FROM flow_audit_outbox')
    && sql.includes('WHERE delivered_at <')));
  assert.equal(pool.queries.filter((sql) => sql.includes('count(*)')).length, 4);
  assert.ok(pool.queries.every((sql) => !sql.includes('count(*) FILTER')));
});
