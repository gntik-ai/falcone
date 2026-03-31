/**
 * Kafka consumer helper for audit event verification.
 *
 * Uses kafkajs to connect to the audit topic and wait for specific events.
 * Each test run uses a unique consumer group to avoid interference.
 */

import { randomUUID } from 'node:crypto';
import { env } from '../config/test-env.mjs';

let Kafka;
try {
  // kafkajs may not be installed in all environments; guard the import.
  ({ Kafka } = await import('kafkajs'));
} catch {
  Kafka = null;
}

/**
 * Create a Kafka consumer connected to the audit topic.
 * @param {string} [groupId]
 * @returns {Promise<object|null>} consumer instance or null if kafkajs is unavailable
 */
export async function createAuditConsumer(groupId) {
  if (!Kafka) return null;

  const gid = groupId ?? `test-t06-${randomUUID().slice(0, 8)}`;
  const kafka = new Kafka({
    clientId: `plan-enforcement-test-${gid}`,
    brokers: env.KAFKA_BROKERS.split(','),
  });
  const consumer = kafka.consumer({ groupId: gid });
  await consumer.connect();
  await consumer.subscribe({ topic: env.KAFKA_AUDIT_TOPIC, fromBeginning: false });

  /** @type {Array<{ topic: string, partition: number, message: object }>} */
  const messages = [];

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const value = JSON.parse(message.value.toString());
        messages.push({ topic, partition, message: value });
      } catch {
        // skip non-JSON messages
      }
    },
  });

  // Attach messages buffer for polling
  consumer._testMessages = messages;
  return consumer;
}

/**
 * Wait for a specific audit event.
 * @param {object|null} consumer
 * @param {object} criteria
 * @param {string} criteria.eventType
 * @param {string} [criteria.tenantId]
 * @param {number} [criteria.timeoutMs]
 * @returns {Promise<object>} the matching event
 */
export async function waitForAuditEvent(consumer, { eventType, tenantId, timeoutMs = 15_000 }) {
  if (!consumer) {
    throw new Error('Kafka consumer not available — kafkajs may not be installed');
  }

  const messages = consumer._testMessages;
  const start = Date.now();
  const pollMs = 250;

  while (Date.now() - start < timeoutMs) {
    const match = messages.find(
      (m) =>
        m.message?.eventType === eventType &&
        (!tenantId || m.message?.tenantId === tenantId),
    );
    if (match) return match.message;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(
    `Timed out waiting for audit event "${eventType}" (tenant: ${tenantId ?? 'any'}) after ${timeoutMs}ms. Received ${messages.length} messages total.`,
  );
}

/**
 * Disconnect a consumer.
 * @param {object|null} consumer
 */
export async function disconnectConsumer(consumer) {
  if (!consumer) return;
  try {
    await consumer.disconnect();
  } catch {
    // Ignore disconnect errors during teardown
  }
}
