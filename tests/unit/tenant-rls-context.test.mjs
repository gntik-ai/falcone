// Unit tests for the tenant RLS context helper (no real DB; a fake pg client
// records the SQL it is asked to run). Verifies the helper emits the exact
// transaction + SET LOCAL sequence the RLS policies depend on, fails closed when
// the tenant is missing, rolls back on error, and always releases the connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withTenantRlsContext,
  setTenantRlsContext,
} from '../../services/adapters/src/tenant-rls-context.mjs';

function fakeClient() {
  const calls = [];
  let released = false;
  return {
    calls,
    get released() {
      return released;
    },
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
}

function fakePool(client) {
  return {
    connectCount: 0,
    async connect() {
      this.connectCount += 1;
      return client;
    },
  };
}

test('withTenantRlsContext wraps the callback in BEGIN; set_config; COMMIT', async () => {
  const client = fakeClient();
  const pool = fakePool(client);

  const result = await withTenantRlsContext(
    pool,
    { tenantId: 'ten_A', workspaceId: 'ws_1' },
    async (c) => {
      await c.query('SELECT * FROM scheduled_jobs');
      return 'ok';
    },
  );

  assert.equal(result, 'ok');
  const sqls = client.calls.map((c) => c.sql);
  assert.deepEqual(sqls, [
    'BEGIN',
    'SELECT set_config($1, $2, true)',
    'SELECT set_config($1, $2, true)',
    'SELECT * FROM scheduled_jobs',
    'COMMIT',
  ]);
  // tenant set before workspace, both bound as parameters (never concatenated)
  assert.deepEqual(client.calls[1].params, ['app.tenant_id', 'ten_A']);
  assert.deepEqual(client.calls[2].params, ['app.workspace_id', 'ws_1']);
  assert.equal(client.released, true);
});

test('withTenantRlsContext omits workspace set_config when workspaceId is absent', async () => {
  const client = fakeClient();
  const pool = fakePool(client);

  await withTenantRlsContext(pool, { tenantId: 'ten_A' }, async () => {});

  const sqls = client.calls.map((c) => c.sql);
  assert.deepEqual(sqls, ['BEGIN', 'SELECT set_config($1, $2, true)', 'COMMIT']);
  assert.deepEqual(client.calls[1].params, ['app.tenant_id', 'ten_A']);
});

test('withTenantRlsContext rolls back and rethrows on callback error, still releases', async () => {
  const client = fakeClient();
  const pool = fakePool(client);

  await assert.rejects(
    () =>
      withTenantRlsContext(pool, { tenantId: 'ten_A', workspaceId: 'ws_1' }, async () => {
        throw new Error('boom');
      }),
    /boom/,
  );

  const sqls = client.calls.map((c) => c.sql);
  assert.ok(sqls.includes('ROLLBACK'), 'should ROLLBACK on error');
  assert.ok(!sqls.includes('COMMIT'), 'should not COMMIT on error');
  assert.equal(client.released, true, 'connection must be released even on error');
});

test('withTenantRlsContext refuses a missing/empty tenantId (fail-closed)', async () => {
  const client = fakeClient();
  const pool = fakePool(client);

  await assert.rejects(
    () => withTenantRlsContext(pool, { tenantId: '' }, async () => {}),
    /tenantId/,
  );
  // never opened a transaction / checked out a connection on bad input
  assert.equal(pool.connectCount, 0);
});

test('setTenantRlsContext binds GUC values as parameters on an open transaction', async () => {
  const client = fakeClient();
  await setTenantRlsContext(client, { tenantId: 'ten_B', workspaceId: 'ws_9' });
  assert.deepEqual(client.calls, [
    { sql: 'SELECT set_config($1, $2, true)', params: ['app.tenant_id', 'ten_B'] },
    { sql: 'SELECT set_config($1, $2, true)', params: ['app.workspace_id', 'ws_9'] },
  ]);
});
