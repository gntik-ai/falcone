import test from 'node:test';
import assert from 'node:assert/strict';
import '../../apps/control-plane-executor/src/iam-tenant-roles.mjs';
import { startMetricsServer, TENANT } from './helpers/control-plane-metrics-server.mjs';

async function roleServer() {
  const rows = new Map([
    ['role-a', { id: 'role-a', tenant_id: TENANT, workspace_id: 'workspace-a', role_name: 'custom:reader-a', allowed_actions: ['workspace.read'] }],
    ['role-b', { id: 'role-b', tenant_id: TENANT, workspace_id: 'workspace-b', role_name: 'custom:reader-b', allowed_actions: ['workspace.read'] }],
    ['role-tenant', { id: 'role-tenant', tenant_id: TENANT, workspace_id: null, role_name: 'custom:tenant-reader', allowed_actions: ['workspace.read'] }],
  ]);
  const databasePool = {
    async connect() { return this; }, release() {},
    async query(sql, values = []) {
      if (sql.includes('scope_enforcement_denials')) return { rows: [] };
      const workspace = sql.match(/workspace_id IS NOT DISTINCT FROM \$(\d+)/);
      const visible = row => row && !row.deleted_at
        && row.tenant_id === values[sql.includes('WHERE id=') ? 1 : 0]
        && (!workspace || row.workspace_id === values[Number(workspace[1]) - 1]);
      if (sql.startsWith('SELECT')) {
        return { rows: sql.includes('WHERE id=')
          ? [rows.get(values[0])].filter(visible) : [...rows.values()].filter(visible) };
      }
      if (sql.startsWith('INSERT')) {
        const row = { id: 'role-new', tenant_id: values[0], workspace_id: values[1], role_name: values[2], allowed_actions: values[3], created_by: values[4] };
        rows.set(row.id, row);
        return { rows: [row] };
      }
      if (sql.startsWith('UPDATE')) {
        const row = rows.get(values[0]);
        if (!visible(row)) return { rows: [] };
        if (sql.includes('SET deleted_at')) row.deleted_at = values[2];
        else Object.assign(row, { role_name: values[2], allowed_actions: values[3], updated_at: values[4] });
        return { rows: [row] };
      }
      throw Error(`Unexpected SQL: ${sql}`);
    },
  };
  return startMetricsServer({ databasePool });
}

test('low-privilege tenant users and service accounts cannot mutate custom roles over HTTP', async t => {
  for (const claims of [
    { realm_access: { roles: [] } },
    { realm_access: { roles: ['tenant_developer'] } },
    { realm_access: { roles: ['workspace_viewer'] }, workspace_id: 'workspace-a' },
    { realm_access: { roles: ['workspace_service_account'] }, azp: 'sa-reader', workspace_id: 'workspace-a' },
    { realm_access: { roles: [] }, actor_type: 'tenant_owner' },
    { realm_access: { roles: ['platform_admin'] } },
  ]) {
    for (const [method, path, body] of [
      ['POST', '/v1/iam/tenant-roles', { role_name: 'custom:reader', allowed_actions: ['workspace.read'] }],
      ['PUT', '/v1/iam/tenant-roles/role-a', { allowed_actions: ['workspace.read'] }],
      ['DELETE', '/v1/iam/tenant-roles/role-a'],
    ]) {
      await t.test(`${claims.realm_access.roles.join(',') || claims.actor_type || 'tenant_member'}: ${method} ${path}`, async () => {
        const server = await roleServer();
        const response = await server.request(path, { method, body, bearer: server.token(claims),
          headers: { 'x-actor-roles': 'tenant_owner', 'x-workspace-id': 'workspace-b' } });
        assert.equal(response.status, 403);
        const role = await server.request('/v1/iam/tenant-roles/role-a', { bearer: server.token() });
        assert.equal(role.status, 200);
        assert.equal(JSON.parse(role.body).role_name, 'custom:reader-a');
      });
    }
  }
});

