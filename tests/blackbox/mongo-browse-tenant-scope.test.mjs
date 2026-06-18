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
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MONGO_HANDLERS } from '../../deploy/kind/control-plane/mongo-handlers.mjs';

const WS_A = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app-staging', status: 'active', environment: 'staging' };

// A shared collection holding BOTH tenants' documents (the live topology).
const DOCS = [
  { _id: '1', tenantId: 'tenant-a', secret: 'ACME_PRIVATE' },
  { _id: '2', tenantId: 'tenant-b', secret: 'GLOBEX_PRIVATE' },
  { _id: '3', tenantId: 'tenant-a', note: 'acme-2' },
];

function fakePool() {
  const query = async (sql, params = []) => {
    if (sql.includes('FROM workspaces')) return { rows: params[0] === 'ws-a' ? [WS_A] : [] };
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
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_B, { workspaceId: 'ws-a' }));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.ok(!JSON.stringify(r.body).includes('GLOBEX_PRIVATE') && !JSON.stringify(r.body).includes('ACME_PRIVATE'), 'must leak no document');
});

test('bbx-mongo-scope-02: tenant A reads its own docs in a shared collection → only A docs', async () => {
  const capture = {};
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_A, { workspaceId: 'ws-a' }, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  assert.equal(capture.findFilter?.tenantId, 'tenant-a', 'find must be scoped by the caller tenantId');
  const blob = JSON.stringify(r.body);
  assert.ok(blob.includes('ACME_PRIVATE'), 'A must see its own document');
  assert.ok(!blob.includes('GLOBEX_PRIVATE'), 'A must NOT see tenant B documents');
});

test('bbx-mongo-scope-03: superadmin reads a workspace docs → scoped to that workspace tenant', async () => {
  const capture = {};
  const r = await MONGO_HANDLERS.mongoDocuments(ctx(IDENTITY_SA, { workspaceId: 'ws-a' }, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  assert.equal(capture.findFilter?.tenantId, 'tenant-a', 'docs are scoped to the workspace owning tenant');
});

test('bbx-mongo-scope-04: tenant A lists collections → counts scoped to A documents', async () => {
  const capture = {};
  const r = await MONGO_HANDLERS.mongoListCollections(ctx(IDENTITY_A, {}, capture));
  assert.equal(r.statusCode, 200, `got ${r.statusCode}`);
  const recs = r.body.items.find((i) => i.collectionName === 'records');
  assert.ok(recs, 'own collection must be listed');
  assert.equal(recs.documentCount, 2, `count must reflect only tenant A docs, got ${recs.documentCount}`);
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
