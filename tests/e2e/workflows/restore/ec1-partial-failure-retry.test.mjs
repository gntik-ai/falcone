/**
 * EC1 — Fallo parcial durante reaprovisionamiento y reintento posterior.
 * @module tests/e2e/workflows/restore/ec1-partial-failure-retry
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { seedPostgres } from '../../fixtures/restore/seed-postgres.mjs';
import { seedKafka } from '../../fixtures/restore/seed-kafka.mjs';
import { buildArtifactFromManifests } from '../../fixtures/restore/artifact-builder.mjs';

const TIMEOUT = Number(process.env.RESTORE_TEST_SCENARIO_TIMEOUT_MS) || 120_000;
const AUTH = { actor_id: 'sre-e2e', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const SILENT = { error: () => {}, warn: () => {}, info: () => {} };

function items(dk, data) {
  if (!data) return [];
  switch (dk) {
    case 'iam': return [...(data.roles ?? []), ...(data.groups ?? []), ...(data.client_scopes ?? []), ...(data.identity_providers ?? [])];
    case 'postgres_metadata': return [...(data.schemas ?? []), ...(data.tables ?? []), ...(data.views ?? []), ...(data.extensions ?? []), ...(data.grants ?? [])];
    case 'kafka': return [...(data.topics ?? []), ...(data.acls ?? [])];
    default: return [];
  }
}

function applierRegistry({ failKafka }) {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData, opts) => {
        if (dk === 'kafka' && failKafka()) throw new Error('kafka subsystem unreachable');
        const resource_results = items(dk, domainData).map(item => ({ resource_type: dk, resource_name: item.name, resource_id: null, action: opts.dryRun ? 'would_create' : 'created', message: null, warnings: [], diff: null }));
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

test('EC1: partial failure and retry — kafka fails, then retried successfully', { timeout: TIMEOUT }, async () => {
  const executionId = generateExecutionId();
  const tenantId = `test-restore-${executionId}-dst`;

  const artifact = buildArtifactFromManifests(tenantId, {
    iam: await seedIam(tenantId, executionId, 'standard'),
    postgres_metadata: await seedPostgres(tenantId, executionId, 'standard'),
    kafka: await seedKafka(tenantId, executionId, 'standard'),
  });

  let failKafka = true;
  const first = await reprovisionAction({ tenant_id: tenantId, artifact }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getApplierRegistry: applierRegistry({ failKafka: () => failKafka }),
    acquireLock: async () => ({ lock_token: 'lock', expires_at: new Date(Date.now() + 60000).toISOString() }),
    releaseLock: async () => {},
    failLock: async () => {},
    insertReprovisionAuditLog: async () => ({ id: 'audit-rp' }),
    publishReprovisionCompleted: async () => ({ published: true }),
    db: {},
    log: SILENT,
  });

  assert.equal(first.statusCode, 207);
  assert.equal(first.body.result_status, 'partial');
  assert.equal(first.body.domain_results.find(d => d.domain_key === 'kafka').status, 'error');
  assert.equal(first.body.domain_results.find(d => d.domain_key === 'iam').status, 'applied');
  assert.equal(first.body.domain_results.find(d => d.domain_key === 'postgres_metadata').status, 'applied');

  failKafka = false;
  const retry = await reprovisionAction({ tenant_id: tenantId, artifact, domains: ['kafka'] }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getApplierRegistry: applierRegistry({ failKafka: () => failKafka }),
    acquireLock: async () => ({ lock_token: 'lock', expires_at: new Date(Date.now() + 60000).toISOString() }),
    releaseLock: async () => {},
    failLock: async () => {},
    insertReprovisionAuditLog: async () => ({ id: 'audit-rp' }),
    publishReprovisionCompleted: async () => ({ published: true }),
    db: {},
    log: SILENT,
  });

  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.domain_results.find(d => d.domain_key === 'kafka').status, 'applied');
});
