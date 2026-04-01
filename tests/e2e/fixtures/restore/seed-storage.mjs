/**
 * S3 storage seed for restore E2E tests.
 * @module tests/e2e/fixtures/restore/seed-storage
 */

/**
 * @param {string} tenantId
 * @param {string} executionId
 * @param {'minimal'|'standard'|'conflicting'} level
 * @param {import('../../helpers/api-client.mjs').ApiClient} [client]
 * @param {Object} [overrides]
 * @returns {Promise<{ buckets: string[] }>}
 */
export async function seedStorage(tenantId, executionId, level = 'standard', client = null, overrides = {}) {
  const bucketCounts = { minimal: 1, standard: 2, conflicting: 2 };
  const count = bucketCounts[level] ?? 2;
  const buckets = [];

  for (let i = 1; i <= count; i++) {
    const bucketName = `restore-${executionId}-bucket-${i}`;
    buckets.push(bucketName);
    if (overrides.createBucket) {
      await overrides.createBucket(tenantId, {
        name: bucketName,
        versioning: 'Enabled',
      });
    }
  }

  return { buckets };
}
