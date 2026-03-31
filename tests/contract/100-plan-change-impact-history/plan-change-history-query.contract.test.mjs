import test from 'node:test';
import assert from 'node:assert/strict';
import contract from '../../../specs/100-plan-change-impact-history/contracts/plan-change-history-query.json' with { type: 'json' };

test('history query contract exposes required path', () => {
  assert.ok(contract.paths['/v1/tenants/{tenantId}/plan/history-impact']);
});
