/**
 * Kafka event publishers for config schema validation and migration audit events.
 * Fire-and-forget: Kafka failures are logged but never abort the operation.
 * @module events/config-schema-events
 */

import { randomUUID } from 'node:crypto';

export const CONFIG_SCHEMA_VALIDATED_TOPIC =
  process.env.CONFIG_SCHEMA_KAFKA_TOPIC_VALIDATED ?? 'console.config.schema.validated';

export const CONFIG_SCHEMA_MIGRATED_TOPIC =
  process.env.CONFIG_SCHEMA_KAFKA_TOPIC_MIGRATED ?? 'console.config.schema.migrated';

/**
 * Builds the event payload for a config schema validation.
 * @param {Object} p
 * @returns {Object}
 */
export function buildValidationEvent(p) {
  return {
    event_id: randomUUID(),
    event_type: 'config.schema.validated',
    schema_version: '1.0',
    correlation_id: p.correlation_id,
    tenant_id: p.tenant_id,
    actor_id: p.actor_id,
    actor_type: p.actor_type,
    format_version_validated: p.format_version_validated,
    result: p.result,
    error_count: p.error_count ?? 0,
    warning_count: p.warning_count ?? 0,
    schema_checksum_match: p.schema_checksum_match ?? null,
    migration_required: p.migration_required ?? false,
    validated_at: new Date().toISOString(),
  };
}

/**
 * Builds the event payload for a config schema migration.
 * @param {Object} p
 * @returns {Object}
 */
export function buildMigrationEvent(p) {
  return {
    event_id: randomUUID(),
    event_type: 'config.schema.migrated',
    schema_version: '1.0',
    correlation_id: p.correlation_id,
    tenant_id: p.tenant_id,
    actor_id: p.actor_id,
    actor_type: p.actor_type,
    migrated_from: p.migrated_from,
    migrated_to: p.migrated_to,
    migration_chain: p.migration_chain ?? [],
    has_migration_warnings: p.has_migration_warnings ?? false,
    migrated_at: new Date().toISOString(),
  };
}

/**
 * Publish a validation audit event to Kafka. Fire-and-forget.
 *
 * @param {import('kafkajs').Producer | null} kafkaProducer
 * @param {Object} eventPayload
 * @param {Console} [log]
 * @returns {Promise<{published: boolean}>}
 */
export async function publishValidationEvent(kafkaProducer, eventPayload, log = console) {
  if (!kafkaProducer?.send) {
    log.warn?.({ event: 'config_schema_validated_kafka_skip', reason: 'no producer available' });
    return { published: false };
  }

  const event = buildValidationEvent(eventPayload);
  try {
    await kafkaProducer.send({
      topic: CONFIG_SCHEMA_VALIDATED_TOPIC,
      messages: [{ key: event.tenant_id, value: JSON.stringify(event) }],
    });
    return { published: true };
  } catch (err) {
    log.error?.({
      event: 'config_schema_validated_kafka_error',
      correlation_id: event.correlation_id,
      error: err.message,
    });
    return { published: false };
  }
}

/**
 * Publish a migration audit event to Kafka. Fire-and-forget.
 *
 * @param {import('kafkajs').Producer | null} kafkaProducer
 * @param {Object} eventPayload
 * @param {Console} [log]
 * @returns {Promise<{published: boolean}>}
 */
export async function publishMigrationEvent(kafkaProducer, eventPayload, log = console) {
  if (!kafkaProducer?.send) {
    log.warn?.({ event: 'config_schema_migrated_kafka_skip', reason: 'no producer available' });
    return { published: false };
  }

  const event = buildMigrationEvent(eventPayload);
  try {
    await kafkaProducer.send({
      topic: CONFIG_SCHEMA_MIGRATED_TOPIC,
      messages: [{ key: event.tenant_id, value: JSON.stringify(event) }],
    });
    return { published: true };
  } catch (err) {
    log.error?.({
      event: 'config_schema_migrated_kafka_error',
      correlation_id: event.correlation_id,
      error: err.message,
    });
    return { published: false };
  }
}
