import { EventEmitter } from 'node:events';
import { CaptureChangeEvent } from '../../provisioning-orchestrator/src/models/realtime/CaptureChangeEvent.mjs';

const NAMESPACE_RE = /^[a-z][a-z0-9._-]{0,63}$/;

/**
 * Validates the namespace override value.
 * Accepts undefined (unset) but rejects any set value not matching the safe pattern.
 * @param {string|undefined} value
 */
export function assertValidTopicNamespace(value) {
  if (value === undefined) return;
  if (!NAMESPACE_RE.test(value)) {
    throw new Error(`Invalid topic namespace: "${value}". Must match pattern ${NAMESPACE_RE} (lowercase, start with a-z, max 64 chars).`);
  }
}

/**
 * Derives the Kafka topic for a PG CDC event.
 * If namespace is provided it acts ONLY as a validated leading prefix.
 * The tenant_id and workspace_id components are NEVER replaceable.
 *
 * @param {{ namespace?: string, tenantId: string, workspaceId: string }} opts
 * @returns {string}
 */
export function deriveTopic({ namespace, tenantId, workspaceId }) {
  const base = `${tenantId}.${workspaceId}.pg-changes`;
  return namespace ? `${namespace}.${base}` : base;
}

export class KafkaChangePublisher extends EventEmitter {
  constructor({ kafka, maxEventsPerSecond = Number(process.env.PG_CDC_MAX_EVENTS_PER_SECOND ?? 1000), overflowBufferSize, metricsCollector = null }) { super(); this.kafka = kafka; this.maxEventsPerSecond = maxEventsPerSecond; this.overflowBufferSize = overflowBufferSize ?? Number(process.env.PG_CDC_OVERFLOW_BUFFER_SIZE ?? 256); this.metricsCollector = metricsCollector; this.windows = new Map(); this.overflowBuffers = new Map(); this._lastEviction = 0; this.connected = false; }
  async initialize() { this.producer = this.kafka?.producer ? this.kafka.producer({ idempotent: true, acks: -1 }) : this.kafka?.producerObj; await this.producer?.connect?.(); this.connected = true; }
  _allow(tenantId, workspaceId) { const now = Date.now(); const key = `${tenantId}:${workspaceId}`; const current = this.windows.get(key) ?? { count: 0, windowStart: now }; if (now - current.windowStart >= 1000) { current.count = 0; current.windowStart = now; } current.count += 1; this.windows.set(key, current); if (now - this._lastEviction >= 1000) { for (const [k, entry] of this.windows) { if (now - entry.windowStart >= 1000) { this.windows.delete(k); } } this._lastEviction = now; } return current.count <= this.maxEventsPerSecond; }
  /**
   * Derives the dead-letter topic for a captureConfig, reusing deriveTopic so the
   * tenant/workspace namespacing invariant is preserved (never hand-built).
   * @param {{ tenant_id: string, workspace_id: string }} captureConfig
   * @returns {string}
   */
  _deriveDlqTopic(captureConfig) {
    return `${deriveTopic({ namespace: process.env.PG_CDC_KAFKA_TOPIC_PREFIX, tenantId: captureConfig.tenant_id, workspaceId: captureConfig.workspace_id })}.dlq`;
  }
  /** Send a constructed CaptureChangeEvent to the primary CDC topic (live or drained). */
  async _sendPrimary(captureConfig, decodedEvent, event, committedAt) {
    const topic = deriveTopic({ namespace: process.env.PG_CDC_KAFKA_TOPIC_PREFIX, tenantId: captureConfig.tenant_id, workspaceId: captureConfig.workspace_id });
    const key = `${captureConfig.workspace_id}:${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}`;
    await this.producer.send({ topic, messages: [{ key, value: JSON.stringify(event), headers: { 'ce-type': 'console.pg-capture.change', 'ce-tenantid': captureConfig.tenant_id, 'ce-workspaceid': captureConfig.workspace_id, 'ce-source': `/data-sources/${captureConfig.data_source_ref}/tables/${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}` } }] });
    this.metricsCollector?.increment('pg_cdc_events_published_total', { workspace_id: captureConfig.workspace_id, table: `${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}` });
    this.metricsCollector?.set('pg_cdc_publish_lag_seconds', { workspace_id: captureConfig.workspace_id }, Math.max(0, (Date.now() - new Date(committedAt).getTime()) / 1000));
  }
  async publish(captureConfig, decodedEvent, lsn, committedAt) {
    // Construct the event up-front so it can be sent, buffered, or dead-lettered —
    // no event is ever silently dropped.
    const event = CaptureChangeEvent.create({ eventType: decodedEvent.type, schema: decodedEvent.relation.namespace, table: decodedEvent.relation.relationName, lsn, committedAt, rowPayload: decodedEvent.newRow ?? decodedEvent.oldRow ?? {}, captureConfigId: captureConfig.id, workspaceId: captureConfig.workspace_id, tenantId: captureConfig.tenant_id, sequence: decodedEvent.sequence ?? 0, dataSourceRef: captureConfig.data_source_ref });
    const compositeKey = `${captureConfig.tenant_id}:${captureConfig.workspace_id}`;

    if (this._allow(captureConfig.tenant_id, captureConfig.workspace_id)) {
      // Capacity available: drain any buffered events FIRST (FIFO, before the live
      // event) to preserve approximate ordering, then send the live event.
      const buffered = this.overflowBuffers.get(compositeKey);
      if (buffered && buffered.length > 0) {
        for (const b of buffered) {
          await this._sendPrimary(b.captureConfig, b.decodedEvent, b.event, b.committedAt);
        }
        buffered.length = 0;
        this.metricsCollector?.set('pg_cdc_events_overflow_buffered_total', { tenant_id: captureConfig.tenant_id, workspace_id: captureConfig.workspace_id }, 0);
      }
      await this._sendPrimary(captureConfig, decodedEvent, event, committedAt);
      return event;
    }

    // Rate-limited: preserve existing metric/event behaviour.
    this.metricsCollector?.increment('pg_cdc_events_rate_limited_total', { workspace_id: captureConfig.workspace_id });
    this.emit('rate-limited', captureConfig.workspace_id);

    let buffer = this.overflowBuffers.get(compositeKey);
    if (!buffer) { buffer = []; this.overflowBuffers.set(compositeKey, buffer); }
    if (buffer.length < this.overflowBufferSize) {
      // Buffer has capacity: enqueue the constructed event for later drain.
      buffer.push({ captureConfig, decodedEvent, event, committedAt });
      this.metricsCollector?.set('pg_cdc_events_overflow_buffered_total', { tenant_id: captureConfig.tenant_id, workspace_id: captureConfig.workspace_id }, buffer.length);
      return null;
    }

    // Buffer full: route to the dead-letter topic + emit a structured audit event.
    const dlqTopic = this._deriveDlqTopic(captureConfig);
    await this.producer.send({ topic: dlqTopic, messages: [{ key: compositeKey, value: JSON.stringify(event), headers: { 'ce-type': 'console.pg-capture.change', 'ce-tenantid': captureConfig.tenant_id, 'ce-workspaceid': captureConfig.workspace_id, 'ce-source': `/data-sources/${captureConfig.data_source_ref}/tables/${decodedEvent.relation.namespace}.${decodedEvent.relation.relationName}` } }] });
    this.metricsCollector?.increment('pg_cdc_events_dlq_total', { tenant_id: captureConfig.tenant_id, workspace_id: captureConfig.workspace_id });
    await this.producer.send({ topic: 'console.pg-cdc.overflow', messages: [{ key: compositeKey, value: JSON.stringify({ type: 'console.pg-cdc.overflow', tenantId: captureConfig.tenant_id, workspaceId: captureConfig.workspace_id, lsn, committedAt }) }] });
    return null;
  }
  async disconnect() { await this.producer?.disconnect?.(); this.connected = false; }
}
