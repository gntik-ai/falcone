/**
 * MongoDB metadata seed for restore E2E tests (optional domain).
 * @module tests/e2e/fixtures/restore/seed-mongo
 */

/**
 * @param {string} tenantId
 * @param {string} executionId
 * @param {'minimal'|'standard'|'conflicting'} level
 * @param {import('../../helpers/api-client.mjs').ApiClient} [client]
 * @param {Object} [overrides]
 * @returns {Promise<{ collections: string[], indexes: string[], skipped?: boolean, reason?: string }>}
 */
export async function seedMongo(tenantId, executionId, level = 'standard', client = null, overrides = {}) {
  if (process.env.RESTORE_TEST_MONGO_ENABLED !== 'true') {
    return { collections: [], indexes: [], skipped: true, reason: 'MONGO_DISABLED' };
  }

  const collections = [`restore-${executionId}-col-1`];
  const indexes = [`restore-${executionId}-idx-1`];

  if (level !== 'minimal') {
    collections.push(`restore-${executionId}-col-2`);
  }

  if (overrides.createCollection) {
    for (const col of collections) {
      await overrides.createCollection(tenantId, { name: col, validator: {} });
    }
  }

  return { collections, indexes };
}
