import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  __resetKafkaHandlersTestHooks,
  __setKafkaHandlersTestHooks,
  KAFKA_HANDLERS
} from '../../deploy/kind/control-plane/kafka-handlers.mjs';
import { routes } from '../../deploy/kind/control-plane/routes.mjs';

const runtimeRouteMap = JSON.parse(readFileSync(new URL('../../deploy/kind/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));
const fullRouteMap = JSON.parse(readFileSync(new URL('../../deploy/kind/control-plane/route-map.json', import.meta.url), 'utf8'));

test.afterEach(async () => {
  await __resetKafkaHandlersTestHooks();
});

function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

function compileRoutes(routeTable) {
  return routeTable
    .map((r) => ({ ...r, _rx: compilePath(r.path) }))
    .sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
      || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
}

function matchRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

function ownerCtx(overrides = {}) {
  return {
    pool: {},
    identity: { actorType: 'tenant_owner', tenantId: 'ten_1', sub: 'owner_1' },
    params: { workspaceId: 'ws_1' },
    query: {},
    body: {},
    ...overrides
  };
}

function topicRow(overrides = {}) {
  return {
    id: 'res_topic_1',
    workspace_id: 'ws_1',
    tenant_id: 'ten_1',
    topic_name: 'orders',
    physical_topic_name: 'evt.ws_1.orders',
    partitions: 3,
    created_at: '2026-06-30T00:00:00.000Z',
    ...overrides
  };
}

function storeWithTopic({ workspace = { id: 'ws_1', tenant_id: 'ten_1' }, topics = [topicRow()] } = {}) {
  const calls = [];
  return {
    calls,
    async getWorkspace(_pool, workspaceId) {
      calls.push(['getWorkspace', workspaceId]);
      return workspace;
    },
    async listTopicsForWorkspace(_pool, workspaceId) {
      calls.push(['listTopicsForWorkspace', workspaceId]);
      return topics;
    }
  };
}

function fakeProducer(send = async () => [{ partition: 0, baseOffset: '7' }]) {
  const calls = { connect: 0, disconnect: 0, send: [] };
  return {
    calls,
    async connect() { calls.connect += 1; },
    async disconnect() { calls.disconnect += 1; },
    async send(request) {
      calls.send.push(request);
      return send(request);
    }
  };
}

function fakeConsumer(messages) {
  const calls = { connect: 0, disconnect: 0, subscribe: [], run: 0 };
  return {
    calls,
    async connect() { calls.connect += 1; },
    async disconnect() { calls.disconnect += 1; },
    async subscribe(request) { calls.subscribe.push(request); },
    async run({ eachMessage }) {
      calls.run += 1;
      for (const item of messages) {
        await eachMessage({
          partition: item.partition ?? 0,
          message: {
            key: item.key == null ? null : Buffer.from(String(item.key)),
            value: item.value == null ? null : Buffer.from(typeof item.value === 'string' ? item.value : JSON.stringify(item.value)),
            offset: String(item.offset ?? '0'),
            timestamp: item.timestamp ?? '2026-06-30T00:00:00.000Z'
          }
        });
      }
    }
  };
}

function fakeKafka({ producer, consumer } = {}) {
  return {
    producer() {
      assert.ok(producer, 'unexpected producer allocation');
      return producer;
    },
    consumer() {
      assert.ok(consumer, 'unexpected consumer allocation');
      return consumer;
    }
  };
}

test('fix-777-00: EventsConsole workspace routes are registered and do not fall through to NO_ROUTE', () => {
  const compiled = compileRoutes(routes);
  const cases = [
    ['GET', '/v1/events/workspaces/ws_1/topics', 'eventsListTopics', '/v1/events/workspaces/{workspaceId}/topics'],
    ['POST', '/v1/events/workspaces/ws_1/topics', 'eventsProvisionTopic', '/v1/events/workspaces/{workspaceId}/topics'],
    ['POST', '/v1/events/workspaces/ws_1/topics/orders/publish', 'eventsWorkspaceTopicPublish', '/v1/events/workspaces/{workspaceId}/topics/{topic}/publish'],
    ['GET', '/v1/events/workspaces/ws_1/topics/orders/messages', 'eventsWorkspaceTopicMessages', '/v1/events/workspaces/{workspaceId}/topics/{topic}/messages']
  ];

  for (const [method, url, handler, path] of cases) {
    const hit = matchRoute(compiled, method, url);
    assert.ok(hit, `${method} ${url} must resolve to a real route`);
    assert.equal(hit.route.localHandler, handler);
    assert.equal(hit.route.auth, 'authenticated');
    assert.equal(typeof KAFKA_HANDLERS[handler], 'function');

    assert.ok(
      runtimeRouteMap.some((route) => route.method === method && route.path === path && route.localHandler === handler),
      `${method} ${path} must be present in route-map.runtime.json`
    );
    assert.ok(
      fullRouteMap.some((route) => route.method === method && route.path === path && route.invoke === 'localHandler'),
      `${method} ${path} must be present in route-map.json`
    );
  }
});

test('fix-777-01: owned workspace topics list returns the TopicRecord-compatible collection shape', async () => {
  const store = storeWithTopic({ topics: [topicRow(), topicRow({ id: 'res_topic_2', topic_name: 'payments', physical_topic_name: 'evt.ws_1.payments', partitions: 1 })] });
  await __setKafkaHandlersTestHooks({ store });

  const response = await KAFKA_HANDLERS.eventsListTopics(ownerCtx());

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.items, [
    { topic: 'orders', partitions: 3, resourceId: 'res_topic_1', topicName: 'orders' },
    { topic: 'payments', partitions: 1, resourceId: 'res_topic_2', topicName: 'payments' }
  ]);
  assert.deepEqual(store.calls, [
    ['getWorkspace', 'ws_1'],
    ['listTopicsForWorkspace', 'ws_1']
  ]);
});

test('fix-777-02: workspace logical-topic publish resolves the topic row and sends console {key,value}', async () => {
  const producer = fakeProducer();
  await __setKafkaHandlersTestHooks({
    kafka: fakeKafka({ producer }),
    store: storeWithTopic()
  });

  const response = await KAFKA_HANDLERS.eventsWorkspaceTopicPublish(ownerCtx({
    params: { workspaceId: 'ws_1', topic: 'orders' },
    body: { key: 'order-1', value: { amount: 10 } }
  }));

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.status, 'accepted');
  assert.equal(response.body.topic, 'orders');
  assert.equal(response.body.partition, 0);
  assert.equal(response.body.offset, '7');
  assert.equal(producer.calls.connect, 1);
  assert.equal(producer.calls.send.length, 1);
  assert.deepEqual(producer.calls.send[0], {
    topic: 'evt.ws_1.orders',
    messages: [{ key: 'order-1', value: '{"amount":10}', headers: {} }]
  });
});

test('fix-777-03: workspace logical-topic messages consumes a bounded fake Kafka batch', async () => {
  const consumer = fakeConsumer([
    { key: 'order-1', value: { amount: 10 }, partition: 2, offset: '12', timestamp: '2026-06-30T12:00:00.000Z' },
    { key: null, value: 'plain-text', partition: 2, offset: '13', timestamp: '2026-06-30T12:00:01.000Z' }
  ]);
  await __setKafkaHandlersTestHooks({
    kafka: fakeKafka({ consumer }),
    store: storeWithTopic()
  });

  const response = await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(ownerCtx({
    params: { workspaceId: 'ws_1', topic: 'orders' },
    query: { maxMessages: '2', timeoutMs: '1000' }
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.items, [
    { key: 'order-1', value: { amount: 10 }, partition: 2, offset: '12', timestamp: '2026-06-30T12:00:00.000Z' },
    { key: null, value: 'plain-text', partition: 2, offset: '13', timestamp: '2026-06-30T12:00:01.000Z' }
  ]);
  assert.deepEqual(consumer.calls.subscribe, [{ topic: 'evt.ws_1.orders', fromBeginning: true }]);
  assert.equal(consumer.calls.disconnect, 1);
});

test('fix-777-04: foreign workspace is hidden before topic rows are queried', async () => {
  const store = storeWithTopic({ workspace: { id: 'ws_1', tenant_id: 'ten_other' } });
  await __setKafkaHandlersTestHooks({ store });

  const response = await KAFKA_HANDLERS.eventsListTopics(ownerCtx());

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'WORKSPACE_NOT_FOUND');
  assert.deepEqual(store.calls, [['getWorkspace', 'ws_1']]);
});

test('fix-777-05: same-tenant non-admin cannot publish through the workspace topic route', async () => {
  await __setKafkaHandlersTestHooks({
    kafka: {
      producer() {
        throw new Error('producer must not be allocated for a denied publish');
      }
    },
    store: storeWithTopic()
  });

  const response = await KAFKA_HANDLERS.eventsWorkspaceTopicPublish(ownerCtx({
    identity: { actorType: 'tenant_member', tenantId: 'ten_1', sub: 'viewer_1' },
    params: { workspaceId: 'ws_1', topic: 'orders' },
    body: { value: { amount: 10 } }
  }));

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'FORBIDDEN');
});
