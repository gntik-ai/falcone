import test from 'node:test';
import assert from 'node:assert/strict';
import contract from '../../contracts/schemas/plan-change-history-query.json' with { type: 'json' };

test('history query contract exposes required path', () => {
  assert.ok(contract.paths['/v1/tenants/{tenantId}/plan/history-impact']);
});
