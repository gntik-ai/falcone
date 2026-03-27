import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adapterCallContract,
  adapterResultContract,
  buildTenantStorageEvent,
  getStorageProviderCompatibilitySummary,
  getStorageProviderProfile,
  getTenantStorageContextRecord,
  getTenantStorageContextSummary,
  getWorkspaceStorageBootstrapPreview,
  listAuditAdapters,
  listProvisioningAdapters,
  listStorageProviderProfiles,
  providerAdapterCatalog,
  rotateTenantStorageCredential,
  supportedStorageProviderTypes
} from '../../services/adapters/src/provider-catalog.mjs';
import {
  adapterContextTargets,
  adapterEnforcementSurfaces,
  workspaceOwnedResourceSemantics
} from '../../services/adapters/src/authorization-policy.mjs';

test('provider adapter catalog covers all baseline providers', () => {
  const providerIds = new Set(providerAdapterCatalog.map((adapter) => adapter.id));

  for (const providerId of ['keycloak', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage']) {
    assert.ok(providerIds.has(providerId), `missing provider adapter ${providerId}`);
  }

  assert.equal(adapterCallContract.owner, 'services/adapters');
  assert.equal(adapterResultContract.owner, 'services/adapters');
});

test('consumer-specific adapter views remain separated', () => {
  const provisioningIds = new Set(listProvisioningAdapters().map((adapter) => adapter.id));
  const auditIds = new Set(listAuditAdapters().map((adapter) => adapter.id));
  const storageProfiles = listStorageProviderProfiles();
  const minioProfile = getStorageProviderProfile({ providerType: 'minio' });
  const unavailableProfile = getStorageProviderProfile({ providerType: 'unsupported' });
  const compatibility = getStorageProviderCompatibilitySummary({ providerType: 'garage' });

  assert.ok(provisioningIds.has('keycloak'));
  assert.ok(provisioningIds.has('storage'));
  assert.ok(auditIds.has('postgresql'));
  assert.ok(auditIds.has('storage'));
  assert.ok(!auditIds.has('keycloak'));

  assert.equal(supportedStorageProviderTypes.includes('minio'), true);
  assert.equal(supportedStorageProviderTypes.includes('ceph-rgw'), true);
  assert.equal(storageProfiles.length >= 2, true);
  assert.equal(minioProfile.status, 'ready');
  assert.equal(minioProfile.capabilityManifest.bucketOperations, true);
  assert.equal(unavailableProfile.status, 'unavailable');
  assert.equal(compatibility.providerType, 'garage');
  assert.equal(compatibility.capabilityCount >= 4, true);
});

test('adapter authorization policy exposes scoped enforcement targets', () => {
  const surfaceIds = new Set(adapterEnforcementSurfaces.map((surface) => surface.id));
  const targetIds = new Set(adapterContextTargets.map((target) => target.target));
  const resourceTypes = new Set(workspaceOwnedResourceSemantics.map((resource) => resource.resource_type));

  assert.deepEqual([...surfaceIds].sort(), ['data_api', 'event_bus', 'functions_runtime', 'object_storage']);
  assert.deepEqual([...targetIds].sort(), ['adapter_call', 'kafka_headers', 'openwhisk_activation', 'storage_presign_context']);
  assert.ok(resourceTypes.has('database'));
  assert.ok(resourceTypes.has('bucket'));
  assert.ok(resourceTypes.has('topic'));
  assert.ok(resourceTypes.has('function'));
  assert.ok(resourceTypes.has('app'));
});

test('provider catalog exposes tenant storage context helpers without leaking secret material', () => {
  const record = getTenantStorageContextRecord({
    tenant: {
      tenantId: 'ten_01catalog',
      slug: 'catalog',
      state: 'active',
      planId: 'pln_01growth'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:50:00Z'
  });
  const summary = getTenantStorageContextSummary(record);
  const rotated = rotateTenantStorageCredential({ storageContext: record, requestedAt: '2026-03-27T20:55:00Z', actorUserId: 'usr_01catalog' });
  const bootstrap = getWorkspaceStorageBootstrapPreview({
    tenantId: 'ten_01catalog',
    workspaceId: 'wrk_01catalog',
    workspaceSlug: 'catalog-dev',
    storageContext: rotated,
    now: '2026-03-27T20:55:00Z'
  });
  const event = buildTenantStorageEvent({ storageContext: rotated, transition: 'reactivated', occurredAt: '2026-03-27T20:56:00Z' });

  assert.equal(record.state, 'active');
  assert.equal(record.quotaAssignment.capabilityAvailable, true);
  assert.equal(summary.credential.secretReferencePresent, true);
  assert.equal(JSON.stringify(summary).includes('secret://tenants/'), false);
  assert.equal(rotated.credentialReference.version, 2);
  assert.equal(bootstrap.requestedState, 'pending');
  assert.equal(event.entityType, 'tenant_storage_context');
});
