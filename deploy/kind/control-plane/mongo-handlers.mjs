// Console MongoDB (document store) handlers — REAL MongoDB (kind deploy).
//
// MongoDB runs as `falcone-mongodb:27017` (bitnami; root user + MONGODB_ROOT_PASSWORD).
// The web-console Mongo page browses databases, collections, indexes, views and
// documents. We talk to it with the official `mongodb` driver (added to the image),
// returning the camelCase shapes the page expects. System databases are hidden.
// Provisioning (engine=mongodb) creates the database + its initial collections.
import { MongoClient } from 'mongodb';

const HOST = process.env.MONGO_HOST || 'falcone-mongodb:27017';
const USER = process.env.MONGO_USER || 'root';
const PASS = process.env.MONGO_PASSWORD || '';
const URI = process.env.MONGO_URI
  || `mongodb://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@${HOST}/?authSource=admin`;
const SYSTEM_DBS = new Set(['admin', 'config', 'local']);

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });

let clientPromise = null;
function client() {
  if (!clientPromise) {
    clientPromise = new MongoClient(URI, { serverSelectionTimeoutMS: 5000 }).connect()
      .catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

// Make BSON values JSON-safe for the documents view (ObjectId -> hex, Date -> ISO).
function jsonSafe(v) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v._bsontype === 'ObjectId' || (v.constructor && v.constructor.name === 'ObjectId')) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = jsonSafe(v[k]);
    return o;
  }
  return v;
}

function indexType(key) {
  const vals = Object.values(key);
  if (vals.includes('text')) return 'text';
  if (vals.includes('2dsphere') || vals.includes('2d')) return 'geo';
  if (vals.includes('hashed')) return 'hashed';
  return Object.keys(key).length > 1 ? 'compound' : 'single';
}
const collType = (o = {}) => (o.capped ? 'capped' : o.timeseries ? 'time-series' : 'standard');
const D = (db) => decodeURIComponent(db);
const C = (col) => decodeURIComponent(col);

async function mongoListDatabases() {
  const c = await client();
  const { databases } = await c.db('admin').admin().listDatabases();
  const items = [];
  for (const d of databases) {
    if (SYSTEM_DBS.has(d.name)) continue;
    let stats = {};
    try {
      const s = await c.db(d.name).stats();
      stats = { dataSize: s.dataSize, storageSize: s.storageSize, collections: s.collections, indexes: s.indexes, avgObjSize: s.avgObjSize };
    } catch { /* keep sizeOnDisk fallback */ stats = { storageSize: d.sizeOnDisk }; }
    items.push({ databaseName: d.name, stats });
  }
  return ok(200, { items, page: { total: items.length } });
}

async function mongoListCollections(ctx) {
  const db = D(ctx.params.db);
  const c = await client();
  const cols = (await c.db(db).listCollections().toArray()).filter((x) => x.type === 'collection');
  const items = await Promise.all(cols.map(async (x) => {
    let documentCount, estimatedSize;
    try { const cs = await c.db(db).command({ collStats: x.name }); documentCount = cs.count; estimatedSize = cs.size; } catch { /* ignore */ }
    return {
      collectionName: x.name, collectionType: collType(x.options), documentCount, estimatedSize,
      validation: x.options?.validator
        ? { validationLevel: x.options.validationLevel, validationAction: x.options.validationAction, validator: x.options.validator }
        : undefined
    };
  }));
  return ok(200, { items, page: { total: items.length } });
}

async function mongoCollectionDetail(ctx) {
  const db = D(ctx.params.db); const col = C(ctx.params.col);
  const c = await client();
  const list = await c.db(db).listCollections({ name: col }).toArray();
  if (!list.length) return err(404, 'COLLECTION_NOT_FOUND', `collection ${col} not found`);
  const x = list[0];
  let documentCount, estimatedSize;
  try { const cs = await c.db(db).command({ collStats: col }); documentCount = cs.count; estimatedSize = cs.size; } catch { /* ignore */ }
  return ok(200, {
    collectionName: col, collectionType: collType(x.options), documentCount, estimatedSize,
    validation: x.options?.validator
      ? { validationLevel: x.options.validationLevel, validationAction: x.options.validationAction, validator: x.options.validator }
      : undefined
  });
}

async function mongoIndexes(ctx) {
  const db = D(ctx.params.db); const col = C(ctx.params.col);
  const c = await client();
  const idx = await c.db(db).collection(col).indexes();
  const items = idx.map((i) => ({
    indexName: i.name,
    keys: Object.entries(i.key).map(([fieldName, direction]) => ({ fieldName, direction })),
    indexType: indexType(i.key), unique: Boolean(i.unique), sparse: Boolean(i.sparse),
    ttlSeconds: typeof i.expireAfterSeconds === 'number' ? i.expireAfterSeconds : undefined,
    partialFilterExpression: i.partialFilterExpression
  }));
  return ok(200, { items, page: { total: items.length } });
}

async function mongoViews(ctx) {
  const db = D(ctx.params.db);
  const c = await client();
  const views = await c.db(db).listCollections({ type: 'view' }).toArray();
  const items = views.map((v) => ({ viewName: v.name, viewOn: v.options?.viewOn, pipeline: v.options?.pipeline ?? [] }));
  return ok(200, { items, page: { total: items.length } });
}

async function mongoDocuments(ctx) {
  const db = D(ctx.params.db); const col = C(ctx.params.col);
  const limit = Number(ctx.query['page[size]'] ?? 20) || 20;
  const skip = ctx.query['page[after]'] ? Number(ctx.query['page[after]']) || 0 : 0;
  const c = await client();
  const docs = await c.db(db).collection(col).find({}).skip(skip).limit(limit).toArray();
  const hasMore = docs.length === limit;
  return ok(200, { items: docs.map(jsonSafe), page: { after: hasMore ? String(skip + docs.length) : null, size: docs.length } });
}

// engine=mongodb provisioning: create the database + initial collections.
async function mongoProvision(ctx) {
  const ws = ctx.workspace; // set by the generic dispatcher
  const name = String(ctx.body?.name ?? '').trim().replace(/[\/\\. "$*<>:|?]/g, '_').slice(0, 63);
  if (!name) return err(400, 'VALIDATION_ERROR', 'database name is required');
  const collections = Array.isArray(ctx.body?.collections) && ctx.body.collections.length ? ctx.body.collections : ['default'];
  try {
    const c = await client();
    for (const col of collections) {
      try { await c.db(name).createCollection(String(col)); } catch (e) { if (!/already exists/i.test(String(e.message))) throw e; }
    }
    return ok(201, { databaseId: name, database: { databaseName: name }, engine: 'mongodb', workspaceId: ws?.id ?? null, collections });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'MONGO_PROVISION_FAILED', String(e.message ?? e));
  }
}

export const MONGO_HANDLERS = {
  mongoListDatabases, mongoListCollections, mongoCollectionDetail, mongoIndexes, mongoViews, mongoDocuments, mongoProvision
};
