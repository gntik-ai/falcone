import test from 'node:test';
import assert from 'node:assert/strict';
import contract from '../../../specs/100-plan-change-impact-history/contracts/plan-effective-entitlements-get.json' with { type: 'json' };

test('effective entitlements contract exposes required path', () => {
  assert.ok(contract.paths['/v1/tenant/plan/effective-entitlements']);
});
