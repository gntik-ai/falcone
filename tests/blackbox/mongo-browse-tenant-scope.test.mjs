/**
 * Black-box tests for cross-tenant document-store isolation in the control-plane
 * mongo browse/document handlers (fix-mongo-browse-tenant-scope, P0 ISO-MONGO).
 *
 * FerretDB topology: ONE shared cluster; db/collection names are caller-supplied
 * and SHARED across tenants — the only isolation boundary is a `tenantId` field on
 * each document (matching services/adapters mongodb-data-api applyTenantScopeToFilter).
 * The control-plane browse/document handlers omitted that filter, so any tenant
 * could read another tenant's documents by db/collection name and enumerate names.
 *
 * The fix: scope document reads by `tenantId`, enforce workspace ownership on the
 * document route, and restrict listed collections/counts to the caller's tenant.
 * A `ctx.mongoClient` injection point lets these drive a fake client (no FerretDB).
 *
 * bbx-mongo-scope-01: tenant B reads documents under tenant A's workspace → 404
 * bbx-mongo-scope-02: tenant A reads its own docs in a SHARED collection → only A's docs
 * bbx-mongo-scope-03: superadmin reads a workspace's docs → scoped to that workspace's tenant
 * bbx-mongo-scope-04: tenant A lists collections → counts scoped to A's documents
 * bbx-mongo-scope-05: tenant B lists collections of a db with no B data → empty
 * bbx-mongo-scope-06: superadmin lists collections → unscoped (sees all)
 *
 * The workspace-addressed document route (`/v1/mongo/workspaces/{workspaceId}/data/...`) is
 * additionally scoped per WORKSPACE within the tenant (fix-mongo-console-document-workspace-scope,
 * #661 — the console tail of #632). Documents carry BOTH `tenantId` and the workspace UUID in a
 * top-level `workspaceId` field (matching the data-API write path), so the browser of one
 * workspace must not see a sibling workspace's (or stage's) documents of the same tenant.
 * bbx-mongo-scope-07: tenant A browses workspace A → only ws-a docs, NOT sibling ws-a2 docs
 * bbx-mongo-scope-08: tenant A browses workspace A2 → only ws-a2 docs, NOT ws-a docs (symmetric)
 * bbx-mongo-scope-09: slug-addressed workspace browse filters by the canonical workspace UUID
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MONGO_HANDLERS } from '../../deploy/kind/control-plane/mongo-handlers.mjs';

// Two workspaces of the SAME tenant (tenant-a) — e.g. the dev and staging stages of one
// project. `id` is the canonical workspace UUID the documents are stamped with; `slug` is the
// human-addressable alias. getWorkspace resolves by `id` OR `slug` and returns the row whose
// `.id` is the canonical UUID — the handler filters documents by that `.id` (#661).
const WS_A = { id: 'ws-a-uuid', tenant_id: 'tenant-a', slug: 'app-staging', status: 'active', environment: 'staging' };
const WS_A2 = { id: 'ws-a2-uuid', tenant_id: 'tenant-a', slug: 'app-dev', status: 'active', environment: 'dev' };

// A shared collection holding documents of BOTH tenants AND of two workspaces of tenant-a (the
// live topology). Documents carry BOTH `tenantId` and the canonical workspace UUID in
// `workspaceId` (matching the data-API write path / applyTenantScopeToFilter).
const DOCS = [
  { _id: '1', tenantId: 'tenant-a', workspaceId: 'ws-a-uuid', secret: 'ACME_PRIVATE' },
  { _id: '2', tenantId: 'tenant-b', workspaceId: 'ws-b-uuid', secret: 'GLOBEX_PRIVATE' },
  { _id: '3', tenantId: 'tenant-a', workspaceId: 'ws-a-uuid', note: 'acme-2' },
  // Sibling workspace of the SAME tenant — must be invisible to the ws-a browser (#661).
  { _id: '4', tenantId: 'tenant-a', workspaceId: 'ws-a2-uuid', secret: 'ACME_DEV_PRIVATE' },
];

// Resolve a workspace by id OR slug (mirrors tenant-store.getWorkspace), returning the
// canonical row whose `.id` is the UUID the documents carry.
function resolveWorkspace(idOrSlug) {
  return [WS_A, WS_A2].find((w) => w.id === idOrSlug || w.slug === idOrSlug) ?? null;
}

function fakePool() {
  const query = async (sql, params = []) => {
    if (sql.includes('FROM workspaces')) {
      const ws = resolveWorkspace(params[0]);
      return { rows: ws ? [ws] : [] };
    }
    return { rows: [] };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

/** Fake FerretDB client capturing the filters the handlers apply. */
function fakeMongo(capture = {}) {
  const match = (filter, d) => Object.entries(filter || {}).every(([k, v]) => d[k] === v);
  const collection = (name) => ({
    find(filter) {
      capture.findFilter = filter;
      const rows = DOCS.filter((d) => match(filter, d));
      let s = 0, l = rows.length;
      return { skip(n) { s = n || 0; return this; }, limit(n) { l = n ?? rows.length; return this; }, async toArray() { return rows.slice(s, s + l); } };
    },
    async countDocuments(filter) { capture.countFilters = [...(capture.countFilters || []), filter]; return DOCS.filter((d) => match(filter, d)).length; },
    async indexes() { return [{ name: '_id_', key: { _id: 1 } }]; },
  });
  const db = () => ({
    collection,
    listCollections() { return { async toArray() { return [{ name: 'records', type: 'collection', options: {} }]; } }; },
    async command() { return { count: DOCS.length, size: 999 }; },
    async stats() { return { dataSize: 1, storageSize: 1, collections: 1, indexes: 1 }; },
    admin() { return { async listDatabases() { return { databases: [{ name: 'appdb', sizeOnDisk: 1 }] }; } }; },
  });
  return { db };
}

