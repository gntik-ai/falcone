import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { createVaultKvClient, createWorkspaceSecretStore, workspaceSecretPath } from '../../apps/control-plane/vault-secrets.mjs';
import { fakeOpenBao } from '../helpers/fake-openbao-kv.mjs';

const MARKER = 'synthetic-value-977';
const identity = { actorType: 'superadmin', roles: ['superadmin'] };

// The database boundary retains rows until the real tenant-store cascade deletes them.
function registryPool() {
  const tenants = new Map(['tenant-a', 'tenant-b'].map((id) => [id, { id, slug: `${id}-slug` }]));
  const workspaces = new Map([
    ['ws-a', { id: 'ws-a', tenant_id: 'tenant-a' }],
    ['ws-sibling', { id: 'ws-sibling', tenant_id: 'tenant-a' }],
    ['ws-b', { id: 'ws-b', tenant_id: 'tenant-b' }],
  ]);
  const query = async (sql, params = []) => {
    if (/^DELETE FROM tenants /i.test(sql)) tenants.delete(params[0]);
    if (/^DELETE FROM workspaces WHERE id/i.test(sql)) workspaces.delete(params[0]);
    if (/^DELETE FROM workspaces WHERE tenant_id/i.test(sql)) {
      for (const [id, ws] of workspaces) if (ws.tenant_id === params[0]) workspaces.delete(id);
    }
    if (/FROM tenants WHERE/i.test(sql)) return { rows: [...tenants.values()].filter((t) => t.id === params[0] || t.slug === params[0]) };
    if (/FROM workspaces WHERE tenant_id/i.test(sql)) return { rows: [...workspaces.values()].filter((ws) => ws.tenant_id === params[0]) };
    if (/FROM workspaces WHERE/i.test(sql)) return { rows: workspaces.has(params[0]) ? [workspaces.get(params[0])] : [] };
    return { rows: [] };
  };
  return { query };
}

function setup() {
  const bao = fakeOpenBao();
  const client = createVaultKvClient({ addr: 'http://synthetic-bao', token: 'synthetic-token', fetchImpl: bao.fetchImpl });
  const vaultStore = createWorkspaceSecretStore(client);
  const pool = registryPool();
  const ctx = {
    pool, identity, query: {}, body: { tenantId: 'tenant-b', workspaceId: 'ws-b' }, vaultStore,
    runtimeTeardownCoordinator: {
      purgeTenant: async () => ({ pending: false }),
      purgeWorkspace: async () => ({ pending: false }),
    },
    deleteTopics: async () => {},
  };
  return { bao, client, vaultStore, ctx };
}

