/**
 * REAL Kafka integration test for secret-audit per-tenant topic isolation (issue #211).
 *
 * Skipped unless the Falcone test environment (with Redpanda) is running:
 *   bash tests/env/up.sh && source tests/env/env.sh && \
 *     node --test packages/secret-audit-handler/tests/integration/secret-audit-topic-isolation.kafka.test.mjs
 *
 * Publishes through the ACTUAL createPublisher (real kafkajs producer) and consumes
 * from the live broker to prove a tenant-domain audit event lands ONLY on the
 * per-tenant topic console.secrets.audit.<tenantId> (never the shared topic).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Kafka, logLevel } from 'kafkajs';
import { createPublisher } from '../../src/kafka-publisher.mjs';

const RUN = process.env.FALCONE_TESTENV === '1' && !!process.env.KAFKA_BROKERS;

function auditEvent(tenantId) {
  return {
    eventId: `e-${tenantId}`,
    timestamp: new Date().toISOString(),
    operation: 'read',
    domain: 'tenant',
    tenantId,
    secretPath: `tenant/${tenantId}/db-password`,
    secretName: 'db-password',
    requestorIdentity: { type: 'service', name: 'svc', namespace: 'ns', serviceAccount: 'sa' },
    result: 'success',
    denialReason: null,
    vaultRequestId: `r-${tenantId}`
  };
}

test('secret-audit tenant event routes to per-tenant topic only (REAL Kafka)', { skip: !RUN }, async (t) => {
  const brokers = process.env.KAFKA_BROKERS.split(',');
  const publisher = await createPublisher({ brokers, topic: 'console.secrets.audit' });
  await publisher.connect();
  t.after(async () => { await publisher.disconnect(); });

  await publisher.publishAuditEvent(auditEvent('tenant-a'));
  await publisher.publishAuditEvent(auditEvent('tenant-b'));

  const kafka = new Kafka({ clientId: 'audit-test', brokers, logLevel: logLevel.NOTHING });
  const consumer = kafka.consumer({ groupId: `audit-test-${process.pid}` });
  await consumer.connect();
  await consumer.subscribe({ topic: 'console.secrets.audit.tenant-a', fromBeginning: true });
  t.after(async () => { await consumer.disconnect(); });

  const payload = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting on console.secrets.audit.tenant-a')), 20000);
    consumer.run({ eachMessage: async ({ message }) => { clearTimeout(timer); resolve(message.value.toString()); } });
  });

  assert.match(payload, /tenant-a/, 'tenant-a topic must carry tenant-a audit event');
  assert.doesNotMatch(payload, /tenant-b/, 'tenant-a topic must not carry tenant-b data');
});