const IDENTITY_A = { sub: 'user-a', tenantId: 'tenant-a', workspaceId: 'ws-a', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_B = { sub: 'user-b', tenantId: 'tenant-b', workspaceId: 'ws-b', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
// Tenant C has NO documents in the shared collection — exercises the hide-when-empty path.
const IDENTITY_C = { sub: 'user-c', tenantId: 'tenant-c', workspaceId: 'ws-c', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, workspaceId: null, actorType: 'superadmin', roles: ['superadmin'], scopes: [] };

function ctx(identity, params = {}, capture = {}) {
  return { pool: fakePool(), mongoClient: fakeMongo(capture), params: { db: 'appdb', col: 'records', ...params }, query: {}, body: {}, identity };
}

test('bbx-mongo-scope-01: tenant B reads docs under tenant A workspace → 404', async () => {
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_B, { workspaceId: 'ws-a-uuid' }));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.ok(!JSON.stringify(r.body).includes('GLOBEX_PRIVATE') && !JSON.stringify(r.body).includes('ACME_PRIVATE'), 'must leak no document');
});

test('bbx-mongo-scope-02: tenant A reads its own docs in a shared collection → only A docs', async () => {
  const capture = {};
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_A, { workspaceId: 'ws-a-uuid' }, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  assert.equal(capture.findFilter?.tenantId, 'tenant-a', 'find must be scoped by the caller tenantId');
  const blob = JSON.stringify(r.body);
  assert.ok(blob.includes('ACME_PRIVATE'), 'A must see its own document');
  assert.ok(!blob.includes('GLOBEX_PRIVATE'), 'A must NOT see tenant B documents');
});

test('bbx-mongo-scope-03: superadmin reads a workspace docs → scoped to that workspace tenant', async () => {
  const capture = {};
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_SA, { workspaceId: 'ws-a-uuid' }, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  assert.equal(capture.findFilter?.tenantId, 'tenant-a', 'docs are scoped to the workspace owning tenant');
});

