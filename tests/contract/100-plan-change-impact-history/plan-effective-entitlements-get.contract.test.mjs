import test from 'node:test';
import assert from 'node:assert/strict';
import contract from '../../contracts/schemas/plan-effective-entitlements-get.json' with { type: 'json' };

test('effective entitlements contract exposes required path', () => {
  assert.ok(contract.paths['/v1/tenant/plan/effective-entitlements']);
});
