/**
 * OpenWhisk functions seed for restore E2E tests (optional domain).
 * @module tests/e2e/fixtures/restore/seed-functions
 */

/**
 * @param {string} tenantId
 * @param {string} executionId
 * @param {'minimal'|'standard'|'conflicting'} level
 * @param {import('../../helpers/api-client.mjs').ApiClient} [client]
 * @param {Object} [overrides]
 * @returns {Promise<{ packages: string[], actions: string[], skipped?: boolean, reason?: string }>}
 */
export async function seedFunctions(tenantId, executionId, level = 'standard', client = null, overrides = {}) {
  if (process.env.RESTORE_TEST_OW_ENABLED !== 'true') {
    return { packages: [], actions: [], skipped: true, reason: 'OW_DISABLED' };
  }

  const packages = [`restore-${executionId}-pkg`];
  const actions = [`restore-${executionId}-pkg/action-1`];

  if (level !== 'minimal') {
    actions.push(`restore-${executionId}-pkg/action-2`);
  }

  if (overrides.createPackage) {
    await overrides.createPackage(tenantId, { name: packages[0] });
  }
  for (const action of actions) {
    if (overrides.createAction) {
      await overrides.createAction(tenantId, { name: action, exec: { kind: 'nodejs:20' } });
    }
  }

  return { packages, actions };
}
