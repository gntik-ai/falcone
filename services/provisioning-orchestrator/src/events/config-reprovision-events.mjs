/**
 * Kafka event publisher for config reprovision audit events.
 * Fire-and-forget: Kafka failures are logged but never abort the reprovision.
 * @module events/config-reprovision-events
 */

import { randomUUID } from 'node:crypto';

export const CONFIG_REPROVISION_COMPLETED_TOPIC =
  process.env.CONFIG_REPROVISION_KAFKA_TOPIC_COMPLETED ?? 'console.config.reprovision.completed';

export const CONFIG_REPROVISION_IDENTIFIER_MAP_TOPIC =
  process.env.CONFIG_REPROVISION_KAFKA_TOPIC_MAP ?? 'console.config.reprovision.identifier-map';

/**
 * Build the event payload for a completed config reprovision.
 * @param {Object} p
 * @returns {Object}
 */
export function buildReprovisionCompletedEvent(p) {
  return {
    event_id: randomUUID(),
    event_type: 'config.reprovision.completed',
    schema_version: '1.0',
    correlation_id: p.correlation_id,
    tenant_id: p.tenant_id,
    source_tenant_id: p.source_tenant_id,
    actor_id: p.actor_id,
    actor_type: p.actor_type,
    dry_run: p.dry_run ?? false,
    domains_requested: p.domains_requested,
    domains_applied: p.domains_applied ?? [],
    domains_failed: p.domains_failed ?? [],
    domains_skipped: p.domains_skipped ?? [],
    result_status: p.result_status,
    summary: p.summary ?? null,
    format_version: p.format_version ?? '1.0.0',
    started_at: p.started_at,
    ended_at: p.ended_at,
    emitted_at: new Date().toISOString(),
  };
}

/**
 * Build the event payload for identifier map generation.
 * @param {Object} p
 * @returns {Object}
 */
export function buildIdentifierMapGeneratedEvent(p) {
  return {
    event_id: randomUUID(),
    event_type: 'config.reprovision.identifier-map.generated',
    schema_version: '1.0',
    correlation_id: p.correlation_id,
    tenant_id: p.tenant_id,
    source_tenant_id: p.source_tenant_id,
    actor_id: p.actor_id,
    actor_type: p.actor_type,
    entries_count: p.entries_count ?? 0,
    warnings: p.warnings ?? [],
    emitted_at: new Date().toISOString(),
  };
}

/**
 * Publish a reprovision completed event to Kafka. Fire-and-forget.
 *
 * @param {import('kafkajs').Producer | null} kafkaProducer
 * @param {Object} eventPayload
 * @param {Console} [log]
 * @returns {Promise<{published: boolean}>}
 */
export async function publishReprovisionCompleted(kafkaProducer, eventPayload, log = console) {
  if (!kafkaProducer?.send) {
    log.warn?.({ event: 'config_reprovision_kafka_skip', reason: 'no producer available' });
    return { published: false };
  }

  const event = buildReprovisionCompletedEvent(eventPayload);

  try {
    await kafkaProducer.send({
      topic: CONFIG_REPROVISION_COMPLETED_TOPIC,
      messages: [{ key: event.tenant_id, value: JSON.stringify(event) }],
    });
    return { published: true };
  } catch (err) {
    log.error?.({
      event: 'config_reprovision_kafka_error',
      correlation_id: event.correlation_id,
      error: err.message,
    });
    return { published: false };
  }
}

/**
 * Publish an identifier map generated event to Kafka. Fire-and-forget.
 *
 * @param {import('kafkajs').Producer | null} kafkaProducer
 * @param {Object} eventPayload
 * @param {Console} [log]
 * @returns {Promise<{published: boolean}>}
 */
export async function publishIdentifierMapGenerated(kafkaProducer, eventPayload, log = console) {
  if (!kafkaProducer?.send) {
    log.warn?.({ event: 'config_reprovision_identifier_map_kafka_skip', reason: 'no producer available' });
    return { published: false };
  }

  const event = buildIdentifierMapGeneratedEvent(eventPayload);

  try {
    await kafkaProducer.send({
      topic: CONFIG_REPROVISION_IDENTIFIER_MAP_TOPIC,
      messages: [{ key: event.tenant_id, value: JSON.stringify(event) }],
    });
    return { published: true };
  } catch (err) {
    log.error?.({
      event: 'config_reprovision_identifier_map_kafka_error',
      correlation_id: event.correlation_id,
      error: err.message,
    });
    return { published: false };
  }
}
