import test from 'node:test';
import assert from 'node:assert/strict';
import { invokeRoute } from '../../apps/control-plane/route-invoke.mjs';
import { secretInventory } from '../../packages/provisioning-orchestrator/src/actions/secret-inventory.mjs';
import { main as consumerStatus } from '../../packages/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs';
const identity = { sub: 'actor-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', workspaceIds: ['workspace-a'], actorType: 'tenant_owner', roles: ['tenant-owner'], scopes: [] };

test('inventory invoke rejects missing identity without invoking the handler', async () => {
  assert.deepEqual(await invokeRoute({ invoke: 'params-auth-query' }, () => { throw new Error('must not invoke'); },
    { domain: 'platform' }, null, null, {}), { statusCode: 401, body: { code: 'UNAUTHENTICATED' } });
});

test('inventory invoke preserves platform tenant filter and binds query to its database', async () => {
  const db = { marker: 'db', async query(_sql, values) {
    assert.equal(this.marker, 'db');
    assert.deepEqual(values, ['tenant', 'tenant-b', 0, 50]);
    return { rows: [{ name: 'key', tenantId: 'tenant-b' }] };
  } };
  const result = await invokeRoute({ invoke: 'params-auth-query' }, secretInventory,
    { domain: 'tenant', tenantId: 'tenant-b', auth: { roles: [] }, query: () => { throw new Error('spoofed query'); } }, null,
    { ...identity, trustKind: 'platform', roles: ['platform_operator'] }, db);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.secrets[0].tenantId, 'tenant-b');
});

test('inventory invoke aliases tenant operators and rejects untrusted platform grants before querying', async () => {
  for (const [roles, trustKind, tenantId, domain, status] of [
    [['tenant_operator'], 'tenant', 'tenant-a', 'tenant', 200],
    [['tenant_operator'], 'tenant', undefined, 'tenant', 403],
    [['tenant_operator'], 'tenant', 'tenant-a', 'platform', 403],
    [['tenant_owner'], 'tenant', 'tenant-a', 'tenant', 403],
    [[], 'platform', 'tenant-a', 'platform', 403],
    [['platform_operator'], 'tenant', 'tenant-a', 'platform', 403],
    [['platform-operator'], 'tenant', 'tenant-a', 'platform', 403],
    [['superadmin'], 'tenant', 'tenant-a', 'platform', 403],
    [['superadmin'], 'platform', undefined, 'platform', 200]
  ]) {
    let calls = 0;
    const result = await invokeRoute({ invoke: 'params-auth-query' }, secretInventory,
      { domain, auth: { roles: ['superadmin'], tenantId: 'spoofed' } }, null,
      { ...identity, roles, trustKind, tenantId }, { async query(_sql, values) {
        calls++;
        if (domain === 'tenant') assert.equal(values[1], 'tenant-a');
        return { rows: [] };
      } });
    assert.equal(result.statusCode, status, `${roles} ${trustKind} ${domain}`);
    if (status === 403) assert.deepEqual(result.body, { error: 'forbidden' });
    assert.equal(calls, status === 200 ? 1 : 0);
  }
});

test('params-auth-db passes trusted auth and db and maps forbidden results to HTTP 403', async () => {
  const db = { async query(sql) { return { rows: sql.includes('secret_version_states') ? [{ tenant_id: 'tenant-b' }] : [] }; } };
  const result = await invokeRoute({ invoke: 'params-auth-db', deps: ['db'] }, consumerStatus,
    { domain: 'tenant', secretName: 'key', auth: { roles: ['superadmin'] }, tenantId: 'tenant-b', secretPath: 'tenant/tenant-b/key' }, null, identity, db);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.error.code, 'FORBIDDEN');
});

for (const [operation, module] of [['rotate', 'secret-rotation-initiate'], ['revoke', 'secret-rotation-revoke']]) {
  test(`${operation} without an OpenBao client returns 503 and performs no database writes`, async () => {
    const { main } = await import(`../../packages/provisioning-orchestrator/src/actions/${module}.mjs`);
    const writes = [];
    const db = { async query(sql) {
      if (!sql.startsWith('SELECT')) writes.push(sql);
      return { rows: [] };
    } };
    const result = await invokeRoute({ invoke: 'params-auth-db', deps: ['db'] }, main,
      { domain: 'tenant', secretName: 'key', newValue: 'test-only', vaultVersion: 1 }, null, identity, db);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(writes, []);
  });
}

