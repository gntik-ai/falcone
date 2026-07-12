/**
 * REAL Kafka integration test for CDC per-tenant topic isolation (issue #212).
 *
 * Skipped unless the Falcone test environment (with Redpanda) is running:
 *   bash tests/env/up.sh && source tests/env/env.sh && \
 *     node --test packages/pg-cdc-bridge/tests/integration/cdc-topic-isolation.kafka.test.mjs
 *
 * Publishes through the ACTUAL KafkaChangePublisher (no mocked producer) with a
 * namespace override set, then consumes from the real broker to prove the topic
 * embeds tenant+workspace (override acts only as a leading prefix) — i.e. tenants
 * never share a topic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Kafka, logLevel } from 'kafkajs';
import { KafkaChangePublisher } from '../../src/KafkaChangePublisher.mjs';

const RUN = process.env.FALCONE_TESTENV === '1' && !!process.env.KAFKA_BROKERS;

function decodedEvent(table) {
  return { type: 'insert', relation: { namespace: 'public', relationName: table }, newRow: { id: 1 }, sequence: 1 };
}

test('pg CDC namespace override prefixes per-tenant topics (REAL Kafka)', { skip: !RUN }, async (t) => {
  process.env.PG_CDC_KAFKA_TOPIC_PREFIX = 'myns';
  const kafka = new Kafka({ clientId: 'cdc-test', brokers: process.env.KAFKA_BROKERS.split(','), logLevel: logLevel.NOTHING });

  const publisher = new KafkaChangePublisher({ kafka });
  await publisher.initialize();
  t.after(async () => { await publisher.disconnect(); });

  // Two tenants publish the same logical change.
  await publisher.publish({ id: 'c1', tenant_id: 'tenant-a', workspace_id: 'ws-1', data_source_ref: 'ds1' }, decodedEvent('orders'), '0/1', new Date().toISOString());
  await publisher.publish({ id: 'c2', tenant_id: 'tenant-b', workspace_id: 'ws-2', data_source_ref: 'ds2' }, decodedEvent('orders'), '0/2', new Date().toISOString());

  // Consume tenant A's prefixed topic — it must exist and carry tenant-a only.
  const topicA = 'myns.tenant-a.ws-1.pg-changes';
  const consumer = kafka.consumer({ groupId: `cdc-test-${process.pid}` });
  await consumer.connect();
  await consumer.subscribe({ topic: topicA, fromBeginning: true });
  t.after(async () => { await consumer.disconnect(); });

  const payload = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting on ${topicA}`)), 20000);
    consumer.run({ eachMessage: async ({ message }) => { clearTimeout(timer); resolve(message.value.toString()); } });
  });

  assert.match(payload, /tenant-a/, 'message on tenant-a topic must reference tenant-a');
  assert.doesNotMatch(payload, /tenant-b/, 'tenant-a topic must not carry tenant-b data');
});
