// Black-box test suite for change add-tenant-purge-executor (teardown exports).
// Drives only the PUBLIC `teardown` entrypoint of each of the six appliers,
// injecting fakes through options.credentials. No internal knowledge.
//
// Tests: bbx-purge-teardown-01 .. bbx-purge-teardown-14
import test from 'node:test';
import assert from 'node:assert/strict';

import { teardown as pgTeardown } from '../../services/provisioning-orchestrator/src/appliers/postgres-applier.mjs';
import { teardown as iamTeardown } from '../../services/provisioning-orchestrator/src/appliers/iam-applier.mjs';
import { teardown as kafkaTeardown } from '../../services/provisioning-orchestrator/src/appliers/kafka-applier.mjs';
import { teardown as mongoTeardown } from '../../services/provisioning-orchestrator/src/appliers/mongo-applier.mjs';
import { teardown as storageTeardown } from '../../services/provisioning-orchestrator/src/appliers/storage-applier.mjs';
import { teardown as functionsTeardown } from '../../services/provisioning-orchestrator/src/appliers/functions-applier.mjs';

const TENANT_A = 'tenant-aaa-01';

// ---------------------------------------------------------------------------
// Postgres teardown
// ---------------------------------------------------------------------------

test('bbx-purge-teardown-01: postgres teardown drops the tenant schema CASCADE using the injected query', async () => {
  const calls = [];
  const credentials = { async query(sql, params) { calls.push({ sql, params }); return []; } };

  const result = await pgTeardown(TENANT_A, {}, { credentials });

  assert.equal(result.domain_key, 'postgres_metadata');
  const dropCalls = calls.filter((c) => /\bDROP SCHEMA\b/i.test(c.sql));
  assert.ok(dropCalls.length > 0, `expected a DROP SCHEMA call, got: ${JSON.stringify(calls.map((c) => c.sql))}`);
  assert.ok(/CASCADE/i.test(dropCalls[0].sql), `expected CASCADE on drop, got: ${dropCalls[0].sql}`);
  // schema is derived from tenantId with hyphens replaced by underscores, quoted
  assert.ok(dropCalls[0].sql.includes('"tenant_aaa_01"'), `expected quoted schema ident, got: ${dropCalls[0].sql}`);
  assert.ok(result.resource_results.some((r) => r.action === 'removed'), `expected a 'removed' action, got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-02: postgres teardown honors dryRun (no DROP issued)', async () => {
  const calls = [];
  const credentials = { async query(sql, params) { calls.push({ sql, params }); return []; } };

  const result = await pgTeardown(TENANT_A, {}, { credentials, dryRun: true });

  const dropCalls = calls.filter((c) => /\bDROP\b/i.test(c.sql));
  assert.equal(dropCalls.length, 0, `expected NO DROP under dryRun, got: ${JSON.stringify(dropCalls.map((c) => c.sql))}`);
  assert.ok(result.resource_results.some((r) => r.action === 'would_remove'), `expected 'would_remove', got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-03: postgres teardown uses explicit domainData.schema when provided', async () => {
  const calls = [];
  const credentials = { async query(sql, params) { calls.push({ sql, params }); return []; } };

  await pgTeardown(TENANT_A, { schema: 'custom_schema' }, { credentials });

  const dropCalls = calls.filter((c) => /\bDROP SCHEMA\b/i.test(c.sql));
  assert.ok(dropCalls[0].sql.includes('"custom_schema"'), `expected custom schema quoted, got: ${dropCalls[0].sql}`);
});

// ---------------------------------------------------------------------------
// IAM teardown
// ---------------------------------------------------------------------------

test('bbx-purge-teardown-04: iam teardown deletes the realm via injected kcApi', async () => {
  const calls = [];
  const credentials = {
    async kcApi(method, path, body) { calls.push({ method, path, body }); return { ok: true, status: 204 }; },
  };

  const result = await iamTeardown(TENANT_A, { realm: 'realm-a' }, { credentials });

  assert.equal(result.domain_key, 'iam');
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del, `expected a DELETE kcApi call, got: ${JSON.stringify(calls)}`);
  assert.ok(result.resource_results.some((r) => r.action === 'removed'), `expected 'removed', got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-05: iam teardown is idempotent when realm already gone (404)', async () => {
  const credentials = {
    async kcApi() { return { ok: false, status: 404 }; },
  };
  const result = await iamTeardown(TENANT_A, { realm: 'realm-a' }, { credentials });
  assert.notEqual(result.status, 'error', `404 must not be an error, got ${result.status}`);
  assert.ok(result.resource_results.some((r) => r.action === 'removed' || r.action === 'skipped'),
    `expected removed/skipped on 404, got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-06: iam teardown honors dryRun (no DELETE issued)', async () => {
  const calls = [];
  const credentials = { async kcApi(method, path) { calls.push({ method, path }); return { ok: true, status: 204 }; } };
  const result = await iamTeardown(TENANT_A, { realm: 'realm-a' }, { credentials, dryRun: true });
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'no DELETE under dryRun');
  assert.ok(result.resource_results.some((r) => r.action === 'would_remove'), `expected 'would_remove', got ${JSON.stringify(result.resource_results)}`);
});

// ---------------------------------------------------------------------------
// Kafka teardown
// ---------------------------------------------------------------------------

