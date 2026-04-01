/**
 * Kafka topics/ACLs seed for restore E2E tests.
 * @module tests/e2e/fixtures/restore/seed-kafka
 */

/**
 * @param {string} tenantId
 * @param {string} executionId
 * @param {'minimal'|'standard'|'conflicting'} level
 * @param {import('../../helpers/api-client.mjs').ApiClient} [client]
 * @param {Object} [overrides]
 * @returns {Promise<{ topics: string[] }>}
 */
export async function seedKafka(tenantId, executionId, level = 'standard', client = null, overrides = {}) {
  const topicCounts = { minimal: 1, standard: 3, conflicting: 3 };
  const count = topicCounts[level] ?? 3;
  const topics = [];

  for (let i = 1; i <= count; i++) {
    const topicName = `restore-${executionId}-topic-${i}`;
    topics.push(topicName);
    if (overrides.createTopic) {
      await overrides.createTopic(tenantId, {
        name: topicName,
        numPartitions: 3,
        configEntries: {},
      });
    }
  }

  return { topics };
}
