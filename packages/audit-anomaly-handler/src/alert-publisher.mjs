/**
 * Security-alert Kafka publisher.
 *
 * Mirrors the secret-audit-handler producer factory shape
 * (packages/secret-audit-handler/src/kafka-publisher.mjs): an injectable
 * producer for tests, lazy kafkajs import in production.
 *
 * Emits to the `console.security.alerts` topic. Every message payload carries
 * a per-tenant scope envelope (from `getAuditScopeEnvelope`) and ALL required
 * alert fields: tenant_id, alert_type, event_count, window_seconds,
 * first_event_at, last_event_at, correlation_id.
 */
import { getAuditScopeEnvelope } from '../../internal-contracts/src/index.mjs';

export const SECURITY_ALERT_TOPIC = 'console.security.alerts';

const REQUIRED_FIELDS = Object.freeze([
  'tenant_id',
  'alert_type',
  'event_count',
  'window_seconds',
  'first_event_at',
  'last_event_at',
  'correlation_id'
]);

/**
 * Build the wire payload for a security alert, attaching a per-tenant scope
 * envelope so downstream consumers can enforce tenant isolation.
 *
 * @param {object} alert detector alert descriptor
 * @returns {object} the message payload
 */
export function buildAlertPayload(alert) {
  if (!alert || !alert.tenant_id) {
    throw new Error('alert must carry a tenant_id');
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(alert, field)) {
      throw new Error(`alert is missing required field "${field}"`);
    }
  }

  const envelope = getAuditScopeEnvelope() ?? {};

  return {
    tenant_id: alert.tenant_id,
    alert_type: alert.alert_type,
    event_count: alert.event_count,
    window_seconds: alert.window_seconds,
    first_event_at: alert.first_event_at,
    last_event_at: alert.last_event_at,
    correlation_id: alert.correlation_id,
    scope: {
      // Anomaly alerts are always attributable to a single tenant.
      scope_mode: 'tenant',
      tenant_id: alert.tenant_id,
      governance_rules: envelope.governance_rules ?? []
    }
  };
}

/**
 * @param {object} options
 * @param {string[]} options.brokers
 * @param {string} [options.topic]
 * @param {object} [options.producer] injectable producer (tests)
 */
export async function createAlertPublisher({ brokers, topic = SECURITY_ALERT_TOPIC, producer: injectedProducer }) {
  let producer;

  if (injectedProducer) {
    producer = injectedProducer;
  } else {
    const { Kafka, logLevel } = await import('kafkajs');
    const kafka = new Kafka({
      brokers,
      logLevel: logLevel.NOTHING,
      retry: { retries: 5, initialRetryTime: 300 }
    });
    producer = kafka.producer();
  }

  return {
    async connect() {
      await producer.connect();
    },
    async publishAlert(alert) {
      const payload = buildAlertPayload(alert);
      try {
        await producer.send({
          topic,
          messages: [{
            key: payload.tenant_id,
            value: JSON.stringify(payload),
            headers: {
              tenantId: payload.tenant_id,
              alertType: payload.alert_type
            }
          }]
        });
      } catch (error) {
        console.error('Failed to publish security alert', error);
      }
    },
    async disconnect() {
      await producer.disconnect();
    }
  };
}
