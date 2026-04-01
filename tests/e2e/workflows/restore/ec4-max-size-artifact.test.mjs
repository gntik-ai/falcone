/**
 * EC4 — Artefacto con tamaño máximo permitido.
 * @module tests/e2e/workflows/restore/ec4-max-size-artifact
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { buildArtifactFromManifests, buildLargeArtifact } from '../../fixtures/restore/artifact-builder.mjs';

const TIMEOUT = Number(process.env.RESTORE_TEST_SCENARIO_TIMEOUT_MS) || 120_000;
const AUTH = { actor_id: 'sre-e2e', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const SILENT = { error: () => {}, warn: () => {}, info: () => {} };

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

test('EC4: max-size artifact handled without truncation or timeout', { timeout: TIMEOUT }, async () => {
  const executionId = generateExecutionId();
  const tenantId = `test-restore-${executionId}-dst`;
  const base = buildArtifactFromManifests(tenantId, { iam: await seedIam(tenantId, executionId, 'minimal') });
  const large = buildLargeArtifact(base, 9 * 1024 * 1024);
  assert.ok(JSON.stringify(large).length < 10 * 1024 * 1024);

  const result = await reprovisionAction({ tenant_id: tenantId, artifact: large }, {
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

  assert.ok([200, 207].includes(result.statusCode));
});
