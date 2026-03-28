import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_QUOTA_DIMENSIONS,
  STORAGE_QUOTA_GUARDRAIL_ERROR_CODES,
  STORAGE_QUOTA_OPERATION_TYPES,
  STORAGE_QUOTA_SCOPE_TYPES,
  STORAGE_QUOTA_SOURCES,
  buildStorageQuotaAuditEvent,
  buildStorageQuotaProfile,
  previewStorageBucketQuotaAdmission,
  previewStorageObjectQuotaAdmission
} from '../../services/adapters/src/storage-capacity-quotas.mjs';
import { STORAGE_NORMALIZED_ERROR_CODES } from '../../services/adapters/src/storage-error-taxonomy.mjs';
import { buildTenantStorageContextRecord } from '../../services/adapters/src/storage-tenant-context.mjs';

function buildTenantContext() {
  return buildTenantStorageContextRecord({
    tenant: {
      tenantId: 'ten_01quota',
      slug: 'quota',
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
    now: '2026-03-28T00:00:00Z'
  });
}

test('storage quota constants and local error catalog stay frozen and additive', () => {
  assert.equal(Object.isFrozen(STORAGE_QUOTA_DIMENSIONS), true);
  assert.equal(Object.isFrozen(STORAGE_QUOTA_SCOPE_TYPES), true);
  assert.equal(Object.isFrozen(STORAGE_QUOTA_SOURCES), true);
  assert.equal(Object.isFrozen(STORAGE_QUOTA_OPERATION_TYPES), true);
  assert.equal(Object.isFrozen(STORAGE_QUOTA_GUARDRAIL_ERROR_CODES), true);
  assert.equal(STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES, 'total_bytes');
  assert.equal(STORAGE_QUOTA_SCOPE_TYPES.TENANT, 'tenant');
  assert.equal(STORAGE_QUOTA_OPERATION_TYPES.MULTIPART_COMPLETE, 'multipart_complete');
  assert.equal(STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.CAPACITY_LIMIT_EXCEEDED.normalizedCode, STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED);
  assert.equal(STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.OBJECT_SIZE_LIMIT_EXCEEDED.normalizedCode, STORAGE_NORMALIZED_ERROR_CODES.STORAGE_OBJECT_TOO_LARGE);

  assert.throws(() => {
    STORAGE_QUOTA_DIMENSIONS.TOTAL_BYTES = 'mutated';
  }, TypeError);
  assert.throws(() => {
    STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.CAPACITY_LIMIT_EXCEEDED.httpStatus = 500;
  }, TypeError);
});

test('buildStorageQuotaProfile derives tenant limits from tenant storage context and keeps workspace overrides additive', () => {
  const context = buildTenantContext();
  const profile = buildStorageQuotaProfile({
    tenantStorageContext: context,
    workspaceId: 'wrk_01quota',
    tenantUsage: {
      totalBytes: 512,
      bucketCount: 2
    },
    workspaceUsage: {
      totalBytes: 256,
      bucketCount: 1,
      objectCount: 4
    },
    workspaceLimits: {
      totalBytes: 1024,
      maxBuckets: 3,
      maxObjects: 10,
      maxObjectSizeBytes: 128
    },
    builtAt: '2026-03-28T00:01:00Z'
  });

  const tenantScope = profile.scopes.find((scope) => scope.scope === 'tenant');
  const workspaceScope = profile.scopes.find((scope) => scope.scope === 'workspace');

  assert.equal(profile.tenantId, 'ten_01quota');
  assert.equal(profile.workspaceId, 'wrk_01quota');
  assert.equal(tenantScope.totalBytes.limit, context.quotaAssignment.storageCapacityBytes);
  assert.equal(tenantScope.bucketCount.limit, context.quotaAssignment.maxBuckets);
  assert.equal(tenantScope.totalBytes.source, 'tenant_storage_context');
  assert.equal(workspaceScope.totalBytes.limit, 1024);
  assert.equal(workspaceScope.bucketCount.limit, 3);
  assert.equal(workspaceScope.objectCount.limit, 10);
  assert.equal(workspaceScope.objectSizeBytes.limit, 128);
  assert.equal(workspaceScope.objectCount.source, 'workspace_override');
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(tenantScope), true);
  assert.equal(Object.isFrozen(workspaceScope.objectSizeBytes), true);
});

