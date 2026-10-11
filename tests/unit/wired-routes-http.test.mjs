import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startMetricsServer, TENANT } from './helpers/control-plane-metrics-server.mjs';

const paths = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url)))
  .filter(route => ['identity-overrides', 'workflow-status', 'params-auth-db'].includes(route.invoke)
    || route.path === '/v1/workspaces/{workspaceId}/capability-catalog'
    || (route.method === 'PUT' && route.path.includes('/members/{memberId}/privilege-domains')));

test('every newly wired route returns HTTP 401 without a Bearer token', async () => {
  const server = await startMetricsServer();
  assert.equal(paths.length, 13);
  for (const route of paths) {
    const response = await server.request(route.path.replace(/\{\w+\}/g, 'probe'), { method: route.method, headers: { 'x-tenant-id': TENANT } });
    assert.equal(response.status, 401, `${route.method} ${route.path}`);
  }
});

test('verified JWT tenant wins over spoofed headers and secret HTTP errors retain their status', async () => {
  const writes = [];
  const databasePool = {
    async connect() { return this; }, release() {},
    async query(sql, values) {
      if (sql.includes('INSERT INTO scope_enforcement_denials')) return { rows: [] };
      if (!sql.startsWith('SELECT')) { writes.push(sql); return { rows: [] }; }
      if (sql.includes('secret_metadata')) return { rows: [{ domain: 'tenant', tenant_id: TENANT }] };
      if (sql.includes('secret_version_states')) {
        assert.equal(values[0], `tenant/${TENANT}/key`);
        return { rows: [{ tenant_id: TENANT, vault_version: 1 }] };
      }
      return { rows: [] };
    }
  };
  const server = await startMetricsServer({ databasePool });
  const bearer = server.token();
  const headers = { 'x-tenant-id': 'tenant-b' };
  const status = await server.request('/v1/platform/secrets/tenant/key/consumer-status', { bearer, headers });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { consumers: [] });
  for (const path of ['/v1/platform/secrets/tenant/key/rotate', '/v1/platform/secrets/tenant/key/versions/1/revoke']) {
    const response = await server.request(path, { bearer, headers, method: 'POST', body: { secretPath: 'tenant/tenant-b/key', tenantId: 'tenant-b', newValue: 'fixture' } });
    assert.equal(response.status, 503);
  }
  assert.deepEqual(writes, []);
  const denied = await server.request('/v1/platform/secrets/platform/key/rotate', { bearer, method: 'POST', body: { newValue: 'fixture', auth: { roles: ['superadmin'] } } });
  assert.equal(denied.status, 403);
});

test('capability catalog and secret history respond through real HTTP dispatch for verified callers', async () => {
  const databasePool = {
    async connect() { return this; }, release() {},
    async query(sql, values) {
      if (sql.includes('scope_enforcement_denials')) return { rows: [] };
      if (sql.includes('FROM workspaces')) return { rows: [{ id: 'workspace-a', tenant_id: TENANT }] };
      if (sql.includes('capability_catalog_metadata')) return { rows: [{ capability_key: 'postgres-database', display_name: 'PostgreSQL', category: 'data', enabled: true, dependencies: [] }] };
      if (sql.includes('secret_metadata')) return { rows: [{ domain: 'tenant', tenant_id: TENANT }] };
      if (sql.includes('secret_rotation_events')) return { rows: [{ event_type: 'initiated', __total: 1 }] };
      throw Error(`Unexpected SQL ${sql}`);
    }
  };
  const server = await startMetricsServer({ databasePool });
  const bearer = server.token({ workspace_ids: ['workspace-a'] });
  const catalog = await server.request('/v1/workspaces/workspace-a/capability-catalog', { bearer });
  assert.equal(catalog.status, 200);
  assert.equal(JSON.parse(catalog.body).workspaceId, 'workspace-a');
  assert.equal((await server.request('/v1/workspaces/workspace-b/capability-catalog', { bearer })).status, 403);
  const history = await server.request('/v1/platform/secrets/tenant/key/history', { bearer });
  assert.equal(history.status, 200);
  assert.equal(JSON.parse(history.body).items[0].event_type, 'initiated');
  assert.equal((await server.request('/v1/platform/secrets/tenant/key/history', { bearer: server.token({ iss: 'http://fixture/realms/tenant-b' }) })).status, 403);
});