test('bbx-purge-teardown-07: kafka teardown deletes topics and ACLs via injected admin', async () => {
  const deletedTopics = [];
  const deletedAcls = [];
  const admin = {
    async listTopics() { return ['ten-a.events', 'other.topic']; },
    async deleteTopics({ topics }) { deletedTopics.push(...topics); },
    async deleteAcls(filters) { deletedAcls.push(filters); },
  };
  const domainData = {
    topics: [{ name: 'ten-a.events' }],
    acls: [{ principal: 'User:ten-a', operation: 'READ', resourceName: 'ten-a.events', resourceType: 'TOPIC', permissionType: 'ALLOW' }],
  };
  const result = await kafkaTeardown(TENANT_A, domainData, { credentials: { kafkaAdmin: admin } });

  assert.equal(result.domain_key, 'kafka');
  assert.ok(deletedTopics.includes('ten-a.events'), `expected topic deleted, got: ${JSON.stringify(deletedTopics)}`);
  assert.ok(deletedAcls.length > 0, `expected ACL deletion, got: ${JSON.stringify(deletedAcls)}`);
  assert.ok(result.resource_results.some((r) => r.action === 'removed'), `expected 'removed', got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-08: kafka teardown honors dryRun (no deletes issued)', async () => {
  let deleteCount = 0;
  const admin = {
    async listTopics() { return ['ten-a.events']; },
    async deleteTopics() { deleteCount += 1; },
    async deleteAcls() { deleteCount += 1; },
  };
  const domainData = { topics: [{ name: 'ten-a.events' }], acls: [{ principal: 'User:ten-a', operation: 'READ' }] };
  const result = await kafkaTeardown(TENANT_A, domainData, { credentials: { kafkaAdmin: admin }, dryRun: true });
  assert.equal(deleteCount, 0, 'no kafka deletes under dryRun');
  assert.ok(result.resource_results.some((r) => r.action === 'would_remove'), `expected 'would_remove', got ${JSON.stringify(result.resource_results)}`);
});

// ---------------------------------------------------------------------------
// Mongo teardown
// ---------------------------------------------------------------------------

test('bbx-purge-teardown-09: mongo teardown drops the tenant database via injected getDb', async () => {
  let dropped = false;
  const db = { async dropDatabase() { dropped = true; } };
  const result = await mongoTeardown(TENANT_A, {}, { credentials: { getDb: () => db } });

  assert.equal(result.domain_key, 'mongo_metadata');
  assert.equal(dropped, true, 'expected dropDatabase to be called');
  assert.ok(result.resource_results.some((r) => r.action === 'removed'), `expected 'removed', got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-10: mongo teardown honors dryRun (no dropDatabase)', async () => {
  let dropped = false;
  const db = { async dropDatabase() { dropped = true; } };
  const result = await mongoTeardown(TENANT_A, {}, { credentials: { getDb: () => db }, dryRun: true });
  assert.equal(dropped, false, 'no dropDatabase under dryRun');
  assert.ok(result.resource_results.some((r) => r.action === 'would_remove'), `expected 'would_remove', got ${JSON.stringify(result.resource_results)}`);
});

// ---------------------------------------------------------------------------
// Storage teardown
// ---------------------------------------------------------------------------

test('bbx-purge-teardown-11: storage teardown deletes the tenant buckets via injected s3Api', async () => {
  const deleted = [];
  const s3Api = {
    async headBucket() { /* exists */ },
    async listObjects() { return { Contents: [] }; },
    async deleteBucket(name) { deleted.push(name); },
  };
  const domainData = { buckets: [{ name: 'ten-a-bucket' }] };
  const result = await storageTeardown(TENANT_A, domainData, { credentials: { s3Api } });

  assert.equal(result.domain_key, 'storage');
  assert.ok(deleted.includes('ten-a-bucket'), `expected bucket deleted, got: ${JSON.stringify(deleted)}`);
  assert.ok(result.resource_results.some((r) => r.action === 'removed'), `expected 'removed', got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-12: storage teardown honors dryRun (no deleteBucket)', async () => {
  const deleted = [];
  const s3Api = {
    async headBucket() {},
    async listObjects() { return { Contents: [] }; },
    async deleteBucket(name) { deleted.push(name); },
  };
  const result = await storageTeardown(TENANT_A, { buckets: [{ name: 'ten-a-bucket' }] }, { credentials: { s3Api }, dryRun: true });
  assert.equal(deleted.length, 0, 'no deleteBucket under dryRun');
  assert.ok(result.resource_results.some((r) => r.action === 'would_remove'), `expected 'would_remove', got ${JSON.stringify(result.resource_results)}`);
});

// ---------------------------------------------------------------------------
// Functions teardown
// ---------------------------------------------------------------------------

test('bbx-purge-teardown-13: functions teardown deletes the namespace via injected owApi', async () => {
  const calls = [];
  const credentials = {
    async owApi(method, path, body) { calls.push({ method, path, body }); return { ok: true, status: 200 }; },
  };
  const result = await functionsTeardown(TENANT_A, { namespace: 'ns-a' }, { credentials });

  assert.equal(result.domain_key, 'functions');
  assert.ok(calls.some((c) => c.method === 'DELETE'), `expected a DELETE owApi call, got: ${JSON.stringify(calls)}`);
  assert.ok(result.resource_results.some((r) => r.action === 'removed'), `expected 'removed', got ${JSON.stringify(result.resource_results)}`);
});

test('bbx-purge-teardown-14: functions teardown honors dryRun (no DELETE issued)', async () => {
  const calls = [];
  const credentials = { async owApi(method, path) { calls.push({ method, path }); return { ok: true, status: 200 }; } };
  const result = await functionsTeardown(TENANT_A, { namespace: 'ns-a' }, { credentials, dryRun: true });
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 0, 'no DELETE under dryRun');
  assert.ok(result.resource_results.some((r) => r.action === 'would_remove'), `expected 'would_remove', got ${JSON.stringify(result.resource_results)}`);
});
