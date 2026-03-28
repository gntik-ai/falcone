import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorkspaceQuotaUsageOverview,
  buildWorkspaceUsageSnapshot
} from '../../apps/control-plane/src/observability-admin.mjs';
import { validateKafkaAdminRequest } from '../../services/adapters/src/kafka-admin.mjs';
import { validateMongoAdminRequest } from '../../services/adapters/src/mongodb-admin.mjs';
import { validateOpenWhiskAdminRequest } from '../../services/adapters/src/openwhisk-admin.mjs';
import { validatePostgresAdminRequest } from '../../services/adapters/src/postgresql-admin.mjs';
import {
  buildStorageQuotaProfile,
  previewStorageBucketQuotaAdmission
} from '../../services/adapters/src/storage-capacity-quotas.mjs';

function buildFunctionsAllowedResult() {
  return validateOpenWhiskAdminRequest({
    resourceKind: 'action',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentActionCount: 23,
      tenantCurrentActionCount: 23
    },
    payload: {
      actionName: 'quota-gated-action',
      source: {
        kind: 'inline_code',
        language: 'javascript',
        inlineCode: 'function main() { return { ok: true }; }'
      },
      execution: {
        runtime: 'nodejs:20',
        entrypoint: 'main',
        limits: { timeoutSeconds: 30, memoryMb: 256 },
        webAction: { enabled: false }
      }
    }
  });
}

function buildFunctionsDeniedResult() {
  return validateOpenWhiskAdminRequest({
    resourceKind: 'action',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentActionCount: 24,
      tenantCurrentActionCount: 24
    },
    payload: {
      actionName: 'quota-gated-action',
      source: {
        kind: 'inline_code',
        language: 'javascript',
        inlineCode: 'function main() { return { ok: true }; }'
      },
      execution: {
        runtime: 'nodejs:20',
        entrypoint: 'main',
        limits: { timeoutSeconds: 30, memoryMb: 256 },
        webAction: { enabled: false }
      }
    }
  });
}

function buildEventsAllowedResult() {
  return validateKafkaAdminRequest({
    resourceKind: 'topic',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentTopicCount: 19
    },
    payload: {
      topicName: 'billing-events'
    }
  });
}

function buildEventsDeniedResult() {
  return validateKafkaAdminRequest({
    resourceKind: 'topic',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      workspaceSlug: 'alpha-dev',
      workspaceEnvironment: 'dev',
      planId: 'pln_01growth',
      currentTopicCount: 20
    },
    payload: {
      topicName: 'billing-events'
    }
  });
}

function buildStorageAllowedResult() {
  return previewStorageBucketQuotaAdmission({
    quotaProfile: buildStorageQuotaProfile({
      tenantLimits: { tenantId: 'ten_01growthalpha' },
      workspaceId: 'wrk_01alphadev',
      workspaceUsage: { bucketCount: 1 },
      workspaceLimits: { maxBuckets: 2 }
    }),
    requestedAt: '2026-03-28T18:24:00.000Z'
  });
}

function buildStorageDeniedResult() {
  return previewStorageBucketQuotaAdmission({
    quotaProfile: buildStorageQuotaProfile({
      tenantLimits: { tenantId: 'ten_01growthalpha' },
      workspaceId: 'wrk_01alphadev',
      workspaceUsage: { bucketCount: 2 },
      workspaceLimits: { maxBuckets: 2 }
    }),
    requestedAt: '2026-03-28T18:25:00.000Z'
  });
}

function buildPostgresAllowedResult() {
  return validatePostgresAdminRequest({
    resourceKind: 'schema',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      tenantNamePrefix: 'tenant_alpha',
      workspaceNamePrefix: 'alpha_dev',
      planId: 'pln_01starter',
      currentInventory: {
        counts: { schemas: 7 }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_reporting',
      schemaName: 'alpha_dev_reporting',
      ownerRoleName: 'alpha_dev_owner'
    }
  });
}

function buildPostgresDeniedResult() {
  return validatePostgresAdminRequest({
    resourceKind: 'schema',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      tenantNamePrefix: 'tenant_alpha',
      workspaceNamePrefix: 'alpha_dev',
      planId: 'pln_01starter',
      currentInventory: {
        counts: { schemas: 8 }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_reporting',
      schemaName: 'alpha_dev_reporting',
      ownerRoleName: 'alpha_dev_owner'
    }
  });
}

