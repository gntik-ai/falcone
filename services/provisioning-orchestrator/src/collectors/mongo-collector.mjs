/**
 * MongoDB metadata collector.
 * Extracts databases, collections, indexes, validators, and sharding config for a tenant.
 * @module collectors/mongo-collector
 */

import { redactSensitiveFields } from './types.mjs';

const DOMAIN_KEY = 'mongo_metadata';

/**
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {Object} [options.mongoClient] - injectable MongoClient for testing
 * @returns {Promise<import('./types.mjs').CollectorResult>}
 */
export async function collect(tenantId, options = {}) {
  const exportedAt = new Date().toISOString();

  if (process.env.CONFIG_EXPORT_MONGO_ENABLED !== 'true') {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'MongoDB collector disabled (CONFIG_EXPORT_MONGO_ENABLED != true)', data: null };
  }

  const mongoUri = process.env.CONFIG_EXPORT_MONGO_URI;
  if (!mongoUri && !options.mongoClient) {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'MongoDB URI not configured', data: null };
  }

  let client = options.mongoClient ?? null;
  let shouldClose = false;

  try {
    if (!client) {
      const mongodb = await import('mongodb');
      const MongoClient = mongodb.default?.MongoClient ?? mongodb.MongoClient;
      client = new MongoClient(mongoUri);
      await client.connect();
      shouldClose = true;
    }

    const dbPrefix = process.env.CONFIG_EXPORT_MONGO_DB_PREFIX ?? '';
    const dbName = dbPrefix ? `${dbPrefix}${tenantId}` : tenantId;
    const db = client.db(dbName);

    const collections = await db.listCollections().toArray();

    if (collections.length === 0) {
      return { domain_key: DOMAIN_KEY, status: 'empty', exported_at: exportedAt, items_count: 0, data: { databases: [{ db_name: dbName, collections: [], sharding: null }] } };
    }

    const collectionDetails = await Promise.all(collections.map(async (col) => {
      const coll = db.collection(col.name);
      let indexes = [];
      try {
        indexes = await coll.indexes();
      } catch { /* ignore */ }

      return {
        collection_name: col.name,
        options: col.options ?? {},
        validator: col.options?.validator ?? null,
        indexes,
      };
    }));

    // Sharding info (best-effort)
    let sharding = null;
    try {
      const adminDb = client.db('admin');
      const shardResult = await adminDb.command({ listShards: 1 });
      sharding = shardResult.shards ?? null;
    } catch { /* not available or unauthorized */ }

    const data = redactSensitiveFields({
      databases: [{
        db_name: dbName,
        collections: collectionDetails,
        sharding,
      }],
    });

    return {
      domain_key: DOMAIN_KEY,
      status: 'ok',
      exported_at: exportedAt,
      items_count: collectionDetails.length,
      data,
    };
  } catch (err) {
    return { domain_key: DOMAIN_KEY, status: 'error', exported_at: exportedAt, error: err.message, data: null };
  } finally {
    if (shouldClose && client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
}
