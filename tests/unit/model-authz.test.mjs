import test from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../../apps/control-plane/model-authz.mjs';

const roles = ['tenant_owner', 'tenant_admin', 'tenant_developer', 'tenant_viewer', 'workspace_admin', 'workspace_developer', 'workspace_viewer'];
const actions = ['workspace.read', 'database.admin', 'bucket.admin', 'topic.admin'];
const target = { tenantId: 'fixture-tenant', workspaceId: 'fixture-workspace' };
const scopes = [
  { name: 'bound', tenantId: target.tenantId, workspaceIds: [target.workspaceId], ownTenant: true, bound: true },
  { name: 'absent binding', tenantId: target.tenantId, ownTenant: true, bound: false },
  { name: 'empty binding', tenantId: target.tenantId, workspaceIds: [], ownTenant: true, bound: false },
  { name: 'other workspace', tenantId: target.tenantId, workspaceIds: ['fixture-other'], ownTenant: true, bound: false },
  { name: 'other tenant', tenantId: 'fixture-foreign', workspaceIds: [target.workspaceId], ownTenant: false, bound: true },
];
for (const role of roles) for (const action of actions) for (const scope of scopes) {
  test(`${role} ${action}: ${scope.name}`, () => {
    const grantedRole = action === 'workspace.read' || ['tenant_owner', 'tenant_admin', 'workspace_admin'].includes(role);
    const expected = grantedRole && scope.ownTenant && (role.startsWith('tenant_') || scope.bound);
    assert.equal(can({ roles: [role], ...scope }, action, target), expected);
  });
}

test('unknown roles/actions and actorType-only tenant admins fail closed', () => {
  assert.equal(can({ roles: ['unknown'], tenantId: target.tenantId }, 'workspace.read', target), false);
  assert.equal(can({ roles: ['tenant_owner'], tenantId: target.tenantId }, 'unknown.action', target), false);
  assert.equal(can({ actorType: 'tenant_owner', tenantId: target.tenantId }, 'database.admin', target), false);
  assert.equal(can(null, 'workspace.read', target), false);
  assert.equal(can({ roles: ['tenant_owner'] }, 'workspace.read', {}), false);
});

test('workspace_owner also requires an explicit nonempty workspace binding', () => {
  for (const action of actions) {
    assert.equal(can({ roles: ['workspace_owner'], tenantId: target.tenantId }, action, target), false);
    assert.equal(can({ roles: ['workspace_owner'], tenantId: target.tenantId, workspaceIds: [] }, action, target), false);
    assert.equal(can({ roles: ['workspace_owner'], tenantId: target.tenantId, workspaceIds: [target.workspaceId] }, action, target), true);
  }
});

test('tenant grants are not constrained by a workspace-scoped role in a mixed identity', () => {
  const identity = { roles: ['tenant_viewer', 'workspace_admin'], tenantId: target.tenantId, workspaceIds: [] };
  assert.equal(can(identity, 'workspace.read', target), true);
  assert.equal(can(identity, 'database.admin', target), false);
});

test('platform/internal callers retain cross-tenant authority for known actions', () => {
  for (const actorType of ['superadmin', 'internal']) for (const action of actions) {
    assert.equal(can({ actorType }, action, target), true);
    assert.equal(can({ actorType }, 'unknown.action', target), false);
  }
  for (const action of actions) assert.equal(can({ roles: ['platform_admin'], actorType: 'superadmin' }, action, target), true);
});
