// Regression coverage for #773 on the kind control-plane local handlers.
//
// Storage and Kafka writes used to authorize by same-tenant membership only. These tests drive the
// public handler exports with fake backend seams and assert tenant_developer/tenant_viewer receive
// 403 before S3/Kafka/credential side effects, while tenant_owner still succeeds.
import test from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';
import {
  KAFKA_HANDLERS,
  __resetKafkaHandlersTestHooks,
  __setKafkaHandlersTestHooks,
} from '../../apps/control-plane/kafka-handlers.mjs';

const TENANT = 'tenant-a';
const WORKSPACE = 'ws-a';
const BUCKET = 'ws-abc123-assets';
const TOPIC = {
  id: 'res_topic_a',
  workspace_id: WORKSPACE,
  tenant_id: TENANT,
  topic_name: 'orders',
  physical_topic_name: `evt.${WORKSPACE}.orders`,
  partitions: 1,
  created_at: '2026-06-30T00:00:00.000Z',
};

const developer = { sub: 'dev', tenantId: TENANT, workspaceId: WORKSPACE, actorType: 'tenant_member', roles: ['tenant_developer'] };
const viewer = { sub: 'viewer', tenantId: TENANT, workspaceId: WORKSPACE, actorType: 'tenant_member', roles: ['tenant_viewer'] };
const owner = { sub: 'owner', tenantId: TENANT, workspaceId: WORKSPACE, actorType: 'tenant_owner', roles: ['tenant_owner'] };

function storagePool() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
      if (normalized.includes('from workspaces')) {
        return { rows: [{ id: WORKSPACE, tenant_id: TENANT, slug: 'dev', display_name: 'Dev' }] };
      }
      if (normalized.includes('from workspace_buckets') && normalized.includes('where bucket_name')) {
        return { rows: [{ id: 'bucket-a', workspace_id: WORKSPACE, tenant_id: TENANT, bucket_name: BUCKET, region: 'us-east-1', created_at: '2026-06-30T00:00:00.000Z' }] };
      }
      if (normalized.includes('from workspace_buckets') && normalized.includes('where workspace_id')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function s3Ok() {
  return {
    ok: true,
    status: 200,
    headers: new Map(),
    arrayBuffer: async () => Buffer.alloc(0).buffer,
    text: async () => '',
  };
}

async function withFetch(stub, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = original; }
}

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try { return await fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('kind storage structural writes deny developer/viewer before S3 or credential side effects', async () => {
  await withEnv({ STORAGE_MAX_BYTES: null, STORAGE_TENANT_IDENTITIES: '0' }, async () => {
    let fetched = false;
    const seaweedCalls = [];
    await withFetch(async () => { fetched = true; return s3Ok(); }, async () => {
      const provision = await STORAGE_HANDLERS.storageProvisionBucket({
        params: { workspaceId: WORKSPACE },
        query: {},
        body: { name: 'assets' },
        identity: developer,
        pool: storagePool(),
      });
      assert.equal(provision.statusCode, 403);
      assert.equal(provision.body.code, 'FORBIDDEN');

      const rotate = await STORAGE_HANDLERS.storageRotateCredential({
        params: { bucketId: BUCKET },
        query: {},
        body: {},
        identity: developer,
        pool: storagePool(),
        seaweedClient: async (...args) => { seaweedCalls.push(args); return {}; },
      });
      assert.equal(rotate.statusCode, 403);
      assert.equal(rotate.body.code, 'FORBIDDEN');

      const put = await STORAGE_HANDLERS.storagePutObject({
        params: { bucketId: BUCKET, objectKey: 'doc.txt' },
        query: {},
        body: { content: 'blocked' },
        identity: viewer,
        pool: storagePool(),
      });
      assert.equal(put.statusCode, 403);
      assert.equal(put.body.code, 'FORBIDDEN');
    });
    assert.equal(fetched, false, 'denied storage writes must not reach S3');
    assert.deepEqual(seaweedCalls, [], 'denied credential rotation must not post SeaweedFS jobs');
  });
});

test('kind storage object write still allows tenant_owner', async () => {
  await withEnv({ STORAGE_MAX_BYTES: null }, async () => {
    let putReachedS3 = false;
    await withFetch(async (_url, opts) => {
      if (opts.method === 'PUT') putReachedS3 = true;
      return s3Ok();
    }, async () => {
      const res = await STORAGE_HANDLERS.storagePutObject({
        params: { bucketId: BUCKET, objectKey: 'doc.txt' },
        query: {},
        body: { content: 'ok', contentType: 'text/plain' },
        identity: owner,
        pool: storagePool(),
      });
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
      assert.equal(res.body.objectKey, 'doc.txt');
    });
    assert.equal(putReachedS3, true, 'owner write should reach S3');
  });
});

function makeKafka(calls) {
  return {
    admin() {
      return {
        async connect() { calls.adminConnect += 1; },
        async disconnect() { calls.adminDisconnect += 1; },
        async createTopics(args) { calls.createTopics.push(args); return true; },
        async fetchTopicMetadata() { return { topics: [] }; },
        async describeConfigs() { return { resources: [] }; },
        async fetchTopicOffsets() { return []; },
      };
    },
    producer() {
      return {
        async connect() { calls.producerConnect += 1; },
        async disconnect() { calls.producerDisconnect += 1; },
        async send(args) { calls.sends.push(args); return [{ partition: 0 }]; },
      };
    },
  };
}

function kafkaStore(inserted) {
  return {
    async getWorkspace(_pool, workspaceId) {
      assert.equal(workspaceId, WORKSPACE);
      return { id: WORKSPACE, tenant_id: TENANT, slug: 'dev' };
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
        created_at: '2026-06-30T00:00:00.000Z',
      };
    },
    async getTopicByResourceId() {
      return TOPIC;
    },
  };
}