test('consumer status returns data for its tenant and ignores spoofed identity/body backend fields', async () => {
  const db = { async query(sql, values) {
    if (sql.includes('secret_version_states')) {
      assert.equal(values[0], 'tenant/tenant-a/key');
      return { rows: [{ tenant_id: 'tenant-a', vault_version: 1 }] };
    }
    return { rows: [] };
  } };
  const result = await invokeRoute({ invoke: 'params-auth-db' }, consumerStatus,
    { domain: 'tenant', secretName: 'key', secretPath: 'tenant/tenant-b/key', __ow_headers: { 'x-tenant-id': 'tenant-b' }, repo: {} }, null, identity, db);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { consumers: [] });
});

test('secret history returns rotation events for an authorized tenant and rejects another tenant', async () => {
  const { main } = await import('../../packages/provisioning-orchestrator/src/actions/secret-rotation-history.mjs');
  const db = { async query(sql, values) {
    if (sql.includes('secret_metadata')) return { rows: [{ domain: 'tenant', tenant_id: 'tenant-a' }] };
    if (sql.includes('secret_rotation_events')) {
      assert.equal(values[0], 'tenant/tenant-a/key');
      return { rows: [{ event_type: 'initiated', __total: 1 }] };
    }
    throw new Error(`Unexpected SQL ${sql}`);
  } };
  const route = { invoke: 'params-auth-db' };
  const params = { domain: 'tenant', secretName: 'key' };
  const own = await invokeRoute(route, main, params, null, identity, db);
  assert.equal(own.statusCode, 200);
  assert.equal(own.body.items[0].event_type, 'initiated');
  assert.equal(own.body.total, 1);
  const other = await invokeRoute(route, main, params, null, { ...identity, tenantId: 'tenant-b' }, db);
  assert.equal(other.statusCode, 403);
});

test('capability catalog main uses injected database and verified workspace-member auth', async () => {
  const { main } = await import('../../packages/provisioning-orchestrator/src/actions/workspace-capability-catalog.mjs');
  const db = { async query(sql, values) {
    if (sql.includes('workspaces')) {
      assert.deepEqual(values, ['workspace-a', 'tenant-a']);
      assert.match(sql, /^SELECT id, tenant_id FROM workspaces/);
      return { rows: [{ id: 'workspace-a', tenant_id: 'tenant-a', capabilities: { 'postgres-database': true } }] };
    }
    return { rows: [{ capability_key: 'postgres-database', display_name: 'PostgreSQL', category: 'data', enabled: true, status: 'active', dependencies: [] }] };
  } };
  const route = { invoke: 'params-auth-overrides', deps: ['db'] };
  const result = await invokeRoute(route, main, { workspaceId: 'workspace-a' }, null, identity, db);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.tenantId, 'tenant-a');
  assert.equal((await invokeRoute(route, main, { workspaceId: 'workspace-b' }, null, identity, db)).statusCode, 403);
  assert.equal((await invokeRoute(route, main, { workspaceId: 'workspace-a' }, null, null, db)).statusCode, 401);
});

test('identity-overrides supplies verified tenant and actor rather than client identity', async () => {
  const result = await invokeRoute({ invoke: 'identity-overrides', deps: ['db'] },
    async (params, overrides) => ({ statusCode: 200, body: overrides.identity }),
    { identity: { tenantId: 'tenant-b' }, __ow_headers: { 'x-tenant-id': 'tenant-b' } }, null, identity, {});
  assert.equal(result.body.tenantId, 'tenant-a');
  assert.equal(result.body.actorId, 'actor-a');
  assert.equal((await invokeRoute({ invoke: 'identity-overrides' }, () => { throw new Error('must not invoke'); }, {}, null, null, {})).statusCode, 401);
});

test('privilege-domain PUT preserves last-admin rejection with token auth and injected db', async () => {
  const { main } = await import('../../packages/provisioning-orchestrator/src/actions/privilege-domain-assign.mjs');
  const db = { async query(sql) {
    if (sql.includes('FOR UPDATE')) return { rows: [{ member_id: 'actor-a' }] };
    if (sql.startsWith('SELECT')) return { rows: [{ structural_admin: true }] };
    if (sql.includes('INSERT') || sql.includes('UPDATE')) throw new Error('last admin must not be removed');
    return { rows: [] };
  } };
  const result = await invokeRoute({ invoke: 'params-auth-overrides', deps: ['db'] }, main,
    { tenantId: 'tenant-a', workspaceId: 'workspace-a', memberId: 'actor-a', structural_admin: false, data_access: false }, null,
    { ...identity, trustKind: 'platform', roles: ['platform_admin'] }, db);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'LAST_STRUCTURAL_ADMIN');
});

test('unknown invoke modes keep throwing a server error', async () => {
  await assert.rejects(invokeRoute({ path: '/unknown', invoke: 'facade' }, () => {}, {}, null, identity, {}),
    error => error.statusCode === 500 && error.message.includes('unknown invoke facade'));
});
