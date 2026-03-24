import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPostgresAdminRoute,
  getPostgresCompatibilitySummary,
  listPostgresAdminRoutes,
  postgresApiFamily,
  summarizePostgresAdminSurface
} from '../../apps/control-plane/src/postgres-admin.mjs';

test('postgres admin control-plane helpers expose the generated postgres family surface', () => {
  const routes = listPostgresAdminRoutes();
  const summary = summarizePostgresAdminSurface();
  const roleSummary = summary.find((entry) => entry.resourceKind === 'role');
  const inventorySummary = summary.find((entry) => entry.resourceKind === 'inventory');

  assert.equal(postgresApiFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/roles'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/users'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/inventory'));
  assert.equal(getPostgresAdminRoute('getPostgresInventory').resourceType, 'postgres_inventory');
  assert.ok(roleSummary.routeCount >= 5);
  assert.equal(inventorySummary.routeCount, 1);
});

test('postgres admin compatibility summary reflects placement-aware capabilities and minimum privilege guidance', () => {
  const growth = getPostgresCompatibilitySummary({ planId: 'pln_01growth' });
  const enterprise = getPostgresCompatibilitySummary({ planId: 'pln_01enterprise' });

  assert.equal(growth.provider, 'postgresql');
  assert.equal(growth.placementMode, 'schema_per_tenant');
  assert.equal(growth.databaseMutationsSupported, false);
  assert.equal(growth.minimumEnginePolicy.requiresCreatedb, false);
  assert.equal(growth.supportedVersions.length, 3);

  assert.equal(enterprise.placementMode, 'database_per_tenant');
  assert.equal(enterprise.databaseMutationsSupported, true);
  assert.equal(enterprise.minimumEnginePolicy.requiresCreatedb, true);
  assert.equal(enterprise.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);
});
