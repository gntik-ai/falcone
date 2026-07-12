/**
 * Unit tests for cross-tenant workspace LIST isolation in the kind control-plane
 * (fix-800-workspace-list-tenant-scope, issue #800 — CONFIRMED tenant-isolation fail-open).
 *
 * Lives in tests/unit/ (run in CI via `pnpm test:unit`) like the twin
 * function-list-tenant-scope.test.mjs (#784). Drives the public LOCAL_HANDLERS interface
 * and the exported listWorkspaces store function with a fake pg pool — no internal
 * knowledge assumed.
 *
 * Root cause: listWorkspaces in tenant-store.mjs used `tenantId ? 'WHERE …' : ''`
 * (truthy guard), so a null tenantId silently dropped the WHERE predicate and returned
 * every tenant's workspaces. The handler passed identity.tenantId (null for a principal
 * with no resolvable tenant) with no gate, leaking workspace ids, tenant_ids, slugs,
 * display names, environments, and creators across tenants.
 *
 * Each test is RED on the unfixed code and GREEN after the fix.
 *
 * bbx-ws-list-scope-01: non-platform principal with tenantId=null → 200 empty (fail-closed)
 * bbx-ws-list-scope-02: tenant_owner with real tenantId → only own tenant's workspaces
 * bbx-ws-list-scope-03: superadmin with no filter → all workspaces (regression guard)
 * bbx-ws-list-scope-04: superadmin with filter[tenantId] → only that tenant's workspaces
 * bbx-ws-list-scope-05: agreement — same principal 403'd on by-id is also absent from LIST
 * STORE-01: listWorkspaces(pool,{tenantId:null}) → empty, no unscoped query issued
 * STORE-02: listWorkspaces(pool,{tenantId:null,allTenants:true}) → all rows (superadmin path)
 * STORE-03: listWorkspaces(pool,{tenantId:'tenant-a'}) → only tenant-A rows
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { listWorkspaces } from '../../apps/control-plane/tenant-store.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

/** Workspace owned by Tenant A — contains a recognizable slug and tenantId. */
const WS_A = {
  id: 'ws-aaaa-0001',
  tenant_id: 'tenant-a',
  slug: 'acme-prod',
  display_name: 'Acme Production',
  status: 'active',
  environment: 'prod',
  created_at: NOW,
  created_by: 'user-a-1',
};

/** Workspace owned by Tenant B. */
const WS_B = {
  id: 'ws-bbbb-0001',
  tenant_id: 'tenant-b',
  slug: 'beta-dev',
  display_name: 'Beta Dev',
  status: 'active',
  environment: 'dev',
  created_at: NOW,
  created_by: 'user-b-1',
};

const ALL_WORKSPACES = [WS_A, WS_B];

/**
 * Build a fake pg pool that simulates the workspaces table.
 *
 * For queries against `workspaces`:
 *  - With no WHERE clause (unscoped) → return ALL_WORKSPACES (both tenants).
 *  - With WHERE tenant_id = $3 (param[2]) → filter to matching tenant rows.
 *  - For getWorkspace by id (WHERE id = $1) → exact id match.
 *
 * Tracks all SQL statements issued so tests can assert on them.
 */
function fakePool({ rows = ALL_WORKSPACES } = {}) {
  const queries = [];
  const pool = {
    _queries: queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      // getWorkspace by id/slug — used by getWorkspace handler
      if (sql.includes('workspaces') && sql.includes('id = $1') && sql.includes('OR slug')) {
        const match = rows.find((r) => r.id === params[0] || r.slug === params[0]);
        return { rows: match ? [match] : [] };
      }
      // listWorkspaces — ORDER BY created_at DESC LIMIT … with optional WHERE tenant_id = $3
      if (sql.includes('workspaces') && sql.includes('ORDER BY created_at')) {
        let out;
        if (sql.includes('WHERE tenant_id')) {
          // tenantId is param[2] (params[0]=limit, params[1]=offset, params[2]=tenantId)
          out = rows.filter((r) => r.tenant_id === params[2]);
        } else {
          // Unscoped — returns all rows (represents the pre-fix footgun)
          out = rows;
        }
        const withTotal = out.map((r) => ({ ...r, total: out.length }));
        return { rows: withTotal };
      }
      return { rows: [] };
    },
  };
  return pool;
}

/** Identity: non-platform principal with no resolvable tenant (the #800 attacker). */
const IDENTITY_TENANTLESS = {
  sub: 'platform-viewer-1',
  tenantId: null,
  workspaceId: null,
  actorType: 'tenant_member',
  roles: ['tenant_viewer'],
  scopes: [],
};

/** Identity: Tenant A owner. */
const IDENTITY_A = {
  sub: 'user-a-1',
  tenantId: 'tenant-a',
  workspaceId: 'ws-aaaa-0001',
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: [],
};

