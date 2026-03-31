import test from 'node:test';
import assert from 'node:assert/strict';
import { main as tenantEntitlements } from '../../../services/provisioning-orchestrator/src/actions/tenant-effective-entitlements-get.mjs';
import { createFakeDb, seedPlans, seedAssignments } from './fixtures/seed-plans-with-quotas-and-capabilities.mjs';
import { seedOverrides } from './fixtures/seed-overrides.mjs';

const admin = { callerContext: { actor: { id: 'admin-1', type: 'superadmin' } } };

test('acme-corp on starter plan with override for max_workspaces resolves sources correctly', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db); seedOverrides(db);
  const result = await tenantEntitlements({ ...admin, tenantId: 'acme-corp' }, { db });
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_workspaces').source, 'override');
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_functions').source, 'plan');
});

test('missing dimension in plan falls back to catalog_default', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantEntitlements({ ...admin, tenantId: 'acme-corp' }, { db });
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_kafka_topics').source, 'catalog_default');
});

test('dimension set to -1 at plan level passes through as unlimited', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantEntitlements({ ...admin, tenantId: 'unlimited-corp' }, { db });
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_functions').effectiveValue, -1);
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_functions').source, 'plan');
});

test('override setting dimension to 0 passes through', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db); seedOverrides(db);
  const result = await tenantEntitlements({ ...admin, tenantId: 'acme-corp' }, { db });
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_pg_databases').effectiveValue, 0);
  assert.equal(result.body.quantitativeLimits.find((x) => x.dimensionKey === 'max_pg_databases').source, 'override');
});

test('tenant with no plan assigned falls back to catalog defaults', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantEntitlements({ ...admin, tenantId: 'tenant-none' }, { db });
  assert.equal(result.body.quantitativeLimits.every((x) => x.source === 'catalog_default'), true);
});

test('professional capabilities include plan and catalog defaults', async () => {
  const db = createFakeDb(); seedPlans(db); seedAssignments(db);
  const result = await tenantEntitlements({ ...admin, tenantId: 'pro-corp' }, { db });
  assert.equal(result.body.capabilities.find((x) => x.capabilityKey === 'realtime').source, 'plan');
  assert.equal(result.body.capabilities.find((x) => x.capabilityKey === 'webhooks').source, 'plan');
  assert.equal(result.body.capabilities.find((x) => x.capabilityKey === 'sql_admin_api').source, 'plan');
  assert.equal(result.body.capabilities.find((x) => x.capabilityKey === 'custom_domains').source, 'catalog_default');
  assert.equal(result.body.capabilities.find((x) => x.capabilityKey === 'batch_exports').enabled, false);
});
