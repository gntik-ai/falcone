const TOPICS = {
  set: process.env.SUB_QUOTA_KAFKA_TOPIC_SET ?? 'console.quota.sub_quota.set',
  removed: process.env.SUB_QUOTA_KAFKA_TOPIC_REMOVED ?? 'console.quota.sub_quota.removed',
  inconsistency: process.env.SUB_QUOTA_KAFKA_TOPIC_INCONSISTENCY ?? 'console.quota.sub_quota.inconsistency_detected'
};

async function emit(kafkaProducer, topic, payload) {
  const event = { eventType: topic, timestamp: payload.timestamp ?? new Date().toISOString(), ...payload };
  if (kafkaProducer?.send) await kafkaProducer.send({ topic, messages: [{ key: payload.tenantId ?? payload.workspaceId ?? event.timestamp, value: JSON.stringify(event) }] });
  return event;
}

export function getSubQuotaLockTimeoutMs(value = process.env.SUB_QUOTA_ALLOCATION_LOCK_TIMEOUT_MS) {
  const parsed = Number.parseInt(`${value ?? '5000'}`, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5000;
}

export async function emitSubQuotaSet(payload, kafkaProducer) { return emit(kafkaProducer, TOPICS.set, payload); }
export async function emitSubQuotaRemoved(payload, kafkaProducer) { return emit(kafkaProducer, TOPICS.removed, payload); }
export async function emitSubQuotaInconsistency(payload, kafkaProducer) { return emit(kafkaProducer, TOPICS.inconsistency, payload); }