/** Identity: superadmin (cross-tenant bypass). */
const IDENTITY_SA = {
  sub: 'superadmin-1',
  tenantId: null,
  workspaceId: null,
  actorType: 'superadmin',
  roles: ['superadmin'],
  scopes: [],
};

function makeCtx(identity, query = {}) {
  return {
    pool: fakePool(),
    params: {},
    query,
    body: {},
    identity,
    callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId },
  };
}

// ===========================================================================
// HANDLER TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// bbx-ws-list-scope-01 — DECISIVE #800 ASSERTION
// A non-platform principal with tenantId=null must get an empty list,
// NOT all tenants' workspaces. RED on unfixed code.
// ---------------------------------------------------------------------------
test('bbx-ws-list-scope-01: tenant_member with tenantId=null → 200 empty (fail-closed, no foreign rows)', async () => {
  const ctx = makeCtx(IDENTITY_TENANTLESS);
  const result = await LOCAL_HANDLERS.listWorkspaces(ctx);
  assert.equal(result.statusCode, 200,
    `expected 200 (fail-closed empty), got ${result.statusCode} (body: ${JSON.stringify(result.body)})`);
  const items = result.body?.items ?? [];
  assert.equal(items.length, 0,
    `expected 0 items (fail-closed), got ${items.length}: ${JSON.stringify(items)}`);
  // Confirm none of the foreign tenants' data leaked through
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes('tenant-a'), 'response must not leak tenant-a id');
  assert.ok(!serialized.includes('tenant-b'), 'response must not leak tenant-b id');
  assert.ok(!serialized.includes('acme-prod'), 'response must not leak Tenant A slug');
  assert.ok(!serialized.includes('beta-dev'), 'response must not leak Tenant B slug');
});

// ---------------------------------------------------------------------------
// bbx-ws-list-scope-02 — own-tenant principal sees only its own workspaces
// ---------------------------------------------------------------------------
test('bbx-ws-list-scope-02: tenant_owner with real tenantId → 200 only own tenant workspaces', async () => {
  const ctx = makeCtx(IDENTITY_A);
  const result = await LOCAL_HANDLERS.listWorkspaces(ctx);
  assert.equal(result.statusCode, 200,
    `expected 200 for own-tenant list, got ${result.statusCode}`);
  const items = result.body?.items ?? [];
  // Must include Tenant A's workspace
  assert.ok(items.some((w) => w.workspaceId === 'ws-aaaa-0001' || w.id === 'ws-aaaa-0001'),
    'must include Tenant A workspace');
  // Must NOT include Tenant B's workspace
  const serialized = JSON.stringify(items);
  assert.ok(!serialized.includes('ws-bbbb-0001'), 'must not include Tenant B workspace');
  assert.ok(!serialized.includes('tenant-b'), 'must not leak tenant-b id');
});

// ---------------------------------------------------------------------------
// bbx-ws-list-scope-03 — superadmin with no filter → all workspaces (regression guard)
// ---------------------------------------------------------------------------
test('bbx-ws-list-scope-03: superadmin no filter → 200 all workspaces (regression guard)', async () => {
  const ctx = makeCtx(IDENTITY_SA, {});
  const result = await LOCAL_HANDLERS.listWorkspaces(ctx);
  assert.equal(result.statusCode, 200,
    `expected 200 for superadmin list, got ${result.statusCode}`);
  const items = result.body?.items ?? [];
  const ids = items.map((w) => w.workspaceId ?? w.id);
  assert.ok(ids.includes('ws-aaaa-0001'), 'superadmin must see Tenant A workspace');
  assert.ok(ids.includes('ws-bbbb-0001'), 'superadmin must see Tenant B workspace');
});

// ---------------------------------------------------------------------------
// bbx-ws-list-scope-04 — superadmin with filter[tenantId] → only that tenant
// ---------------------------------------------------------------------------
test('bbx-ws-list-scope-04: superadmin with filter[tenantId]=tenant-a → only Tenant A workspaces', async () => {
  const ctx = makeCtx(IDENTITY_SA, { 'filter[tenantId]': 'tenant-a' });
  const result = await LOCAL_HANDLERS.listWorkspaces(ctx);
  assert.equal(result.statusCode, 200,
    `expected 200 for superadmin filtered list, got ${result.statusCode}`);
  const items = result.body?.items ?? [];
  const ids = items.map((w) => w.workspaceId ?? w.id);
  assert.ok(ids.includes('ws-aaaa-0001'), 'filtered list must include Tenant A workspace');
  const serialized = JSON.stringify(items);
  assert.ok(!serialized.includes('ws-bbbb-0001'), 'filtered list must not include Tenant B workspace');
});

