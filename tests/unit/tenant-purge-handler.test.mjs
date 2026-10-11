import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import * as store from '../../apps/control-plane/tenant-store.mjs';
import { createRuntimeTeardownCoordinator } from '../../apps/control-plane/runtime-teardown-coordinator.mjs';

function context({ error, hidden = false } = {}) {
  const query = async (sql) => {
    if (/FROM flow_versions/.test(sql)) {
      if (error) throw error;
      if (hidden) throw Object.assign(new Error('private backend detail'), { code: '42501' });
    }
    if (/SELECT count\(\*\)/.test(sql)) return { rows: [{ count: 0 }] };
    if (/FROM tenants WHERE/.test(sql)) return { rows: [{ id: 'tenant-a' }] };
    if (/has_table_privilege/.test(sql)) return { rows: [{ allowed: true }] };
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) };
  return {
    pool, params: { tenantId: 'tenant-a' }, identity: { actorType: 'superadmin' },
    vaultStore: null,
    runtimeTeardownCoordinator: createRuntimeTeardownCoordinator({ store }),
  };
}

test('tenant purge HTTP response discloses protected database tables without changing secret residue', async () => {
  const result = await LOCAL_HANDLERS.purgeTenant(context({ hidden: true }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.purged, true);
  assert.deepEqual(result.body.residual.databaseTables, [{ table: 'flow_versions', count: null }]);
  assert.deepEqual(result.body.residual.secrets, []);
  assert.equal(result.body.residual.secretsBackend, 'disabled');
});

test('tenant purge HTTP response preserves programming failures for the server error boundary', async () => {
  const problem = new TypeError('programming fault');
  await assert.rejects(LOCAL_HANDLERS.purgeTenant(context({ error: problem })), (error) => error === problem);
});

test('tenant purge HTTP response logs only safe SQL diagnostics', async (t) => {
  const entries = [];
  t.mock.method(console, 'error', (...args) => entries.push(args));
  const error = Object.assign(new Error('private backend detail'), { code: '40001' });
  const result = await LOCAL_HANDLERS.purgeTenant(context({ error }));
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, 'TENANT_PURGE_INCOMPLETE');
  assert.deepEqual(entries[0][1], { code: '40001', table: 'flow_versions', count: null });
  assert.ok(!JSON.stringify([result, entries]).includes('private backend detail'));
});
