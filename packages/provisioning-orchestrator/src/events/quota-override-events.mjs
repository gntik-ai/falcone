const TOPICS = {
  created: process.env.QUOTA_OVERRIDE_KAFKA_TOPIC_CREATED ?? 'console.quota.override.created',
  modified: process.env.QUOTA_OVERRIDE_KAFKA_TOPIC_MODIFIED ?? 'console.quota.override.modified',
  revoked: process.env.QUOTA_OVERRIDE_KAFKA_TOPIC_REVOKED ?? 'console.quota.override.revoked',
  expired: process.env.QUOTA_OVERRIDE_KAFKA_TOPIC_EXPIRED ?? 'console.quota.override.expired',
  superseded: process.env.QUOTA_OVERRIDE_KAFKA_TOPIC_MODIFIED ?? 'console.quota.override.modified'
};

async function emit(producer, topic, event) { if (producer?.send) await producer.send({ topic, messages: [{ key: event.tenantId ?? event.dimensionKey ?? event.timestamp, value: JSON.stringify(event) }] }); return event; }
export async function emitOverrideEvent(producer, kind, payload) { const topic = TOPICS[kind] ?? TOPICS.created; return emit(producer, topic, { eventType: topic, timestamp: new Date().toISOString(), ...payload }); }
