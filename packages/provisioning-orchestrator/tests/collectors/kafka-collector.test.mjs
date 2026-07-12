import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Set env before import
process.env.CONFIG_EXPORT_KAFKA_BROKERS = 'localhost:9092';

const { collect } = await import('../../src/collectors/kafka-collector.mjs');

function mockKafkaAdmin({ topics = [], acls = [], groups = [] } = {}) {
  return {
    connect: async () => {},
    disconnect: async () => {},
    fetchTopicMetadata: async () => ({ topics }),
    describeConfigs: async () => ({ resources: [{ configEntries: [] }] }),
    describeAcls: async () => ({ resources: acls }),
    listGroups: async () => ({ groups }),
    describeGroups: async (ids) => ({
      groups: ids.map(id => ({ groupId: id, state: 'Stable', members: [{}] })),
    }),
  };
}

describe('kafka-collector', () => {
  it('filters topics by tenant prefix only', async () => {
    const admin = mockKafkaAdmin({
      topics: [
        { name: 'tenantA.orders', partitions: [{ replicas: [0, 1] }] },
        { name: 'tenantA.events', partitions: [{ replicas: [0] }] },
        { name: 'tenantB.orders', partitions: [{ replicas: [0] }] },
      ],
    });

    const result = await collect('tenantA', { kafkaAdmin: admin });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.topics.length, 2);
    assert.ok(result.data.topics.every(t => t.name.startsWith('tenantA.')));
  });

  it('filters ACLs by tenant prefix', async () => {
    const admin = mockKafkaAdmin({
      topics: [{ name: 'tenantA.events', partitions: [{ replicas: [0] }] }],
      acls: [
        { resourceName: 'tenantA.events', acls: [{ principal: 'User:app', operation: 'Read', permissionType: 'Allow', host: '*' }] },
        { resourceName: 'tenantB.orders', acls: [{ principal: 'User:app', operation: 'Write', permissionType: 'Allow', host: '*' }] },
      ],
    });

    const result = await collect('tenantA', { kafkaAdmin: admin });
    assert.equal(result.data.acls.length, 1);
    assert.ok(result.data.acls[0].resource.startsWith('tenantA.'));
  });

  it('filters consumer groups by tenant cg prefix', async () => {
    const admin = mockKafkaAdmin({
      topics: [{ name: 'tenantA.events', partitions: [{ replicas: [0] }] }],
      groups: [
        { groupId: 'tenantA.cg.main', protocolType: 'consumer' },
        { groupId: 'tenantB.cg.main', protocolType: 'consumer' },
      ],
    });

    const result = await collect('tenantA', { kafkaAdmin: admin });
    assert.equal(result.data.consumer_groups.length, 1);
    assert.equal(result.data.consumer_groups[0].group_id, 'tenantA.cg.main');
  });

  it('returns empty when no tenant topics found', async () => {
    const admin = mockKafkaAdmin({
      topics: [{ name: 'other.events', partitions: [{ replicas: [0] }] }],
    });

    const result = await collect('tenantA', { kafkaAdmin: admin });
    assert.equal(result.status, 'empty');
    assert.equal(result.items_count, 0);
  });

  it('returns error on connect failure', async () => {
    const admin = {
      connect: async () => { throw new Error('Broker not available'); },
      disconnect: async () => {},
      fetchTopicMetadata: async () => { throw new Error('not connected'); },
      describeAcls: async () => ({ resources: [] }),
      listGroups: async () => ({ groups: [] }),
    };

    // Since we pass kafkaAdmin directly, the connect() is not called by our code
    // Simulate failure at fetchTopicMetadata level
    const badAdmin = {
      fetchTopicMetadata: async () => { throw new Error('Broker not available'); },
      describeAcls: async () => ({ resources: [] }),
      listGroups: async () => ({ groups: [] }),
    };

    const result = await collect('tenantA', { kafkaAdmin: badAdmin });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('Broker not available'));
  });
});
