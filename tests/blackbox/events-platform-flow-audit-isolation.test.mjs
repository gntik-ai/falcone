import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventsExecutor } from '../../apps/control-plane-executor/src/runtime/events-executor.mjs';

test('tenant events API cannot list, consume, or produce on the platform Flow audit topic', async () => {
  const platformTopic = 'falcone.audit.flow-lifecycle';
  const subscriptions = [];
  const sends = [];
  const kafkaClient = {
    admin: () => ({
      async connect() {}, async disconnect() {},
      async listTopics() { return [platformTopic, 'evt.ws_A.orders', 'evt.ws_B.orders']; },
    }),
    producer: () => ({
      async connect() {}, async disconnect() {},
      async send(request) { sends.push(request.topic); return []; },
    }),
    consumer: () => ({
      async connect() {}, async disconnect() {},
      async subscribe(request) { subscriptions.push(request.topic); },
      async run() {},
    }),
  };
  const executor = createEventsExecutor({ brokers: 'fake:9092', kafkaClient });
  const identity = { tenantId: 'tenant_A', workspaceId: 'ws_A' };
  try {
    const listed = await executor.executeEvents({ operation: 'list_topics', identity });
    assert.deepEqual(listed.items, [{ topic: 'orders' }]);
    await executor.executeEvents({ operation: 'consume', identity, topic: platformTopic,
      payload: { timeoutMs: 1 } });
    await executor.executeEvents({ operation: 'publish', identity, topic: platformTopic,
      payload: { messages: [{ value: 'not an audit event' }] } });
    assert.deepEqual(subscriptions, [`evt.ws_A.${platformTopic}`]);
    assert.deepEqual(sends, [`evt.ws_A.${platformTopic}`]);
    assert.ok(!subscriptions.includes(platformTopic) && !sends.includes(platformTopic));
  } finally {
    await executor.close();
  }
});
