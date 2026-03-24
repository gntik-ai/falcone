import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POSTGRES_ADMIN_CAPABILITY_MATRIX,
  POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY,
  RESERVED_POSTGRES_DATABASE_NAMES,
  SUPPORTED_POSTGRES_VERSION_RANGES,
  buildPostgresAdminAdapterCall,
  buildPostgresAdminInventorySnapshot,
  isPostgresVersionSupported,
  normalizePostgresAdminError,
  normalizePostgresAdminResource,
  resolvePostgresAdminProfile,
  validatePostgresAdminRequest
} from '../../services/adapters/src/postgresql-admin.mjs';

test('postgres admin adapter exports the supported compatibility matrix and profile baseline', () => {
  const growthProfile = resolvePostgresAdminProfile({ planId: 'pln_01growth' });
  const enterpriseProfile = resolvePostgresAdminProfile({ planId: 'pln_01enterprise' });

  assert.deepEqual(Object.keys(POSTGRES_ADMIN_CAPABILITY_MATRIX), ['role', 'user', 'database', 'schema']);
  assert.equal(SUPPORTED_POSTGRES_VERSION_RANGES.length, 3);
  assert.equal(isPostgresVersionSupported('15.6'), true);
  assert.equal(isPostgresVersionSupported('16.3'), true);
  assert.equal(isPostgresVersionSupported('17.0'), true);
  assert.equal(isPostgresVersionSupported('14.11'), false);
  assert.equal(growthProfile.placementMode, 'schema_per_tenant');
  assert.equal(growthProfile.databaseMutationsSupported, false);
  assert.equal(enterpriseProfile.placementMode, 'database_per_tenant');
  assert.equal(enterpriseProfile.databaseMutationsSupported, true);
  assert.equal(POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY.database_per_tenant.requiresCreatedb, true);
  assert.equal(RESERVED_POSTGRES_DATABASE_NAMES.includes('postgres'), true);
});

test('postgres admin adapter normalizes provider payloads into safe BaaS resource shapes', () => {
  const role = normalizePostgresAdminResource(
    'role',
    {
      roleName: 'alpha_dev_readwrite',
      memberOf: ['alpha_dev_runtime'],
      metadata: { source: 'console' }
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth'
    }
  );
  const user = normalizePostgresAdminResource(
    'user',
    {
      userName: 'alpha_dev_api',
      memberOf: ['alpha_dev_readwrite'],
      credentialBinding: {
        secretRef: 'vault://postgres/alpha/dev/api',
        rotationPolicy: '30d'
      }
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth'
    }
  );
  const database = normalizePostgresAdminResource(
    'database',
    {
      databaseName: 'tenant_alpha_main',
      ownerRoleName: 'tenant_alpha_owner',
      locale: { encoding: 'UTF8' }
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const schema = normalizePostgresAdminResource(
    'schema',
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      ownerRoleName: 'alpha_prod_owner',
      workspaceBindings: ['wrk_01alphaprod'],
      objectCounts: { tables: 12, views: 2 }
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );

  assert.equal(role.resourceType, 'postgres_role');
  assert.deepEqual(role.memberOf, ['alpha_dev_runtime']);
  assert.equal(role.providerCompatibility.provider, 'postgresql');

  assert.equal(user.resourceType, 'postgres_user');
  assert.equal(user.loginEnabled, true);
  assert.equal(user.credentialBinding.secretRef, 'vault://postgres/alpha/dev/api');

  assert.equal(database.resourceType, 'postgres_database');
  assert.equal(database.placementMode, 'database_per_tenant');
  assert.equal(database.locale.encoding, 'UTF8');

  assert.equal(schema.resourceType, 'postgres_schema');
  assert.equal(schema.objectCounts.tables, 12);
  assert.deepEqual(schema.workspaceBindings, ['wrk_01alphaprod']);
});

test('postgres admin adapter validates profile guardrails, unsafe engine details, and quotas', () => {
  const sharedDatabaseMutation = validatePostgresAdminRequest({
    resourceKind: 'database',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth',
      tenantNamePrefix: 'tenant_alpha'
    },
    payload: {
      databaseName: 'tenant_alpha_extra',
      ownerRoleName: 'tenant_alpha_owner'
    }
  });
  const unsafeUser = validatePostgresAdminRequest({
    resourceKind: 'user',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth',
      workspaceNamePrefix: 'alpha_dev_',
      currentInventory: {
        counts: {
          users: 64
        }
      }
    },
    payload: {
      userName: 'wrongprefix_api',
      memberOf: ['platform_provisioner', 'platform_provisioner'],
      password: 'plain-text-is-forbidden'
    }
  });
  const invalidSchema = validatePostgresAdminRequest({
    resourceKind: 'schema',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth',
      workspaceNamePrefix: 'alpha_dev_',
      tenantDatabaseName: 'tenant_alpha_main',
      currentInventory: {
        schemasByDatabase: {
          tenant_alpha_main: 24,
          tenant_alpha_other: 24
        }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_other',
      schemaName: 'alpha_prod_app',
      ownerRoleName: 'alpha_dev_owner',
      workspaceBindings: ['wrk_01alphadev', 'wrk_01other']
    }
  });

  assert.equal(sharedDatabaseMutation.ok, false);
  assert.equal(
    sharedDatabaseMutation.violations.some((violation) => violation.includes('Database mutations are not supported for placement mode schema_per_tenant')),
    true
  );

  assert.equal(unsafeUser.ok, false);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('Unsafe engine field password')), true);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('must start with alpha_dev_')), true);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('cannot target reserved platform or engine roles')), true);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('would be exceeded')), true);

  assert.equal(invalidSchema.ok, false);
  assert.equal(invalidSchema.violations.some((violation) => violation.includes('cannot escape the current workspace scope')), true);
  assert.equal(invalidSchema.violations.some((violation) => violation.includes('only allows schemas inside tenant database tenant_alpha_main')), true);
  assert.equal(invalidSchema.violations.some((violation) => violation.includes('would be exceeded')), true);
});