// ---------------------------------------------------------------------------
// bbx-ws-list-scope-05 — agreement: principal 403'd on getWorkspace by-id
// is also NOT present in its LIST (same tenantId=null principal)
// ---------------------------------------------------------------------------
test('bbx-ws-list-scope-05: principal 403d on getWorkspace by-id sees no workspace in LIST', async () => {
  // Confirm getWorkspace returns 403 for tenantless principal (by-id already gates)
  const getCtx = {
    pool: fakePool(),
    params: { workspaceId: 'ws-aaaa-0001' },
    query: {},
    body: {},
    identity: IDENTITY_TENANTLESS,
    callerContext: { actor: { id: IDENTITY_TENANTLESS.sub, type: IDENTITY_TENANTLESS.actorType }, tenantId: null },
  };
  const getResult = await LOCAL_HANDLERS.getWorkspace(getCtx);
  assert.equal(getResult.statusCode, 403,
    `expected getWorkspace to 403 for tenantless principal, got ${getResult.statusCode}`);

  // LIST must also return empty for that same principal
  const listCtx = makeCtx(IDENTITY_TENANTLESS);
  const listResult = await LOCAL_HANDLERS.listWorkspaces(listCtx);
  assert.equal(listResult.statusCode, 200,
    `expected listWorkspaces to return 200 empty for tenantless principal, got ${listResult.statusCode}`);
  const items = listResult.body?.items ?? [];
  assert.equal(items.length, 0,
    `expected 0 items in LIST for tenantless principal (agreement with by-id 403), got ${items.length}`);
});

// ===========================================================================
// STORE-LEVEL TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// STORE-01: listWorkspaces(pool, {tenantId:null}) → {items:[],total:0}
// and asserts NO unscoped query was issued.
// RED on unfixed code because the old code skipped the early-return guard and
// ran an unscoped query.
// ---------------------------------------------------------------------------
test('STORE-01: listWorkspaces({tenantId:null}) → empty, no SQL query issued', async () => {
  const pool = fakePool();
  const result = await listWorkspaces(pool, { tenantId: null });
  assert.deepEqual(result, { items: [], total: 0 },
    `expected {items:[],total:0}, got ${JSON.stringify(result)}`);
  // The fail-closed guard returns early — no query should have been issued
  assert.equal(pool._queries.length, 0,
    `expected 0 SQL queries for null tenantId (fail-closed early return), issued: ${pool._queries.length}`);
});

// ---------------------------------------------------------------------------
// STORE-02: listWorkspaces(pool, {tenantId:null, allTenants:true}) → all rows
// (the superadmin unscoped path; requires explicit opt-in).
// ---------------------------------------------------------------------------
test('STORE-02: listWorkspaces({tenantId:null,allTenants:true}) → all workspace rows', async () => {
  const pool = fakePool();
  const result = await listWorkspaces(pool, { tenantId: null, allTenants: true });
  const ids = result.items.map((r) => r.id);
  assert.ok(ids.includes('ws-aaaa-0001'), 'allTenants path must include Tenant A workspace');
  assert.ok(ids.includes('ws-bbbb-0001'), 'allTenants path must include Tenant B workspace');
  assert.equal(result.total, 2, 'total must reflect all rows');
  // The query must NOT include a WHERE tenant_id predicate
  const q = pool._queries.find((q) => q.sql.includes('workspaces') && q.sql.includes('ORDER BY'));
  assert.ok(q, 'a workspaces query must have been issued');
  assert.ok(!q.sql.includes('WHERE tenant_id'),
    'allTenants query must NOT include WHERE tenant_id predicate');
});

// ---------------------------------------------------------------------------
// STORE-03: listWorkspaces(pool, {tenantId:'tenant-a'}) → only Tenant A rows;
// assert SQL includes WHERE tenant_id = $3 and param[2]==='tenant-a'.
// ---------------------------------------------------------------------------
test('STORE-03: listWorkspaces({tenantId:"tenant-a"}) → only Tenant A rows, scoped SQL', async () => {
  const pool = fakePool();
  const result = await listWorkspaces(pool, { tenantId: 'tenant-a' });
  const ids = result.items.map((r) => r.id);
  assert.ok(ids.includes('ws-aaaa-0001'), 'scoped query must include Tenant A workspace');
  assert.ok(!ids.includes('ws-bbbb-0001'), 'scoped query must NOT include Tenant B workspace');
  assert.equal(result.total, 1, 'total must be 1 (only Tenant A)');
  // Confirm the WHERE predicate was in the SQL and param[2] is the tenantId
  const q = pool._queries.find((q) => q.sql.includes('workspaces') && q.sql.includes('ORDER BY'));
  assert.ok(q, 'a workspaces query must have been issued');
  assert.ok(q.sql.includes('WHERE tenant_id'),
    'scoped query must include WHERE tenant_id predicate');
  assert.equal(q.params[2], 'tenant-a',
    `expected params[2]==='tenant-a', got ${JSON.stringify(q.params[2])}`);
});
