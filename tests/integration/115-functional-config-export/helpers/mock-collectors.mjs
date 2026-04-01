/**
 * Mock collector helpers for testing orchestrator actions.
 * @module helpers/mock-collectors
 */

/**
 * Returns a collector function that resolves with the given status and data.
 * @param {string} domainKey
 * @param {string} status
 * @param {object|null} [data]
 * @param {number} [itemsCount]
 * @returns {(tenantId: string) => Promise<import('../../../../services/provisioning-orchestrator/src/collectors/types.mjs').CollectorResult>}
 */
export function stubCollector(domainKey, status, data = null, itemsCount = 0) {
  return async (tenantId) => ({
    domain_key: domainKey,
    status,
    exported_at: new Date().toISOString(),
    items_count: itemsCount,
    data,
    ...(status === 'error' ? { error: 'Mocked error' } : {}),
    ...(status === 'not_available' ? { reason: 'Mocked not available' } : {}),
  });
}

/**
 * Returns a collector that resolves after a delay (for timeout tests).
 * @param {string} domainKey
 * @param {number} delayMs
 * @returns {(tenantId: string) => Promise<import('../../../../services/provisioning-orchestrator/src/collectors/types.mjs').CollectorResult>}
 */
export function timeoutCollector(domainKey, delayMs) {
  return (tenantId) => new Promise((resolve) => {
    setTimeout(() => resolve({
      domain_key: domainKey,
      status: 'ok',
      exported_at: new Date().toISOString(),
      items_count: 1,
      data: { delayed: true },
    }), delayMs);
  });
}

/**
 * Builds a registry Map with controllable per-domain results.
 * @param {Record<string, (tenantId: string) => Promise<any>>} [overrides]
 * @returns {(deploymentProfile?: string) => Map<string, Function>}
 */
export function buildMockRegistry(overrides = {}) {
  const defaults = {
    iam: stubCollector('iam', 'ok', { realm: 'test', roles: [], clients: [] }, 2),
    postgres_metadata: stubCollector('postgres_metadata', 'ok', { schemas: [] }, 1),
    mongo_metadata: stubCollector('mongo_metadata', 'not_available'),
    kafka: stubCollector('kafka', 'ok', { topics: [], acls: [], consumer_groups: [] }, 0),
    functions: stubCollector('functions', 'not_available'),
    storage: stubCollector('storage', 'ok', { buckets: [] }, 0),
  };

  return (deploymentProfile) => {
    const registry = new Map();
    for (const [key, fn] of Object.entries({ ...defaults, ...overrides })) {
      registry.set(key, fn);
    }
    return registry;
  };
}
