import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_ADMIN_ERROR_CODES,
  STORAGE_PROVIDER_CAPABILITIES,
  TENANT_STORAGE_ERROR_CODES,
  buildTenantStorageEvent,
  getStorageAdminRoute,
  getStorageCompatibilitySummary,
  listStorageAdminRoutes,
  previewTenantStorageContext,
  previewWorkspaceStorageBootstrapContext,
  rotateTenantStorageCredentialPreview,
  summarizeStorageProviderIntrospection,
  summarizeStorageProviderSupport,
  summarizeTenantStorageContext
} from '../../apps/control-plane/src/storage-admin.mjs';

test('storage admin helper exposes bucket routes and provider introspection route', () => {
  const routes = listStorageAdminRoutes();
  const createRoute = getStorageAdminRoute('createStorage');
  const getRoute = getStorageAdminRoute('getStorage');
  const providerRoute = getStorageAdminRoute('getStorageProviderIntrospection');

  assert.ok(routes.some((route) => route.operationId === 'createStorage'));
  assert.ok(routes.some((route) => route.operationId === 'getStorage'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageProviderIntrospection'));
  assert.equal(createRoute.resourceType, 'bucket');
  assert.equal(getRoute.resourceType, 'bucket');
  assert.equal(providerRoute.resourceType, 'storage_provider');
  assert.equal(providerRoute.scope, 'platform');
  assert.equal(providerRoute.tenantBinding, 'none');
  assert.equal(providerRoute.workspaceBinding, 'none');
});

test('storage provider support normalizes explicit provider selection into a ready provider profile', () => {
  const profile = summarizeStorageProviderSupport({
    storage: {
      config: {
        inline: {
          providerType: 'ceph_rgw',
          accessKey: 'should-not-leak'
        }
      }
    }
  });
  const compatibility = getStorageCompatibilitySummary({
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    }
  });

  assert.equal(profile.providerType, 'ceph-rgw');
  assert.equal(profile.status, 'ready');
  assert.equal(profile.configured, true);
  assert.equal(profile.configuredVia, 'storage.config.inline.providerType');
  assert.deepEqual(Object.keys(profile.capabilityManifest), STORAGE_PROVIDER_CAPABILITIES);
  assert.equal(profile.capabilityManifest.bucketOperations, true);
  assert.equal(profile.capabilityManifest.objectCrud, true);
  assert.equal(profile.supportedProviderTypes.includes('minio'), true);
  assert.equal(profile.supportedProviderTypes.includes('ceph-rgw'), true);
  assert.equal(JSON.stringify(profile).includes('should-not-leak'), false);

  assert.equal(compatibility.providerType, 'minio');
  assert.equal(compatibility.status, 'ready');
  assert.equal(compatibility.routeIds.includes('getStorageProviderIntrospection'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('createStorage'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('getStorage'), true);
});

test('storage provider support fails safely for missing, unknown, and ambiguous provider selection', () => {
  const missing = summarizeStorageProviderSupport({});
  const unknown = summarizeStorageProviderSupport({ providerType: 'unknown-provider' });
  const ambiguous = summarizeStorageProviderSupport({
    providerType: 'minio',
    storage: {
      config: {
        inline: {
          providerType: 'garage'
        }
      }
    }
  });
  const introspection = summarizeStorageProviderIntrospection({ providerType: 'minio' });

  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.errorCode, STORAGE_ADMIN_ERROR_CODES.MISSING_PROVIDER_TYPE);
  assert.equal(Object.values(missing.capabilityManifest).every((value) => value === false), true);

  assert.equal(unknown.status, 'unavailable');
  assert.equal(unknown.errorCode, STORAGE_ADMIN_ERROR_CODES.UNKNOWN_PROVIDER_TYPE);

  assert.equal(ambiguous.status, 'unavailable');
  assert.equal(ambiguous.errorCode, STORAGE_ADMIN_ERROR_CODES.AMBIGUOUS_PROVIDER_SELECTION);
  assert.equal(Array.isArray(ambiguous.configuredVia), true);

  assert.equal(introspection.route.operationId, 'getStorageProviderIntrospection');
  assert.equal(introspection.supportedProviders.length >= 2, true);
  assert.deepEqual(introspection.capabilityFields, STORAGE_PROVIDER_CAPABILITIES);
});

test('tenant storage context summary is tenant-isolated, introspectable, and secret-safe', () => {
  const preview = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelier',
      slug: 'atelier',
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
    correlationId: 'cor_storage_ctx_01',
    now: '2026-03-27T20:40:00Z'
  });
  const summary = summarizeTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelier',
      slug: 'atelier',
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
    correlationId: 'cor_storage_ctx_01',
    now: '2026-03-27T20:40:00Z'
  });
  const event = buildTenantStorageEvent({
    storageContext: preview,
    transition: 'succeeded',
    actorUserId: 'usr_01owner',
    correlationId: 'cor_storage_ctx_01',
    occurredAt: '2026-03-27T20:40:05Z'
  });

  assert.equal(getStorageAdminRoute('getTenantStorageContext').resourceType, 'tenant_storage_context');
  assert.equal(preview.state, 'active');
  assert.equal(preview.bucketProvisioningAllowed, true);
  assert.equal(preview.namespace.startsWith('tctx-atelier-'), true);
  assert.equal(summary.route.operationId, 'getTenantStorageContext');
  assert.equal(summary.context.quotaAssignment.capabilityAvailable, true);
  assert.equal(summary.context.credential.secretReferencePresent, true);
  assert.equal(JSON.stringify(summary).includes('secret://tenants/'), false);
  assert.equal(event.eventType, 'tenant_storage_context.succeeded');
  assert.equal(event.quotaAssignment.maxBuckets >= 8, true);
});

test('tenant storage context lifecycle gating blocks workspace bucket bootstrap until the context is active', () => {
  const pendingContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelierpending',
      slug: 'atelier-pending',
      state: 'pending_activation',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const blocked = previewWorkspaceStorageBootstrapContext({
    tenantId: 'ten_01atelierpending',
    workspaceId: 'wrk_01atelierpending',
    workspaceSlug: 'atelier-dev',
    storageContext: pendingContext,
    now: '2026-03-27T20:45:00Z'
  });
  const activeContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01atelieractive',
      slug: 'atelier-active',
      state: 'active',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const ready = previewWorkspaceStorageBootstrapContext({
    tenantId: 'ten_01atelieractive',
    workspaceId: 'wrk_01atelieractive',
    workspaceSlug: 'atelier-live',
    storageContext: activeContext,
    now: '2026-03-27T20:45:00Z'
  });
  const rotated = rotateTenantStorageCredentialPreview({
    storageContext: activeContext,
    actorUserId: 'usr_01owner',
    requestedAt: '2026-03-27T20:46:00Z',
    reason: 'scheduled_rotation'
  });

  assert.equal(blocked.requestedState, 'dependency_wait');
  assert.equal(blocked.reasonCode, TENANT_STORAGE_ERROR_CODES.CONTEXT_PENDING);
  assert.equal(ready.requestedState, 'pending');
  assert.equal(ready.namespace, activeContext.namespace);
  assert.equal(rotated.route.operationId, 'rotateTenantStorageContextCredential');
  assert.equal(rotated.context.credential.version, 2);
  assert.equal(rotated.context.credential.health, 'rotated');
});
