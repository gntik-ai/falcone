import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const CREATED = '2026-01-01T00:00:00Z';
const WORKSPACES = [
  { id: 'ws1', slug: 'dev', tenant_id: 'tenant-a' },
  { id: 'ws2', slug: 'prod', tenant_id: 'tenant-a' },
  { id: 'ws3', slug: 'other', tenant_id: 'tenant-b' },
];
const BUCKETS = [
  ['bucket-z', 'ws1', 'tenant-a'],
  ['bucket-prod', 'ws2', 'tenant-a'],
  ['bucket-a', 'ws1', 'tenant-a'],
  ['bucket-other', 'ws3', 'tenant-b'],
  ['bucket-m', 'ws1', 'tenant-a'],
].map(([bucket_name, workspace_id, tenant_id]) => ({
  bucket_name, workspace_id, tenant_id, region: 'eu-west-1', created_at: CREATED,
}));

function caller(roles = ['workspace_viewer'], workspaceIds = ['ws1'], tenantId = 'tenant-a') {
  return { actorType: 'tenant_member', roles, workspaceIds, tenantId };
}

// Mock only the database and network boundaries; use the real store and handler.
function fixture(t, identity = caller(), workspaceId = 'ws1', query = {}) {
  let bucketQueries = 0;
  let s3Calls = 0;
  const limits = [];
  t.mock.method(globalThis, 'fetch', async () => {
    s3Calls++;
    throw new Error('workspace listing must not use S3');
  });
  t.after(() => assert.equal(s3Calls, 0, 'no S3 call on any path'));
  const ctx = { identity, params: { workspaceId }, query, headers: {}, body: {}, pool: {
    async query(sql, params) {
      if (sql.includes('FROM workspaces')) {
        return { rows: WORKSPACES.filter((ws) => ws.id === params[0] || ws.slug === params[0]) };
      }
      if (sql.includes('FROM workspace_buckets')) {
        bucketQueries++;
        assert.match(sql, /ORDER BY bucket_name LIMIT \$4/);
        const [ws, tenant, after, limit] = params;
        limits.push(limit);
        return { rows: BUCKETS.filter((b) => b.workspace_id === ws && b.tenant_id === tenant
          && (after == null || b.bucket_name > after))
          .sort((a, b) => a.bucket_name < b.bucket_name ? -1 : 1).slice(0, limit) };
      }
      throw new Error('unexpected database query');
    },
  } };
  return { ctx, limits, bucketQueries: () => bucketQueries };
}

test('bound workspace viewers and tenant admins get only sorted workspace registry buckets in the legacy shape', async (t) => {
  for (const identity of [caller(), caller(['tenant_owner'], []), caller(['tenant_admin'], [])]) {
    const { ctx } = fixture(t, identity);
    const result = await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      items: ['bucket-a', 'bucket-m', 'bucket-z'].map((name) => ({
        resourceId: name, bucketName: name, tenantId: 'tenant-a', workspaceId: 'ws1',
        region: 'eu-west-1', status: 'active', timestamps: { createdAt: CREATED, lastModifiedAt: CREATED },
      })), page: { size: 3 },
    });
  }
});

test('walking name cursors yields every workspace bucket once and omits the final cursor', async (t) => {
  const { ctx, limits } = fixture(t, caller(), 'ws1', { 'page[size]': '2' });
  const first = await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.items.map((b) => b.bucketName), ['bucket-a', 'bucket-m']);
  assert.deepEqual(first.body.page, { size: 2, nextCursor: 'bucket-m' });
  ctx.query['page[after]'] = first.body.page.nextCursor;
  const last = await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx);
  assert.deepEqual(last.body.page, { size: 1 });
  assert.deepEqual([...first.body.items, ...last.body.items].map((b) => b.bucketName), ['bucket-a', 'bucket-m', 'bucket-z']);
  ctx.query['page[after]'] = 'bucket-z';
  assert.deepEqual((await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx)).body, { items: [], page: { size: 0 } });
  assert.deepEqual(limits, [3, 3, 3], 'one lookahead row per page');
});

test('invalid page sizes are bounded, never a database error or 5xx', async (t) => {
  for (const [value, expectedLimit] of [[undefined, 51], ['0', 51], ['-5', 2], ['abc', 51], ['201', 201],
    ['Infinity', 201], ['-Infinity', 2], ['2.9', 3], ['0.5', 2]]) {
    const { ctx, limits } = fixture(t, caller(), 'ws1', { 'page[size]': value });
    const result = await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx);
    assert.equal(result.statusCode, 200, String(value));
    assert.deepEqual(limits, [expectedLimit], String(value));
    assert.ok(result.body.items.length <= expectedLimit - 1);
  }
});

test('foreign and missing workspaces have identical 404 status and code before listing', async (t) => {
  const identity = caller(['workspace_owner'], ['ws3'], 'tenant-b');
  for (const workspaceId of ['ws1', 'missing']) {
    const { ctx, bucketQueries } = fixture(t, identity, workspaceId);
    const result = await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx);
    assert.equal(result.statusCode, 404);
    assert.deepEqual(result.body, { code: 'WORKSPACE_NOT_FOUND', message: `workspace ${workspaceId} not found` });
    assert.equal(bucketQueries(), 0, 'ownership denial precedes pagination');
  }
});

test('same-tenant callers need verified authority and request fields cannot supply a binding', async (t) => {
  const denied = [caller(['tenant_viewer'], []), caller(['workspace_viewer'], ['ws2']),
    caller(['unknown-role'], ['ws1']), caller(['workspace_viewer'], []),
    { ...caller([], []), isServiceAccount: true }];
  for (const identity of denied) {
    const { ctx, bucketQueries } = fixture(t, identity, 'ws1', {
      workspaceId: 'ws1', workspaceIds: ['ws1'], 'page[size]': '1', 'page[after]': 'bucket-a',
    });
    ctx.body = { workspaceId: 'ws1', workspaceIds: ['ws1'], roles: ['tenant_owner'] };
    ctx.headers = { 'x-workspace-id': 'ws1', 'x-actor-roles': 'tenant_owner' };
    const result = await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx);
    assert.equal(result.statusCode, 403);
    assert.deepEqual(result.body, { code: 'FORBIDDEN', message: 'caller may not read buckets in this workspace' });
    assert.equal(bucketQueries(), 0, 'read denial precedes pagination');
  }
});

test('model read/write/admin authority and bound tenant roles retain the existing bucket-read policy', async (t) => {
  for (const roles of [['workspace_owner'], ['workspace_admin'], ['workspace_developer'], ['workspace_service_account'],
    ['tenant_viewer'], ['tenant_developer']]) {
    const { ctx } = fixture(t, caller(roles));
    assert.equal((await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx)).statusCode, 200, roles[0]);
  }
});

test('superadmin and internal actors can list any tenant workspace with no roles or bindings', async (t) => {
  for (const actorType of ['superadmin', 'internal']) {
    for (const [workspaceId, expected] of [['ws1', ['bucket-a', 'bucket-m', 'bucket-z']], ['ws3', ['bucket-other']]]) {
      const { ctx } = fixture(t, { actorType, tenantId: null }, workspaceId);
      const result = await STORAGE_HANDLERS.storageListWorkspaceBuckets(ctx);
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.body.items.map((b) => b.bucketName), expected);
    }
  }
});
