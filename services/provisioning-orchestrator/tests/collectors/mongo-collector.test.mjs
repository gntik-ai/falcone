import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('mongo-collector', () => {
  const originalEnabled = process.env.CONFIG_EXPORT_MONGO_ENABLED;

  afterEach(() => {
    if (originalEnabled !== undefined) process.env.CONFIG_EXPORT_MONGO_ENABLED = originalEnabled;
    else delete process.env.CONFIG_EXPORT_MONGO_ENABLED;
  });

  it('returns not_available when CONFIG_EXPORT_MONGO_ENABLED is not true', async () => {
    delete process.env.CONFIG_EXPORT_MONGO_ENABLED;
    const { collect } = await import('../../src/collectors/mongo-collector.mjs');
    const result = await collect('tenant-a');
    assert.equal(result.status, 'not_available');
    assert.equal(result.domain_key, 'mongo_metadata');
  });

  it('returns ok with databases/collections structure', async () => {
    process.env.CONFIG_EXPORT_MONGO_ENABLED = 'true';
    const { collect } = await import('../../src/collectors/mongo-collector.mjs');

    const mockClient = {
      db: (name) => ({
        listCollections: () => ({
          toArray: async () => [{ name: 'orders', options: { validator: { $jsonSchema: {} } } }],
        }),
        collection: () => ({
          indexes: async () => [{ v: 2, key: { _id: 1 }, name: '_id_' }],
        }),
      }),
      close: async () => {},
    };

    // Also mock admin db
    const origDb = mockClient.db;
    mockClient.db = (name) => {
      if (name === 'admin') return { command: async () => ({ shards: [] }) };
      return origDb(name);
    };

    const result = await collect('tenant-a', { mongoClient: mockClient });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.databases[0].db_name, 'tenant-a');
    assert.equal(result.data.databases[0].collections[0].collection_name, 'orders');
    assert.ok(result.items_count >= 1);
  });

  it('returns error on connection failure', async () => {
    process.env.CONFIG_EXPORT_MONGO_ENABLED = 'true';
    const { collect } = await import('../../src/collectors/mongo-collector.mjs');

    const mockClient = {
      db: () => { throw new Error('MongoDB connection timeout'); },
      close: async () => {},
    };

    const result = await collect('tenant-a', { mongoClient: mockClient });
    assert.equal(result.status, 'error');
    assert.ok(result.error.includes('timeout'));
  });
});
