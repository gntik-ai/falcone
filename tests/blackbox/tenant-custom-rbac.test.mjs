/**
 * Black-box tests for add-tenant-custom-rbac (management surface + validation half).
 *
 * Drives the public handler exports of the tenant custom-role catalog module
 * (apps/control-plane-executor/src/iam-tenant-roles.mjs) through their injected `db`
 * dependency and gateway-trusted identity headers — no internal knowledge
 * beyond the public function signatures.
 *
 * The runtime ENFORCEMENT half (a user assigned a custom role passing/denying a
 * gateway scope check, tasks 2.7/2.8) is infra-bound (Keycloak token issuance +
 * gateway scope-enforcement) and is DEFERRED; those scenarios are intentionally
 * NOT covered here.
 *
 * In-scope scenarios (management + validation):
 *   bbx-tcr-create-valid       (task 2.2) valid `custom:` role, subset → 201 + persisted
 *   bbx-tcr-no-prefix          (task 2.3) name without `custom:` prefix → 422
 *   bbx-tcr-reserved-name      (task 2.4) name matching RESERVED_ROLE_NAMES → 422
 *   bbx-tcr-platform-action    (task 2.5) platform-scoped action (tenant.suspend) → 403
 *   bbx-tcr-platform-app-admin (task 2.5) platform-scoped action (app.admin) → 403 regardless of role
 *   bbx-tcr-not-held-action    (task 2.6) action creator does not hold → 403
 *   bbx-tcr-cross-tenant-get   (task 2.9) cross-tenant GET by id → 404
 *   bbx-tcr-list-scoped        (list scoping) caller sees only own tenant's roles
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTenantCustomRole,
  listTenantCustomRoles,
  getTenantCustomRole,
} from '../../apps/control-plane-executor/src/iam-tenant-roles.mjs';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const TENANT_A = 'ten_aaaaaaaaaaaa';
const TENANT_B = 'ten_bbbbbbbbbbbb';
const WORKSPACE_A = 'wsp_aaaaaaaaaaaa';

/**
 * In-memory fake of the control-plane DB used by the handlers. Mirrors a minimal
 * `query(text, values)` → { rows } interface and stores tenant_custom_roles rows.
 */
function fakeDb(seed = []) {
  // Normalize seed rows to match the DB schema defaults (deleted_at defaults to
  // NULL for active rows), so soft-delete filtering behaves like the real table.
  const rows = seed.map((r) => ({ workspace_id: null, deleted_at: null, ...r }));
  let nextId = rows.length + 1;
  return {
    rows,
    insert(record) {
      const row = {
        id: record.id ?? `tcr_${String(nextId++).padStart(4, '0')}`,
        tenant_id: record.tenant_id,
        workspace_id: record.workspace_id ?? null,
        role_name: record.role_name,
        allowed_actions: [...record.allowed_actions],
        created_by: record.created_by ?? null,
        created_at: record.created_at ?? '2026-06-09T00:00:00Z',
        updated_at: record.updated_at ?? '2026-06-09T00:00:00Z',
        deleted_at: null,
      };
      rows.push(row);
      return row;
    },
    findById(id) {
      return rows.find((r) => r.id === id && r.deleted_at === null) ?? null;
    },
    listByScope(tenantId, workspaceId) {
      return rows.filter(
        (r) =>
          r.tenant_id === tenantId &&
          (r.workspace_id ?? null) === (workspaceId ?? null) &&
          r.deleted_at === null,
      );
    },
  };
}

/** Trusted gateway headers for a tenant_admin actor. */
function adminHeaders({ tenant = TENANT_A, workspace = WORKSPACE_A, roles = 'tenant_admin' } = {}) {
  return {
    'x-tenant-id': tenant,
    'x-workspace-id': workspace,
    'x-auth-subject': 'user:admin',
    'x-actor-roles': roles,
    'x-actor-scopes': 'openid profile',
  };
}

// ---------------------------------------------------------------------------
// task 2.2 — valid custom: role, subset → 201 + persisted
// ---------------------------------------------------------------------------

