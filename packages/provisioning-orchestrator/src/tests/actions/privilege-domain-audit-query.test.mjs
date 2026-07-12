import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../actions/privilege-domain-audit-query.mjs';

test('platform_admin queries any tenant', async () => {
  const result = await main({ tenantId: 't-1', auth: { roles: ['platform_admin'] } }, {
    db: {},
    repo: { queryDenials: async () => ({ denials: [{ id: 'd1' }], total: 1 }) }
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.total, 1);
});

test('tenant_owner queries own tenant', async () => {
  const result = await main({ auth: { roles: ['tenant_owner'], tenantId: 't-1' } }, {
    db: {},
    repo: { queryDenials: async (_db, params) => ({ denials: [], total: params.tenantId === 't-1' ? 0 : 99 }) }
  });
  assert.equal(result.statusCode, 200);
});

test('tenant_owner different tenant gets 403', async () => {
  const result = await main({ tenantId: 't-2', auth: { roles: ['tenant_owner'], tenantId: 't-1' } }, { db: {} });
  assert.equal(result.statusCode, 403);
});

test('limit clamps to 200', async () => {
  const result = await main({ tenantId: 't-1', limit: 999, auth: { roles: ['platform_admin'] } }, {
    db: {},
    repo: { queryDenials: async (_db, params) => ({ denials: [], total: params.limit }) }
  });
  assert.equal(result.body.limit, 200);
});

test('missing tenantId for platform_admin gets 400', async () => {
  const result = await main({ auth: { roles: ['platform_admin'] } }, { db: {} });
  assert.equal(result.statusCode, 400);
});
