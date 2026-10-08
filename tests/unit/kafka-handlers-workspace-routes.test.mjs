import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  __resetKafkaHandlersTestHooks,
  __setKafkaHandlersTestHooks,
  KAFKA_HANDLERS
} from '../../apps/control-plane/kafka-handlers.mjs';
import { routes } from '../../apps/control-plane/routes.mjs';

const runtimeRouteMap = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));
const fullRouteMap = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.json', import.meta.url), 'utf8'));

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

function fakeConsumer(messages, { joinDelay = 0, neverJoin = false, runError, connectError, disconnectPending = false } = {}) {
  const calls = { connect: 0, disconnect: 0, subscribe: [], run: 0 };
  const listeners = new Map();
  return {
    calls,
    events: { GROUP_JOIN: 'groupJoin', CRASH: 'crash' },
    on(event, listener) {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
    emit(event, payload = {}) { listeners.get(event)?.({ payload }); },
    async connect() { calls.connect += 1; if (connectError) throw connectError; },
    async disconnect() {
      calls.disconnect += 1;
      if (disconnectPending) await new Promise(() => {});
    },
    async subscribe(request) { calls.subscribe.push(request); },
    async run({ eachMessage }) {
      calls.run += 1;
      if (runError) throw runError;
      if (neverJoin) return;
      if (joinDelay) await new Promise((resolve) => setTimeout(resolve, joinDelay));
      if (calls.disconnect) return;
      this.emit(this.events.GROUP_JOIN);
      for (const item of messages) {
        if (item.delay) await new Promise((resolve) => setTimeout(resolve, item.delay));
        if (calls.disconnect) return;
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

function fakeAdmin(offsets = [{ partition: 2, low: '12', high: '14' }]) {
  const calls = { fetchTopicOffsets: [] };
  return {
    calls,
    async connect() {},
    async disconnect() {},
    async fetchTopicOffsets(topic) { calls.fetchTopicOffsets.push(topic); return offsets; }
  };
}

function fakeKafka({ producer, consumer, admin = fakeAdmin() } = {}) {
  return {
    admin() { return admin; },
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
  assert.equal(response.body.status, 'complete');
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

const consumeCtx = (query = {}) => ownerCtx({ params: { workspaceId: 'ws_1', topic: 'orders' }, query });
const nonemptyOffsets = [{ partition: 0, low: '0', high: '3' }];
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

async function installConsumeFake(consumer, offsets = nonemptyOffsets) {
  const admin = fakeAdmin(offsets);
  await __setKafkaHandlersTestHooks({ kafka: fakeKafka({ consumer, admin }), store: storeWithTopic() });
  return admin;
}

test('fix-955: the default read window begins after a join longer than 3000ms', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const consumer = fakeConsumer([
    { value: { seq: 1 }, offset: '0', delay: 1500 },
    { value: { seq: 2 }, offset: '1' },
    { value: { seq: 3 }, offset: '2' }
  ], { joinDelay: 3500 });
  const admin = await installConsumeFake(consumer);
  let settled = false;
  const request = KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx()).then((r) => { settled = true; return r; });
  await flush();
  t.mock.timers.tick(3500);
  await flush();
  assert.equal(settled, false);
  t.mock.timers.tick(1499);
  await flush();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  const response = await request;
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'complete');
  assert.deepEqual(response.body.items.map((item) => item.value), [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  assert.deepEqual(admin.calls.fetchTopicOffsets, ['evt.ws_1.orders']);
  assert.equal(consumer.calls.disconnect, 1);
});

test('fix-955: empty retained partitions return immediately without allocating a consumer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  await installConsumeFake(undefined, [
    { partition: 0, low: '0', high: '0' },
    { partition: 1, low: '9007199254740993', high: '9007199254740993' }
  ]);
  const before = Date.now();
  const response = await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx());
  assert.deepEqual(response, { statusCode: 200, body: { items: [], status: 'empty' } });
  assert.equal(Date.now(), before);
});

test('fix-955: never joining returns an assignment timeout and disconnects once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const consumer = fakeConsumer([], { neverJoin: true });
  await installConsumeFake(consumer);
  const request = KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx());
  await flush();
  t.mock.timers.tick(10000);
  assert.deepEqual(await request, { statusCode: 200, body: { items: [], status: 'timeout', reason: 'assignment' } });
  assert.equal(consumer.calls.disconnect, 1);
});

for (const messages of [[], [{ value: 'partial', offset: '0' }]]) {
  test(`fix-955: read timeout preserves ${messages.length} partial messages`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const consumer = fakeConsumer(messages);
    await installConsumeFake(consumer);
    const request = KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx({ timeoutMs: '100' }));
    await flush();
    t.mock.timers.tick(100);
    const response = await request;
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.status, 'timeout');
    assert.equal(response.body.reason, 'read');
    assert.equal(response.body.items.length, messages.length);
    assert.equal(consumer.calls.disconnect, 1);
  });
}

test('fix-955: finishes at all snapshot high-water marks without waiting or including newer messages', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const consumer = fakeConsumer([
    { partition: 0, offset: '9007199254740993', value: 'old' },
    { partition: 0, offset: '9007199254740994', value: 'new' },
    { partition: 1, offset: '7', value: 'other partition' }
  ]);
  await installConsumeFake(consumer, [
    { partition: 0, low: '9007199254740993', high: '9007199254740994' },
    { partition: 1, low: '7', high: '8' },
    { partition: 2, low: '2', high: '2' }
  ]);
  const before = Date.now();
  const response = await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx());
  assert.equal(response.body.status, 'complete');
  assert.deepEqual(response.body.items.map((item) => item.value), ['old', 'other partition']);
  assert.equal(Date.now(), before);
  assert.equal(consumer.calls.disconnect, 1);
});