test('bbx-tcr-create-valid: tenant admin creates a valid custom: role with a subset of their permissions → 201 + persisted', async () => {
  const db = fakeDb();
  const result = await createTenantCustomRole(
    {
      __ow_headers: adminHeaders(),
      role_name: 'custom:auditors',
      allowed_actions: ['tenant.audit.read', 'workspace.policy.manage'],
    },
    { db },
  );
  assert.equal(result.statusCode, 201, `expected 201, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  // persisted under the caller's (tenant_id, workspace_id)
  assert.equal(db.rows.length, 1, 'role must be persisted');
  const persisted = db.rows[0];
  assert.equal(persisted.tenant_id, TENANT_A);
  assert.equal(persisted.workspace_id, WORKSPACE_A);
  assert.equal(persisted.role_name, 'custom:auditors');
  assert.deepEqual(
    [...persisted.allowed_actions].sort(),
    ['tenant.audit.read', 'workspace.policy.manage'].sort(),
  );
  // response echoes the created record
  assert.ok(result.body?.id, 'response must include the created role id');
  assert.equal(result.body.role_name, 'custom:auditors');
});

// ---------------------------------------------------------------------------
// task 2.3 — name without custom: prefix → 422
// ---------------------------------------------------------------------------

test('bbx-tcr-no-prefix: role name without custom: prefix → 422', async () => {
  const db = fakeDb();
  const result = await createTenantCustomRole(
    {
      __ow_headers: adminHeaders(),
      role_name: 'auditors',
      allowed_actions: ['tenant.audit.read'],
    },
    { db },
  );
  assert.equal(result.statusCode, 422, `expected 422, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  assert.equal(db.rows.length, 0, 'invalid role must not be persisted');
});

// ---------------------------------------------------------------------------
// task 2.4 — name matching RESERVED_ROLE_NAMES → 422
// ---------------------------------------------------------------------------

test('bbx-tcr-reserved-name: role name matching a RESERVED_ROLE_NAMES entry → 422', async () => {
  const db = fakeDb();
  // Even namespaced, the suffix collides with a reserved name.
  const result = await createTenantCustomRole(
    {
      __ow_headers: adminHeaders(),
      role_name: 'custom:tenant_admin',
      allowed_actions: ['tenant.audit.read'],
    },
    { db },
  );
  assert.equal(result.statusCode, 422, `expected 422, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  assert.equal(db.rows.length, 0, 'reserved-name role must not be persisted');
});

// ---------------------------------------------------------------------------
// task 2.5 — platform-scoped action → 403
// ---------------------------------------------------------------------------

test('bbx-tcr-platform-action: allowed_actions containing tenant.suspend (platform-scoped) → 403', async () => {
  const db = fakeDb();
  const result = await createTenantCustomRole(
    {
      // tenant_owner is the highest tenant role; still cannot grant a platform-scoped action.
      __ow_headers: adminHeaders({ roles: 'tenant_owner' }),
      role_name: 'custom:suspenders',
      allowed_actions: ['tenant.suspend'],
    },
    { db },
  );
  assert.equal(result.statusCode, 403, `expected 403, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  assert.equal(db.rows.length, 0, 'platform-scoped role must not be persisted');
});

test('bbx-tcr-platform-app-admin: allowed_actions containing app.admin (platform-scoped) → 403 regardless of role', async () => {
  const db = fakeDb();
  const result = await createTenantCustomRole(
    {
      __ow_headers: adminHeaders({ roles: 'tenant_owner' }),
      role_name: 'custom:appadmins',
      allowed_actions: ['app.admin'],
    },
    { db },
  );
  assert.equal(result.statusCode, 403, `expected 403, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  assert.equal(db.rows.length, 0, 'platform-scoped role must not be persisted');
});

// ---------------------------------------------------------------------------
// task 2.6 — action the creator does not hold → 403
// ---------------------------------------------------------------------------

test('bbx-tcr-not-held-action: allowed_actions containing an action the creator does not hold → 403', async () => {
  const db = fakeDb();
  // tenant_developer does NOT hold tenant.update (it is in their denied_actions).
  const result = await createTenantCustomRole(
    {
      __ow_headers: adminHeaders({ roles: 'tenant_developer' }),
      role_name: 'custom:editors',
      allowed_actions: ['tenant.update'],
    },
    { db },
  );
  assert.equal(result.statusCode, 403, `expected 403, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  assert.equal(db.rows.length, 0, 'escalating role must not be persisted');
});

// ---------------------------------------------------------------------------
// task 2.9 — cross-tenant GET by id → 404
// ---------------------------------------------------------------------------

test('bbx-tcr-cross-tenant-get: Tenant A actor reading a Tenant B role by id → 404 (no existence leak)', async () => {
  const db = fakeDb([
    {
      id: 'tcr_b001',
      tenant_id: TENANT_B,
      workspace_id: null,
      role_name: 'custom:b-secret',
      allowed_actions: ['tenant.audit.read'],
      created_by: 'user:b-admin',
    },
  ]);
  const result = await getTenantCustomRole(
    {
      __ow_headers: adminHeaders({ tenant: TENANT_A }),
      roleId: 'tcr_b001',
    },
    { db },
  );
  assert.equal(result.statusCode, 404, `expected 404, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  // must not reveal Tenant B data
  assert.ok(
    !JSON.stringify(result.body ?? {}).includes('b-secret'),
    'response must not reveal cross-tenant role data',
  );
});

// ---------------------------------------------------------------------------
// list scoping — caller sees only own tenant's roles
// ---------------------------------------------------------------------------

test('bbx-tcr-list-scoped: list returns only the caller tenant/workspace roles', async () => {
  const db = fakeDb([
    {
      id: 'tcr_a001',
      tenant_id: TENANT_A,
      workspace_id: WORKSPACE_A,
      role_name: 'custom:a-one',
      allowed_actions: ['tenant.audit.read'],
    },
    {
      id: 'tcr_b001',
      tenant_id: TENANT_B,
      workspace_id: null,
      role_name: 'custom:b-one',
      allowed_actions: ['tenant.audit.read'],
    },
  ]);
  const result = await listTenantCustomRoles(
    { __ow_headers: adminHeaders({ tenant: TENANT_A }) },
    { db },
  );
  assert.equal(result.statusCode, 200, `expected 200, got ${result.statusCode} body=${JSON.stringify(result.body)}`);
  const items = result.body?.items ?? result.body?.roles ?? [];
  assert.equal(items.length, 1, 'caller must only see their own tenant roles');
  assert.equal(items[0].tenant_id, TENANT_A);
  assert.ok(
    !JSON.stringify(items).includes('b-one'),
    'cross-tenant role must not appear in the list',
  );
});