test('postgres admin adapter builds stable adapter envelopes, inventory projections, and normalized dependency errors', () => {
  const adapterCall = buildPostgresAdminAdapterCall({
    resourceKind: 'schema',
    action: 'create',
    callId: 'call_01pgschemacreate',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-pgadm-001',
    authorizationDecisionId: 'authz-pgadm-001',
    idempotencyKey: 'idem-pgadm-001',
    targetRef: 'database:tenant_alpha_main/schema:alpha_prod_app',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      workspaceNamePrefix: 'alpha_prod_'
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      ownerRoleName: 'alpha_prod_owner',
      workspaceBindings: ['wrk_01alphaprod']
    },
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin']
  });
  const inventory = buildPostgresAdminInventorySnapshot({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    roles: [{ roleName: 'alpha_prod_owner' }],
    users: [{ userName: 'alpha_prod_api' }],
    databases: [{ databaseName: 'tenant_alpha_main' }],
    schemas: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', workspaceBindings: ['wrk_01alphaprod'] }]
  });
  const normalizedError = normalizePostgresAdminError(
    {
      classification: 'quota_exceeded',
      status: 422,
      message: 'Schema quota exceeded.',
      providerError: 'limit reached'
    },
    {
      resourceKind: 'schema',
      action: 'create',
      resourceId: 'tenant_alpha_main.alpha_prod_app',
      placementMode: 'database_per_tenant'
    }
  );

  assert.equal(adapterCall.adapter_id, 'postgresql');
  assert.equal(adapterCall.capability, 'postgres_schema_create');
  assert.equal(adapterCall.payload.resourceKind, 'schema');
  assert.equal(adapterCall.payload.placementProfile.placementMode, 'database_per_tenant');
  assert.equal(adapterCall.payload.normalizedResource.resourceType, 'postgres_schema');
  assert.equal(adapterCall.contract_version, '2026-03-24');

  assert.equal(inventory.placementMode, 'database_per_tenant');
  assert.equal(inventory.counts.schemas, 1);
  assert.equal(inventory.byDatabase.tenant_alpha_main.schemaCount, 1);
  assert.equal(inventory.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);

  assert.equal(normalizedError.status, 422);
  assert.equal(normalizedError.code, 'GW_PGADM_QUOTA_EXCEEDED');
  assert.equal(normalizedError.detail.resourceKind, 'schema');
  assert.equal(normalizedError.retryable, false);
});
