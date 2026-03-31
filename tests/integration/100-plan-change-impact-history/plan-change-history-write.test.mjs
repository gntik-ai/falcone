import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuotaImpactSet, buildCapabilityImpactSet } from '../../../services/provisioning-orchestrator/src/models/effective-entitlement-snapshot.mjs';

test('upgrade/downgrade snapshots include quota and capability lines', () => {
  const quotas = buildQuotaImpactSet([{ dimensionKey: 'max_workspaces', effectiveValue: 5, effectiveValueKind: 'bounded' }], [{ dimensionKey: 'max_workspaces', effectiveValue: 10, effectiveValueKind: 'bounded' }], [{ dimensionKey: 'max_workspaces', observedUsage: 8 }]);
  const capabilities = buildCapabilityImpactSet([{ capabilityKey: 'audit', enabled: false }], [{ capabilityKey: 'audit', enabled: true }]);
  assert.equal(quotas.length, 1);
  assert.equal(quotas[0].comparison, 'increased');
  assert.equal(capabilities[0].comparison, 'enabled');
});
