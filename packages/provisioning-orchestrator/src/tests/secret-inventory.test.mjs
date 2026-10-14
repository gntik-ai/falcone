import test from 'node:test';
import assert from 'node:assert/strict';
import { secretInventory } from '../actions/secret-inventory.mjs';

test('returns 403 for missing role', async () => {
  const result = await secretInventory({ domain: 'platform', auth: { roles: [] } });
  assert.equal(result.statusCode, 403);
});

test('returns metadata for authorized operator', async () => {
  const result = await secretInventory(
    { domain: 'platform', auth: { roles: ['platform-operator'] } },
    { query: async () => ({ rows: [{ name: 'app-password', domain: 'platform', path: 'platform/postgresql/app-password', createdAt: '2026-03-30T00:00:00Z', updatedAt: '2026-03-30T00:00:00Z', status: 'active', secretType: 'password' }] }) }
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.secrets[0].name, 'app-password');
  assert.equal('value' in result.body.secrets[0], false);
});

test('cross-tenant query denied for tenant operator', async () => {
  let calls = 0;
  const result = await secretInventory({ domain: 'tenant', tenantId: 'b', auth: { roles: ['tenant-operator'], tenantId: 'a' } }, {
    query: async () => { calls++; return { rows: [] }; }
  });
  assert.deepEqual(result, { statusCode: 403, body: { error: 'forbidden' } });
  assert.equal(calls, 0);
});

test('tenant operator omitting tenantId receives only their trusted tenant', async () => {
  const tenants = [{ tenantId: 'a' }, { tenantId: 'b' }];
  const result = await secretInventory(
    { domain: 'tenant', auth: { roles: ['tenant-operator'], tenantId: 'a' } },
    { query: async (_sql, values) => ({ rows: tenants.filter(row => !values[1] || row.tenantId === values[1]) }) }
  );
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.secrets.map(row => row.tenantId), ['a']);
});

test('tenant operator without trusted tenant identity is denied before querying', async () => {
  let calls = 0;
  const result = await secretInventory(
    { domain: 'tenant', auth: { roles: ['tenant-operator'] } },
    { query: async () => { calls++; return { rows: [] }; } }
  );
  assert.deepEqual(result, { statusCode: 403, body: { error: 'forbidden' } });
  assert.equal(calls, 0);
});

test('invalid domain and pagination return exact errors without querying', async () => {
  for (const [params, error] of [
    [{}, 'domain is required'],
    [{ domain: 'unknown' }, 'invalid domain'],
    ...[{ limit: '0' }, { limit: '201' }, { offset: '-1' }, { limit: '1.5' },
      { offset: 'abc' }, { limit: '' }, { offset: '1e2' }, { limit: true },
      { offset: ['1'] }, { offset: '9007199254740992' }]
      .map(pagination => [{ domain: 'platform', ...pagination }, 'invalid pagination'])
  ]) {
    let calls = 0;
    const result = await secretInventory({ ...params, auth: { roles: ['superadmin'] } }, {
      query: async () => { calls++; return { rows: [] }; }
    });
    assert.deepEqual(result, { statusCode: 400, body: { error } }, JSON.stringify(params));
    assert.equal(calls, 0);
  }
});

test('string pagination is returned as integers and defaults are 0 and 50', async () => {
  for (const [params, page] of [[{}, [0, 50]], [{ offset: '2', limit: '200' }, [2, 200]]]) {
    const result = await secretInventory({ domain: 'platform', auth: { roles: ['superadmin'] }, ...params }, {
      query: async (_sql, values) => { assert.deepEqual(values.slice(2), page); return { rows: [] }; }
    });
    assert.deepEqual([result.body.offset, result.body.limit], page);
  }
});

test('version metadata exposes only the inventory contract fields', async () => {
  for (const [version, count, expectedVersion, force] of [
    [{ vaultVersion: 2, state: 'active', activatedAt: '2026-03-31T00:00:00Z' }, '1',
      { vaultVersion: 2, state: 'active', activatedAt: '2026-03-31T00:00:00Z' }, true],
    [{ vaultVersion: 3, state: 'active', activatedAt: '2026-04-01T00:00:00Z' }, '2',
      { vaultVersion: 3, state: 'active', activatedAt: '2026-04-01T00:00:00Z' }, false],
    [{ vaultVersion: 1, state: 'grace', activatedAt: '2026-03-30T00:00:00Z' }, '1',
      { vaultVersion: 1, state: 'grace', activatedAt: '2026-03-30T00:00:00Z' }, true],
    [null, null, null, false]
  ]) {
    const row = { name: 'key', domain: 'platform', path: 'platform/key', createdAt: '2026-03-30T00:00:00Z',
      updatedAt: '2026-04-01T00:00:00Z', status: 'active', secretType: 'password', tenantId: null,
      currentVersion: version, versionCount: count };
    const result = await secretInventory({ domain: 'platform', auth: { roles: ['superadmin'] } }, {
      query: async () => ({ rows: [row] })
    });
    const { versionCount: _count, ...metadata } = row;
    assert.deepEqual(result.body.secrets, [{ ...metadata, currentVersion: expectedVersion, requiresForce: force }]);
  }
});

test('secret material is rejected in every inventory item including nested version metadata', async () => {
  for (const row of [{ value: 'forbidden' }, { data: {} }, { currentVersion: { value: 'forbidden' } }]) {
    await assert.rejects(secretInventory({ domain: 'platform', auth: { roles: ['superadmin'] } }, {
      query: async () => ({ rows: [{ name: 'safe' }, row] })
    }), /Secret material exposure is forbidden/);
  }
});
