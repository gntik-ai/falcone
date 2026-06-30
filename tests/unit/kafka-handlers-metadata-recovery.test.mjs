import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __resetKafkaHandlersTestHooks,
  __setKafkaHandlersTestHooks,
  isStaleKafkaMetadataError,
  KAFKA_HANDLERS
} from '../../deploy/kind/control-plane/kafka-handlers.mjs';

test.afterEach(async () => {
  await __resetKafkaHandlersTestHooks();
});

function staleMetadataError(message = 'This server does not host this topic-partition') {
  return Object.assign(new Error(message), { type: 'UNKNOWN_TOPIC_OR_PARTITION', code: 3 });
}

function makeProducer(send) {
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

function makeAdmin(createTopics) {
  const calls = { connect: 0, disconnect: 0, createTopics: [] };
  return {
    calls,
    async connect() { calls.connect += 1; },
    async disconnect() { calls.disconnect += 1; },
    async createTopics(request) {
      calls.createTopics.push(request);
      return createTopics(request);
    }
  };
}

function makeKafka({ producers = [], admins = [] } = {}) {
  return {
    producer() {
      const next = producers.shift();
      assert.ok(next, 'unexpected producer allocation');
      return next;
    },
    admin() {
      const next = admins.shift();
      assert.ok(next, 'unexpected admin allocation');
      return next;
    }
  };
}

function tenantOwnerContext(overrides = {}) {
  return {
    pool: {},
    identity: { actorType: 'tenant_owner', tenantId: 'ten_1' },
    params: {},
    body: {},
    ...overrides
  };
}

test('stale Kafka metadata errors include broker topic-partition host and leader failures', () => {
  assert.equal(isStaleKafkaMetadataError(staleMetadataError()), true);
  assert.equal(isStaleKafkaMetadataError(Object.assign(new Error('leader not available'), { type: 'LEADER_NOT_AVAILABLE', code: 5 })), true);
  assert.equal(isStaleKafkaMetadataError(Object.assign(new Error('not leader for partition'), { type: 'NOT_LEADER_FOR_PARTITION', code: 6 })), true);
  assert.equal(isStaleKafkaMetadataError(new Error('authorization failed')), false);
});

test('eventsTopicPublish reconnects the cached producer and accepts publish after stale metadata', async () => {
  const firstProducer = makeProducer(async () => {
    throw staleMetadataError();
  });
  const secondProducer = makeProducer(async () => [{ partition: 2 }]);
  await __setKafkaHandlersTestHooks({
    kafka: makeKafka({ producers: [firstProducer, secondProducer] }),
    store: {
      async getTopicByResourceId(_pool, topicId) {
        assert.equal(topicId, 'res_topic_1');
        return {
          id: 'res_topic_1',
          workspace_id: 'ws_1',
          tenant_id: 'ten_1',
          topic_name: 'orders',
          physical_topic_name: 'evt.ws_1.orders',
          partitions: 1,
          created_at: '2026-06-30T00:00:00.000Z'
        };
      }
    }
  });

  const response = await KAFKA_HANDLERS.eventsTopicPublish(tenantOwnerContext({
    params: { topicId: 'res_topic_1' },
    body: {
      key: 'order-1',
      payload: { orderId: 1 },
      eventType: 'order.created',
      contentType: 'application/json'
    }
  }));

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.status, 'accepted');
  assert.equal(response.body.acceptedPartition, 2);
  assert.equal(firstProducer.calls.connect, 1);
  assert.equal(firstProducer.calls.send.length, 1);
  assert.equal(firstProducer.calls.disconnect, 1);
  assert.equal(secondProducer.calls.connect, 1);
  assert.equal(secondProducer.calls.send.length, 1);
  assert.equal(secondProducer.calls.send[0].topic, 'evt.ws_1.orders');
  assert.equal(secondProducer.calls.send[0].messages[0].key, 'order-1');
  assert.equal(secondProducer.calls.send[0].messages[0].headers.eventType, 'order.created');
});

test('eventsTopicPublish preserves non-stale Kafka failures as PUBLISH_FAILED without retry', async () => {
  const producer = makeProducer(async () => {
    throw new Error('authorization failed');
  });
  await __setKafkaHandlersTestHooks({
    kafka: makeKafka({ producers: [producer] }),
    store: {
      async getTopicByResourceId() {
        return {
          id: 'res_topic_1',
          workspace_id: 'ws_1',
          tenant_id: 'ten_1',
          topic_name: 'orders',
          physical_topic_name: 'evt.ws_1.orders',
          partitions: 1
        };
      }
    }
  });

  const response = await KAFKA_HANDLERS.eventsTopicPublish(tenantOwnerContext({
    params: { topicId: 'res_topic_1' },
    body: { payload: { orderId: 1 } }
  }));

  assert.equal(response.statusCode, 502);
  assert.equal(response.body.code, 'PUBLISH_FAILED');
  assert.match(response.body.message, /authorization failed/);
  assert.equal(producer.calls.connect, 1);
  assert.equal(producer.calls.send.length, 1);
  assert.equal(producer.calls.disconnect, 0);
});

test('eventsProvisionTopic reconnects the cached admin and creates topic after leader metadata failure', async () => {
  const firstAdmin = makeAdmin(async () => {
    throw Object.assign(new Error('LEADER_NOT_AVAILABLE'), { type: 'LEADER_NOT_AVAILABLE', code: 5 });
  });
  const secondAdmin = makeAdmin(async () => true);
  const inserted = [];
  await __setKafkaHandlersTestHooks({
    kafka: makeKafka({ admins: [firstAdmin, secondAdmin] }),
    store: {
      async getWorkspace(_pool, workspaceId) {
        assert.equal(workspaceId, 'ws_1');
        return { id: 'ws_1', tenant_id: 'ten_1', slug: 'alpha' };
      },
      async insertTopic(_pool, row) {
        inserted.push(row);
        return {
          id: row.id,
          workspace_id: row.workspaceId,
          tenant_id: row.tenantId,
          topic_name: row.topicName,
          physical_topic_name: row.physicalTopicName,
          partitions: row.partitions,
          created_at: '2026-06-30T00:00:00.000Z'
        };
      }
    }
  });

  const response = await KAFKA_HANDLERS.eventsProvisionTopic(tenantOwnerContext({
    params: { workspaceId: 'ws_1' },
    body: { name: 'Orders Created', partitions: 3 }
  }));

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.topicName, 'orders-created');
  assert.equal(response.body.physicalTopicName, 'evt.ws_1.orders-created');
  assert.equal(response.body.partitionCount, 3);
  assert.equal(firstAdmin.calls.connect, 1);
  assert.equal(firstAdmin.calls.createTopics.length, 1);
  assert.equal(firstAdmin.calls.disconnect, 1);
  assert.equal(secondAdmin.calls.connect, 1);
  assert.equal(secondAdmin.calls.createTopics.length, 1);
  assert.deepEqual(secondAdmin.calls.createTopics[0], {
    topics: [{ topic: 'evt.ws_1.orders-created', numPartitions: 3, replicationFactor: 1 }],
    waitForLeaders: true
  });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].physicalTopicName, 'evt.ws_1.orders-created');
});
