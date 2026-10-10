import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetKafkaHandlersTestHooks,
  __setKafkaHandlersTestHooks,
  KAFKA_HANDLERS
} from '../../apps/control-plane/kafka-handlers.mjs';

const topic = {
  id: 'res_topic_1', workspace_id: 'ws_1', tenant_id: 'ten_1',
  topic_name: 'orders', physical_topic_name: 'evt.ws_1.orders'
};
const routes = [
  ['eventsTopicPublish', { topicId: topic.id }],
  ['eventsWorkspaceTopicPublish', { workspaceId: topic.workspace_id, topic: topic.topic_name }]
];
const owner = { actorType: 'tenant_owner', tenantId: topic.tenant_id, sub: 'owner_1' };

test.afterEach(__resetKafkaHandlersTestHooks);

async function publish(handler, params, body, identity = owner) {
  const calls = { allocated: 0, connected: 0, sent: [] };
  await __setKafkaHandlersTestHooks({
    store: {
      async getTopicByResourceId() { return topic; },
      async getWorkspace() { return { id: topic.workspace_id, tenant_id: topic.tenant_id }; },
      async listTopicsForWorkspace() { return [topic]; }
    },
    kafka: {
      producer() {
        calls.allocated += 1;
        return {
          async connect() { calls.connected += 1; },
          async disconnect() {},
          async send(request) {
            calls.sent.push(request);
            return [{ partition: 0, baseOffset: '7' }];
          }
        };
      }
    }
  });
  const response = await KAFKA_HANDLERS[handler]({ pool: {}, identity, params, body });
  return { response, calls };
}

for (const [handler, params] of routes) {
  for (const [name, body] of [
    ['empty object', {}],
    ['messages batch', { messages: [{ key: 'k', value: {} }] }],
    ['records batch', { records: [] }],
    ['data wrapper', { data: { a: 1 } }],
    ['message wrapper', { message: 'x' }],
    ['missing body', undefined],
    ['null body', null],
    ['inherited payload', Object.create({ payload: {} })],
    ['inherited value', Object.create({ value: {} })]
  ]) {
    test(`fix-1009-01: ${handler} rejects ${name} before allocating a producer`, async () => {
      const { response, calls } = await publish(handler, params, body);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.match(response.body.message, /payload/);
      assert.deepEqual(calls, { allocated: 0, connected: 0, sent: [] });
    });
  }

  for (const [name, body] of [
    ['null payload', { payload: null }],
    ['undefined payload', { payload: undefined }],
    ['null value', { value: null }],
    ['undefined value', { value: undefined }],
    ['null payload with usable value', { payload: null, value: 'must not be used' }],
    ['undefined payload with usable value', { payload: undefined, value: {} }]
  ]) {
    test(`fix-1009-02: ${handler} rejects ${name} before allocating a producer`, async () => {
      const { response, calls } = await publish(handler, params, body);
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.match(response.body.message, /payload/);
      assert.deepEqual(calls, { allocated: 0, connected: 0, sent: [] });
    });
  }

  for (const [name, body, expectedValue, expectedSize] of [
    ['object payload', { payload: { probe: 'positive-control' } }, '{"probe":"positive-control"}', 28],
    ['raw text payload', { payload: 'raw text: café' }, 'raw text: café', 15],
    ['blank payload', { payload: '' }, '', 0],
    ['explicit empty object', { payload: {} }, '{}', 2],
    ['explicit empty JSON string', { payload: '{}' }, '{}', 2],
    ['payload precedence', { payload: 'chosen', value: 'ignored' }, 'chosen', 6],
    ['compatibility object', { value: { amount: 10 } }, '{"amount":10}', 13],
    ['compatibility string', { value: 'raw' }, 'raw', 3],
    ['compatibility empty object', { value: {} }, '{}', 2],
    ['compatibility empty JSON string', { value: '{}' }, '{}', 2],
    ['false payload', { payload: false }, 'false', 5],
    ['zero payload', { payload: 0 }, '0', 1]
  ]) {
    test(`fix-1009-03: ${handler} preserves caller-supplied ${name}`, async () => {
      const { response, calls } = await publish(handler, params, {
        ...body, key: 'probe-1', eventType: 'probe', contentType: 'application/json'
      });
      assert.equal(response.statusCode, 202);
      assert.equal(response.body.status, 'accepted');
      assert.equal(response.body.payloadSizeBytes, expectedSize);
      assert.equal(Buffer.byteLength(expectedValue), expectedSize);
      assert.deepEqual(calls, {
        allocated: 1, connected: 1,
        sent: [{ topic: topic.physical_topic_name, messages: [{
          key: 'probe-1', value: expectedValue,
          headers: { eventType: 'probe', contentType: 'application/json' }
        }] }]
      });
    });
  }

  test(`fix-1009-04: ${handler} denies an empty publish before payload validation`, async () => {
    const { response, calls } = await publish(handler, params, {}, {
      actorType: 'tenant_member', tenantId: topic.tenant_id, sub: 'viewer_1'
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, 'FORBIDDEN');
    assert.deepEqual(calls, { allocated: 0, connected: 0, sent: [] });
  });
}