test('fix-955: maxMessages stops the bounded sample before the snapshot ends', async () => {
  const consumer = fakeConsumer([{ offset: '0' }, { offset: '1' }, { offset: '2' }]);
  await installConsumeFake(consumer);
  const response = await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx({ maxMessages: '1' }));
  assert.equal(response.body.status, 'complete');
  assert.equal(response.body.items.length, 1);
  assert.equal(consumer.calls.disconnect, 1);
});

for (const phase of ['connectError', 'runError']) {
  test(`fix-955: ${phase} returns an error and disconnects once`, async () => {
    const consumer = fakeConsumer([], { [phase]: new Error('consumer failed') });
    await installConsumeFake(consumer);
    const response = await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx());
    assert.equal(response.statusCode, 502);
    assert.equal(response.body.code, 'CONSUME_FAILED');
    assert.equal(consumer.calls.disconnect, 1);
  });
}

test('fix-955: consumer crashes end the read and disconnect once', async () => {
  const consumer = fakeConsumer([]);
  await installConsumeFake(consumer);
  const request = KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx());
  await flush();
  consumer.emit(consumer.events.CRASH, { error: new Error('consumer crashed') });
  const response = await request;
  assert.equal(response.statusCode, 502);
  assert.equal(response.body.code, 'CONSUME_FAILED');
  assert.equal(consumer.calls.disconnect, 1);
});

test('fix-955: disconnect cannot extend the total default Kafka deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const consumer = fakeConsumer([{ offset: '2' }], { disconnectPending: true });
  await installConsumeFake(consumer);
  let settled = false;
  const request = KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx()).then((r) => { settled = true; return r; });
  await flush();
  assert.equal(consumer.calls.disconnect, 1);
  t.mock.timers.tick(12999);
  await flush();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  assert.equal((await request).body.status, 'complete');
  assert.equal(consumer.calls.disconnect, 1);
});

test('fix-955: a stalled consumer connection is bounded and disconnected', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const consumer = fakeConsumer([]);
  let connected;
  consumer.connect = () => new Promise((resolve) => { connected = resolve; });
  await installConsumeFake(consumer);
  const request = KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx());
  await flush();
  t.mock.timers.tick(13000);
  assert.equal((await request).body.reason, 'assignment');
  assert.equal(consumer.calls.run, 0);
  connected();
  await flush();
  assert.equal(consumer.calls.disconnect, 1);
  assert.deepEqual(consumer.calls.subscribe, []);
});

test('fix-955: stalled metadata cannot allocate a consumer after timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveOffsets;
  const admin = fakeAdmin();
  admin.fetchTopicOffsets = () => new Promise((resolve) => { resolveOffsets = resolve; });
  await __setKafkaHandlersTestHooks({ kafka: fakeKafka({ admin }), store: storeWithTopic() });
  const request = KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx());
  await flush();
  t.mock.timers.tick(10000);
  assert.equal((await request).body.status, 'timeout');
  resolveOffsets(nonemptyOffsets);
  await flush();
});

for (const [key, value] of [
  ['limit', '10'], ['offset', '0'], ['groupId', 'x'], ['fromBeginning', 'true'],
  ['timeoutMs', 'abc'], ['timeoutMs', '99'], ['timeoutMs', '30001'],
  ['maxMessages', '0'], ['maxMessages', '1000'], ['maxMessages', 'abc'],
  ['maxMessages', ''], ['maxMessages', '-1'], ['maxMessages', '1.5'], ['maxMessages', ['10']],
  ['timeoutMs', 'Infinity'], ['timeoutMs', '1e3'], ['timeoutMs', ' 100 ']
]) {
  test(`fix-955: rejects ${key}=${value} before contacting Kafka`, async () => {
    await __setKafkaHandlersTestHooks({
      kafkaFactory() { assert.fail('invalid queries must not contact Kafka'); },
      store: storeWithTopic()
    });
    const response = await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx({ [key]: value }));
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
    assert.ok(response.body.message.includes(key));
  });
}

for (const query of [{ maxMessages: '1', timeoutMs: '100' }, { maxMessages: '100', timeoutMs: '30000' }]) {
  test(`fix-955: accepts inclusive bounds ${JSON.stringify(query)}`, async () => {
    await installConsumeFake(undefined, [{ partition: 0, low: '0', high: '0' }]);
    assert.equal((await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx(query))).body.status, 'empty');
  });
}

test('fix-955: foreign workspace consume returns 404 before topic lookup, validation or Kafka', async () => {
  const store = storeWithTopic({ workspace: { id: 'ws_1', tenant_id: 'ten_other' } });
  await __setKafkaHandlersTestHooks({
    kafkaFactory() { assert.fail('foreign workspaces must not contact Kafka'); },
    store
  });
  const response = await KAFKA_HANDLERS.eventsWorkspaceTopicMessages(consumeCtx({ limit: '10' }));
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, 'WORKSPACE_NOT_FOUND');
  assert.deepEqual(store.calls, [['getWorkspace', 'ws_1']]);
});
