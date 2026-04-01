/**
 * E4 — Restauración con artefacto degradado.
 * @module tests/e2e/workflows/restore/e4-restore-degraded-artifact
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { seedKafka } from '../../fixtures/restore/seed-kafka.mjs';
import { buildArtifactFromManifests, buildDegradedArtifact } from '../../fixtures/restore/artifact-builder.mjs';

const TIMEOUT = Number(process.env.RESTORE_TEST_SCENARIO_TIMEOUT_MS) || 120_000;
const AUTH = { actor_id: 'sre-e2e', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const SILENT = { error: () => {}, warn: () => {}, info: () => {} };

function items(dk, data) {
  if (!data) return [];
  switch (dk) {
    case 'iam': return [...(data.roles ?? []), ...(data.groups ?? []), ...(data.client_scopes ?? []), ...(data.identity_providers ?? [])];
    case 'kafka': return [...(data.topics ?? []), ...(data.acls ?? [])];
    default: return [];
  }
}

function applierRegistry() {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData, opts) => {
        const resource_results = items(dk, domainData).map(item => ({
          resource_type: dk,
          resource_name: item.name,
          resource_id: null,
          action: opts.dryRun ? 'would_create' : 'created',
          message: null,
          warnings: [],
          diff: null,
        }));
        return {
          domain_key: dk,
          status: resource_results.length ? 'applied' : 'skipped',
          resource_results,
          counts: { created: resource_results.length, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
          message: null,
        };
      });
    }
    return map;
  };
}

test('E4: restore with degraded artifact — mongo_metadata not_available', { timeout: TIMEOUT }, async () => {
  const executionId = generateExecutionId();
  const tenantId = `test-restore-${executionId}-dst`;
  const base = buildArtifactFromManifests(tenantId, {
    iam: await seedIam(tenantId, executionId, 'minimal'),
    kafka: await seedKafka(tenantId, executionId, 'minimal'),
  });
  const artifact = buildDegradedArtifact(base, 'mongo_metadata');

  const result = await reprovisionAction({ tenant_id: tenantId, artifact }, {
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

  assert.equal(result.statusCode, 200);
  const mongo = result.body.domain_results.find(d => d.domain_key === 'mongo_metadata');
  assert.equal(mongo.status, 'skipped_not_exportable');
  assert.ok(result.body.domain_results.find(d => d.domain_key === 'iam').status === 'applied');
});