test('bbx-mongo-scope-04: tenant A lists collections → counts scoped to A documents', async () => {
  // mongoListCollections is NOT workspace-addressed (route has no {workspaceId}) — it stays
  // tenant-scoped (out of scope for #661). Tenant A owns 3 docs across its two workspaces.
  const capture = {};
  const r = await MONGO_HANDLERS.mongoListCollections(ctx(IDENTITY_A, {}, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  const recs = r.body.items.find((i) => i.collectionName === 'records');
  assert.ok(recs, 'own collection must be listed');
  assert.equal(recs.documentCount, 3, `count must reflect only tenant A docs, got ${recs.documentCount}`);
  assert.ok((capture.countFilters || []).some((f) => f?.tenantId === 'tenant-a'), 'count must be tenant-scoped');
});

test('bbx-mongo-scope-05: tenant with no data lists collections → empty', async () => {
  const r = await MONGO_HANDLERS.mongoListCollections(ctx(IDENTITY_C, {}));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  assert.equal(r.body.items.length, 0, 'collections with no caller-tenant documents must not be listed');
});

test('bbx-mongo-scope-06: superadmin lists collections → unscoped', async () => {
  const r = await MONGO_HANDLERS.mongoListCollections(ctx(IDENTITY_SA, {}));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  assert.equal(r.body.items.length, 1, 'superadmin sees the collection');
});

// ---- #661: workspace-scoping of the workspace-addressed document browser ----

test('bbx-mongo-scope-07: tenant A browses workspace A → only ws-a docs, NOT sibling ws-a2', async () => {
  const capture = {};
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_A, { workspaceId: 'ws-a-uuid' }, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  // The find predicate must carry BOTH the tenant AND the addressed workspace's canonical UUID.
  assert.equal(capture.findFilter?.tenantId, 'tenant-a', 'find must be scoped by tenantId');
  assert.equal(capture.findFilter?.workspaceId, 'ws-a-uuid', 'find must ALSO be scoped by the workspace UUID (#661)');
  const ids = r.body.items.map((d) => d._id);
  assert.deepEqual(ids.sort(), ['1', '3'], `must return ONLY ws-a docs, got ${JSON.stringify(ids)}`);
  const blob = JSON.stringify(r.body);
  assert.ok(blob.includes('ACME_PRIVATE'), 'ws-a docs must be visible');
  assert.ok(!blob.includes('ACME_DEV_PRIVATE'), 'sibling workspace (ws-a2) docs of the SAME tenant must NOT leak (#661)');
  assert.ok(!blob.includes('GLOBEX_PRIVATE'), 'other tenant docs must NOT leak');
});

test('bbx-mongo-scope-08: tenant A browses workspace A2 → only ws-a2 docs, NOT ws-a (symmetric)', async () => {
  const capture = {};
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_A, { workspaceId: 'ws-a2-uuid' }, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.equal(capture.findFilter?.tenantId, 'tenant-a', 'find must be scoped by tenantId');
  assert.equal(capture.findFilter?.workspaceId, 'ws-a2-uuid', 'find must ALSO be scoped by the workspace UUID (#661)');
  const ids = r.body.items.map((d) => d._id);
  assert.deepEqual(ids, ['4'], `must return ONLY ws-a2 docs, got ${JSON.stringify(ids)}`);
  const blob = JSON.stringify(r.body);
  assert.ok(blob.includes('ACME_DEV_PRIVATE'), 'ws-a2 docs must be visible');
  assert.ok(!blob.includes('ACME_PRIVATE'), 'sibling workspace (ws-a) docs of the SAME tenant must NOT leak (#661)');
});

test('bbx-mongo-scope-09: slug-addressed workspace browse filters by the canonical workspace UUID', async () => {
  // getWorkspace resolves a slug to its canonical row; the document filter must use ws.id (UUID),
  // NOT the raw slug path param — otherwise a slug-addressed call would match zero stamped docs.
  const capture = {};
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_A, { workspaceId: 'app-staging' }, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.equal(capture.findFilter?.workspaceId, 'ws-a-uuid', 'slug must be normalized to the canonical workspace UUID in the filter');
  const ids = r.body.items.map((d) => d._id);
  assert.deepEqual(ids.sort(), ['1', '3'], `slug-addressed browse must return ws-a docs, got ${JSON.stringify(ids)}`);
});
