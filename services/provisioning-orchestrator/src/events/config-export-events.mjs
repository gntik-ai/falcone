/**
 * Kafka event publisher for config export audit events.
 * Fire-and-forget: Kafka failures are logged but never abort the export.
 * @module events/config-export-events
 */

import { randomUUID } from 'node:crypto';

export const CONFIG_EXPORT_COMPLETED_TOPIC =
  process.env.CONFIG_EXPORT_KAFKA_TOPIC_COMPLETED ?? 'console.config.export.completed';

/**
 * Builds the event payload for a completed config export.
 * @param {Object} p
 * @returns {Object}
 */
export function buildExportCompletedEvent(p) {
  return {
    event_id: randomUUID(),
    event_type: 'config.export.completed',
    schema_version: '1.0',
    correlation_id: p.correlation_id,
    tenant_id: p.tenant_id,
    actor_id: p.actor_id,
    actor_type: p.actor_type,
    domains_requested: p.domains_requested,
    domains_exported: p.domains_exported,
    domains_failed: p.domains_failed ?? [],
    domains_not_available: p.domains_not_available ?? [],
    result_status: p.result_status,
    artifact_bytes: p.artifact_bytes ?? null,
    format_version: p.format_version ?? '1.0',
    export_started_at: p.export_started_at,
    export_ended_at: p.export_ended_at,
    emitted_at: new Date().toISOString(),
  };
}

/**
 * Publishes a `config.export.completed` event to Kafka.
 * Fire-and-forget: catches and logs Kafka errors; export does NOT abort.
 *
 * @param {import('kafkajs').Producer | null} kafkaProducer
 * @param {Object} eventPayload - raw fields (same shape as buildExportCompletedEvent input)
 * @param {Console} [log]
 * @returns {Promise<{published: boolean}>}
 */
export async function publishExportCompleted(kafkaProducer, eventPayload, log = console) {
  if (!kafkaProducer?.send) {
    log.warn?.({ event: 'config_export_kafka_skip', reason: 'no producer available' });
    return { published: false };
  }

  const event = buildExportCompletedEvent(eventPayload);

  try {
    await kafkaProducer.send({
      topic: CONFIG_EXPORT_COMPLETED_TOPIC,
      messages: [{
        key: event.tenant_id,
        value: JSON.stringify(event),
      }],
    });
    return { published: true };
  } catch (err) {
    log.error?.({
      event: 'config_export_kafka_error',
      correlation_id: event.correlation_id,
      error: err.message,
    });
    return { published: false };
  }
}
