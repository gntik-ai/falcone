/**
 * Black-box tests for change fix-mongo-indexes-missing-collection (#572).
 *
 * GET .../collections/{c}/indexes on a NONEXISTENT collection returned 500, leaking the raw
 * FerretDB error (NamespaceNotFound, code 26): the handler reached `.indexes()` /
 * tenantCollectionCount on a namespace that does not exist. The sibling collection-detail
 * handler returns a clean 404 because it checks existence with listCollections first.
 *
 * The fix mirrors mongoCollectionDetail: probe collection existence with listCollections({name})
 * up front and return 404 COLLECTION_NOT_FOUND when absent — for BOTH a tenant-scoped caller
 * (whose tenant count would throw code 26 on a missing namespace) and an unscoped/superadmin
 * caller (which otherwise went straight to `.indexes()`).
 *
 * Drives MONGO_HANDLERS.mongoIndexes directly with a name-aware fake FerretDB client (no real
 * cluster) that throws code 26 from .indexes()/countDocuments on a missing collection — exactly
 * like the live engine.
 *
 * bbx-mongo-index-01 .. bbx-mongo-index-03
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MONGO_HANDLERS } from '../../apps/control-plane/mongo-handlers.mjs';

const EXISTING = new Set(['records']);
const DOCS = [
  { _id: '1', tenantId: 'tenant-a', secret: 'ACME_PRIVATE' },
  { _id: '2', tenantId: 'tenant-b', secret: 'GLOBEX_PRIVATE' },
];

function namespaceNotFound(col) {
  return Object.assign(new Error(`ns not found: appdb.${col}`), { code: 26, codeName: 'NamespaceNotFound' });
}

/** Name-aware fake FerretDB client: missing collections throw code 26 like the real engine. */
function fakeMongo() {
  const match = (filter, d) => Object.entries(filter || {}).every(([k, v]) => d[k] === v);
  const collection = (name) => ({
    async indexes() {
      if (!EXISTING.has(name)) throw namespaceNotFound(name);
      return [{ name: '_id_', key: { _id: 1 } }, { name: 'tenantId_1', key: { tenantId: 1 } }];
    },
    async countDocuments(filter) {
      if (!EXISTING.has(name)) throw namespaceNotFound(name);
      return DOCS.filter((d) => match(filter, d)).length;
    },
  });
  const db = () => ({
    collection,
    listCollections({ name } = {}) {
      return { async toArray() { return EXISTING.has(name) ? [{ name, type: 'collection', options: {} }] : []; } };
    },
  });
  return { db };
}

const IDENTITY_A = { sub: 'user-a', tenantId: 'tenant-a', workspaceId: 'ws-a', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, workspaceId: null, actorType: 'superadmin', roles: ['superadmin'], scopes: [] };

function ctx(identity, col) {
  return { pool: {}, mongoClient: fakeMongo(), params: { db: 'appdb', col }, query: {}, body: {}, identity };
}

test('bbx-mongo-index-01: tenant-scoped caller, missing collection → 404 (not 500/throw)', async () => {
  const r = await MONGO_HANDLERS.mongoIndexes(ctx(IDENTITY_A, 'ghost'));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.equal(r.body.code, 'COLLECTION_NOT_FOUND');
});

test('bbx-mongo-index-02: superadmin (unscoped) caller, missing collection → 404 (not 500/throw)', async () => {
  const r = await MONGO_HANDLERS.mongoIndexes(ctx(IDENTITY_SA, 'ghost'));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.equal(r.body.code, 'COLLECTION_NOT_FOUND');
});

test('bbx-mongo-index-03: existing collection with caller-tenant docs → 200 with index items', async () => {
  const r = await MONGO_HANDLERS.mongoIndexes(ctx(IDENTITY_A, 'records'));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
  assert.ok(Array.isArray(r.body.items) && r.body.items.length >= 1, 'index list is returned');
  assert.ok(r.body.items.some((i) => i.indexName === '_id_'), 'the _id_ index is present');
});
