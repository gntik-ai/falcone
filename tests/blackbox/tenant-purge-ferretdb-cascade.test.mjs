/**
 * Black-box tests for fix-tenant-purge-ferretdb-cascade (#682).
 *
 * The gap (live 2-tenant kind, 2026-06-20): tenant purge
 * (POST /v1/tenants/{tenantId}/purge) and single-workspace teardown
 * (DELETE /v1/workspaces/{workspaceId}) cascade to Postgres / object-store / Kafka /
 * Keycloak, but NOT to the FerretDB document store. A mongo database provisioned via
 * POST /v1/workspaces/{ws}/databases {engine:"mongodb"} survived a full tenant purge
 * indefinitely, with no product API to drop it — orphaned cross-tenant data.
 *
 * Root cause: mongoProvision created the FerretDB db via the driver but wrote NO
 * registry row, so purge could not even discover it; and purgeTenant/purgeWorkspace
 * collected physical resources only from the Postgres registries.
 *
 * The fix:
 *  - mongoProvision records a `workspace_mongo_databases` row (Scenario 2).
 *  - purge/delete collect the recorded mongo dbs and run an ISOLATION-SAFE teardown
 *    (mongoTeardown): delete THIS tenant's documents by {tenantId} from each recorded
 *    db, then drop the db ONLY when it is empty across ALL tenants. A same-named shared
 *    db that still holds another tenant's documents is RETAINED (only this tenant's
 *    docs removed) — a blind dropDatabase would be cross-tenant data loss (Scenario 1
 *    + the critical isolation scenario).
 *
 * Drives the PUBLIC LOCAL_HANDLERS / store / mongoTeardown surface only, with a fake
 * pool + an injected fake mongo client (records deleteMany filters, countDocuments,
 * dropDatabase calls), so the cascade + isolation are asserted deterministically with
 * no live FerretDB.
 *
 * bbx-682-01: provision (engine=mongodb) records a workspace_mongo_databases row (Scenario 2)
 * bbx-682-02: tenant purge deletes the tenant's docs by {tenantId} + drops the now-empty
 *             FerretDB db; the purge response reports it under removed.mongoDatabases (Scenario 1)
 * bbx-682-03: ISOLATION — a mongo db that ALSO holds another tenant's docs is RETAINED on
 *             purge (only the purged tenant's docs removed); dropDatabase NOT called for it
 * bbx-682-04: workspace delete mirrors the same isolation-safe teardown for its mongo db
 * bbx-682-05: best-effort — a failing mongo teardown does NOT abort the purge (rows removed, 200)
 * bbx-682-06: mongoTeardown unit — deletes by {tenantId} across non-system collections, excludes
 *             system.* from the emptiness check, drops iff empty across all tenants
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS as HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { mongoTeardown } from '../../apps/control-plane/mongo-handlers.mjs';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const WS_A = { id: 'ws-a', tenant_id: TENANT_A, slug: 'app-prod', display_name: 'App Prod', status: 'active', environment: 'prod' };
const TENANT_A_ROW = { id: TENANT_A, tenant_id: TENANT_A, slug: 'tenant-a', display_name: 'Tenant A', status: 'deleted', iam_realm: TENANT_A };

const IDENTITY_A = { sub: 'user-a', tenantId: TENANT_A, actorType: 'tenant_owner', roles: ['tenant_owner'] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, actorType: 'superadmin', roles: ['superadmin'] };

// ---------------------------------------------------------------------------
// A fake mongo client that records every deleteMany / countDocuments / dropDatabase
// call. Each named database is backed by an in-memory map of collection -> [docs].
// `client.db(name).collection(col).deleteMany(filter)` removes matching docs;
// `countDocuments(filter)` counts; `dropDatabase()` flags the db dropped.
// ---------------------------------------------------------------------------
function fakeMongoClient(initial = {}) {
  const calls = { deleteMany: [], countDocuments: [], dropDatabase: [], listCollections: [], createCollection: [] };
  const dbs = {};
  for (const [name, cols] of Object.entries(initial)) {
    dbs[name] = { dropped: false, collections: {} };
    for (const [col, docs] of Object.entries(cols)) dbs[name].collections[col] = docs.map((d) => ({ ...d }));
  }
  const matches = (doc, filter) => Object.entries(filter ?? {}).every(([k, v]) => doc[k] === v);
  const dbHandle = (name) => {
    const db = dbs[name] ?? (dbs[name] = { dropped: false, collections: {} });
    return {
      listCollections() {
        return { toArray: async () => {
          calls.listCollections.push(name);
          return Object.keys(db.collections).map((n) => ({ name: n, type: 'collection' }));
        } };
      },
      collection(col) {
        const arr = db.collections[col] ?? (db.collections[col] = []);
        return {
          async deleteMany(filter) {
            calls.deleteMany.push({ db: name, col, filter });
            const before = arr.length;
            db.collections[col] = arr.filter((d) => !matches(d, filter));
            return { deletedCount: before - db.collections[col].length };
          },
          async countDocuments(filter = {}) {
            calls.countDocuments.push({ db: name, col, filter });
            return (db.collections[col] ?? []).filter((d) => matches(d, filter)).length;
          },
        };
      },
      async createCollection(col) { calls.createCollection?.push?.({ db: name, col }); if (!db.collections[col]) db.collections[col] = []; },
      async dropDatabase() { calls.dropDatabase.push(name); db.dropped = true; },
    };
  };
  return { calls, dbs, client: { db: dbHandle } };
}

// ---------------------------------------------------------------------------
// A fake pool for purge/delete: resolves the tenant/workspace, returns the recorded
// mongo dbs from workspace_mongo_databases, records DELETEs. Postgres-side physical
// teardown (dropWorkspaceDatabase etc.) is injected separately and not exercised here.
// ---------------------------------------------------------------------------
function fakePurgePool({ tenant, workspaces = {}, mongoByTenant = {}, mongoByWorkspace = {} } = {}) {
  const deletes = [];
  const query = async (sql, params = []) => {
    const s = String(sql);
    if (/^\s*DELETE\s+FROM/i.test(s)) { deletes.push({ sql: s.trim(), params }); return { rows: [], rowCount: 1 }; }
    if (/FROM\s+tenants\s+WHERE/i.test(s)) return { rows: tenant && (params[0] === tenant.id || params[0] === tenant.slug) ? [tenant] : [] };
    if (/FROM\s+workspaces\s+WHERE/i.test(s)) return { rows: workspaces[params[0]] ? [workspaces[params[0]]] : [] };
    if (/FROM\s+workspace_mongo_databases\s+WHERE\s+tenant_id/i.test(s)) {
      return { rows: (mongoByTenant[params[0]] ?? []).map((database_name) => ({ database_name })) };
    }
    if (/FROM\s+workspace_mongo_databases\s+WHERE\s+workspace_id/i.test(s)) {
      return { rows: (mongoByWorkspace[params[0]] ?? []).map((database_name) => ({ database_name })) };
    }
    // SELECT id FROM workspaces WHERE tenant_id (purgeTenant workspaceIds collect)
    if (/SELECT\s+id\s+FROM\s+workspaces\s+WHERE\s+tenant_id/i.test(s)) {
      return { rows: Object.values(workspaces).filter((w) => w.tenant_id === params[0]).map((w) => ({ id: w.id })) };
    }
    return { rows: [] };
  };
  return { deletes, query, connect: async () => ({ query, release() {} }) };
}

// Stub the Postgres/storage/kafka teardown deps so only the mongo cascade is asserted.
const noopTeardown = {
  dropWorkspaceDatabase: async () => {},
  deleteBucket: async () => {},
  deleteTopics: async () => {},
};

test('bbx-682-01: provision (engine=mongodb) records a workspace_mongo_databases row (Scenario 2)', async () => {
  const inserts = [];
  // Fake pool for the provisioning path: resolveWorkspaceForManage needs getWorkspace + getTenant;
  // mongoProvision then inserts into workspace_mongo_databases.
  const pool = {
    query: async (sql, params = []) => {
      const s = String(sql);
      if (/INSERT\s+INTO\s+workspace_mongo_databases/i.test(s)) {
        inserts.push({ sql: s, params });
        return { rows: [{ id: 'm1', workspace_id: params[0], tenant_id: params[1], database_name: params[2], collections: params[3] }] };
      }
      if (/FROM\s+workspaces\s+WHERE/i.test(s)) return { rows: [WS_A] };
      if (/FROM\s+tenants\s+WHERE/i.test(s)) return { rows: [TENANT_A_ROW] };
      return { rows: [] };
    },
  };
  const { client } = fakeMongoClient();
  const ctx = {
    pool, identity: IDENTITY_A, params: { workspaceId: 'ws-a' },
    query: {}, body: { engine: 'mongodb', databaseName: 'app_docs', collections: ['orders', 'customers'] },
    mongoClient: client,
  };
  const res = await HANDLERS.provisionDatabaseGeneric(ctx);
  assert.equal(res.statusCode, 201, `got ${res.statusCode} (${JSON.stringify(res.body)})`);
  assert.equal(res.body.databaseId, 'app_docs');
  assert.equal(inserts.length, 1, 'mongoProvision must record exactly one workspace_mongo_databases row');
  const ins = inserts[0];
  // The row must carry workspace_id, tenant_id, and the (sanitized) database_name.
  assert.equal(ins.params[0], 'ws-a', 'row carries workspace_id');
  assert.equal(ins.params[1], TENANT_A, 'row carries the workspace owning tenant_id');
  assert.equal(ins.params[2], 'app_docs', 'row carries the database_name');
  // Idempotent re-provision: ON CONFLICT DO NOTHING (no owner reassignment).
  assert.ok(/ON\s+CONFLICT/i.test(ins.sql) && /DO\s+NOTHING/i.test(ins.sql),
    'insert must be idempotent via ON CONFLICT DO NOTHING');
});

test('bbx-682-02: tenant purge drops the now-empty FerretDB db + reports it (Scenario 1)', async () => {
  const pool = fakePurgePool({ tenant: TENANT_A_ROW, workspaces: { 'ws-a': WS_A }, mongoByTenant: { [TENANT_A]: ['app_docs'] } });
  // Only tenant A's documents live in app_docs.
  const { client, calls, dbs } = fakeMongoClient({ app_docs: { orders: [{ tenantId: TENANT_A, n: 1 }, { tenantId: TENANT_A, n: 2 }] } });
  const res = await HANDLERS.purgeTenant({
    pool, identity: IDENTITY_SA, params: { tenantId: TENANT_A }, query: {}, body: {},
    ...noopTeardown, mongoClient: client,
  });
  assert.equal(res.statusCode, 200, `got ${res.statusCode} (${JSON.stringify(res.body)})`);
  assert.equal(res.body.purged, true);
  // Documents deleted scoped by {tenantId}.
  assert.ok(calls.deleteMany.some((c) => c.db === 'app_docs' && c.filter.tenantId === TENANT_A),
    `expected a deleteMany({tenantId:${TENANT_A}}) on app_docs; got ${JSON.stringify(calls.deleteMany)}`);
  // The now-empty db is physically dropped and reported.
  assert.deepEqual(calls.dropDatabase, ['app_docs'], 'empty db must be dropped');
  assert.equal(dbs.app_docs.dropped, true);
  assert.deepEqual(res.body.removed.mongoDatabases, ['app_docs'], 'purge response reports the dropped mongo db');
  assert.deepEqual(res.body.removed.mongoDatabasesRetained, [], 'nothing retained when no other tenant has data');
  // The registry row must also be removed.
  const deletedTables = pool.deletes.map((d) => /DELETE\s+FROM\s+(\w+)/i.exec(d.sql)?.[1]).filter(Boolean);
  assert.ok(deletedTables.includes('workspace_mongo_databases'),
    `expected a DELETE FROM workspace_mongo_databases (got ${deletedTables.join(',')})`);
});

test('bbx-682-03: ISOLATION — a shared mongo db with another tenant\'s docs is RETAINED on purge', async () => {
  const pool = fakePurgePool({ tenant: TENANT_A_ROW, workspaces: { 'ws-a': WS_A }, mongoByTenant: { [TENANT_A]: ['shared_docs'] } });
  // shared_docs holds BOTH tenant A and tenant B documents (db/collection names are shared
  // across tenants in the one FerretDB cluster).
  const { client, calls, dbs } = fakeMongoClient({
    shared_docs: { records: [{ tenantId: TENANT_A, n: 1 }, { tenantId: TENANT_B, n: 2 }, { tenantId: TENANT_A, n: 3 }] },
  });
  const res = await HANDLERS.purgeTenant({
    pool, identity: IDENTITY_SA, params: { tenantId: TENANT_A }, query: {}, body: {},
    ...noopTeardown, mongoClient: client,
  });
  assert.equal(res.statusCode, 200);
  // Tenant A's documents were deleted...
  assert.ok(calls.deleteMany.some((c) => c.db === 'shared_docs' && c.filter.tenantId === TENANT_A),
    'tenant A documents must be deleted from the shared db');
  // ...but the db is NEVER dropped (tenant B still has data) — no cross-tenant data loss.
  assert.deepEqual(calls.dropDatabase, [], 'a shared db with another tenant data must NOT be dropped');
  assert.equal(dbs.shared_docs.dropped, false, 'shared db must survive');
  // Tenant B's document is still present (only tenant A removed).
  const survivors = dbs.shared_docs.collections.records;
  assert.equal(survivors.length, 1, 'only tenant B document remains');
  assert.equal(survivors[0].tenantId, TENANT_B, 'the surviving document belongs to the other tenant');
  // The response reflects retention, not a drop.
  assert.deepEqual(res.body.removed.mongoDatabases, [], 'nothing dropped');
  assert.deepEqual(res.body.removed.mongoDatabasesRetained, ['shared_docs'], 'the shared db is reported retained');
});

test('bbx-682-04: workspace delete mirrors the isolation-safe teardown for its mongo db', async () => {
  // Same-named shared db across two tenants; deleting ws-a (tenant A) must remove only
  // tenant A docs and retain the db (tenant B data present).
  const poolShared = fakePurgePool({ workspaces: { 'ws-a': WS_A }, mongoByWorkspace: { 'ws-a': ['ws_shared'] } });
  const shared = fakeMongoClient({ ws_shared: { c: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }] } });
  const resShared = await HANDLERS.deleteWorkspace({
    pool: poolShared, identity: IDENTITY_A, params: { workspaceId: 'ws-a' }, query: {}, body: {},
    ...noopTeardown, mongoClient: shared.client,
  });
  assert.equal(resShared.statusCode, 200, `got ${resShared.statusCode} (${JSON.stringify(resShared.body)})`);
  assert.deepEqual(shared.calls.dropDatabase, [], 'shared db retained on workspace delete');
  assert.deepEqual(resShared.body.removed.mongoDatabasesRetained, ['ws_shared']);

  // Sole-tenant db is dropped on workspace delete.
  const poolSole = fakePurgePool({ workspaces: { 'ws-a': WS_A }, mongoByWorkspace: { 'ws-a': ['ws_only'] } });
  const sole = fakeMongoClient({ ws_only: { c: [{ tenantId: TENANT_A }] } });
  const resSole = await HANDLERS.deleteWorkspace({
    pool: poolSole, identity: IDENTITY_A, params: { workspaceId: 'ws-a' }, query: {}, body: {},
    ...noopTeardown, mongoClient: sole.client,
  });
  assert.equal(resSole.statusCode, 200);
  assert.deepEqual(sole.calls.dropDatabase, ['ws_only'], 'sole-tenant db dropped on workspace delete');
  assert.deepEqual(resSole.body.removed.mongoDatabases, ['ws_only']);
  // Registry row removed.
  const deletedTables = poolSole.deletes.map((d) => /DELETE\s+FROM\s+(\w+)/i.exec(d.sql)?.[1]).filter(Boolean);
  assert.ok(deletedTables.includes('workspace_mongo_databases'), 'workspace_mongo_databases row removed on delete');
});

test('bbx-682-05: best-effort — a failing mongo teardown does NOT abort the purge (rows removed, 200)', async () => {
  const pool = fakePurgePool({ tenant: TENANT_A_ROW, workspaces: { 'ws-a': WS_A }, mongoByTenant: { [TENANT_A]: ['app_docs'] } });
  // Inject a teardown that throws — must be swallowed.
  const res = await HANDLERS.purgeTenant({
    pool, identity: IDENTITY_SA, params: { tenantId: TENANT_A }, query: {}, body: {},
    ...noopTeardown,
    mongoClient: {},
    mongoTeardown: async () => { throw new Error('ferretdb unreachable'); },
  });
  assert.equal(res.statusCode, 200, `purge must still succeed when mongo teardown throws, got ${res.statusCode}`);
  assert.equal(res.body.purged, true);
  // Registry rows still removed.
  const deletedTables = pool.deletes.map((d) => /DELETE\s+FROM\s+(\w+)/i.exec(d.sql)?.[1]).filter(Boolean);
  assert.ok(deletedTables.includes('workspace_mongo_databases'), 'rows removed even when mongo teardown throws');
  assert.ok(deletedTables.includes('tenants'), 'tenant row removed even when mongo teardown throws');
  // Nothing reported dropped (teardown failed) but the purge is not aborted.
  assert.deepEqual(res.body.removed.mongoDatabases, []);
});

test('bbx-682-06: mongoTeardown unit — by-tenant delete, system.* excluded, drop iff empty across all tenants', async () => {
  // db1: only tenant A -> dropped. db2: A + B -> retained. db3: empty except a system marker -> dropped.
  const { client, calls, dbs } = fakeMongoClient({
    db1: { orders: [{ tenantId: TENANT_A }, { tenantId: TENANT_A }] },
    db2: { records: [{ tenantId: TENANT_A }, { tenantId: TENANT_B }] },
    db3: { 'system.dbSentinel': [{ marker: true }] },
  });
  const out = await mongoTeardown({ client, tenantId: TENANT_A, databaseNames: ['db1', 'db2', 'db3'] });
  // db1 + db3 dropped (empty across all tenants after removing tenant A); db2 retained.
  assert.deepEqual(out.dropped.sort(), ['db1', 'db3'], `dropped: ${JSON.stringify(out.dropped)}`);
  assert.deepEqual(out.retained, ['db2'], `retained: ${JSON.stringify(out.retained)}`);
  // The emptiness check must NOT count system.* collections (db3 had only a sentinel).
  assert.ok(!calls.deleteMany.some((c) => c.col.startsWith('system.')),
    'must not deleteMany on system.* collections');
  assert.ok(!calls.countDocuments.some((c) => c.col.startsWith('system.')),
    'emptiness check must exclude system.* collections');
  assert.equal(dbs.db2.dropped, false, 'shared db2 retained');
  assert.equal(dbs.db1.dropped, true, 'sole-tenant db1 dropped');
});