function buildMongoAllowedResult() {
  return validateMongoAdminRequest({
    resourceKind: 'database',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      currentDatabaseCount: 2,
      currentTenantDatabaseCount: 3
    },
    payload: {
      databaseName: '01starterdev_workspace_dev'
    }
  });
}

function buildMongoDeniedResult() {
  return validateMongoAdminRequest({
    resourceKind: 'database',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      currentDatabaseCount: 3,
      currentTenantDatabaseCount: 3
    },
    payload: {
      databaseName: '01starterdev_workspace_dev'
    }
  });
}

const scenarioMatrix = Object.freeze([
  {
    moduleId: 'functions',
    expectedDimensionId: 'serverless_functions',
    expectedSourceDimensionId: 'function_invocations',
    expectedReasonCode: 'workspace_function_quota_exceeded',
    expectedScopeType: 'workspace',
    buildAllowedResult: buildFunctionsAllowedResult,
    buildDeniedResult: buildFunctionsDeniedResult
  },
  {
    moduleId: 'events',
    expectedDimensionId: 'kafka_topics',
    expectedSourceDimensionId: 'topics',
    expectedReasonCode: 'workspace_topic_quota_exceeded',
    expectedScopeType: 'workspace',
    buildAllowedResult: buildEventsAllowedResult,
    buildDeniedResult: buildEventsDeniedResult
  },
  {
    moduleId: 'storage',
    expectedDimensionId: 'storage_buckets',
    expectedSourceDimensionId: 'storage_volume_bytes',
    expectedReasonCode: 'BUCKET_LIMIT_EXCEEDED',
    expectedScopeType: 'workspace',
    buildAllowedResult: buildStorageAllowedResult,
    buildDeniedResult: buildStorageDeniedResult
  },
  {
    moduleId: 'postgres',
    expectedDimensionId: 'collections_tables',
    expectedSourceDimensionId: 'collections_tables',
    expectedReasonCode: 'postgres_quota_exceeded',
    expectedScopeType: 'workspace',
    buildAllowedResult: buildPostgresAllowedResult,
    buildDeniedResult: buildPostgresDeniedResult
  },
  {
    moduleId: 'mongo',
    expectedDimensionId: 'logical_databases',
    expectedSourceDimensionId: 'logical_databases',
    expectedReasonCode: 'workspace_database_quota_exceeded',
    expectedScopeType: 'workspace',
    buildAllowedResult: buildMongoAllowedResult,
    buildDeniedResult: buildMongoDeniedResult
  }
]);

function assertAllowedBelowLimit(result) {
  if (Object.prototype.hasOwnProperty.call(result, 'allowed')) {
    assert.equal(result.allowed, true);
    assert.equal(result.quotaDecision ?? null, null);
    return;
  }

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.quotaDecision ?? null, null);
}

function getDeniedDecision(result) {
  assert.ok(result.quotaDecision);
  return result.quotaDecision;
}

