function buildPayload(eventType, payload) {
  return {
    eventType,
    timestamp: new Date().toISOString(),
    ...payload
  };
}

async function emit(kafka, topic, payload) {
  if (!kafka?.producer) return;
  const producer = kafka.producer();
  await producer.connect();
  await producer.send({ topic, messages: [{ value: JSON.stringify(payload) }] });
  await producer.disconnect();
}

export function emitSpecAccessed(kafka, payload) {
  return emit(kafka, 'console.openapi.spec.accessed', buildPayload('openapi.spec.accessed', payload));
}

export function emitSpecUpdated(kafka, payload) {
  return emit(kafka, 'console.openapi.spec.updated', buildPayload('openapi.spec.updated', payload));
}

export function emitSdkDownloadAccessed(kafka, payload) {
  return emit(kafka, 'console.sdk.download.accessed', buildPayload('sdk.download.accessed', payload));
}

export function emitSdkGenerationCompleted(kafka, payload) {
  return emit(kafka, 'console.sdk.generation.completed', buildPayload('sdk.generation.completed', payload));
}
