import test from 'node:test';
import assert from 'node:assert/strict';

test('workspace authority uses verified roles, tenant and workspace bindings only', async () => {
  const { canAccessWorkspace } = await import('../../apps/control-plane/workspace-authz.mjs');
  const row = { tenant_id: 'T', workspace_id: 'ws2' };
  const actions = ['database.read', 'database.write', 'database.admin'];
  for (const actorType of ['superadmin', 'internal']) assert.equal(canAccessWorkspace({ actorType }, null, actions), true);
  for (const role of ['tenant_owner', 'tenant_admin', 'tenant_viewer', 'tenant_developer', 'workspace_viewer', 'workspace_developer', 'workspace_service_account']) {
    const identity = { actorType: 'tenant_member', tenantId: 'T', roles: [role] };
    const admin = ['tenant_owner', 'tenant_admin'].includes(role);
    assert.equal(canAccessWorkspace(identity, row, actions), admin, role);
    assert.equal(canAccessWorkspace({ ...identity, workspaceIds: ['ws1'] }, row, actions), admin, role);
    assert.equal(canAccessWorkspace({ ...identity, workspaceIds: ['ws2'] }, row, actions), true, role);
    assert.equal(canAccessWorkspace({ ...identity, tenantId: 'foreign', workspaceIds: ['ws2'] }, row, actions), false, role);
    assert.equal(canAccessWorkspace(identity, { tenant_id: 'T', workspace_id: null }, actions), false, role);
  }
  assert.equal(canAccessWorkspace({ actorType: 'tenant_owner', tenantId: 'T', workspaceIds: ['ws2'] }, row, actions), false);
  assert.equal(canAccessWorkspace({ tenantId: 'T', roles: ['tenant_viewer'], workspaceId: 'ws2', body: { workspaceIds: ['ws2'] } }, row, actions), false);
  assert.equal(canAccessWorkspace(null, row, actions), false);
});
