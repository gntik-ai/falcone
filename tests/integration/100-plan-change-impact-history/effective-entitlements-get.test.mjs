import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUsageStatus } from '../../../services/provisioning-orchestrator/src/models/effective-entitlement-snapshot.mjs';

test('effective entitlements classify unlimited and missing correctly', () => {
  assert.equal(classifyUsageStatus({ newEffectiveValueKind: 'unlimited', observedUsage: 999 }), 'within_limit');
  assert.equal(classifyUsageStatus({ newEffectiveValueKind: 'missing', observedUsage: 1 }), 'unknown');
});
