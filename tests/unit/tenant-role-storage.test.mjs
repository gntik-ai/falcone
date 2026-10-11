import test from 'node:test';
import assert from 'node:assert/strict';

test('PostgreSQL role storage scopes every CRUD operation to the verified tenant', async () => {
  const { tenantRoleStorage } = await import('../../apps/control-plane-executor/src/tenant-role-storage.mjs');
  const db = { async query(sql, values) {
    assert.ok(values.includes('tenant-a'));
    if (sql.startsWith('SELECT')) assert.match(sql, /tenant_id\s*=\s*\$\d/);
    return { rows: [{ id: 'role-a', tenant_id: 'tenant-a', role_name: 'custom:reader' }] };
  } };
  const store = tenantRoleStorage(db, { tenantId: 'tenant-a' });
  assert.equal((await store.listByScope('tenant-a', null))[0].id, 'role-a');
  assert.equal((await store.findById('role-a')).tenant_id, 'tenant-a');
  assert.equal((await store.insert({ tenant_id: 'tenant-a', role_name: 'custom:reader', allowed_actions: ['workspace.read'], created_by: 'actor-a' })).id, 'role-a');
  await store.update({ id: 'role-a', role_name: 'custom:reader', allowed_actions: ['workspace.read'], updated_at: '2026-01-01' });
  await store.softDelete({ id: 'role-a', deleted_at: '2026-01-01' });
});
