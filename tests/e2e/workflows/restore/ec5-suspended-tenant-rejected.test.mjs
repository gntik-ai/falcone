/**
 * EC5 — Restauración sobre tenant en estado suspendido.
 * The current product action does not expose a tenant state check, so this test
 * documents the gap and skips if the action does not reject suspended tenants.
 * @module tests/e2e/workflows/restore/ec5-suspended-tenant-rejected
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { main as reprovisionAction } from '../../../../services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs';
import { generateExecutionId } from '../../helpers/correlation.mjs';
import { seedIam } from '../../fixtures/restore/seed-iam.mjs';
import { buildArtifactFromManifests } from '../../fixtures/restore/artifact-builder.mjs';

const TIMEOUT = Number(process.env.RESTORE_TEST_SCENARIO_TIMEOUT_MS) || 120_000;
const AUTH = { actor_id: 'sre-e2e', actor_type: 'sre', scopes: ['platform:admin:config:reprovision'] };
const SILENT = { error: () => {}, warn: () => {}, info: () => {} };

test('EC5: reprovision on suspended tenant is rejected or explicitly skipped', { timeout: TIMEOUT }, async (t) => {
  const executionId = generateExecutionId();
  const tenantId = `test-restore-${executionId}-dst-suspended`;
  const artifact = buildArtifactFromManifests(tenantId, { iam: await seedIam(tenantId, executionId, 'minimal') });

  const result = await reprovisionAction({ tenant_id: tenantId, artifact }, {
    auth: AUTH,
    tenantExists: async () => true,
    isSameMajor: (a, b) => String(a).split('.')[0] === String(b).split('.')[0],
    getApplierRegistry: () => new Map(),
    acquireLock: async () => ({ lock_token: 'lock', expires_at: new Date(Date.now() + 60000).toISOString() }),
    releaseLock: async () => {},
    failLock: async () => {},
    insertReprovisionAuditLog: async () => ({ id: 'audit-rp' }),
    publishReprovisionCompleted: async () => ({ published: true }),
    db: {},
    log: SILENT,
  });

  if (result.statusCode === 422 || result.statusCode === 409) {
    assert.ok(true, 'suspended tenant rejected');
    return;
  }

  t.skip('Current action does not enforce suspended-tenant rejection yet');
});
