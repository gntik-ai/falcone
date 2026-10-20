import test from 'node:test';
import assert from 'node:assert/strict';
import { markServiceAccountCredentialsInvalidated, markServiceAccountCredentialsInvalidatedUntil } from '../../apps/control-plane/tenant-store.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

test('rotate and revoke preserve a later credential invalidation cutoff in the database', async () => {
  const calls = [];
  await markServiceAccountCredentialsInvalidated({ query: async (...args) => calls.push(args) }, 'sa-one');
  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /credentials_invalidated_at\s*=\s*GREATEST\(COALESCE\(credentials_invalidated_at, NOW\(\)\), NOW\(\)\)/);
  assert.deepEqual(calls[0][1], ['sa-one']);
});

for (const [handler, status] of [['rotateCredential', 201], ['revokeCredential', 200]]) {
  test(`${handler} uses the monotonic store query after a rollback cutoff`, async () => {
    const queries = [];
    const pool = { query: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.includes('FROM workspaces')) return { rows: [{ id: 'workspace-one', tenant_id: 'tenant-one' }] };
      if (sql.includes('FROM tenants')) return { rows: [{ id: 'tenant-one', iam_realm: 'realm-one' }] };
      if (sql.includes('FROM service_accounts')) return { rows: [{ id: 'sa-one', workspace_id: 'workspace-one',
        iam_realm: 'realm-one', kc_client_uuid: 'client-one', kc_client_id: 'sa-worker', status: 'active',
        credentials_invalidated_at: new Date('2030-01-01T00:00:05Z') }] };
      return { rows: [] };
    } };
    const result = await LOCAL_HANDLERS[handler]({ pool,
      identity: { actorType: 'tenant_owner', tenantId: 'tenant-one' },
      params: { workspaceId: 'workspace-one', serviceAccountId: 'sa-one' },
      kcAdmin: { regenerateClientSecret: async () => 'test-value', setClientEnabled: async () => {} },
    });
    assert.equal(result.statusCode, status);
    const cutoffWrites = queries.filter(query => query.sql.includes('SET credentials_invalidated_at'));
    assert.equal(cutoffWrites.length, 1);
    assert.match(cutoffWrites[0].sql, /GREATEST\(COALESCE\(credentials_invalidated_at, NOW\(\)\), NOW\(\)\)/);
  });
}

test('rollback accepts a future cutoff without lowering any existing cutoff', async () => {
  const calls = [];
  const pool = { query: async (...args) => calls.push(args) };
  const cutoff = new Date('2030-01-01T00:00:04Z');
  await markServiceAccountCredentialsInvalidatedUntil(pool, 'sa-one', cutoff);
  assert.match(calls[0][0], /GREATEST\(COALESCE\(credentials_invalidated_at, NOW\(\)\), NOW\(\), \$2::timestamptz\)/);
  assert.deepEqual(calls[0][1], ['sa-one', cutoff]);
  await assert.rejects(() => markServiceAccountCredentialsInvalidatedUntil(pool, 'sa-one', new Date('invalid')));
  assert.equal(calls.length, 1);
});