test('previewStorageBucketQuotaAdmission allows headroom and blocks exhausted bucket counts', () => {
  const profile = buildStorageQuotaProfile({
    tenantStorageContext: buildTenantContext(),
    workspaceId: 'wrk_01quota',
    workspaceUsage: {
      bucketCount: 1
    },
    workspaceLimits: {
      maxBuckets: 2
    }
  });

  const allowed = previewStorageBucketQuotaAdmission({
    quotaProfile: profile,
    bucketDelta: 1,
    requestedAt: '2026-03-28T00:02:00Z'
  });
  const denied = previewStorageBucketQuotaAdmission({
    quotaProfile: buildStorageQuotaProfile({
      tenantStorageContext: buildTenantContext(),
      workspaceId: 'wrk_01quota',
      workspaceUsage: { bucketCount: 2 },
      workspaceLimits: { maxBuckets: 2 }
    }),
    bucketDelta: 1,
    requestedAt: '2026-03-28T00:03:00Z'
  });

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.violations.length, 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.effectiveViolation.reasonCode, 'BUCKET_LIMIT_EXCEEDED');
  assert.equal(denied.effectiveViolation.normalizedCode, 'STORAGE_QUOTA_EXCEEDED');
  assert.equal(Object.isFrozen(denied), true);
});

test('previewStorageObjectQuotaAdmission enforces total bytes object count and object size', () => {
  const profile = buildStorageQuotaProfile({
    tenantStorageContext: buildTenantContext(),
    workspaceId: 'wrk_01quota',
    tenantUsage: { totalBytes: 900 },
    tenantLimits: { totalBytes: 1000 },
    workspaceUsage: {
      totalBytes: 950,
      objectCount: 10
    },
    workspaceLimits: {
      totalBytes: 1000,
      maxObjects: 10,
      maxObjectSizeBytes: 128
    }
  });

  const decision = previewStorageObjectQuotaAdmission({
    quotaProfile: profile,
    byteDelta: 200,
    objectDelta: 1,
    requestedObjectSizeBytes: 256,
    requestedAt: '2026-03-28T00:04:00Z'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.violations.some((entry) => entry.dimension === 'total_bytes'), true);
  assert.equal(decision.violations.some((entry) => entry.dimension === 'object_count'), true);
  assert.equal(decision.violations.some((entry) => entry.dimension === 'object_size_bytes'), true);
  assert.equal(decision.effectiveViolation.reasonCode, 'CAPACITY_LIMIT_EXCEEDED');
});

test('quota decisions remain deterministic across multiple violations and negative deltas do not false-positive', () => {
  const profile = buildStorageQuotaProfile({
    tenantStorageContext: buildTenantContext(),
    workspaceId: 'wrk_01quota',
    tenantUsage: { totalBytes: 99 },
    tenantLimits: { totalBytes: 100 },
    workspaceUsage: { objectCount: 5 },
    workspaceLimits: { maxObjects: 5, maxObjectSizeBytes: 10 }
  });

  const denied = previewStorageObjectQuotaAdmission({
    quotaProfile: profile,
    byteDelta: 2,
    objectDelta: 1,
    requestedObjectSizeBytes: 20,
    requestedAt: '2026-03-28T00:05:00Z'
  });
  const allowed = previewStorageObjectQuotaAdmission({
    quotaProfile: profile,
    byteDelta: -50,
    objectDelta: -1,
    requestedObjectSizeBytes: 0,
    action: STORAGE_QUOTA_OPERATION_TYPES.OBJECT_DELETE,
    requestedAt: '2026-03-28T00:06:00Z'
  });

  assert.equal(denied.allowed, false);
  assert.equal(denied.violations.length, 3);
  assert.equal(denied.effectiveViolation.dimension, 'total_bytes');
  assert.equal(denied.effectiveViolation.scope, 'tenant');
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.violations.length, 0);
});

test('multipart-complete decisions share the same object guardrails and audit events stay sanitized', () => {
  const profile = buildStorageQuotaProfile({
    tenantStorageContext: buildTenantContext(),
    workspaceId: 'wrk_01quota',
    workspaceUsage: { totalBytes: 100, objectCount: 1 },
    workspaceLimits: { totalBytes: 1024, maxObjects: 20, maxObjectSizeBytes: 64 }
  });

  const decision = previewStorageObjectQuotaAdmission({
    quotaProfile: profile,
    byteDelta: 80,
    objectDelta: 1,
    requestedObjectSizeBytes: 80,
    action: STORAGE_QUOTA_OPERATION_TYPES.MULTIPART_COMPLETE,
    requestedAt: '2026-03-28T00:07:00Z'
  });
  const auditEvent = buildStorageQuotaAuditEvent({
    decision,
    actorRef: 'usr_01quota',
    bucketId: 'bucket-01',
    objectKey: 'https://example.invalid/file.bin',
    correlationId: 'secret://corr/01',
    occurredAt: '2026-03-28T00:07:05Z'
  });

  assert.equal(decision.action, 'multipart_complete');
  assert.equal(decision.allowed, false);
  assert.equal(decision.effectiveViolation.reasonCode, 'OBJECT_SIZE_LIMIT_EXCEEDED');
  assert.equal(auditEvent.eventType, 'storage.quota.guardrail.evaluated');
  assert.equal(auditEvent.violationCount, 1);
  assert.equal(JSON.stringify(auditEvent).includes('https://'), false);
  assert.equal(JSON.stringify(auditEvent).includes('secret://'), false);
  assert.equal(Object.isFrozen(auditEvent), true);
});
