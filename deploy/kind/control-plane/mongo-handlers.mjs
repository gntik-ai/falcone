// Console document-store handlers — the FerretDB gateway over the DocumentDB engine (kind
// deploy), accessed via the MongoDB wire protocol.
//
// The FerretDB gateway runs as `falcone-ferretdb:27017` (DocumentDB engine credentials:
// user `falcone` + POSTGRES_PASSWORD). The web-console document page browses databases,
// collections, indexes, views and documents. We talk to it with the official `mongodb`
// driver (FerretDB is MongoDB-wire-compatible), returning the camelCase shapes the page
// expects. System databases are hidden. Provisioning (engine=mongodb) creates the database.
import { MongoClient } from 'mongodb';
import * as store from './tenant-store.mjs';
import { callerTenantScope, canManageTenant } from './tenant-scope.mjs';

const HOST = process.env.MONGO_HOST || 'falcone-ferretdb:27017';
const USER = process.env.MONGO_USER || 'falcone';
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
// Resolve the FerretDB client. ctx.mongoClient is an injection point for tests
// (the handlers otherwise share the singleton connection above).
const mc = async (ctx) => ctx?.mongoClient ?? client();

// FerretDB is ONE shared cluster keyed only by a `tenantId` field per document
// (db/collection names are caller-supplied and shared across tenants), so a
// collection "belongs to" a tenant iff it holds ≥1 of that tenant's documents.
async function tenantCollectionCount(c, db, col, scope) {
  return c.db(db).collection(col).countDocuments({ tenantId: scope });
}
async function dbHasTenantData(c, db, scope) {
  const cols = (await c.db(db).listCollections().toArray()).filter((x) => x.type === 'collection');
  for (const x of cols) {
    if (await tenantCollectionCount(c, db, x.name, scope) > 0) return true;
  }
  return false;
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

async function mongoListDatabases(ctx) {
  const c = await mc(ctx);
  const scope = callerTenantScope(ctx?.identity);
  const { databases } = await c.db('admin').admin().listDatabases();
  const items = [];
  for (const d of databases) {
    if (SYSTEM_DBS.has(d.name)) continue;
    if (scope != null) {
      // Tenant caller: only surface databases that hold this tenant's documents,
      // and report a tenant-scoped document count (no cross-tenant volume leak).
      const cols = (await c.db(d.name).listCollections().toArray()).filter((x) => x.type === 'collection');
      let documents = 0;
      for (const x of cols) documents += await tenantCollectionCount(c, d.name, x.name, scope);
      if (documents === 0) continue;
      items.push({ databaseName: d.name, stats: { documents } });
      continue;
    }
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
  const c = await mc(ctx);
  const scope = callerTenantScope(ctx?.identity);
  const cols = (await c.db(db).listCollections().toArray()).filter((x) => x.type === 'collection');
  const items = [];
  for (const x of cols) {
    let documentCount, estimatedSize;
    if (scope != null) {
      // Tenant-scoped count; hide collections this tenant has no documents in.
      documentCount = await tenantCollectionCount(c, db, x.name, scope);
      if (documentCount === 0) continue;
    } else {
      try { const cs = await c.db(db).command({ collStats: x.name }); documentCount = cs.count; estimatedSize = cs.size; } catch { /* ignore */ }
    }
    items.push({
      collectionName: x.name, collectionType: collType(x.options), documentCount, estimatedSize,
      validation: x.options?.validator
        ? { validationLevel: x.options.validationLevel, validationAction: x.options.validationAction, validator: x.options.validator }
        : undefined
    });
  }
  return ok(200, { items, page: { total: items.length } });
}

async function mongoCollectionDetail(ctx) {
  const db = D(ctx.params.db); const col = C(ctx.params.col);
  const c = await mc(ctx);
  const scope = callerTenantScope(ctx?.identity);
  const list = await c.db(db).listCollections({ name: col }).toArray();
  if (!list.length) return err(404, 'COLLECTION_NOT_FOUND', `collection ${col} not found`);
  const x = list[0];
  let documentCount, estimatedSize;
  if (scope != null) {
    // A collection with no documents for the caller's tenant is reported as
    // not-found — no cross-tenant existence leak.
    documentCount = await tenantCollectionCount(c, db, col, scope);
    if (documentCount === 0) return err(404, 'COLLECTION_NOT_FOUND', `collection ${col} not found`);
  } else {
    try { const cs = await c.db(db).command({ collStats: col }); documentCount = cs.count; estimatedSize = cs.size; } catch { /* ignore */ }
  }
  return ok(200, {
    collectionName: col, collectionType: collType(x.options), documentCount, estimatedSize,
    validation: x.options?.validator
      ? { validationLevel: x.options.validationLevel, validationAction: x.options.validationAction, validator: x.options.validator }
      : undefined
  });
}

async function mongoIndexes(ctx) {
  const db = D(ctx.params.db); const col = C(ctx.params.col);
  const c = await mc(ctx);
  const scope = callerTenantScope(ctx?.identity);
  // Probe existence first (mirrors mongoCollectionDetail): a missing collection is a clean 404,
  // never a 500 leaking the raw FerretDB NamespaceNotFound (code 26) from .indexes()/count.
  const exists = await c.db(db).listCollections({ name: col }).toArray();
  if (!exists.length) return err(404, 'COLLECTION_NOT_FOUND', `collection ${col} not found`);
  // Tenant callers may only inspect indexes of a collection they have data in —
  // otherwise the collection is reported as not-found (no cross-tenant schema leak).
  if (scope != null && await tenantCollectionCount(c, db, col, scope) === 0) {
    return err(404, 'COLLECTION_NOT_FOUND', `collection ${col} not found`);
  }
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
  const c = await mc(ctx);
  const scope = callerTenantScope(ctx?.identity);
  // Don't enumerate views of a database the caller's tenant has no data in.
  if (scope != null && !(await dbHasTenantData(c, db, scope))) return ok(200, { items: [], page: { total: 0 } });
  const views = await c.db(db).listCollections({ type: 'view' }).toArray();
  const items = views.map((v) => ({ viewName: v.name, viewOn: v.options?.viewOn, pipeline: v.options?.pipeline ?? [] }));
  return ok(200, { items, page: { total: items.length } });
}

async function mongoDocuments(ctx) {
  const db = D(ctx.params.db); const col = C(ctx.params.col);
  // Enforce the caller owns the workspace (404 cross-tenant, no existence leak) and
  // derive the tenant scope for the documents from the workspace's owning tenant.
  const ws = await store.getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!ws || !canManageTenant(ctx.identity, ws.tenant_id)) {
    return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`);
  }
  const limit = Number(ctx.query['page[size]'] ?? 20) || 20;
  const skip = ctx.query['page[after]'] ? Number(ctx.query['page[after]']) || 0 : 0;
  const c = await mc(ctx);
  // Documents are isolated ONLY by the `tenantId` field (one shared FerretDB
  // cluster) — scope every read to the workspace's owning tenant (P0 ISO-MONGO).
  const docs = await c.db(db).collection(col).find({ tenantId: ws.tenant_id }).skip(skip).limit(limit).toArray();
  const hasMore = docs.length === limit;
  return ok(200, { items: docs.map(jsonSafe), page: { after: hasMore ? String(skip + docs.length) : null, size: docs.length } });
}

// engine=mongodb provisioning: create the database + initial collections.
async function mongoProvision(ctx) {
  const ws = ctx.workspace; // set by the generic dispatcher
  // The public provision body names the database `databaseName`; accept both that and `name`.
  const name = String(ctx.body?.name ?? ctx.body?.databaseName ?? '').trim().replace(/[\/\\. "$*<>:|?]/g, '_').slice(0, 63);
  if (!name) return err(400, 'VALIDATION_ERROR', 'database name is required');
  const collections = Array.isArray(ctx.body?.collections) && ctx.body.collections.length ? ctx.body.collections : ['default'];
  try {
    const c = await mc(ctx);
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
