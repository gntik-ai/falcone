import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiKeyStore } from '../../apps/control-plane-executor/src/runtime/api-keys.mjs';

function recordingPool(storedKey) {
  const statements = [];
  return {
    statements,
    async query(sql, params) {
      statements.push(sql);
      if (sql.startsWith('INSERT')) {
        return { rowCount: 1, rows: [{ id: 'key-id', key_prefix: params[3], key_type: params[2], scopes: params[5] }] };
      }
      if (sql.startsWith('SELECT')) return { rowCount: storedKey ? 1 : 0, rows: storedKey ? [storedKey] : [] };
      if (sql.startsWith('UPDATE')) return { rowCount: 1, rows: [{ id: 'key-id' }] };
      throw new Error('Unexpected query');
    },
  };
}

const identity = { tenantId: 'fixture-tenant', workspaceId: 'fixture-workspace' };

test('anon write scopes are rejected before any database query or key is returned', async () => {
  const pool = recordingPool();
  const store = createApiKeyStore({ pool });
  await assert.rejects(
    store.issueKey({ ...identity, keyType: 'anon', scopes: ['data:write'] }),
    (error) => error.statusCode === 400 && error.code === 'SCOPE_EXCEEDS_KEY_TYPE' && !('key' in error),
  );
  assert.equal(pool.statements.length, 0);
});

test('rotating a legacy over-scoped anon key rejects without revoking or minting', async () => {
  const pool = recordingPool({ tenant_id: identity.tenantId, workspace_id: identity.workspaceId, key_type: 'anon', scopes: ['data:read', 'data:write'] });
  await assert.rejects(
    createApiKeyStore({ pool }).rotateKey({ id: 'key-id', workspaceId: identity.workspaceId }),
    (error) => error.statusCode === 400 && error.code === 'SCOPE_EXCEEDS_KEY_TYPE' && !('key' in error),
  );
  assert.equal(pool.statements.filter((sql) => /^(INSERT|UPDATE)/.test(sql)).length, 0);
});

test('malformed scopes are rejected for either type without echoing non-string values', async () => {
  for (const keyType of ['anon', 'service']) {
    for (const scopes of ['data:read', null, {}, [123], [null], [{ private: 'sensitive-fixture' }], ['data:read', false]]) {
      const pool = recordingPool();
      await assert.rejects(
        createApiKeyStore({ pool }).issueKey({ ...identity, keyType, scopes }),
        (error) => error.statusCode === 400 && error.code === 'SCOPE_EXCEEDS_KEY_TYPE'
          && error.message === 'Scopes must be an array of strings' && !('key' in error),
      );
      assert.equal(pool.statements.length, 0);
    }
  }
});

test('anon DDL and mixed scopes are rejected rather than silently dropped', async () => {
  for (const scopes of [['ddl:write'], ['data:read', 'data:write', 'ddl:write']]) {
    const pool = recordingPool();
    await assert.rejects(
      createApiKeyStore({ pool }).issueKey({ ...identity, keyType: 'anon', scopes }),
      (error) => error.statusCode === 400 && error.code === 'SCOPE_EXCEEDS_KEY_TYPE' && !('key' in error),
    );
    assert.equal(pool.statements.length, 0);
  }
});

test('unknown scope names are rejected for either key type', async () => {
  for (const keyType of ['anon', 'service']) {
    const pool = recordingPool();
    await assert.rejects(
      createApiKeyStore({ pool }).issueKey({ ...identity, keyType, scopes: ['data:read', 'admin:*'] }),
      (error) => error.statusCode === 400 && error.code === 'SCOPE_EXCEEDS_KEY_TYPE'
        && error.message === 'Scopes exceed key type: admin:*',
    );
    assert.equal(pool.statements.length, 0);
  }
});

test('anon defaults and an explicit read scope retain the read-only ceiling', async () => {
  for (const scopes of [undefined, [], ['data:read']]) {
    const pool = recordingPool();
    const result = await createApiKeyStore({ pool }).issueKey({ ...identity, keyType: 'anon', scopes });
    assert.equal(result.keyType, 'anon');
    assert.deepEqual(result.scopes, ['data:read']);
    assert.equal(pool.statements.length, 1);
  }
});

test('service keys accept every non-empty scope subset and default to the full ceiling', async () => {
  const subsets = [
    ['data:read'], ['data:write'], ['ddl:write'],
    ['data:read', 'data:write'], ['data:read', 'ddl:write'], ['data:write', 'ddl:write'],
    ['data:read', 'data:write', 'ddl:write'],
  ];
  for (const scopes of [undefined, [], ...subsets]) {
    const pool = recordingPool();
    const result = await createApiKeyStore({ pool }).issueKey({ ...identity, keyType: 'service', scopes });
    assert.equal(result.keyType, 'service');
    assert.deepEqual(result.scopes, scopes?.length ? scopes : ['data:read', 'data:write', 'ddl:write']);
    assert.equal(pool.statements.length, 1);
  }
});

test('rotation preserves the type and scopes of compliant keys', async () => {
  for (const [keyType, scopes] of [['anon', ['data:read']], ['service', ['data:read']], ['service', ['data:read', 'data:write', 'ddl:write']]]) {
    const pool = recordingPool({ tenant_id: identity.tenantId, workspace_id: identity.workspaceId, key_type: keyType, scopes });
    const result = await createApiKeyStore({ pool }).rotateKey({ id: 'key-id', workspaceId: identity.workspaceId });
    assert.equal(result.keyType, keyType);
    assert.deepEqual(result.scopes, scopes);
  }
});
