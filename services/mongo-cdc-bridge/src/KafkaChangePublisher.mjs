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
 * Derives the Kafka topic for a Mongo CDC event.
 * If namespace is provided it acts ONLY as a validated leading prefix.
 * The tenant_id and workspace_id components are NEVER replaceable.
 *
 * @param {{ namespace?: string, tenantId: string, workspaceId: string }} opts
 * @returns {string}
 */
export function deriveTopic({ namespace, tenantId, workspaceId }) {
  const base = `${tenantId}.${workspaceId}.mongo-changes`;
  return namespace ? `${namespace}.${base}` : base;
}

export class KafkaChangePublisher {
  constructor({ kafka, maxEventsPerSecond = Number(process.env.MONGO_CDC_MAX_EVENTS_PER_SECOND ?? 1000), metricsCollector = null }) { this.kafka = kafka; this.maxEventsPerSecond = maxEventsPerSecond; this.metricsCollector = metricsCollector; this.windows = new Map(); this.connected = false; }
  async connect() { this.producer = this.kafka?.producer ? this.kafka.producer({ idempotent: true, acks: -1 }) : this.kafka?.producerObj; await this.producer?.connect?.(); this.connected = true; }
  _allow(workspaceId) { const now = Date.now(); const current = this.windows.get(workspaceId) ?? { count: 0, windowStart: now }; if (now - current.windowStart >= 1000) { current.count = 0; current.windowStart = now; } current.count += 1; this.windows.set(workspaceId, current); return current.count <= this.maxEventsPerSecond; }
  resolveTopic(captureConfig) {
    return deriveTopic({ namespace: process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX, tenantId: captureConfig.tenant_id, workspaceId: captureConfig.workspace_id });
  }
  async publish(topic, partitionKey, cloudeventsEnvelope, headers) {
    const workspaceId = cloudeventsEnvelope.workspaceid;
    if (!this._allow(workspaceId)) throw new Error('MONGO_CDC_RATE_LIMITED');
    await this.producer.send({ topic, messages: [{ key: partitionKey, value: JSON.stringify(cloudeventsEnvelope), headers }] });
    this.metricsCollector?.increment('mongo_cdc_events_published_total', { workspace_id: workspaceId, collection: `${cloudeventsEnvelope.data.database_name}.${cloudeventsEnvelope.data.collection_name}` });
    if (cloudeventsEnvelope.data.cluster_time) this.metricsCollector?.observe('mongo_cdc_publish_lag_seconds', { workspace_id: workspaceId }, Math.max(0, (Date.now() - new Date(cloudeventsEnvelope.data.cluster_time).getTime()) / 1000));
    return cloudeventsEnvelope;
  }
  async disconnect() { await this.producer?.disconnect?.(); this.connected = false; }
}
