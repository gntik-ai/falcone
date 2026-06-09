/**
 * Billing-export service entrypoint (thin event-driven loop).
 *
 * Subscribes to the `quota_metering` calculation-cycle completion topic, and for
 * each completed cycle projects per-tenant consumption snapshots into immutable,
 * idempotent usage records (see emitter.mjs::processCycleCompletion). Mirrors the
 * secret-audit-handler tailer→publisher shape: all heavy dependencies are
 * resolved at startup and injected into the pure emitter core.
 */
import { Client } from 'pg';

import { processCycleCompletion, createBillingAdapter } from './emitter.mjs';

const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean);
const cycleTopic = process.env.METERING_CYCLE_TOPIC ?? 'console.metering.cycle.completed';
const consumerGroup = process.env.BILLING_EXPORT_GROUP ?? 'billing-export';
const databaseUrl = process.env.DATABASE_URL ?? '';
const batchSize = Number(process.env.BILLING_BATCH_SIZE ?? '50');

if (brokers.length === 0) {
  console.error('KAFKA_BROKERS is required');
  process.exit(1);
}
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const { Kafka, logLevel } = await import('kafkajs');
const kafka = new Kafka({ brokers, logLevel: logLevel.NOTHING, retry: { retries: 5, initialRetryTime: 300 } });
const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: consumerGroup });
const db = new Client({ connectionString: databaseUrl });

const billingAdapter = createBillingAdapter({
  type: process.env.BILLING_ADAPTER_TYPE,
  url: process.env.BILLING_ADAPTER_URL
});

// Minimal audit client publishing billing_boundary_change events to the audit
// pipeline topic. Keeping it inline keeps the dependency surface small.
const auditTopic = process.env.AUDIT_TOPIC ?? 'console.audit.platform';
const auditClient = {
  async emit(event) {
    try {
      await producer.send({
        topic: auditTopic,
        messages: [{ key: event.tenant_id ?? 'platform', value: JSON.stringify(event) }]
      });
    } catch (error) {
      console.error('Failed to emit billing audit event', error);
    }
  }
};

// Resolve a tenant's consumption snapshot via the orchestrator action, run as an
// internal actor (tenant-consumption-snapshot-get accepts actor.type === 'internal').
async function resolveSnapshot(tenantId) {
  const { main } = await import(
    '../../provisioning-orchestrator/src/actions/tenant-consumption-snapshot-get.mjs'
  );
  const response = await main(
    { tenantId, callerContext: { actor: { id: 'billing-export', type: 'internal' } } },
    { db }
  );
  return response.body;
}

await db.connect();
await producer.connect();
await consumer.connect();
await consumer.subscribe({ topic: cycleTopic, fromBeginning: false });

const shutdown = async () => {
  await consumer.disconnect().catch(() => {});
  await producer.disconnect().catch(() => {});
  await db.end().catch(() => {});
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await consumer.run({
  eachMessage: async ({ message }) => {
    let cycle;
    try {
      cycle = JSON.parse(message.value.toString());
    } catch (error) {
      console.error('Skipping unparseable metering cycle event', error);
      return;
    }
    try {
      await processCycleCompletion(cycle, { db, producer, auditClient, billingAdapter, resolveSnapshot, batchSize });
    } catch (error) {
      console.error('Failed to process metering cycle', cycle?.cycleId, error);
      throw error;
    }
  }
});
