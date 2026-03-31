import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuotaImpact } from '../../../services/provisioning-orchestrator/src/models/effective-entitlement-snapshot.mjs';

test('downgrade over-limit marks hard decrease without blocking', () => {
  const impact = buildQuotaImpact({ dimensionKey: 'max_workspaces', effectiveValueKind: 'bounded', effectiveValue: 10 }, { dimensionKey: 'max_workspaces', effectiveValueKind: 'bounded', effectiveValue: 5 }, { observedUsage: 8 });
  assert.equal(impact.usageStatus, 'over_limit');
  assert.equal(impact.isHardDecrease, true);
});
