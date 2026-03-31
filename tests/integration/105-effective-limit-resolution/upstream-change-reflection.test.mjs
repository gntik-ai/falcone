import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantEntitlements } from '../../../services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs';
import { createFakeDb, seedPlans, seedAssignments } from './fixtures/seed-plans-with-quotas-and-capabilities.mjs';
import { seedOverrides } from './fixtures/seed-overrides.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('plan upgrade is reflected on next query', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  db.assignments.set('acme-corp', { tenant_id: 'acme-corp', plan_id: 'professional' });
  const result = await tenantEntitlements({ ...admin, tenantId: 'acme-corp' }, { db });
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_functions').effectiveValue, 200);
});

test('override revocation returns plan base value on next query', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db); seedOverrides(db);
  db._quotaOverrides = db._quotaOverrides.filter((x) => !(x.tenantId === 'acme-corp' && x.dimensionKey === 'max_workspaces'));
  const result = await tenantEntitlements({ ...admin, tenantId: 'acme-corp' }, { db });
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_workspaces').effectiveValue, 5);
});
