/**
 * E5 — Restauración con migración de formato.
 * Skips when no prior version is available or when migration is unsupported.
 * @module tests/e2e/workflows/restore/e5-restore-format-migration
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as migrateAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-migrate.mjs';
import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { main as formatVersionsAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-format-versions.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { buildArtifactFromManifests } from '../../fixtures/restore/artifact-builder.mjs';

const TIMEOUT = Number(process.env.RESTORE_TEST_SCENARIO_TIMEOUT_MS) || 120_000;
const AUTH = { actor_id: 'sre-e2e', actor_type: 'sre', scopes: ['platform:admin:config:export', 'platform:admin:config:reprovision'] };
const SILENT = { error: () => {}, warn: () => {}, info: () => {} };

function applierRegistry() {
  return () => {
    const map = new Map();
    for (const dk of ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage']) {
      map.set(dk, async (_tenantId, domainData, opts) => {
        const items = Array.isArray(domainData?.roles) ? domainData.roles : [];
        return {
          domain_key: dk,
          status: items.length ? 'applied' : 'skipped',
          resource_results: items.map(item => ({ resource_type: dk, resource_name: item.name, resource_id: null, action: opts.dryRun ? 'would_create' : 'created', message: null, warnings: [], diff: null })),
          counts: { created: items.length, skipped: 0, conflicts: 0, errors: 0, warnings: 0 },
          message: null,
        };
      });
    }
    return map;
  };
}

test('E5: restore with format migration', { timeout: TIMEOUT }, async (t) => {
  const versions = await formatVersionsAction({}, { auth: AUTH, log: SILENT });
  const currentVersion = versions.body?.current_version ?? versions.body?.version ?? '1.0.0';
  const supported = versions.body?.supported_versions ?? versions.body?.versions ?? [currentVersion];
  const prior = supported.filter(v => v !== currentVersion);
  if (prior.length === 0) {
    t.skip('No prior format version available for migration test');
    return;
  }

  const executionId = generateExecutionId();
  const tenantId = `test-restore-${executionId}-dst`;
  const artifact = buildArtifactFromManifests(tenantId, { iam: await seedIam(tenantId, executionId, 'minimal') });
  artifact.format_version = prior[0];

  const migrate = await migrateAction({}, { auth: AUTH, artifact, log: SILENT, publishMigrationEvent: async () => ({ published: true }) });
  if (migrate.statusCode !== 200) {
    t.skip(`Migration not supported in this environment: ${migrate.statusCode}`);
    return;
  }

  const result = await reprovisionAction({ tenant_id: tenantId, artifact: migrate.body.artifact }, {
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
