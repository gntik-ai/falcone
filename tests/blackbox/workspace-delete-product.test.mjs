/**
 * Black-box tests for the SHIPPABLE-product workspace teardown handler
 * (add-deploy-completeness-cluster, #562 — deliverable (a), product parity).
 *
 * Mirrors the kind-runtime `deleteWorkspace` cascade in `apps/control-plane-executor`:
 * the public route `deleteWorkspace` (DELETE /v1/workspaces/{workspaceId}) is in
 * the public route catalog but had no handler. `handleWorkspaceDeleteRequest` is
 * a pure function (no real HTTP) that re-gates the request by TENANT OWNERSHIP —
 * a tenant owner/admin may delete ONLY a workspace whose tenantId matches their
 * identity; superadmin/internal may delete any — then dispatches a teardown
 * through an injected dispatcher. It NEVER bypasses the ownership gate, so a
 * cross-tenant delete is rejected (404, no existence leak) with NO dispatch.
 *
 * bbx-562-wsprod-00: the handler resolves the existing public route deleteWorkspace
 * bbx-562-wsprod-01: owner of the workspace's tenant → 200 + teardown dispatched
 * bbx-562-wsprod-02: the dispatched draft carries the workspaceId + tenantId + actor
 * bbx-562-wsprod-03: a DIFFERENT tenant's owner → 404, NO dispatch (no cross-tenant)
 * bbx-562-wsprod-04: superadmin may delete any tenant's workspace
 * bbx-562-wsprod-05: handler does not throw when the dispatcher is omitted (safe default)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handleWorkspaceDeleteRequest, getWorkspaceRoute } from '../../apps/control-plane-executor/src/workspace-management.mjs';

const WS_A = { workspaceId: 'ws-a', tenantId: 'tenant-a', slug: 'app-staging', state: 'active' };

const ownerA = { actorUserId: 'usr_owner_a', actorTenantId: 'tenant-a', actorType: 'tenant_owner' };
const ownerB = { actorUserId: 'usr_owner_b', actorTenantId: 'tenant-b', actorType: 'tenant_owner' };
const superadmin = { actorUserId: 'usr_sa', actorTenantId: null, actorType: 'superadmin' };

test('bbx-562-wsprod-00: handler wires to the existing public route deleteWorkspace', () => {
  const route = getWorkspaceRoute('deleteWorkspace');
  assert.ok(route, 'deleteWorkspace must be a known workspaces-family route');
  assert.equal(route.method, 'DELETE');
  assert.equal(route.path, '/v1/workspaces/{workspaceId}');
});

test('bbx-562-wsprod-01: owner of the workspace tenant → 200 + teardown dispatched', async () => {
  let dispatched = null;
  const res = await handleWorkspaceDeleteRequest({
    workspace: WS_A, ...ownerA, dispatchTeardown: async (arg) => { dispatched = arg; return arg; },
  });
  assert.equal(res.statusCode, 200, `got ${res.statusCode} (${JSON.stringify(res.body)})`);
  assert.equal(res.body.workspaceId, 'ws-a');
  assert.equal(res.body.deleted, true);
  assert.ok(dispatched, 'must dispatch the teardown for an owned workspace');
});

test('bbx-562-wsprod-02: dispatched draft carries workspaceId + tenantId + actor', async () => {
  let dispatched = null;
  await handleWorkspaceDeleteRequest({
    workspace: WS_A, ...ownerA, dispatchTeardown: async (arg) => { dispatched = arg; },
  });
  assert.equal(dispatched.workspaceId, 'ws-a');
  assert.equal(dispatched.tenantId, 'tenant-a');
  assert.equal(dispatched.actorUserId, 'usr_owner_a');
});

test('bbx-562-wsprod-03: a different tenant owner → 404, NO dispatch (no cross-tenant)', async () => {
  let dispatched = 0;
  const res = await handleWorkspaceDeleteRequest({
    workspace: WS_A, ...ownerB, dispatchTeardown: async () => { dispatched += 1; },
  });
  assert.ok(res.statusCode === 404 || res.statusCode === 403, `cross-tenant must be 404/403, got ${res.statusCode}`);
  assert.equal(dispatched, 0, 'must NOT dispatch a cross-tenant workspace teardown');
});

test('bbx-562-wsprod-04: superadmin may delete any tenant workspace', async () => {
  let dispatched = null;
  const res = await handleWorkspaceDeleteRequest({
    workspace: WS_A, ...superadmin, dispatchTeardown: async (arg) => { dispatched = arg; },
  });
  assert.equal(res.statusCode, 200, `got ${res.statusCode} (${JSON.stringify(res.body)})`);
  assert.ok(dispatched, 'superadmin teardown must dispatch');
});

test('bbx-562-wsprod-05: handler does not throw when dispatcher omitted (safe default)', async () => {
  const res = await handleWorkspaceDeleteRequest({ workspace: WS_A, ...ownerA });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
});
