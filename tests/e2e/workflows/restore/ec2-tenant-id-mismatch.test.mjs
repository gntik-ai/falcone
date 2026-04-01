/**
 * EC2 — Tenant/origin mismatch: preflight returns identifier-map proposal.
 * @module tests/e2e/workflows/restore/ec2-tenant-id-mismatch
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as preflightAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs';
import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { buildArtifactFromManifests } from '../../fixtures/restore/artifact-builder.mjs';

const TIMEOUT = Number(process.env.RESTORE_TEST_SCENARIO_TIMEOUT_MS) || 120_000;
const AUTH = { actor_id: 'sre-e2e', actor_type: 'sre', scopes: ['platform:admin:config:export', 'platform:admin:config:reprovision'] };
const SILENT = { error: () => {}, warn: () => {}, info: () => {} };

function analyzerRegistry() {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData) => ({
        domain_key: dk,
        status: 'no_conflicts',
        resources_analyzed: Array.isArray(domainData?.roles) ? domainData.roles.length : 0,
        compatible_count: Array.isArray(domainData?.roles) ? domainData.roles.length : 0,
        compatible_with_redacted_count: 0,
        conflicts: [],
        compatible_with_redacted: [],
        analysis_error_message: null,
      }));
    }
    return map;
  };
}

function applierRegistry() {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData, opts) => ({
        domain_key: dk,
        status: Array.isArray(domainData?.roles) && domainData.roles.length ? 'applied' : 'skipped',
        resource_results: (domainData?.roles ?? []).map(item => ({ resource_type: dk, resource_name: item.name, resource_id: null, action: opts.dryRun ? 'would_create' : 'created', message: null, warnings: [], diff: null })),
        counts: { created: (domainData?.roles ?? []).length, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
        message: null,
      }));
    }
    return map;
  };
}

test('EC2: tenant ID mismatch — preflight proposes identifier map and reprovision succeeds with it', { timeout: TIMEOUT }, async () => {
  const executionId = generateExecutionId();
  const srcTenantId = `test-restore-${executionId}-src`;
  const dstTenantId = `test-restore-${executionId}-dst`;

  const artifact = buildArtifactFromManifests(srcTenantId, { iam: await seedIam(srcTenantId, executionId, 'minimal') });

  const preflight = await preflightAction({ tenant_id: dstTenantId, artifact }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getAnalyzerRegistry: analyzerRegistry(),
    db: {},
    log: SILENT,
    insertPreflightAuditLog: async () => ({ id: 'audit-pf' }),
    publishPreflightAuditEvent: async () => ({ published: true }),
  });

  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.body.needs_confirmation, true);
  assert.ok(preflight.body.identifier_map_proposal);

  const reprovision = await reprovisionAction({ tenant_id: dstTenantId, artifact, identifier_map: preflight.body.identifier_map_proposal }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getApplierRegistry: applierRegistry(),
    acquireLock: async () => ({ lock_token: 'lock', expires_at: new Date(Date.now() + 60000).toISOString() }),
    releaseLock: async () => {},
    failLock: async () => {},
    insertReprovisionAuditLog: async () => ({ id: 'audit-rp' }),
    publishReprovisionCompleted: async () => ({ published: true }),
    db: {},
    log: SILENT,
  });

  assert.equal(reprovision.statusCode, 200);
});