async function withKafka(fn) {
  const calls = { adminConnect: 0, adminDisconnect: 0, producerConnect: 0, producerDisconnect: 0, createTopics: [], sends: [] };
  const inserted = [];
  await __setKafkaHandlersTestHooks({ kafka: makeKafka(calls), store: kafkaStore(inserted) });
  try {
    await fn({ calls, inserted });
  } finally {
    await __resetKafkaHandlersTestHooks();
  }
}

test('kind Kafka topic create and publish deny tenant_developer before Kafka/store side effects', async () => {
  await withKafka(async ({ calls, inserted }) => {
    const create = await KAFKA_HANDLERS.eventsProvisionTopic({
      params: { workspaceId: WORKSPACE },
      query: {},
      body: { name: 'orders' },
      identity: developer,
      pool: {},
    });
    assert.equal(create.statusCode, 403);
    assert.equal(create.body.code, 'FORBIDDEN');

    const publish = await KAFKA_HANDLERS.eventsTopicPublish({
      params: { topicId: TOPIC.id },
      query: {},
      body: { payload: { orderId: 1 } },
      identity: developer,
      pool: {},
    });
    assert.equal(publish.statusCode, 403);
    assert.equal(publish.body.code, 'FORBIDDEN');

    assert.deepEqual(calls.createTopics, [], 'denied topic create must not call Kafka admin');
    assert.deepEqual(calls.sends, [], 'denied publish must not call Kafka producer');
    assert.deepEqual(inserted, [], 'denied topic create must not insert topic rows');
  });
});

test('kind Kafka topic create and publish still allow tenant_owner', async () => {
  await withKafka(async ({ calls, inserted }) => {
    const create = await KAFKA_HANDLERS.eventsProvisionTopic({
      params: { workspaceId: WORKSPACE },
      query: {},
      body: { name: 'orders', partitions: 1 },
      identity: owner,
      pool: {},
    });
    assert.equal(create.statusCode, 201, JSON.stringify(create.body));
    assert.equal(inserted.length, 1);
    assert.equal(calls.createTopics.length, 1);

    const publish = await KAFKA_HANDLERS.eventsTopicPublish({
      params: { topicId: TOPIC.id },
      query: {},
      body: { payload: { orderId: 1 } },
      identity: owner,
      pool: {},
    });
    assert.equal(publish.statusCode, 202, JSON.stringify(publish.body));
    assert.equal(calls.sends.length, 1);
  });
});
