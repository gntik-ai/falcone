/**
 * audit-anomaly-handler entrypoint.
 *
 * Thin Kafka consumer loop mirroring packages/secret-audit-handler/src/index.mjs.
 * All testable logic lives in anomaly-detector.mjs (pure detection) and
 * alert-publisher.mjs (alert emission); this file only wires Kafka I/O to them.
 *
 * It tails the audit Kafka topic, feeds each event to the per-tenant detector,
 * and publishes any returned alert descriptor to the security-alerts topic. It
 * never writes back to the audit pipeline, so audit persistence and query paths
 * are unaffected.
 */
import { createAnomalyDetector } from './anomaly-detector.mjs';
import { createAlertPublisher, SECURITY_ALERT_TOPIC } from './alert-publisher.mjs';

const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean);
const auditTopic = process.env.AUDIT_KAFKA_TOPIC ?? 'console.audit.events';
const alertTopic = process.env.SECURITY_ALERT_TOPIC ?? SECURITY_ALERT_TOPIC;
const consumerGroupId = process.env.ANOMALY_CONSUMER_GROUP ?? 'audit-anomaly-handler';

if (brokers.length === 0) {
  console.error('KAFKA_BROKERS is required');
  process.exit(1);
}

function parseAuditEvent(message) {
  try {
    return JSON.parse(message.value.toString());
  } catch {
    return null;
  }
}

const detector = createAnomalyDetector();
const publisher = await createAlertPublisher({ brokers, topic: alertTopic });

const { Kafka, logLevel } = await import('kafkajs');
const kafka = new Kafka({
  brokers,
  logLevel: logLevel.NOTHING,
  retry: { retries: 5, initialRetryTime: 300 }
});
const consumer = kafka.consumer({ groupId: consumerGroupId });

try {
  await publisher.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: auditTopic, fromBeginning: false });
} catch (error) {
  console.error('Kafka connection failed', error);
  process.exit(1);
}

const shutdown = async () => {
  try {
    await consumer.disconnect();
    await publisher.disconnect();
  } finally {
    process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await consumer.run({
  eachMessage: async ({ message }) => {
    const event = parseAuditEvent(message);
    if (!event) {
      return;
    }
    const alert = detector.recordEvent(event, Date.now());
    if (alert) {
      await publisher.publishAlert(alert);
    }
  }
});
