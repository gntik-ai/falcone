/**
 * Black-box tests for the workspace teardown API
 * (add-deploy-completeness-cluster, #562 — deliverable (a)).
 *
 * The gap (live 2-tenant E2E, 2026-06-18): only the TENANT purge cascades; a single
 * project/workspace could not be torn down — `DELETE /v1/workspaces/{workspaceId}`
 * was NO_ROUTE, so its per-workspace database, bucket(s), topic(s), service-account
 * rows, and the workspace row itself leaked when one workspace was retired.
 *
 * The fix adds a `deleteWorkspace` LOCAL handler that MIRRORS the tenant purge
 * cascade for ONE workspace, tenant-scoped: it resolves the workspace, gates that
 * the caller owns it (a tenant owner may delete ONLY a workspace whose tenant_id
 * matches their identity; superadmin/internal may delete any), then collects and
 * removes the workspace's owned resources — best-effort physical teardown (DB drop,
 * bucket/topic delete) + reliable registry-row teardown — leaving no orphaned rows.
 *
 * Drives the PUBLIC LOCAL_HANDLERS interface only, with a fake pool + injected
 * teardown deps (pg/storage/kafka) that RECORD the cascade calls, so the teardown
 * is asserted deterministically and a cross-tenant DELETE is proven to perform NO
 * teardown and to NOT leak existence (404).
 *
 * bbx-562-wsdel-00: DELETE /v1/workspaces/{workspaceId} is routed (was NO_ROUTE)
 * bbx-562-wsdel-01: owner deletes own workspace → 200; DB dropped, bucket + topic gone, rows removed
 * bbx-562-wsdel-02: the workspace row + its service-account/database/bucket/topic rows are all deleted
 * bbx-562-wsdel-03: cross-tenant DELETE → 404 (no existence leak) and NO teardown performed
 * bbx-562-wsdel-04: superadmin may delete any tenant's workspace (full cascade)
 * bbx-562-wsdel-05: unknown workspace id → 404 (no teardown)
 * bbx-562-wsdel-06: physical teardown failures are best-effort — rows still removed, 200 returned
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS as HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { routes } from '../../apps/control-plane/routes.mjs';

const WS_A = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app-staging', display_name: 'App Staging', status: 'active', environment: 'staging' };
const WS_B = { id: 'ws-b', tenant_id: 'tenant-b', slug: 'other-app', display_name: 'Other App', status: 'active', environment: 'dev' };
const WORKSPACES = { 'ws-a': WS_A, 'ws-b': WS_B };

// Per-workspace owned resources the cascade must collect + tear down.
const OWNED = {
  'ws-a': {
    databases: ['wsdb_tenant_a_app_staging'],
    buckets: ['tenant-a-app-staging'],
    topics: ['tenant-a.app-staging.events'],
  },
  'ws-b': {
    databases: ['wsdb_tenant_b_other_app'],
    buckets: ['tenant-b-other-app'],
    topics: ['tenant-b.other-app.events'],
  },
};

// A fake pool that:
//   - resolves a workspace by id (getWorkspace),
//   - returns the workspace's owned physical resources (collect SELECTs), and
//   - RECORDS every DELETE so we can assert the registry rows were removed.
function fakePool(workspaceId) {
  const deletes = [];
  const owned = OWNED[workspaceId] ?? { databases: [], buckets: [], topics: [] };
  const query = async (sql, params = []) => {
    const s = String(sql);
    if (/^\s*DELETE\s+FROM/i.test(s)) { deletes.push({ sql: s.trim(), params }); return { rows: [], rowCount: 1 }; }
    if (/FROM\s+workspaces\s+WHERE/i.test(s)) {
      return { rows: WORKSPACES[params[0]] ? [WORKSPACES[params[0]]] : [] };
    }
    if (/FROM\s+workspace_databases/i.test(s)) return { rows: owned.databases.map((database_name) => ({ database_name })) };
    if (/FROM\s+workspace_buckets/i.test(s)) return { rows: owned.buckets.map((bucket_name) => ({ bucket_name })) };
    if (/FROM\s+workspace_topics/i.test(s)) return { rows: owned.topics.map((physical_topic_name) => ({ physical_topic_name })) };
    return { rows: [] };
  };
  return { deletes, query, connect: async () => ({ query, release() {} }) };
}

// Recording teardown deps injected via ctx — never touch real PG/S3/Kafka.
function fakeTeardown(opts = {}) {
  const calls = { dropDatabase: [], deleteBucket: [], deleteTopics: [] };
  return {
    calls,
    dropWorkspaceDatabase: async (_pool, db) => { if (opts.dbThrows) throw new Error('drop failed'); calls.dropDatabase.push(db); },
    deleteBucket: async (b) => { if (opts.bucketThrows) throw new Error('bucket gone'); calls.deleteBucket.push(b); },
    deleteTopics: async (topics) => { if (opts.topicsThrows) throw new Error('kafka down'); calls.deleteTopics.push(...(topics ?? [])); },
  };
}

const IDENTITY_A = { sub: 'user-a', tenantId: 'tenant-a', actorType: 'tenant_owner', roles: ['tenant_owner'] };
const IDENTITY_B = { sub: 'user-b', tenantId: 'tenant-b', actorType: 'tenant_owner', roles: ['tenant_owner'] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, actorType: 'superadmin', roles: ['superadmin'] };

function ctx(identity, workspaceId, teardown) {
  return {
    pool: fakePool(workspaceId), identity, params: { workspaceId }, query: {}, body: {},
    callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId },
    ...teardown && {
      dropWorkspaceDatabase: teardown.dropWorkspaceDatabase,
      deleteBucket: teardown.deleteBucket,
      deleteTopics: teardown.deleteTopics,
    },
  };
}

test('bbx-562-wsdel-00: DELETE /v1/workspaces/{workspaceId} is routed (was NO_ROUTE)', () => {
  const r = routes.find((x) => x.method === 'DELETE' && x.path === '/v1/workspaces/{workspaceId}');
  assert.ok(r, 'expected a DELETE /v1/workspaces/{workspaceId} route');
  assert.equal(r.localHandler, 'deleteWorkspace');
  assert.equal(typeof HANDLERS.deleteWorkspace, 'function', 'deleteWorkspace handler must be exported');
});

test('bbx-562-wsdel-01: owner deletes own workspace → 200; DB dropped, bucket + topic gone', async () => {
  const td = fakeTeardown();
  const res = await HANDLERS.deleteWorkspace(ctx(IDENTITY_A, 'ws-a', td));
  assert.equal(res.statusCode, 200, `got ${res.statusCode} (${JSON.stringify(res.body)})`);
  assert.equal(res.body.workspaceId, 'ws-a');
  assert.equal(res.body.deleted, true);
  assert.deepEqual(td.calls.dropDatabase, OWNED['ws-a'].databases, 'must drop the per-workspace wsdb_* database');
  assert.deepEqual(td.calls.deleteBucket, OWNED['ws-a'].buckets, 'must delete the workspace bucket(s)');
  assert.deepEqual(td.calls.deleteTopics, OWNED['ws-a'].topics, 'must delete the workspace Kafka topic(s)');
});

test('bbx-562-wsdel-02: the workspace + its child registry rows are all deleted', async () => {
  const td = fakeTeardown();
  const c = ctx(IDENTITY_A, 'ws-a', td);
  await HANDLERS.deleteWorkspace(c);
  const deletedTables = c.pool.deletes.map((d) => {
    const m = /DELETE\s+FROM\s+(\w+)/i.exec(d.sql);
    return m ? m[1] : null;
  }).filter(Boolean);
  // The workspace row itself + its child rows must be removed (mirrors purgeTenant's row teardown).
  assert.ok(deletedTables.includes('workspaces'), `expected the workspaces row to be deleted (got: ${deletedTables.join(',')})`);
  for (const t of ['workspace_databases', 'workspace_buckets', 'workspace_topics', 'service_accounts']) {
    assert.ok(deletedTables.includes(t), `expected a DELETE FROM ${t} (got: ${deletedTables.join(',')})`);
  }
  // Every delete must be scoped by the workspace id (tenant-owned teardown, no broad wipe).
  for (const d of c.pool.deletes) {
    assert.ok(d.params.some((p) => Array.isArray(p) ? p.includes('ws-a') : p === 'ws-a'),
      `every teardown delete must be scoped to ws-a; offending: ${d.sql} :: ${JSON.stringify(d.params)}`);
  }
});

test('bbx-562-wsdel-03: cross-tenant DELETE → 404 (no existence leak) and NO teardown', async () => {
  const td = fakeTeardown();
  // tenant B owner tries to delete tenant A's workspace.
  const c = ctx(IDENTITY_B, 'ws-a', td);
  const res = await HANDLERS.deleteWorkspace(c);
  assert.ok(res.statusCode === 404 || res.statusCode === 403, `cross-tenant must be 404/403, got ${res.statusCode}`);
  assert.deepEqual(td.calls.dropDatabase, [], 'no DB drop on a denied cross-tenant delete');
  assert.deepEqual(td.calls.deleteBucket, [], 'no bucket delete on a denied cross-tenant delete');
  assert.deepEqual(td.calls.deleteTopics, [], 'no topic delete on a denied cross-tenant delete');
  assert.deepEqual(c.pool.deletes, [], 'no registry rows removed on a denied cross-tenant delete');
});

test('bbx-562-wsdel-04: superadmin may delete any tenant workspace (full cascade)', async () => {
  const td = fakeTeardown();
  const res = await HANDLERS.deleteWorkspace(ctx(IDENTITY_SA, 'ws-b', td));
  assert.equal(res.statusCode, 200, `got ${res.statusCode} (${JSON.stringify(res.body)})`);
  assert.deepEqual(td.calls.dropDatabase, OWNED['ws-b'].databases);
  assert.deepEqual(td.calls.deleteBucket, OWNED['ws-b'].buckets);
  assert.deepEqual(td.calls.deleteTopics, OWNED['ws-b'].topics);
});

test('bbx-562-wsdel-05: unknown workspace id → 404 (no teardown)', async () => {
  const td = fakeTeardown();
  const c = ctx(IDENTITY_SA, 'ws-missing', td);
  const res = await HANDLERS.deleteWorkspace(c);
  assert.equal(res.statusCode, 404, `got ${res.statusCode} (${JSON.stringify(res.body)})`);
  assert.deepEqual(td.calls.dropDatabase, []);
  assert.deepEqual(c.pool.deletes, []);
});

test('bbx-562-wsdel-06: physical teardown failures are best-effort — rows still removed, 200', async () => {
  const td = fakeTeardown({ dbThrows: true, bucketThrows: true, topicsThrows: true });
  const c = ctx(IDENTITY_A, 'ws-a', td);
  const res = await HANDLERS.deleteWorkspace(c);
  assert.equal(res.statusCode, 200, `best-effort teardown must still succeed, got ${res.statusCode}`);
  assert.equal(res.body.deleted, true);
  const deletedTables = c.pool.deletes.map((d) => /DELETE\s+FROM\s+(\w+)/i.exec(d.sql)?.[1]).filter(Boolean);
  assert.ok(deletedTables.includes('workspaces'), 'rows must be removed even when physical teardown throws');
});
