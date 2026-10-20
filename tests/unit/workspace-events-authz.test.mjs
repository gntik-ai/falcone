import test from 'node:test';
import assert from 'node:assert/strict';
import { KAFKA_HANDLERS, __setKafkaHandlersTestHooks, __resetKafkaHandlersTestHooks } from '../../apps/control-plane/kafka-handlers.mjs';

const ws = { id: 'ws2', tenant_id: 'T' };
const topic = { id: 'topic-prod', workspace_id: 'ws2', tenant_id: 'T', topic_name: 'orders', physical_topic_name: 'evt.ws2.orders' };
function ctx(role = 'tenant_developer', workspaceIds = ['ws1']) {
  return { identity: { actorType: 'tenant_member', tenantId: 'T', roles: [role], workspaceIds },
    pool: {}, params: { workspaceId: 'ws2', topicId: 'topic-prod', topic: 'orders' }, body: {}, query: {} };
}
async function setup(t) {
  const calls = [];
  await __setKafkaHandlersTestHooks({ store: {
    getWorkspace: async () => ws, getTopicByResourceId: async () => topic,
    listTopicsForWorkspace: async () => { calls.push('topic listing'); return [topic]; },
  }, kafka: { admin() { calls.push('kafka admin'); throw new Error('Kafka after denial'); } } });
  t.after(__resetKafkaHandlersTestHooks);
  return calls;
}

test('development binding cannot enumerate production topics or reach Kafka admin', async (t) => {
  const calls = await setup(t);
  const result = await KAFKA_HANDLERS.eventsInventory(ctx());
  assert.deepEqual(result, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace ws2 not found' } });
  assert.deepEqual(calls, []);
});

test('topic ids cannot bypass workspace authority, including the SSE route', async (t) => {
  const calls = await setup(t);
  for (const name of ['eventsTopicDetail', 'eventsTopicAccess', 'eventsTopicMetadata', 'eventsTopicPublish']) {
    const result = await KAFKA_HANDLERS[name](ctx());
    assert.deepEqual(result, { statusCode: 404, body: { code: 'TOPIC_NOT_FOUND', message: 'topic topic-prod not found' } }, name);
  }
  let status, body;
  await KAFKA_HANDLERS.eventsTopicStream(ctx(), { writeHead: (s) => { status = s; }, end: (s) => { body = JSON.parse(s); } });
  assert.equal(status, 404);
  assert.deepEqual(body, { code: 'TOPIC_NOT_FOUND', message: 'topic topic-prod not found' });
  assert.deepEqual(calls, []);
});

test('bound topic readers and verified tenant administrators retain the topic collection', async (t) => {
  const calls = await setup(t);
  for (const [role, bindings] of [['workspace_viewer', ['ws2']], ['tenant_viewer', ['ws2']], ['tenant_owner', []], ['tenant_admin', []]]) {
    const result = await KAFKA_HANDLERS.eventsListTopics(ctx(role, bindings));
    assert.deepEqual(result, { statusCode: 200, body: { items: [{ topic: 'orders', partitions: undefined, resourceId: 'topic-prod', topicName: 'orders' }] } });
  }
  assert.equal(calls.includes('kafka admin'), false);
});
