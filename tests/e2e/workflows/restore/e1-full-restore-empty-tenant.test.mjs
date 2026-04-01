/**
 * E1 — Restauración total sobre tenant vacío (golden path).
 * @module tests/e2e/workflows/restore/e1-full-restore-empty-tenant
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as preflightAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs';
import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId, buildCorrelationId } from '../../helpers/correlation.mjs';
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

function buildAnalyzerRegistry(conflicts = {}) {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData) => {
        const domainItems = items(dk, domainData);
        const conflictsForDomain = conflicts[dk] ?? [];
        const conflictEntries = conflictsForDomain.map(name => ({
          resource_type: dk,
          resource_name: name,
          resource_id: null,
          severity: 'medium',
          diff: { composites: { existing: ['alt'], desired: [] } },
          recommendation: 'review',
        }));
        return {
          domain_key: dk,
          status: conflictEntries.length > 0 ? 'analyzed' : 'no_conflicts',
          resources_analyzed: domainItems.length,
          compatible_count: domainItems.length - conflictEntries.length,
          compatible_with_redacted_count: 0,
          conflicts: conflictEntries,
          compatible_with_redacted: [],
          analysis_error_message: null,
        };
      });
    }
    return map;
  };
}

function buildApplierRegistry(conflicts = {}) {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData, opts) => {
        const domainItems = items(dk, domainData);
        const conflictNames = new Set(conflicts[dk] ?? []);
        const resource_results = domainItems.map(item => ({
          resource_type: dk,
          resource_name: item.name,
          resource_id: null,
          action: conflictNames.has(item.name) ? (opts.dryRun ? 'would_conflict' : 'conflict') : (opts.dryRun ? 'would_create' : 'created'),
          message: conflictNames.has(item.name) ? 'Config differs' : null,
          warnings: [],
          diff: conflictNames.has(item.name) ? { field: { existing: 'x', desired: 'y' } } : null,
        }));
        const counts = {
          created: resource_results.filter(r => r.action === 'created').length,
          skipped: 0,
          conflicts: resource_results.filter(r => r.action === 'conflict' || r.action === 'would_conflict').length,
          errors: 0,
          warnings: 0,
        };
        return {
          domain_key: dk,
          status: counts.conflicts > 0 ? 'conflict' : (counts.created > 0 ? 'applied' : 'skipped'),
          resource_results,
          counts,
          message: null,
        };
      });
    }
    return map;
  };
}

test('E1: full restore on empty tenant — golden path', { timeout: TIMEOUT }, async () => {
  const executionId = generateExecutionId();
  const srcTenantId = `test-restore-${executionId}-src`;
  const dstTenantId = `test-restore-${executionId}-dst`;

  const manifests = {
    iam: await seedIam(srcTenantId, executionId, 'standard'),
    postgres_metadata: await seedPostgres(srcTenantId, executionId, 'standard'),
    kafka: await seedKafka(srcTenantId, executionId, 'standard'),
    storage: await seedStorage(srcTenantId, executionId, 'standard'),
  };
  const artifact = buildArtifactFromManifests(dstTenantId, manifests);
  const correlationId = buildCorrelationId(executionId, 'E1');

  const preflight = await preflightAction({ tenant_id: dstTenantId, artifact }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getAnalyzerRegistry: buildAnalyzerRegistry(),
    db: {},
    log: SILENT,
    insertPreflightAuditLog: async () => ({ id: 'audit-pf' }),
    publishPreflightAuditEvent: async () => ({ published: true }),
  });

  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.body.summary.risk_level, 'low');
  assert.ok(preflight.body.domains.length >= 4);

  const reprovision = await reprovisionAction({ tenant_id: dstTenantId, artifact }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getApplierRegistry: buildApplierRegistry(),
    acquireLock: async () => ({ lock_token: correlationId, expires_at: new Date(Date.now() + 60000).toISOString() }),
    releaseLock: async () => {},
    failLock: async () => {},
    insertReprovisionAuditLog: async () => ({ id: 'audit-rp' }),
    publishReprovisionCompleted: async () => ({ published: true }),
    db: {},
    log: SILENT,
  });

  assert.equal(reprovision.statusCode, 200);
  assert.equal(reprovision.body.result_status, 'success');
  assert.ok(reprovision.body.domain_results.every(d => ['applied', 'skipped', 'skipped_not_exportable'].includes(d.status)));
});