function buildOverviewForDecision({ moduleId, deniedDecision }) {
  const sourceDimensionId = deniedDecision.sourceDimensionIds[0];
  const previousUsage = Math.max(deniedDecision.hardLimit - 1, 0);
  const currentUsage = deniedDecision.hardLimit;
  const snapshotTimestamp = '2026-03-28T18:30:00.000Z';
  const previousSnapshot = buildWorkspaceUsageSnapshot({
    tenantId: deniedDecision.tenantId,
    workspaceId: deniedDecision.workspaceId,
    snapshotTimestamp: '2026-03-28T18:29:00.000Z',
    observationWindow: {
      startedAt: '2026-03-28T18:24:00.000Z',
      endedAt: '2026-03-28T18:29:00.000Z'
    },
    values: {
      [sourceDimensionId]: previousUsage
    }
  });
  const currentSnapshot = buildWorkspaceUsageSnapshot({
    tenantId: deniedDecision.tenantId,
    workspaceId: deniedDecision.workspaceId,
    snapshotTimestamp,
    observationWindow: {
      startedAt: '2026-03-28T18:25:00.000Z',
      endedAt: snapshotTimestamp
    },
    values: {
      [sourceDimensionId]: currentUsage
    }
  });

  const previousDimension = previousSnapshot.dimensions.find((dimension) => dimension.dimensionId === sourceDimensionId);
  const currentDimension = currentSnapshot.dimensions.find((dimension) => dimension.dimensionId === sourceDimensionId);

  assert.ok(previousDimension);
  assert.ok(currentDimension);
  assert.equal(currentDimension.value - previousDimension.value, 1);

  const overview = buildWorkspaceQuotaUsageOverview({
    tenantId: deniedDecision.tenantId,
    workspaceId: deniedDecision.workspaceId,
    requestedBy: 'quota-verification-suite',
    generatedAt: '2026-03-28T18:31:00.000Z',
    usageSnapshot: currentSnapshot,
    quotaPosture: {
      postureId: `quota-${moduleId}`,
      queryScope: 'workspace',
      tenantId: deniedDecision.tenantId,
      workspaceId: deniedDecision.workspaceId,
      evaluatedAt: '2026-03-28T18:31:00.000Z',
      usageSnapshotTimestamp: snapshotTimestamp,
      observationWindow: currentSnapshot.observationWindow,
      overallStatus: 'hard_limit_reached',
      degradedDimensions: [],
      hardLimitBreaches: [sourceDimensionId],
      softLimitBreaches: [],
      warningDimensions: [],
      dimensions: [
        {
          dimensionId: sourceDimensionId,
          displayName: `${moduleId} quota source`,
          scope: 'workspace',
          measuredValue: deniedDecision.currentUsage,
          unit: 'count',
          freshnessStatus: 'fresh',
          policyMode: 'enforced',
          status: 'hard_limit_reached',
          hardLimit: deniedDecision.hardLimit,
          usageSnapshotTimestamp: snapshotTimestamp
        }
      ]
    },
    blockingDecisions: [deniedDecision]
  });

  return {
    sourceDimensionId,
    overview,
    currentDimension
  };
}

test('cross-module verification matrix preserves below-limit allowance and canonical hard-limit denials', () => {
  for (const scenario of scenarioMatrix) {
    const allowedResult = scenario.buildAllowedResult();
    assertAllowedBelowLimit(allowedResult);

    const deniedResult = scenario.buildDeniedResult();
    const deniedDecision = getDeniedDecision(deniedResult);

    assert.equal(deniedDecision.errorCode, 'QUOTA_HARD_LIMIT_REACHED');
    assert.equal(deniedDecision.dimensionId, scenario.expectedDimensionId);
    assert.equal(deniedDecision.scopeType, scenario.expectedScopeType);
    assert.equal(deniedDecision.reasonCode, scenario.expectedReasonCode);
    assert.equal(Array.isArray(deniedDecision.sourceDimensionIds), true);
    assert.equal(deniedDecision.sourceDimensionIds.includes(scenario.expectedSourceDimensionId), true);
    assert.equal(deniedDecision.tenantId != null, true);
    assert.equal(deniedDecision.workspaceId != null, true);
  }
});

test('cross-module hard-limit denials remain explainable through the workspace quota overview', () => {
  for (const scenario of scenarioMatrix) {
    const deniedDecision = getDeniedDecision(scenario.buildDeniedResult());
    const { sourceDimensionId, overview, currentDimension } = buildOverviewForDecision({
      moduleId: scenario.moduleId,
      deniedDecision
    });

    const overviewDimension = overview.dimensions.find((dimension) => dimension.dimensionId === sourceDimensionId);

    assert.ok(overviewDimension);
    assert.equal(overview.overallPosture, 'hard_limit_reached');
    assert.equal(overview.queryScope, 'workspace');
    assert.equal(overviewDimension.blockingState, 'denied');
    assert.equal(overviewDimension.blockingReasonCode, deniedDecision.reasonCode ?? deniedDecision.errorCode);
    assert.equal(overviewDimension.posture, 'hard_limit_reached');
    assert.equal(overviewDimension.currentUsage, deniedDecision.currentUsage);
    assert.equal(overviewDimension.hardLimit, deniedDecision.hardLimit);
    assert.equal(currentDimension.value, deniedDecision.hardLimit);
  }
});
