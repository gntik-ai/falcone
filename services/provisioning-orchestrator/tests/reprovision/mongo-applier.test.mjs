import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/appliers/mongo-applier.mjs';

function mockGetDb(existingCollections = [], existingIndexes = []) {
  const created = [];
  return {
    created,
    getDb: () => ({
      listCollections: (filter) => ({
        toArray: async () => existingCollections.filter(c => c.name === filter.name),
      }),
      createCollection: async (name, opts) => { created.push({ type: 'collection', name, opts }); },
      collection: (name) => ({
        listIndexes: () => ({
          toArray: async () => existingIndexes.filter(i => i.collection === name),
        }),
        createIndex: async (key, opts) => { created.push({ type: 'index', key, opts }); },
      }),
    }),
  };
}

test('mongo-applier: empty domain returns applied', async () => {
  const result = await apply('tenant-1', null, { dryRun: false, credentials: {} });
  assert.equal(result.status, 'applied');
});

test('mongo-applier: creates non-existing collection', async () => {
  const mock = mockGetDb();
  const domainData = { database: 'test_db', collections: [{ name: 'users' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { getDb: mock.getDb } });
  assert.equal(result.resource_results[0].action, 'created');
  assert.equal(mock.created.length, 1);
});

test('mongo-applier: skips existing identical collection', async () => {
  const mock = mockGetDb([{ name: 'users', options: {} }]);
  const domainData = { database: 'test_db', collections: [{ name: 'users' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { getDb: mock.getDb } });
  assert.equal(result.resource_results[0].action, 'skipped');
});

test('mongo-applier: reports conflict for collection with different validator', async () => {
  const mock = mockGetDb([{ name: 'users', options: { validator: { $jsonSchema: { bsonType: 'object' } } } }]);
  const domainData = { database: 'test_db', collections: [{ name: 'users', validator: { $jsonSchema: { bsonType: 'string' } } }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { getDb: mock.getDb } });
  assert.equal(result.resource_results[0].action, 'conflict');
});

test('mongo-applier: dry run does not create', async () => {
  const mock = mockGetDb();
  const domainData = { database: 'test_db', collections: [{ name: 'users' }] };
  const result = await apply('tenant-1', domainData, { dryRun: true, credentials: { getDb: mock.getDb } });
  assert.equal(result.resource_results[0].action, 'would_create');
  assert.equal(mock.created.length, 0);
});

test('mongo-applier: redacted value produces applied_with_warnings', async () => {
  const mock = mockGetDb();
  const domainData = { database: 'test_db', collections: [{ name: 'users', password: '***REDACTED***' }] };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { getDb: mock.getDb } });
  assert.equal(result.resource_results[0].action, 'applied_with_warnings');
});

test('mongo-applier: sharding metadata reports conflict', async () => {
  const mock = mockGetDb();
  const domainData = { database: 'test_db', collections: [], sharding: { key: { _id: 1 } } };
  const result = await apply('tenant-1', domainData, { dryRun: false, credentials: { getDb: mock.getDb } });
  const shardResult = result.resource_results.find(r => r.resource_type === 'sharding');
  assert.ok(shardResult);
  assert.equal(shardResult.action, 'conflict');
});
