import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPostgresAdminRoute,
  getPostgresAdminSqlRoute,
  getPostgresCompatibilitySummary,
  listPostgresAdminRoutes,
  listPostgresAdminSqlRoutes,
  postgresApiFamily,
  summarizePostgresAdminSurface
} from '../../apps/control-plane-executor/src/postgres-admin.mjs';

test('postgres admin control-plane helpers expose the expanded postgres family surface', () => {
  const routes = listPostgresAdminRoutes();
  const adminSqlRoutes = listPostgresAdminSqlRoutes();
  const summary = summarizePostgresAdminSurface();
  const resourceKinds = new Map(summary.map((entry) => [entry.resourceKind, entry]));

  assert.equal(postgresApiFamily.id, 'postgres');
  assert.ok(routes.some((route) => route.path === '/v1/postgres/roles'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/constraints'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/views'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/materialized-views'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/procedures'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/security'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/grants'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/databases/{databaseName}/extensions'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/templates'));
  assert.ok(routes.some((route) => route.path === '/v1/postgres/workspaces/{workspaceId}/admin/{databaseName}/sql'));
  assert.equal(adminSqlRoutes.length, 1);
  assert.equal(getPostgresAdminRoute('getPostgresInventory').resourceType, 'postgres_inventory');
  assert.equal(getPostgresAdminSqlRoute().resourceType, 'postgres_admin_sql');
  assert.equal(getPostgresAdminRoute('getPostgresMaterializedView').resourceType, 'postgres_materialized_view');
  assert.equal(getPostgresAdminRoute('getPostgresTableSecurity').resourceType, 'postgres_table_security');
  assert.equal(getPostgresAdminRoute('getPostgresGrant').resourceType, 'postgres_grant');
  assert.equal(resourceKinds.get('constraint').routeCount, 5);
  assert.equal(resourceKinds.get('index').routeCount, 5);
  assert.equal(resourceKinds.get('view').routeCount, 5);
  assert.equal(resourceKinds.get('materialized_view').routeCount, 5);
  assert.equal(resourceKinds.get('function').routeCount, 5);
  assert.equal(resourceKinds.get('procedure').routeCount, 5);
  assert.equal(resourceKinds.get('table_security').routeCount, 2);
  assert.equal(resourceKinds.get('policy').routeCount, 5);
  assert.equal(resourceKinds.get('grant').routeCount, 5);
  assert.equal(resourceKinds.get('extension').routeCount, 5);
  assert.equal(resourceKinds.get('template').routeCount, 5);
  assert.equal(resourceKinds.get('type').routeCount, 1);
  assert.equal(resourceKinds.get('inventory').routeCount, 1);
  assert.equal(resourceKinds.get('admin_sql').routeCount, 1);
});

test('postgres admin compatibility summary reflects placement-aware capability flags and quota guardrails for advanced structural resources', () => {
  const growth = getPostgresCompatibilitySummary({ planId: 'pln_01growth' });
  const enterprise = getPostgresCompatibilitySummary({ planId: 'pln_01enterprise' });

  assert.equal(growth.provider, 'postgresql');
  assert.equal(growth.placementMode, 'schema_per_tenant');
  assert.equal(growth.databaseMutationsSupported, false);
  assert.equal(growth.minimumEnginePolicy.requiresCreatedb, false);
  assert.equal(growth.supportedVersions.length, 3);
  assert.equal(growth.quotaGuardrails.tables.limit > 0, true);
  assert.equal(growth.quotaGuardrails.columns.limit > 0, true);
  assert.equal(growth.quotaGuardrails.constraints.limit > growth.quotaGuardrails.columns.limit, true);
  assert.equal(growth.quotaGuardrails.materializedViews.limit > 0, true);
  assert.equal(growth.minimumEnginePolicy.allowedCapabilities.includes('create_workspace_materialized_views'), true);
  assert.equal(growth.tableSecurityMutationsSupported, true);
  assert.equal(growth.policyMutationsSupported, true);
  assert.equal(growth.grantMutationsSupported, true);
  assert.equal(growth.extensionMutationsSupported, true);
  assert.equal(growth.templateCatalogSupported, true);
  assert.equal(growth.authorizedExtensions.some((entry) => entry.extensionName === 'pgcrypto'), true);
  assert.equal(growth.adminSqlEnabled, false);

  assert.equal(enterprise.placementMode, 'database_per_tenant');
  assert.equal(enterprise.databaseMutationsSupported, true);
  assert.equal(enterprise.minimumEnginePolicy.requiresCreatedb, true);
  assert.equal(enterprise.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);
  assert.equal(enterprise.quotaGuardrails.functions.limit > enterprise.quotaGuardrails.procedures.limit, true);
  assert.equal(enterprise.adminSqlEnabled, true);
  assert.equal(enterprise.adminSqlPlanFlags.includes('postgres.admin_sql.audit'), true);
});
