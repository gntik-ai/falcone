import test from 'node:test';
import assert from 'node:assert/strict';
import { KAFKA_HANDLERS, __setKafkaHandlersTestHooks, __resetKafkaHandlersTestHooks } from '../../apps/control-plane/kafka-handlers.mjs';
import { MONGO_HANDLERS } from '../../apps/control-plane/mongo-handlers.mjs';
import { defaults, load, governancePool, tenantId, workspace, identity } from '../helpers/live-quota-fixture.mjs';

function ctx(pool, body) {
  return { pool, body, workspace, identity, params: { workspaceId: workspace.id }, quotaOptions: { load }, callerContext: { correlationId: 'request-a' } };
}
function assertDenial(result, pool, key, action, usage, limit, source = 'default') {
  assert.equal(result.statusCode, 402);
  assert.equal(result.body.code, 'QUOTA_EXCEEDED');
  assert.match(result.body.message, new RegExp(`${key}.*${usage}/${limit}`));
  assert.equal(pool.logs.length, 1);
  assert.deepEqual(pool.logs[0], { tenantId, workspaceId: workspace.id, dimensionKey: key, attemptedAction: action, currentUsage: usage, effectiveLimit: limit, quotaType: 'hard', graceMargin: 0, effectiveCeiling: limit, source, decision: 'hard_blocked', actorId: 'owner', correlationId: 'request-a' });
}
async function kafkaFixture(t) {
  let connects = 0, creates = 0, writes = 0;
  await __setKafkaHandlersTestHooks({
    kafka: { admin: () => ({ connect: async () => { connects++; }, disconnect: async () => {}, createTopics: async () => { creates++; } }) },
    store: { insertTopic: async (_pool, data) => { writes++; return { id: data.id, topic_name: data.topicName, physical_topic_name: data.physicalTopicName }; } },
  });
  t.after(__resetKafkaHandlersTestHooks);
  return () => ({ connects, creates, writes });
}

test('11th topic is denied across tenant workspaces before Kafka or registry writes', async t => {
  const effects = await kafkaFixture(t);
  const pool = governancePool({ usage: 10 });
  assertDenial(await KAFKA_HANDLERS.eventsProvisionTopic(ctx(pool, { name: 'eleventh' })), pool, 'max_kafka_topics', 'topic.create', 10, 10);
  assert.deepEqual(effects(), { connects: 0, creates: 0, writes: 0 });
  const count = pool.queries.find(q => /count\(\*\).*workspace_topics/i.test(q.sql));
  assert.deepEqual(count.values, [tenantId]);
  assert.ok(!count.sql.includes('workspace_id'));
});

test('topic below limit succeeds and writes no enforcement record', async t => {
  const effects = await kafkaFixture(t);
  const pool = governancePool({ usage: 9 });
  assert.equal((await KAFKA_HANDLERS.eventsProvisionTopic(ctx(pool, { name: 'tenth' }))).statusCode, 201);
  assert.deepEqual(effects(), { connects: 1, creates: 1, writes: 1 });
  assert.equal(pool.logs.length, 0);
});

test('foreign topic workspace is denied before governance evaluation', async t => {
  const effects = await kafkaFixture(t);
  const pool = governancePool({ usage: 10, ownerTenant: 'tenant-b' });
  const call = ctx(pool, { name: 'foreign' });
  call.quotaOptions.load = () => assert.fail('must not evaluate quota');
  assert.equal((await KAFKA_HANDLERS.eventsProvisionTopic(call)).statusCode, 404);
  assert.deepEqual(effects(), { connects: 0, creates: 0, writes: 0 });
  assert.equal(pool.logs.length, 0);
});

function mongoCall(pool, name) {
  let creates = 0;
  const call = ctx(pool, { databaseName: name });
  call.mongoClient = { db: () => ({ createCollection: async () => { creates++; } }) };
  return { call, creates: () => creates };
}

test('third distinct Mongo database is refused before FerretDB or registry writes', async () => {
  const pool = governancePool({ mongoNames: ['one', 'two'] });
  const { call, creates } = mongoCall(pool, 'three');
  assertDenial(await MONGO_HANDLERS.mongoProvision(call), pool, 'max_mongo_databases', 'mongo_database.create', 2, 2);
  assert.equal(creates(), 0);
  assert.equal(pool.queries.filter(q => /INSERT INTO workspace_mongo_databases/i.test(q.sql)).length, 0);
  const count = pool.queries.find(q => /SELECT DISTINCT database_name/i.test(q.sql));
  assert.deepEqual(count.values, [tenantId]);
});

test('existing tenant Mongo database can be re-provisioned at the limit with no quota evaluation', async () => {
  const pool = governancePool({ mongoNames: ['one', 'two'] });
  const { call, creates } = mongoCall(pool, 'one');
  call.quotaOptions.load = () => assert.fail('not a new dimension unit');
  assert.equal((await MONGO_HANDLERS.mongoProvision(call)).statusCode, 201);
  assert.equal(creates(), 1);
  assert.equal(pool.logs.length, 0);
});

test('Mongo below the limit succeeds and foreign workspace is denied before metering', async () => {
  const pool = governancePool({ mongoNames: ['one'] });
  const { call, creates } = mongoCall(pool, 'two');
  assert.equal((await MONGO_HANDLERS.mongoProvision(call)).statusCode, 201);
  assert.equal(creates(), 1);
  const foreign = mongoCall(pool, 'three');
  foreign.call.workspace = { ...workspace, tenant_id: 'tenant-b' };
  foreign.call.quotaOptions.load = () => assert.fail('ownership must precede quota');
  assert.equal((await MONGO_HANDLERS.mongoProvision(foreign.call)).statusCode, 404);
  assert.equal(foreign.creates(), 0);
  assert.equal(pool.logs.length, 0);
});

for (const source of ['plan', 'override']) {
  test(`topic and Mongo gates respect ${source} at limit-1 and limit`, async t => {
    const effects = await kafkaFixture(t);
    const dimensions = { max_kafka_topics: 2, max_mongo_databases: 1 };
    const options = source === 'plan' ? { plan: dimensions } : { plan: defaults, overrides: dimensions };
    const topicBelow = governancePool({ ...options, usage: 1 });
    assert.equal((await KAFKA_HANDLERS.eventsProvisionTopic(ctx(topicBelow, { name: 'last' }))).statusCode, 201);
    assert.equal(topicBelow.logs.length, 0);
    const topicAt = governancePool({ ...options, usage: 2 });
    assertDenial(await KAFKA_HANDLERS.eventsProvisionTopic(ctx(topicAt, { name: 'over' })), topicAt, 'max_kafka_topics', 'topic.create', 2, 2, source);
    assert.deepEqual(effects(), { connects: 1, creates: 1, writes: 1 });
    const mongoBelow = governancePool(options);
    const below = mongoCall(mongoBelow, 'last');
    assert.equal((await MONGO_HANDLERS.mongoProvision(below.call)).statusCode, 201);
    assert.equal(mongoBelow.logs.length, 0);
    const mongoAt = governancePool({ ...options, mongoNames: ['last'] });
    const at = mongoCall(mongoAt, 'over');
    assertDenial(await MONGO_HANDLERS.mongoProvision(at.call), mongoAt, 'max_mongo_databases', 'mongo_database.create', 1, 1, source);
    assert.equal(at.creates(), 0);
  });
}