test('tenant purge destroys workspace secret data and metadata while isolating other tenants', async () => {
  const { client, vaultStore, ctx } = setup();
  await vaultStore.set('tenant-a', 'ws-a', 'probe', MARKER);
  await vaultStore.set('tenant-a', 'ws-a', 'probe', 'synthetic-second-version');
  await vaultStore.set('tenant-a', 'ws-sibling', 'another', MARKER);
  await vaultStore.set('tenant-b', 'ws-b', 'probe', MARKER);
  const result = await LOCAL_HANDLERS.purgeTenant({ ...ctx, params: { tenantId: 'tenant-a-slug' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.purged, true);
  assert.equal(await vaultStore.getValue('tenant-a', 'ws-a', 'probe'), null, 'purged secret must be unreadable');
  assert.equal(await client.readMeta(workspaceSecretPath('tenant-a', 'ws-a', 'probe')), null, 'no KV versions remain');
  assert.equal(await vaultStore.getValue('tenant-a', 'ws-sibling', 'another'), null);
  assert.equal(await vaultStore.getValue('tenant-b', 'ws-b', 'probe'), MARKER);
  assert.deepEqual(result.body.removed.secrets, ['ws-a/probe', 'ws-sibling/another']);
  assert.deepEqual(result.body.residual.secrets, []);
  assert.ok(!JSON.stringify(result).includes(MARKER));
});

for (const scope of ['tenant', 'workspace']) {
  test(`${scope} teardown fails closed with survivor names and supports the same request on retry`, async () => {
    const { bao, vaultStore, ctx } = setup();
    await vaultStore.set('tenant-a', 'ws-a', 'probe', MARKER);
    await vaultStore.set('tenant-a', 'ws-a', 'removable', MARKER);
    const faultKey = `DELETE:${workspaceSecretPath('tenant-a', 'ws-a', 'probe')}`;
    bao.faults.set(faultKey, 403);
    const invoke = () => scope === 'tenant'
      ? LOCAL_HANDLERS.purgeTenant({ ...ctx, params: { tenantId: 'tenant-a' } })
      : LOCAL_HANDLERS.deleteWorkspace({ ...ctx, params: { workspaceId: 'ws-a' } });
    const result = await invoke();
    assert.equal(result.statusCode, 502);
    assert.equal(result.body.code, 'SECRET_TEARDOWN_INCOMPLETE');
    assert.deepEqual(result.body.residual.secrets, [scope === 'tenant' ? 'ws-a/probe' : 'probe']);
    assert.deepEqual(result.body.removed.secrets, [scope === 'tenant' ? 'ws-a/removable' : 'removable']);
    assert.ok(!JSON.stringify(result).includes(MARKER));
    const tenant = await LOCAL_HANDLERS.getTenant({ ...ctx, params: { tenantId: 'tenant-a' } });
    const workspace = await LOCAL_HANDLERS.getWorkspace({ ...ctx, params: { workspaceId: 'ws-a' } });
    assert.equal(tenant.statusCode, 200, 'tenant retained for retry');
    assert.equal(workspace.statusCode, 200, 'workspace retained for retry');
    bao.faults.delete(faultKey);
    const retry = await invoke();
    assert.equal(retry.statusCode, 200);
    assert.equal(await vaultStore.getValue('tenant-a', 'ws-a', 'probe'), null);
  });
}

test('a malformed resolved workspace cannot broaden deletion to its tenant', async () => {
  const { bao, ctx } = setup();
  const query = ctx.pool.query;
  ctx.pool.query = async (sql, params) => /FROM workspaces WHERE/.test(sql)
    ? { rows: [{ tenant_id: 'tenant-a' }] }
    : query(sql, params);
  const result = await LOCAL_HANDLERS.deleteWorkspace({ ...ctx, params: { workspaceId: 'ws-a' } });
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.code, 'SECRET_TEARDOWN_INCOMPLETE');
  assert.deepEqual(bao.requests, [], 'no KV operation without both resolved ids');
});

test('workspace deletion destroys only its own secrets despite request-body coordinates', async () => {
  const { client, vaultStore, ctx } = setup();
  for (const [tenant, ws] of [['tenant-a', 'ws-a'], ['tenant-a', 'ws-sibling'], ['tenant-b', 'ws-b']]) {
    await vaultStore.set(tenant, ws, 'probe', MARKER);
  }
  const result = await LOCAL_HANDLERS.deleteWorkspace({ ...ctx, params: { workspaceId: 'ws-a' } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.deleted, true);
  assert.deepEqual(result.body.removed.secrets, ['probe']);
  assert.deepEqual(result.body.residual.secrets, []);
  assert.equal(await vaultStore.getValue('tenant-a', 'ws-a', 'probe'), null);
  assert.equal(await client.readMeta(workspaceSecretPath('tenant-a', 'ws-a', 'probe')), null);
  assert.equal(await vaultStore.getValue('tenant-a', 'ws-sibling', 'probe'), MARKER);
  assert.equal(await vaultStore.getValue('tenant-b', 'ws-b', 'probe'), MARKER);
});

for (const scope of ['tenant', 'workspace']) {
  const invoke = (ctx) => scope === 'tenant'
    ? LOCAL_HANDLERS.purgeTenant({ ...ctx, params: { tenantId: 'tenant-a' } })
    : LOCAL_HANDLERS.deleteWorkspace({ ...ctx, params: { workspaceId: 'ws-a' } });

  test(`${scope} teardown discloses a disabled backend`, async () => {
    const { ctx } = setup();
    const result = await invoke({ ...ctx, vaultStore: null });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body.removed.secrets, []);
    assert.deepEqual(result.body.residual, { knativeServices: [], secrets: [], secretsBackend: 'disabled' });
  });

  test(`${scope} cleanup_pending preserves rows and does not touch OpenBao`, async () => {
    const { bao, vaultStore, ctx } = setup();
    await vaultStore.set('tenant-a', 'ws-a', 'probe', MARKER);
    bao.requests.length = 0;
    const pending = async () => ({ pending: true, obligations: [{ resourceType: 'function', resourceId: 'synthetic-function' }] });
    const result = await invoke({ ...ctx, runtimeTeardownCoordinator: { purgeTenant: pending, purgeWorkspace: pending } });
    assert.equal(result.statusCode, 202);
    assert.equal(result.body.status, 'cleanup_pending');
    assert.deepEqual(bao.requests, []);
    assert.equal((await LOCAL_HANDLERS.getTenant({ ...ctx, params: { tenantId: 'tenant-a' } })).statusCode, 200);
    assert.equal((await LOCAL_HANDLERS.getWorkspace({ ...ctx, params: { workspaceId: 'ws-a' } })).statusCode, 200);
  });

  test(`${scope} unexpected backend errors expose only a prefix and a recovery path`, async (t) => {
    const { ctx } = setup();
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args));
    const unavailable = async () => { throw new Error(MARKER); };
    const result = await invoke({ ...ctx, vaultStore: { purgeTenant: unavailable, purgeWorkspace: unavailable } });
    assert.equal(result.statusCode, 502);
    assert.equal(result.body.code, 'SECRET_TEARDOWN_INCOMPLETE');
    assert.deepEqual(result.body.residual.secrets, [scope === 'tenant' ? 'tenant-a/' : 'ws-a/']);
    assert.match(result.body.message, /retry the same/);
    assert.deepEqual(logs.map(([record]) => JSON.parse(record)), [
      { event: 'secret_teardown_failure', operation: scope === 'tenant' ? 'purgeTenant' : 'purgeWorkspace', status: 0 },
    ]);
    assert.ok(!JSON.stringify({ result, logs }).includes(MARKER));
  });
}
