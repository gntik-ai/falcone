import { validateAuditEvent } from './event-schema.mjs';
import { resolveAuditTopic } from './topic-router.mjs';

export async function createPublisher({ brokers, topic, producer: injectedProducer }) {
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
    async publishAuditEvent(event) {
      validateAuditEvent(event);
      const resolvedTopic = resolveAuditTopic(topic, event);
      try {
        await producer.send({
          topic: resolvedTopic,
          messages: [{
            key: event.domain,
            value: JSON.stringify(event),
            headers: {
              eventId: event.eventId,
              domain: event.domain
            }
          }]
        });
      } catch (error) {
        console.error('Failed to publish audit event', error);
      }
    },
    async disconnect() {
      await producer.disconnect();
    }
  };
}
