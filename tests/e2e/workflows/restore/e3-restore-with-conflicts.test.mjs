/**
 * E3 — Restauración sobre tenant con configuración preexistente (con conflictos).
 * @module tests/e2e/workflows/restore/e3-restore-with-conflicts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as preflightAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs';
import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { seedPostgres } from '../../fixtures/restore/seed-postgres.mjs';
import { seedKafka } from '../../fixtures/restore/seed-kafka.mjs';
import { seedStorage } from '../../fixtures/restore/seed-storage.mjs';
import { buildArtifactFromManifests } from '../../fixtures/restore/artifact-builder.mjs';

const TIMEOUT = Number(process.env.RESTORE_TEST_SCENARIO_TIMEOUT_MS) || 120_000;
const AUTH = { actor_id: 'sre-e2e', actor_type: 'sre', scopes: ['platform:admin:config:export', 'platform:admin:config:reprovision'] };
const SILENT = { error: () => {}, warn: () => {}, info: () => {} };

function items(dk, data) {
  if (!data) return [];
  switch (dk) {
    case 'iam': return [...(data.roles ?? []), ...(data.groups ?? []), ...(data.client_scopes ?? []), ...(data.identity_providers ?? [])];
    case 'postgres_metadata': return [...(data.schemas ?? []), ...(data.tables ?? []), ...(data.views ?? []), ...(data.extensions ?? []), ...(data.grants ?? [])];
    case 'kafka': return [...(data.topics ?? []), ...(data.acls ?? [])];
    case 'storage': return data.buckets ?? [];
    default: return [];
  }
}

function analyzerRegistry(conflictRole) {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData) => {
        const domainItems = items(dk, domainData);
        const conflicts = dk === 'iam' ? [{
          resource_type: 'iam',
          resource_name: conflictRole,
          resource_id: null,
          severity: 'medium',
          diff: { composites: { existing: ['alt'], desired: [] } },
          recommendation: 'review',
        }] : [];
        return {
          domain_key: dk,
          status: conflicts.length ? 'analyzed' : 'no_conflicts',
          resources_analyzed: domainItems.length,
          compatible_count: domainItems.length - conflicts.length,
          compatible_with_redacted_count: 0,
          conflicts,
          compatible_with_redacted: [],
          analysis_error_message: null,
        };
      });
    }
    return map;
  };
}

function applierRegistry(conflictRole) {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData, opts) => {
        const domainItems = items(dk, domainData);
        const resource_results = domainItems.map(item => ({
          resource_type: dk,
          resource_name: item.name,
          resource_id: null,
          action: dk === 'iam' && item.name === conflictRole ? 'conflict' : (opts.dryRun ? 'would_create' : 'created'),
          message: dk === 'iam' && item.name === conflictRole ? 'Config differs' : null,
          warnings: [],
          diff: dk === 'iam' && item.name === conflictRole ? { composites: { existing: ['alt'], desired: [] } } : null,
        }));
        const conflictCount = resource_results.filter(r => r.action === 'conflict').length;
        const createdCount = resource_results.filter(r => r.action === 'created').length;
        return {
          domain_key: dk,
          status: conflictCount ? 'conflict' : (createdCount ? 'applied' : 'skipped'),
          resource_results,
          counts: { created: createdCount, skipped: 0, conflicts: conflictCount, errors: 0, warnings: 0 },
          message: null,
        };
      });
    }
    return map;
  };
}

test('E3: restore with conflicts — IAM role name collision', { timeout: TIMEOUT }, async () => {
  const executionId = generateExecutionId();
  const tenantId = `test-restore-${executionId}-dst`;

  const iamManifest = await seedIam(tenantId, executionId, 'standard');
  const conflictName = iamManifest.roles[0];
  const artifact = buildArtifactFromManifests(tenantId, {
    iam: iamManifest,
    postgres_metadata: await seedPostgres(tenantId, executionId, 'standard'),
    kafka: await seedKafka(tenantId, executionId, 'standard'),
    storage: await seedStorage(tenantId, executionId, 'standard'),
  });

  const preflight = await preflightAction({ tenant_id: tenantId, artifact }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getAnalyzerRegistry: analyzerRegistry(conflictName),
    db: {},
    log: SILENT,
    insertPreflightAuditLog: async () => ({ id: 'audit-pf' }),
    publishPreflightAuditEvent: async () => ({ published: true }),
  });

  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.body.summary.risk_level, 'medium');
  assert.ok(preflight.body.summary.conflict_counts.medium >= 1);
  assert.ok(preflight.body.domains.find(d => d.domain_key === 'iam').conflicts.length > 0);

  const reprovision = await reprovisionAction({ tenant_id: tenantId, artifact }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getApplierRegistry: applierRegistry(conflictName),
    acquireLock: async () => ({ lock_token: 'lock', expires_at: new Date(Date.now() + 60000).toISOString() }),
    releaseLock: async () => {},
    failLock: async () => {},
    insertReprovisionAuditLog: async () => ({ id: 'audit-rp' }),
    publishReprovisionCompleted: async () => ({ published: true }),
    db: {},
    log: SILENT,
  });

  assert.equal(reprovision.statusCode, 200);
  assert.equal(reprovision.body.result_status, 'partial');
  const iam = reprovision.body.domain_results.find(d => d.domain_key === 'iam');
  assert.equal(iam.status, 'conflict');
  assert.ok(iam.resource_results.some(r => r.action === 'conflict'));
});
