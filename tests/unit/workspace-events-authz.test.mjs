import test from 'node:test';
import assert from 'node:assert/strict';
import { KAFKA_HANDLERS, __setKafkaHandlersTestHooks, __resetKafkaHandlersTestHooks } from '../../apps/control-plane/kafka-handlers.mjs';
import { resolveEffectiveLimit } from '../../packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs';
import { evaluateQuotaDecision } from '../../packages/provisioning-orchestrator/src/models/quota-enforcement.mjs';

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

test('bound topic listing uses the same request store as workspace resolution', async (t) => {
  await setup(t);
  const request = ctx('workspace_viewer', ['ws2']);
  request.store = {
    getWorkspace: async () => ws,
    listTopicsForWorkspace: async () => [{ ...topic, topic_name: 'request-orders' }],
  };
  const result = await KAFKA_HANDLERS.eventsListTopics(request);
  assert.deepEqual(result, { statusCode: 200, body: { items: [
    { topic: 'request-orders', partitions: undefined, resourceId: 'topic-prod', topicName: 'request-orders' },
  ] } });
});

test('authorized topic provisioning persists through the request store', async (t) => {
  await __setKafkaHandlersTestHooks({
    kafka: { admin: () => ({ connect: async () => {}, disconnect: async () => {}, createTopics: async () => true }) },
    store: { insertTopic: async () => ({ ...topic, id: 'fallback-topic' }) },
  });
  t.after(__resetKafkaHandlersTestHooks);
  const request = ctx('tenant_owner', []);
  request.body = { name: 'orders', partitions: 2 };
  request.store = {
    getWorkspace: async () => ws,
    insertTopic: async () => ({ ...topic, id: 'request-topic' }),
  };
  const result = await KAFKA_HANDLERS.eventsProvisionTopic(request);
  assert.deepEqual(result, { statusCode: 201, body: {
    resourceId: 'request-topic', topic: 'orders', topicName: 'orders', physicalTopicName: 'evt.ws2.orders',
    partitionCount: 2, partitions: 2, status: 'active',
  }, auditScope: { tenantId: 'T', workspaceId: 'ws2' } });
});

test('topic provisioning applies request-store usage before contacting Kafka', async (t) => {
  const calls = [];
  await __setKafkaHandlersTestHooks({
    kafka: { admin: () => ({
      connect: async () => { calls.push('Kafka connection'); }, disconnect: async () => {}, createTopics: async () => true,
    }) },
    store: { countTenantTopics: async () => 0 },
  });
  t.after(__resetKafkaHandlersTestHooks);
  const request = ctx('tenant_owner', []);
  request.body = { name: 'orders' };
  request.store = {
    getWorkspace: async () => ws,
    countTenantTopics: async () => 1,
    insertTopic: async () => { calls.push('topic persistence'); return topic; },
  };
  request.pool.query = async (sql) => {
    if (sql.includes('FROM tenant_plan_assignments')) return { rows: [{ quota_dimensions: { max_kafka_topics: 1 } }] };
    if (sql.includes('FROM quota_dimension_catalog')) return { rows: [
      { dimension_key: 'max_kafka_topics', display_label: 'Kafka topics', unit: 'count', default_value: -1 },
    ] };
    if (sql.includes('FROM quota_overrides')) return { rows: [] };
    throw new Error('unexpected quota database query');
  };
  request.quotaOptions = { load: async () => ({ resolveEffectiveLimit, evaluateQuotaDecision }) };
  request.recordQuotaEnforcement = async () => {};
  const result = await KAFKA_HANDLERS.eventsProvisionTopic(request);
  assert.deepEqual(result, { statusCode: 402, body: {
    code: 'QUOTA_EXCEEDED', message: 'quota reached (max_kafka_topics): 1/1',
  }, auditScope: { tenantId: 'T', workspaceId: 'ws2' } });
  assert.deepEqual(calls, []);
});
