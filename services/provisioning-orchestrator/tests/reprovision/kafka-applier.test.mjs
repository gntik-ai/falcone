import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/appliers/kafka-applier.mjs';

function mockKafkaAdmin(existingTopics = [], topicMeta = {}, configs = {}, acls = {}) {
  const calls = [];
  return {
    calls,
    kafkaAdmin: {
      listTopics: async () => { calls.push('listTopics'); return existingTopics; },
      createTopics: async (opts) => { calls.push({ createTopics: opts }); },
      fetchTopicMetadata: async ({ topics }) => {
        calls.push({ fetchTopicMetadata: topics });
        return {
          topics: topics.map(t => ({
            name: t,
            partitions: topicMeta[t]?.partitions ?? [],
          })),
        };
      },
      describeConfigs: async ({ resources }) => {
        calls.push('describeConfigs');
        return { resources: resources.map(r => ({ configEntries: configs[r.name] ?? [] })) };
      },
      describeAcls: async (filter) => {
        calls.push({ describeAcls: filter });
        const key = `${filter.principal}/${filter.operation}`;
        return { resources: acls[key] ? [acls[key]] : [] };
      },
      createAcls: async (opts) => { calls.push({ createAcls: opts }); },
    },
  };
}

test('kafka-applier: empty domain returns applied', async () => {
  const result = await apply('tenant-1', null, { dryRun: false, credentials: {} });
  assert.equal(result.status, 'applied');
});

test('kafka-applier: creates non-existing topic', async () => {
  const mock = mockKafkaAdmin();
  const domainData = { topics: [{ name: 'events', numPartitions: 3 }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kafkaAdmin: mock.kafkaAdmin } });
  assert.equal(result.resource_results[0].action, 'created');
  assert.ok(mock.calls.some(c => c.createTopics));
});

test('kafka-applier: skips existing topic with same config', async () => {
  const mock = mockKafkaAdmin(['events'], { events: { partitions: [1, 2, 3] } });
  const domainData = { topics: [{ name: 'events', numPartitions: 3 }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kafkaAdmin: mock.kafkaAdmin } });
  assert.equal(result.resource_results[0].action, 'skipped');
});

test('kafka-applier: reports conflict for different partition count', async () => {
  const mock = mockKafkaAdmin(['events'], { events: { partitions: [1, 2] } });
  const domainData = { topics: [{ name: 'events', numPartitions: 5 }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kafkaAdmin: mock.kafkaAdmin } });
  assert.equal(result.resource_results[0].action, 'conflict');
});

test('kafka-applier: dry run does not create', async () => {
  const mock = mockKafkaAdmin();
  const domainData = { topics: [{ name: 'events' }] };
  const result = await apply('tenant-1', domainData, { dryRun: true, credentials: { kafkaAdmin: mock.kafkaAdmin } });
  assert.equal(result.resource_results[0].action, 'would_create');
  assert.ok(!mock.calls.some(c => c.createTopics));
});

test('kafka-applier: consumer groups are always skipped', async () => {
  const mock = mockKafkaAdmin();
  const domainData = { consumer_groups: [{ groupId: 'cg1' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kafkaAdmin: mock.kafkaAdmin } });
  assert.equal(result.resource_results[0].action, 'skipped');
});

test('kafka-applier: redacted value produces applied_with_warnings', async () => {
  const mock = mockKafkaAdmin();
  const domainData = { topics: [{ name: 'events', secret: '***REDACTED***' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { kafkaAdmin: mock.kafkaAdmin } });
  assert.equal(result.resource_results[0].action, 'applied_with_warnings');
});
