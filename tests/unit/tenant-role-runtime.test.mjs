import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeRoute } from '../../apps/control-plane/route-invoke.mjs';

test('tenant roles use token identity over spoofed headers and PostgreSQL storage', async () => {
  const { listTenantCustomRoles } = await import('../../apps/control-plane-executor/src/iam-tenant-roles.mjs');
  const db = { async query(sql, values) {
    assert.equal(values[0], 'tenant-a');
    return { rows: [{ id: 'role-a', tenant_id: 'tenant-a', role_name: 'custom:reader', allowed_actions: ['workspace.read'] }] };
  } };
  const identity = { sub: 'actor-a', tenantId: 'tenant-a', workspaceId: null, roles: ['tenant_owner'] };
  const result = await invokeRoute({ invoke: 'identity-overrides', deps: ['db'] }, listTenantCustomRoles,
    { __ow_headers: { 'x-tenant-id': 'tenant-b' } }, null, identity, db);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.items[0].tenant_id, 'tenant-a');
});
