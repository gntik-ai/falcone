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
import { resolveMongoTls } from './transport-security.mjs';

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
    clientPromise = new MongoClient(URI, { serverSelectionTimeoutMS: 5000, ...resolveMongoTls() }).connect()
      .catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}
// Resolve the FerretDB client. ctx.mongoClient is an injection point for tests
// (the handlers otherwise share the singleton connection above).
const mc = async (ctx) => ctx?.mongoClient ?? client();
// Shared singleton client accessor for callers outside this module (e.g. the
// purge/delete teardown in b-handlers resolves a default client through this).
export const mongoClient = () => client();

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
  // This route is WORKSPACE-addressed (/v1/mongo/workspaces/{workspaceId}/...), and the
  // document plane is scoped per workspace WITHIN the tenant: the data-API write path stamps
  // BOTH `tenantId` AND `workspaceId` on every document (packages/adapters mongodb-data-api
  // applyTenantScopeToFilter, #632). Scoping by tenantId ALONE would leak a sibling
  // workspace's (and stage's) documents to this workspace's browser (#661, the console tail of
  // #632). Filter by BOTH — using `ws.id`, the canonical workspace UUID the documents carry,
  // not the raw path param (which getWorkspace also resolves from a slug). Documents predating
  // the workspace stamping (no `workspaceId` field) are correctly excluded: an unattributable
  // doc cannot be shown as belonging to a workspace (matches the canonical adapter).
  const docs = await c.db(db).collection(col)
    .find({ tenantId: ws.tenant_id, workspaceId: ws.id })
    .skip(skip).limit(limit).toArray();
  const hasMore = docs.length === limit;
  return ok(200, { items: docs.map(jsonSafe), page: { after: hasMore ? String(skip + docs.length) : null, size: docs.length } });
}

// ---- document export / import (#683, data-export-import-clone) --------------
// Bounded, synchronous, inline-artifact document movement, WORKSPACE-addressed. The document plane
// stamps BOTH tenantId AND workspaceId on every document (#632/#661), so export reads ONLY the
// caller's workspace documents and import stamps that SAME verified scope — a body-supplied
// tenantId/workspaceId is always overwritten, so an import can never cross a tenant/workspace
// boundary. v1 caps the operation at MONGO_IO_MAX_DOCS documents (no async pipeline/streaming).
const MONGO_IO_MAX_DOCS = (() => { const n = Number(process.env.MONGO_IO_MAX_DOCS); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000; })();

// Resolve + own-tenant gate the workspace (404 cross-tenant, no existence leak), returning the
// workspace row so the caller can derive the canonical tenantId + workspaceId stamp.
async function ownedWorkspaceForData(ctx) {
  const ws = await store.getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!ws || !canManageTenant(ctx.identity, ws.tenant_id)) {
    return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
  }
  return { ws };
}

// Strip the Mongo `_id` (it is collection-managed; re-inserting a foreign _id risks a duplicate-key
// collision) and the scope fields (re-stamped on import). Returns a plain, JSON-safe document.
function exportDoc(doc) {
  const { _id, tenantId, workspaceId, ...rest } = doc;
  return jsonSafe(rest);
}

// POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports
async function mongoDataExport(ctx) {
  const { error, ws } = await ownedWorkspaceForData(ctx);
  if (error) return error;
  const db = D(ctx.params.databaseName ?? ctx.params.db);
  const col = C(ctx.params.collectionName ?? ctx.params.col);
  const limit = Math.min(Math.max(Number(ctx.body?.limit ?? MONGO_IO_MAX_DOCS) || MONGO_IO_MAX_DOCS, 1), MONGO_IO_MAX_DOCS);
  try {
    const c = await mc(ctx);
    const docs = await c.db(db).collection(col)
      .find({ tenantId: ws.tenant_id, workspaceId: ws.id })
      .limit(limit).toArray();
    return ok(200, {
      entityType: 'mongo_data_export',
      sourceWorkspaceId: ws.id, sourceTenantId: ws.tenant_id,
      databaseName: db, collectionName: col,
      exportedAt: new Date().toISOString(),
      documentCount: docs.length,
      documents: docs.map(exportDoc)
    });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'MONGO_EXPORT_FAILED', String(e.message ?? e));
  }
}

// POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports
async function mongoDataImport(ctx) {
  const { error, ws } = await ownedWorkspaceForData(ctx);
  if (error) return error;
  const db = D(ctx.params.databaseName ?? ctx.params.db);
  const col = C(ctx.params.collectionName ?? ctx.params.col);
  const docs = Array.isArray(ctx.body?.documents) ? ctx.body.documents : null;
  if (!docs) return err(400, 'VALIDATION_ERROR', 'documents (array) is required');
  if (docs.length > MONGO_IO_MAX_DOCS) return err(413, 'MONGO_IMPORT_TOO_LARGE', `import exceeds the ${MONGO_IO_MAX_DOCS}-document limit`);
  let inserted = 0;
  const skipped = [];
  try {
    const c = await mc(ctx);
    const collection = c.db(db).collection(col);
    for (const raw of docs) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { skipped.push({ reason: 'NOT_AN_OBJECT' }); continue; }
      // ALWAYS stamp the caller's VERIFIED scope; never trust a body-supplied tenantId/workspaceId.
      // Drop any incoming _id so a foreign _id can't collide or be used to target another doc.
      const { _id, tenantId: _t, workspaceId: _w, ...fields } = raw;
      await collection.insertOne({ ...fields, tenantId: ws.tenant_id, workspaceId: ws.id });
      inserted += 1;
    }
    return ok(200, {
      entityType: 'mongo_data_import_result',
      targetWorkspaceId: ws.id, targetTenantId: ws.tenant_id,
      databaseName: db, collectionName: col,
      importedAt: new Date().toISOString(),
      totalEntries: docs.length, importedCount: inserted, skippedCount: skipped.length, skipped
    });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'MONGO_IMPORT_FAILED', String(e.message ?? e));
  }
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
    // Record the provisioned database so tenant-purge / workspace-delete can DISCOVER
    // it for an isolation-safe teardown (fix-tenant-purge-ferretdb-cascade, #682).
    // BEST-EFFORT and idempotent: a registry hiccup (or a benign re-provision conflict)
    // must NEVER fail provisioning — the FerretDB db/collections were already created.
    if (ctx.pool && ws?.id && ws?.tenant_id) {
      try {
        await store.insertMongoDatabase(ctx.pool, {
          workspaceId: ws.id, tenantId: ws.tenant_id, databaseName: name,
          collections, createdBy: ctx.identity?.sub ?? null });
      } catch { /* registry is for teardown discovery only; never block provisioning */ }
    }
    return ok(201, { databaseId: name, database: { databaseName: name }, engine: 'mongodb', workspaceId: ws?.id ?? null, collections });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'MONGO_PROVISION_FAILED', String(e.message ?? e));
  }
}

// Isolation-safe FerretDB teardown for tenant-purge / workspace-delete
// (fix-tenant-purge-ferretdb-cascade, #682). The document store is ONE shared cluster
// keyed only by a `tenantId` document field — db/collection NAMES are caller-supplied
// and SHARED across tenants — so this MUST NOT blindly dropDatabase(name): another
// tenant may hold documents in a same-named shared db (a naïve drop = cross-tenant
// data loss, a NEW Critical bug). For each recorded database it therefore:
//   1. deletes ONLY this tenant's documents (deleteMany { tenantId }) from every
//      non-system collection, then
//   2. drops the database physically IFF it now holds ZERO documents from ANY tenant
//      across its non-system collections; otherwise the db is RETAINED (another
//      tenant still owns data there) and only this tenant's documents were removed.
// `system.*` collections are excluded from the emptiness check (a provisioned-but-empty
// db carries a `system.dbSentinel` marker); dropDatabase() removes the sentinel.
// Best-effort per database (a failure on one db never aborts the rest, nor the purge).
// The client is injected by the caller (mirrors the ctx.mongoClient seam) so the
// teardown is unit-testable with a fake client.
const isSystemCollection = (n) => SYSTEM_DBS.has(n) || String(n).startsWith('system.');
export async function mongoTeardown({ client, tenantId, databaseNames }) {
  const dropped = [];
  const retained = [];
  const errors = [];
  for (const name of (databaseNames ?? []).filter(Boolean)) {
    try {
      const db = client.db(name);
      const cols = (await db.listCollections().toArray())
        .filter((x) => x.type === 'collection' && !isSystemCollection(x.name));
      // 1. Delete THIS tenant's documents from every non-system collection.
      for (const x of cols) {
        await db.collection(x.name).deleteMany({ tenantId });
      }
      // 2. Drop the db only if no other tenant's documents remain anywhere in it.
      let remaining = 0;
      for (const x of cols) {
        remaining += await db.collection(x.name).countDocuments({});
        if (remaining > 0) break;
      }
      if (remaining === 0) {
        await db.dropDatabase();
        dropped.push(name);
      } else {
        // Another tenant still has data in this shared db — retain it (we removed
        // only the purged tenant's documents). NEVER drop (cross-tenant safety).
        retained.push(name);
      }
    } catch (e) {
      errors.push({ database: name, error: String(e?.message ?? e) });
    }
  }
  return { dropped, retained, errors };
}

export const MONGO_HANDLERS = {
  mongoListDatabases, mongoListCollections, mongoCollectionDetail, mongoIndexes, mongoViews, mongoDocuments, mongoProvision,
  mongoDataExport, mongoDataImport
};
