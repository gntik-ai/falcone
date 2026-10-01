import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import { Kafka, logLevel } from 'kafkajs';
import { createFlowExecutor, createFlowStore } from '../../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowAuditRelay } from '../../../apps/control-plane-executor/src/runtime/flow-audit-relay.mjs';
import { FLOW_AUDIT_EVENT_TYPES } from '../../../packages/audit/src/flow-lifecycle-events.mjs';

const TOPIC = 'falcone.audit.flow-lifecycle';
const COMPOSE_FILE = resolve(fileURLToPath(new URL('../docker-compose.yml', import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compose = (command) => execFileSync('docker', ['compose', '-f', COMPOSE_FILE, command, 'redpanda'], { stdio: 'inherit' });

test('definition writes persist and publish audit events across a broker outage', { timeout: 90000 }, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DB_URL, max: 3 });
  const kafka = new Kafka({ clientId: `flow-audit-test-${randomUUID()}`, brokers: (process.env.KAFKA_BROKERS ?? 'localhost:19092').split(','),
    logLevel: logLevel.NOTHING, connectionTimeout: 1000, requestTimeout: 1500, retry: { retries: 0 } });
  const admin = kafka.admin();
  const flowId = `audit-${randomUUID()}`;
  const identity = { tenantId: 'audit-test-tenant', workspaceId: 'audit-test-workspace', actorId: 'audit-test-actor', roles: ['tenant_owner'] };
  const definition = { apiVersion: 'v1.0', name: 'audit-test-flow', nodes: [{ id: 'task', type: 'task', taskType: 'fetch-record' }] };
  const store = createFlowStore({ pool });
  const executor = createFlowExecutor({ store });
  const publish = async (event) => {
    const producer = kafka.producer();
    try {
      await producer.connect();
      await producer.send({ topic: TOPIC, acks: -1, messages: [{ key: event.flowId, value: JSON.stringify(event) }] });
    } finally {
      await producer.disconnect().catch(() => {});
    }
  };
  const relay = createFlowAuditRelay({ pool, publish, batchSize: 10 });
  const expected = new Map();
  let paused = false;
  async function mutate(operation, body) {
    await executor.executeFlows({ operation, identity, flowId, body, correlationId: randomUUID() });
    const { rows } = await pool.query('SELECT event_id, event_payload FROM flow_audit_outbox WHERE event_payload->>\'flowId\' = $1', [flowId]);
    for (const row of rows) expected.set(row.event_id, row.event_payload.eventType);
  }
  try {
    await store.ensureSchema();
    await admin.connect();
    await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 1 }] });
    await admin.disconnect();

    await mutate('create_definition', { name: 'Audit flow', definition });
    assert.deepEqual(await executor.executeFlows({ operation: 'validate', identity, flowId }), { valid: true });
    await mutate('publish_version');
    await relay.tick();

    compose('pause');
    paused = true;
    await mutate('update_definition', { name: 'Audit flow updated' });
    await mutate('update_definition', { name: 'Audit flow updated again' });
    const pending = await pool.query('SELECT event_id, attempts, delivered_at, next_attempt_at FROM flow_audit_outbox WHERE event_payload->>\'flowId\' = $1 AND delivered_at IS NULL ORDER BY created_at, event_id', [flowId]);
    assert.equal(pending.rows.length, 2);
    await relay.tick();
    const afterFailure = await pool.query('SELECT event_id, attempts, delivered_at, next_attempt_at, failed_at FROM flow_audit_outbox WHERE event_payload->>\'flowId\' = $1 AND delivered_at IS NULL ORDER BY created_at, event_id', [flowId]);
    assert.deepEqual(afterFailure.rows.map((row) => row.attempts), [1, 0]);
    assert.ok(afterFailure.rows[0].next_attempt_at > pending.rows[0].next_attempt_at);
    assert.deepEqual(afterFailure.rows[1].next_attempt_at, pending.rows[1].next_attempt_at);
    assert.ok(afterFailure.rows.every((row) => row.failed_at === null));

    compose('unpause');
    paused = false;
    await mutate('delete_definition');
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await relay.tick();
      const { rows } = await pool.query('SELECT count(*)::integer AS count FROM flow_audit_outbox WHERE event_payload->>\'flowId\' = $1 AND delivered_at IS NULL', [flowId]);
      if (rows[0].count === 0) break;
      await sleep(500);
    }
    const { rows: outbox } = await pool.query('SELECT event_id, event_payload, delivered_at, failed_at FROM flow_audit_outbox WHERE event_payload->>\'flowId\' = $1', [flowId]);
    assert.equal(outbox.length, 5);
    assert.ok(outbox.every((row) => row.delivered_at && row.failed_at === null));

    const received = new Map();
    const consumer = kafka.consumer({ groupId: `flow-audit-test-${randomUUID()}` });
    try {
      await consumer.connect();
      await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
      await consumer.run({ eachMessage: async ({ message }) => {
        const event = JSON.parse(message.value.toString());
        if (!expected.has(event.eventId)) return;
        assert.equal(message.key.toString(), flowId);
        assert.equal(event.flowId, flowId);
        assert.equal(event.tenantId, identity.tenantId);
        assert.equal(event.workspaceId, identity.workspaceId);
        assert.equal(event.eventType, expected.get(event.eventId));
        received.set(event.eventId, event);
      } });
      const consumeDeadline = Date.now() + 15000;
      while (received.size < expected.size && Date.now() < consumeDeadline) await sleep(100);
      assert.deepEqual(new Set(received.keys()), new Set(expected.keys()));
      assert.deepEqual([...received.values()].map((event) => event.eventType).sort(), [
        FLOW_AUDIT_EVENT_TYPES.DEFINITION_CREATED,
        FLOW_AUDIT_EVENT_TYPES.VERSION_PUBLISHED,
        FLOW_AUDIT_EVENT_TYPES.DEFINITION_UPDATED,
        FLOW_AUDIT_EVENT_TYPES.DEFINITION_UPDATED,
        FLOW_AUDIT_EVENT_TYPES.DEFINITION_DELETED,
      ].sort());
    } finally {
      await consumer.disconnect().catch(() => {});
    }
  } finally {
    if (paused) compose('unpause');
    await admin.disconnect().catch(() => {});
    await pool.end();
  }
});
