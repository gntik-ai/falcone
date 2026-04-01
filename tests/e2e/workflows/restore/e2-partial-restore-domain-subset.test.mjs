/**
 * E2 — Restauración parcial: solo dominios seleccionados.
 * @module tests/e2e/workflows/restore/e2-partial-restore-domain-subset
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { seedPostgres } from '../../fixtures/restore/seed-postgres.mjs';
import { seedKafka } from '../../fixtures/restore/seed-kafka.mjs';
import { seedStorage } from '../../fixtures/restore/seed-storage.mjs';
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
    case 'storage': return data.buckets ?? [];
    default: return [];
  }
}

function applierRegistry() {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData, opts) => {
        const resultItems = items(dk, domainData).map(item => ({
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
          status: resultItems.length > 0 ? 'applied' : 'skipped',
          resource_results: resultItems,
          counts: { created: resultItems.length, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
          message: null,
        };
      });
    }
    return map;
  };
}

async function runCombo(combo) {
  const executionId = generateExecutionId();
  const srcTenantId = `test-restore-${executionId}-src`;
  const dstTenantId = `test-restore-${executionId}-dst`;

  const artifact = buildArtifactFromManifests(dstTenantId, {
    iam: await seedIam(srcTenantId, executionId, 'standard'),
    postgres_metadata: await seedPostgres(srcTenantId, executionId, 'standard'),
    kafka: await seedKafka(srcTenantId, executionId, 'standard'),
    storage: await seedStorage(srcTenantId, executionId, 'standard'),
  });

  const result = await reprovisionAction({ tenant_id: dstTenantId, artifact, domains: combo }, {
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
  assert.equal(result.body.summary.domains_requested, combo.length);
  assert.deepEqual(result.body.domain_results.map(d => d.domain_key), combo);
  assert.ok(result.body.domain_results.every(d => d.status === 'applied'));
}

test('E2: partial restore — Combo A: iam + postgres_metadata only', { timeout: TIMEOUT }, async () => {
  await runCombo(['iam', 'postgres_metadata']);
});

test('E2: partial restore — Combo B: kafka + storage only', { timeout: TIMEOUT }, async () => {
  await runCombo(['kafka', 'storage']);
});