test('tenant-role CRUD uses the verified JWT tenant across HTTP requests', async t => {
  try { await import('../../apps/control-plane-executor/src/iam-tenant-roles.mjs'); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find package /.test(error.message)) { t.skip(error.message); return; }
    throw error;
  }
  const rows = new Map([['role-b', { id: 'role-b', tenant_id: 'tenant-b', role_name: 'custom:foreign', allowed_actions: ['workspace.read'] }]]);
  const databasePool = {
    async connect() { return this; }, release() {},
    async query(sql, values) {
      if (sql.includes('scope_enforcement_denials')) return { rows: [] };
      if (sql.startsWith('SELECT')) {
        if (sql.includes('WHERE id=')) {
          const row = rows.get(values[0]);
          return { rows: row?.tenant_id === values[1] && !row.deleted_at ? [row] : [] };
        }
        return { rows: [...rows.values()].filter(row => row.tenant_id === values[0] && !row.deleted_at) };
      }
      if (sql.startsWith('INSERT')) {
        const row = { id: 'role-a', tenant_id: values[0], workspace_id: values[1], role_name: values[2], allowed_actions: values[3], created_by: values[4] };
        rows.set(row.id, row); return { rows: [row] };
      }
      if (sql.startsWith('UPDATE')) {
        const row = rows.get(values[0]);
        assert.equal(row.tenant_id, values[1]);
        if (sql.includes('SET deleted_at')) row.deleted_at = values[2];
        else Object.assign(row, { role_name: values[2], allowed_actions: values[3], updated_at: values[4] });
        return { rows: [row] };
      }
      throw Error(`Unexpected SQL ${sql}`);
    }
  };
  const server = await startMetricsServer({ databasePool });
  const options = { bearer: server.token({ tenant_id: 'tenant-b' }), headers: { 'x-tenant-id': 'tenant-b' } };
  const created = await server.request('/v1/iam/tenant-roles', { ...options, method: 'POST', body: { role_name: 'custom:reader', allowed_actions: ['workspace.read'] } });
  assert.equal(created.status, 201);
  assert.equal(JSON.parse(created.body).tenant_id, TENANT);
  assert.equal((await server.request('/v1/iam/tenant-roles', options)).status, 200);
  assert.equal((await server.request('/v1/iam/tenant-roles/role-a', options)).status, 200);
  assert.equal((await server.request('/v1/iam/tenant-roles/role-a', { ...options, method: 'PUT', body: { allowed_actions: ['workspace.read'] } })).status, 200);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await server.request('/v1/iam/tenant-roles/role-b', { ...options, method, ...(method === 'PUT' ? { body: { allowed_actions: ['workspace.read'] } } : {}) })).status, 404);
  }
  assert.equal((await server.request('/v1/iam/tenant-roles/role-a', { ...options, method: 'DELETE' })).status, 204);
  assert.equal((await server.request('/v1/iam/tenant-roles/role-a', options)).status, 404);
});

test('workflow status reaches its facade through HTTP with tenant and workspace authorization', async t => {
  try { await import('../../apps/control-plane-executor/src/console-backend-functions.mjs'); }
  catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && /Cannot find package /.test(error.message)) { t.skip(error.message); return; }
    throw error;
  }
  const databasePool = {
    async connect() { return this; }, release() {},
    async query(sql, values) {
      if (sql.includes('scope_enforcement_denials')) return { rows: [] };
      if (sql.includes('saga_instances')) return { rows: values[0] === 'missing' ? [] : [{ saga_id: values[0], tenant_id: TENANT, workspace_id: 'workspace-a', status: 'completed', workflow_id: 'WF-CON-003' }] };
      if (sql.includes('saga_steps')) return { rows: [] };
      throw Error(`Unexpected SQL ${sql}`);
    }
  };
  const server = await startMetricsServer({ databasePool });
  const bearer = server.token({ workspace_ids: ['workspace-a'] });
  for (const path of [`/v1/tenants/${TENANT}/workflow-jobs/saga-a`, '/v1/workspaces/workspace-a/workflow-jobs/saga-a']) {
    const result = await server.request(path, { bearer });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).status, 'completed');
  }
  assert.equal((await server.request('/v1/workspaces/workspace-a/workflow-jobs/missing', { bearer })).status, 404);
  assert.equal((await server.request('/v1/workspaces/workspace-b/workflow-jobs/saga-a', { bearer })).status, 403);
  assert.equal((await server.request(`/v1/tenants/${TENANT}/workflow-jobs/saga-a`, { bearer: server.token({ iss: 'http://fixture/realms/tenant-b' }) })).status, 403);
});
