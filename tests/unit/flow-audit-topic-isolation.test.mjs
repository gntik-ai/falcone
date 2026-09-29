import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventsExecutor } from '../../apps/control-plane-executor/src/runtime/events-executor.mjs';

test('tenant events list, publish and consume cannot address the platform flow audit topic', async () => {
  const topic = 'falcone.audit.flow-lifecycle';
  const sent = [];
  const subscribed = [];
  const kafka = {
    admin: () => ({ connect: async () => {}, disconnect: async () => {},
      listTopics: async () => [topic, 'evt.workspace-a.orders', 'evt.workspace-b.orders'] }),
    producer: () => ({ connect: async () => {}, disconnect: async () => {},
      send: async (request) => { sent.push(request.topic); return []; } }),
    consumer: () => ({ connect: async () => {}, disconnect: async () => {},
      subscribe: async ({ topic: name }) => { subscribed.push(name); },
      run: async ({ eachMessage }) => eachMessage({ message: { value: Buffer.from('ok'), offset: '0' } }) }),
  };
  const executor = createEventsExecutor({ brokers: 'unused:9092', kafka });
  const identity = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  try {
    const list = await executor.executeEvents({ operation: 'list_topics', identity });
    assert.deepEqual(list.items, [{ topic: 'orders' }]);
    await executor.executeEvents({ operation: 'publish', identity, topic, payload: { value: 'forged' } });
    await executor.executeEvents({ operation: 'consume', identity, topic, payload: { maxMessages: 1 } });
    assert.deepEqual(sent, [`evt.workspace-a.${topic}`]);
    assert.deepEqual(subscribed, [`evt.workspace-a.${topic}`]);
    assert.ok(!sent.includes(topic) && !subscribed.includes(topic));
  } finally {
    await executor.close();
  }
});
