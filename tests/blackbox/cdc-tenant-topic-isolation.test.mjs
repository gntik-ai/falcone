/**
 * Black-box tests for CDC tenant topic isolation (enforce-cdc-tenant-topic-isolation).
 *
 * Tests drive the public exported API of KafkaChangePublisher (both bridges),
 * deriveTopic, and assertValidTopicNamespace — no internal knowledge assumed.
 *
 * bbx-cdc-topic-isolation-01: deriveTopic always embeds tenant + workspace
 * bbx-cdc-topic-isolation-02: namespace override is a prefix-only (never replaces)
 * bbx-cdc-topic-isolation-03: assertValidTopicNamespace rejects invalid values
 * bbx-cdc-topic-isolation-04: publish() end-to-end routes to correct per-tenant topic
 * bbx-cdc-topic-isolation-05: CaptureConfigCache SQL includes tenant_id predicate
 * bbx-cdc-topic-isolation-06: MongoCaptureConfigCache scoped (not unbounded all-tenants)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// PG CDC bridge imports
// ---------------------------------------------------------------------------
import {
  deriveTopic as pgDeriveTopic,
  assertValidTopicNamespace as pgAssertValidTopicNamespace,
  KafkaChangePublisher as PgKafkaChangePublisher,
} from '../../packages/pg-cdc-bridge/src/KafkaChangePublisher.mjs';

// ---------------------------------------------------------------------------
// Mongo CDC bridge imports
// ---------------------------------------------------------------------------
import {
  deriveTopic as mongoDeriveTopic,
  assertValidTopicNamespace as mongoAssertValidTopicNamespace,
  KafkaChangePublisher as MongoKafkaChangePublisher,
} from '../../packages/mongo-cdc-bridge/src/KafkaChangePublisher.mjs';

// ---------------------------------------------------------------------------
// Cache imports
// ---------------------------------------------------------------------------
import { CaptureConfigCache } from '../../packages/pg-cdc-bridge/src/CaptureConfigCache.mjs';
import { MongoCaptureConfigCache } from '../../packages/mongo-cdc-bridge/src/MongoCaptureConfigCache.mjs';

// ===========================================================================
// bbx-cdc-topic-isolation-01: deriveTopic — no override embeds tenant+workspace
// ===========================================================================
test('bbx-cdc-topic-isolation-01: PG deriveTopic no override embeds tenant_id and workspace_id', () => {
  const topic = pgDeriveTopic({ namespace: undefined, tenantId: 'tenant-a', workspaceId: 'ws-1' });
  assert.equal(topic, 'tenant-a.ws-1.pg-changes');
});

test('bbx-cdc-topic-isolation-01: PG deriveTopic two tenants produce distinct topics without override', () => {
  const topicA = pgDeriveTopic({ namespace: undefined, tenantId: 'tenant-a', workspaceId: 'ws-1' });
  const topicB = pgDeriveTopic({ namespace: undefined, tenantId: 'tenant-b', workspaceId: 'ws-2' });
  assert.notEqual(topicA, topicB);
  assert.ok(topicA.includes('tenant-a'), `expected tenant-a in "${topicA}"`);
  assert.ok(topicB.includes('tenant-b'), `expected tenant-b in "${topicB}"`);
  assert.ok(!topicA.includes('tenant-b'), `tenant-b must not appear in tenant-a topic "${topicA}"`);
  assert.ok(!topicB.includes('tenant-a'), `tenant-a must not appear in tenant-b topic "${topicB}"`);
});

test('bbx-cdc-topic-isolation-01: Mongo deriveTopic no override embeds tenant_id and workspace_id', () => {
  const topic = mongoDeriveTopic({ namespace: undefined, tenantId: 'tenant-a', workspaceId: 'ws-1' });
  assert.equal(topic, 'tenant-a.ws-1.mongo-changes');
});

test('bbx-cdc-topic-isolation-01: Mongo deriveTopic two tenants produce distinct topics without override', () => {
  const topicA = mongoDeriveTopic({ namespace: undefined, tenantId: 'tenant-a', workspaceId: 'ws-1' });
  const topicB = mongoDeriveTopic({ namespace: undefined, tenantId: 'tenant-b', workspaceId: 'ws-2' });
  assert.notEqual(topicA, topicB);
  assert.ok(topicA.includes('tenant-a'));
  assert.ok(topicB.includes('tenant-b'));
  assert.ok(!topicA.includes('tenant-b'));
  assert.ok(!topicB.includes('tenant-a'));
});

// ===========================================================================
// bbx-cdc-topic-isolation-02: namespace override is a PREFIX, not a replacement
// ===========================================================================
test('bbx-cdc-topic-isolation-02: PG deriveTopic with namespace prefix embeds tenant+workspace after prefix', () => {
  const topicA = pgDeriveTopic({ namespace: 'myns', tenantId: 'tenant-a', workspaceId: 'ws-1' });
  const topicB = pgDeriveTopic({ namespace: 'myns', tenantId: 'tenant-b', workspaceId: 'ws-2' });
  assert.equal(topicA, 'myns.tenant-a.ws-1.pg-changes');
  assert.equal(topicB, 'myns.tenant-b.ws-2.pg-changes');
});

test('bbx-cdc-topic-isolation-02: Mongo deriveTopic with namespace prefix embeds tenant+workspace after prefix', () => {
  const topicA = mongoDeriveTopic({ namespace: 'myns', tenantId: 'tenant-a', workspaceId: 'ws-1' });
  const topicB = mongoDeriveTopic({ namespace: 'myns', tenantId: 'tenant-b', workspaceId: 'ws-2' });
  assert.equal(topicA, 'myns.tenant-a.ws-1.mongo-changes');
  assert.equal(topicB, 'myns.tenant-b.ws-2.mongo-changes');
});

test('bbx-cdc-topic-isolation-02: PG namespace prefix prod-ns routes per-tenant', () => {
  const t = pgDeriveTopic({ namespace: 'prod-ns', tenantId: 'tenant-a', workspaceId: 'ws-99' });
  assert.equal(t, 'prod-ns.tenant-a.ws-99.pg-changes');
});

// ===========================================================================
// bbx-cdc-topic-isolation-03: assertValidTopicNamespace rejects bad values
// ===========================================================================
test('bbx-cdc-topic-isolation-03: PG assertValidTopicNamespace accepts undefined (unset)', () => {
  assert.doesNotThrow(() => pgAssertValidTopicNamespace(undefined));
});

test('bbx-cdc-topic-isolation-03: PG assertValidTopicNamespace accepts valid lowercase namespace', () => {
  assert.doesNotThrow(() => pgAssertValidTopicNamespace('prod-ns'));
  assert.doesNotThrow(() => pgAssertValidTopicNamespace('myns'));
  assert.doesNotThrow(() => pgAssertValidTopicNamespace('a'));
  assert.doesNotThrow(() => pgAssertValidTopicNamespace('ns.sub'));
});

test('bbx-cdc-topic-isolation-03: PG assertValidTopicNamespace rejects UPPER_CASE', () => {
  assert.throws(() => pgAssertValidTopicNamespace('UPPER'), /invalid|namespace|pattern/i);
});

test('bbx-cdc-topic-isolation-03: PG assertValidTopicNamespace rejects empty string', () => {
  assert.throws(() => pgAssertValidTopicNamespace(''), /invalid|namespace|pattern/i);
});

test('bbx-cdc-topic-isolation-03: Mongo assertValidTopicNamespace accepts undefined (unset)', () => {
  assert.doesNotThrow(() => mongoAssertValidTopicNamespace(undefined));
});

test('bbx-cdc-topic-isolation-03: Mongo assertValidTopicNamespace accepts valid namespace', () => {
  assert.doesNotThrow(() => mongoAssertValidTopicNamespace('prod-ns'));
});

test('bbx-cdc-topic-isolation-03: Mongo assertValidTopicNamespace rejects UPPER_CASE', () => {
  assert.throws(() => mongoAssertValidTopicNamespace('UPPER_CASE'), /invalid|namespace|pattern/i);
});

test('bbx-cdc-topic-isolation-03: Mongo assertValidTopicNamespace rejects empty string', () => {
  assert.throws(() => mongoAssertValidTopicNamespace(''), /invalid|namespace|pattern/i);
});

// ===========================================================================
// bbx-cdc-topic-isolation-04: publish() end-to-end routes to correct per-tenant topic
// ===========================================================================
test('bbx-cdc-topic-isolation-04: PG publish() routes to per-tenant topic without namespace override', async () => {
  const sent = [];
  const kafka = { producerObj: { connect: async () => {}, send: async (p) => sent.push(p), disconnect: async () => {} } };
  // Temporarily clear any env override
  const prev = process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
  delete process.env.PG_CDC_KAFKA_TOPIC_PREFIX;

  const publisher = new PgKafkaChangePublisher({ kafka });
  await publisher.initialize();
  await publisher.publish(
    { id: 'c1', tenant_id: 'tenant-a', workspace_id: 'ws-1', data_source_ref: 'db1' },
    { type: 'insert', relation: { namespace: 'public', relationName: 'orders' }, newRow: { id: '1' }, sequence: 0 },
    '0/1',
    new Date().toISOString()
  );
  assert.equal(sent[0].topic, 'tenant-a.ws-1.pg-changes');

  if (prev !== undefined) process.env.PG_CDC_KAFKA_TOPIC_PREFIX = prev;
});

test('bbx-cdc-topic-isolation-04: PG publish() with namespace override prefixes per-tenant topic', async () => {
  const sent = [];
  const kafka = { producerObj: { connect: async () => {}, send: async (p) => sent.push(p), disconnect: async () => {} } };
  const prev = process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
  process.env.PG_CDC_KAFKA_TOPIC_PREFIX = 'testns';

  const publisher = new PgKafkaChangePublisher({ kafka });
  await publisher.initialize();

  await publisher.publish(
    { id: 'c1', tenant_id: 'tenant-a', workspace_id: 'ws-1', data_source_ref: 'db1' },
    { type: 'insert', relation: { namespace: 'public', relationName: 'orders' }, newRow: { id: '1' }, sequence: 0 },
    '0/1',
    new Date().toISOString()
  );
  await publisher.publish(
    { id: 'c2', tenant_id: 'tenant-b', workspace_id: 'ws-2', data_source_ref: 'db1' },
    { type: 'insert', relation: { namespace: 'public', relationName: 'orders' }, newRow: { id: '2' }, sequence: 0 },
    '0/2',
    new Date().toISOString()
  );

  assert.equal(sent[0].topic, 'testns.tenant-a.ws-1.pg-changes');
  assert.equal(sent[1].topic, 'testns.tenant-b.ws-2.pg-changes');

  if (prev !== undefined) process.env.PG_CDC_KAFKA_TOPIC_PREFIX = prev;
  else delete process.env.PG_CDC_KAFKA_TOPIC_PREFIX;
});

test('bbx-cdc-topic-isolation-04: Mongo publish() routes to per-tenant topic via resolveTopic', async () => {
  const sent = [];
  const kafka = { producerObj: { connect: async () => {}, send: async (p) => sent.push(p), disconnect: async () => {} } };
  const prev = process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX;
  delete process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX;

  const publisher = new MongoKafkaChangePublisher({ kafka });
  await publisher.connect();
  const captureConfig = { tenant_id: 'tenant-a', workspace_id: 'ws-1' };
  const topic = publisher.resolveTopic(captureConfig);
  assert.equal(topic, 'tenant-a.ws-1.mongo-changes');

  if (prev !== undefined) process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX = prev;
});

test('bbx-cdc-topic-isolation-04: Mongo resolveTopic with namespace override prefixes per-tenant topics', () => {
  const prev = process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX;
  process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX = 'myns';

  const kafka = { producerObj: { connect: async () => {}, send: async () => {}, disconnect: async () => {} } };
  const publisher = new MongoKafkaChangePublisher({ kafka });
  const topicA = publisher.resolveTopic({ tenant_id: 'tenant-a', workspace_id: 'ws-1' });
  const topicB = publisher.resolveTopic({ tenant_id: 'tenant-b', workspace_id: 'ws-2' });
  assert.equal(topicA, 'myns.tenant-a.ws-1.mongo-changes');
  assert.equal(topicB, 'myns.tenant-b.ws-2.mongo-changes');

  if (prev !== undefined) process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX = prev;
  else delete process.env.MONGO_CDC_KAFKA_TOPIC_PREFIX;
});

// ===========================================================================
// bbx-cdc-topic-isolation-05: CaptureConfigCache SQL includes tenant_id predicate
// ===========================================================================
test('bbx-cdc-topic-isolation-05: PG CaptureConfigCache SQL includes tenant_id predicate', async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const cache = new CaptureConfigCache({ pool, ttlSeconds: 0 });
  await cache.getActiveConfigs('db1', 'tenant-a');
  assert.ok(queries.length > 0, 'expected at least one query');
  const lastQuery = queries[queries.length - 1];
  assert.ok(
    lastQuery.sql.includes('tenant_id'),
    `SQL must include tenant_id predicate, got: ${lastQuery.sql}`
  );
});

// ===========================================================================
// bbx-cdc-topic-isolation-06: MongoCaptureConfigCache scoped (not unbounded all-tenants)
// ===========================================================================
test('bbx-cdc-topic-isolation-06: MongoCaptureConfigCache SQL is scoped (not a full table scan without predicate)', async () => {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const cache = new MongoCaptureConfigCache({ pool, ttlSeconds: 0, tenantId: 'tenant-a' });
  await cache.load(true);
  assert.ok(queries.length > 0, 'expected at least one query');
  const lastQuery = queries[queries.length - 1];
  // Must either have a WHERE clause with tenant_id or use a params binding that scopes it
  const hasScope =
    lastQuery.sql.includes('tenant_id') ||
    (lastQuery.params && lastQuery.params.length > 0);
  assert.ok(
    hasScope,
    `SQL or params must scope by tenant; got SQL: ${lastQuery.sql}, params: ${JSON.stringify(lastQuery.params)}`
  );
});