test('workspace-bound administrators cannot read or mutate sibling-workspace or tenant-wide roles', async t => {
  for (const role of ['workspace_admin', 'workspace_owner', 'tenant_admin', 'tenant_owner']) {
    for (const target of ['role-b', 'role-tenant']) {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        await t.test(`${role}: ${method} ${target}`, async () => {
          const server = await roleServer();
          const response = await server.request(`/v1/iam/tenant-roles/${target}`, {
            method, bearer: server.token({ realm_access: { roles: [role] }, workspace_id: 'workspace-a' }),
            headers: { 'x-workspace-id': 'workspace-b' },
            ...(method === 'PUT' ? { body: { role_name: 'custom:rewritten', allowed_actions: ['workspace.read'], workspaceId: 'workspace-b' } } : {}),
          });
          assert.equal(response.status, 404);
          const unchanged = await server.request(`/v1/iam/tenant-roles/${target}`, { bearer: server.token() });
          assert.equal(unchanged.status, 200);
          assert.equal(JSON.parse(unchanged.body).role_name, target === 'role-b' ? 'custom:reader-b' : 'custom:tenant-reader');
        });
      }
    }
  }
});

test('workspace administrator mutations require an explicit verified workspace binding', async t => {
  for (const role of ['workspace_admin', 'workspace_owner']) {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      await t.test(`${role}: ${method}`, async () => {
        const server = await roleServer();
        const response = await server.request(method === 'POST' ? '/v1/iam/tenant-roles' : '/v1/iam/tenant-roles/role-tenant', {
          method, bearer: server.token({ realm_access: { roles: [role] }, workspace_ids: ['workspace-a'] }),
          headers: { 'x-workspace-id': 'workspace-a' },
          ...(method === 'DELETE' ? {} : { body: { role_name: 'custom:new', allowed_actions: ['workspace.read'] } }),
        });
        assert.equal(response.status, 403);
      });
    }
  }
});

test('authorized administrators retain custom-role CRUD within their verified scope', async t => {
  for (const claims of [
    { realm_access: { roles: ['tenant_owner'] } },
    { realm_access: { roles: ['tenant_admin'] } },
    { realm_access: { roles: ['workspace_admin'] }, workspace_id: 'workspace-a' },
    { realm_access: { roles: ['workspace_owner'] }, workspace_id: 'workspace-a' },
    { iss: 'http://fixture/realms/platform', tenant_id: TENANT, realm_access: { roles: ['platform_admin'] } },
    { iss: 'http://fixture/realms/platform', tenant_id: TENANT, realm_access: { roles: ['platform_operator'] } },
  ]) {
    await t.test(claims.realm_access.roles[0], async () => {
      const server = await roleServer();
      const options = { bearer: server.token(claims), headers: { 'x-tenant-id': 'tenant-b', 'x-workspace-id': 'workspace-b' } };
      const created = await server.request('/v1/iam/tenant-roles', { ...options, method: 'POST',
        body: { role_name: 'custom:new', allowed_actions: ['workspace.read'], workspaceId: 'workspace-b' } });
      assert.equal(created.status, 201);
      assert.equal(JSON.parse(created.body).tenant_id, TENANT);
      assert.equal(JSON.parse(created.body).workspace_id, claims.workspace_id ?? null);
      const updated = await server.request('/v1/iam/tenant-roles/role-new', { ...options, method: 'PUT',
        body: { role_name: 'custom:updated', allowed_actions: ['workspace.read'] } });
      assert.equal(updated.status, 200);
      const retrieved = await server.request('/v1/iam/tenant-roles/role-new', options);
      assert.equal(retrieved.status, 200);
      assert.equal(JSON.parse(retrieved.body).role_name, 'custom:updated');
      assert.equal((await server.request('/v1/iam/tenant-roles/role-new', { ...options, method: 'DELETE' })).status, 204);
      assert.equal((await server.request('/v1/iam/tenant-roles/role-new', options)).status, 404);
    });
  }
});
