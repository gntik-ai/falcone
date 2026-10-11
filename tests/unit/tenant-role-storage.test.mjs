import test from 'node:test';
import assert from 'node:assert/strict';

test('malformed custom-role IDs are absent rather than PostgreSQL errors', async () => {
  const { tenantRoleStorage } = await import('../../apps/control-plane-executor/src/tenant-role-storage.mjs');
  const store = tenantRoleStorage({ async query() {
    throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
  } }, { tenantId: 'tenant-a' });
  assert.equal(await store.findById('not-a-uuid'), null);
});

test('repository role storage exposes explicit updates and deletion through the same interface', async () => {
  const { tenantRoleStorage } = await import('../../apps/control-plane-executor/src/tenant-role-storage.mjs');
  const row = { id: 'role-a', tenant_id: 'tenant-a', role_name: 'custom:reader', deleted_at: null };
  const repository = {
    findById(id) { return id === row.id ? row : null; },
    listByScope() { return row.deleted_at ? [] : [row]; },
    insert(value) { return value; }
  };
  const store = tenantRoleStorage(repository, { tenantId: 'tenant-a' });
  await store.update({ ...await store.findById('role-a'), role_name: 'custom:writer' });
  assert.equal((await store.findById('role-a')).role_name, 'custom:writer');
  await store.softDelete({ ...await store.findById('role-a'), deleted_at: '2026-01-01' });
  assert.deepEqual(await store.listByScope('tenant-a', null), []);
});

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
