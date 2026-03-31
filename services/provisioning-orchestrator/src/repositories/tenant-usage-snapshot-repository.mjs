function resolveTimeoutMs() {
  const parsed = Number.parseInt(process.env.PLAN_USAGE_COLLECTION_TIMEOUT_MS ?? '150', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 150;
}

async function withTimeout(promiseFactory) {
  const timeoutMs = resolveTimeoutMs();
  return await Promise.race([
    promiseFactory(),
    new Promise((resolve) => setTimeout(() => resolve({ status: 'unknown', reasonCode: 'timeout' }), timeoutMs))
  ]);
}

async function queryDimensionUsage(tenantId, dimensionKey, source, runner) {
  try {
    return await withTimeout(async () => {
      const result = await runner();
      if (result === null || result === undefined) return { dimensionKey, status: 'unknown', reasonCode: 'not_available' };
      return { dimensionKey, observedUsage: Number(result.observedUsage ?? result.value ?? result), usageObservedAt: result.usageObservedAt ?? new Date().toISOString(), usageSource: source };
    });
  } catch {
    return { dimensionKey, status: 'unknown', reasonCode: 'source_error' };
  }
}

export async function collectObservedUsage(tenantId, dimensionKeys = [], options = {}) {
  const client = options.client;
  const customCollectors = options.collectors ?? {};
  const results = [];
  for (const dimensionKey of dimensionKeys) {
    const collector = customCollectors[dimensionKey];
    if (collector) {
      results.push(await queryDimensionUsage(tenantId, dimensionKey, `custom:${dimensionKey}`, () => collector({ tenantId, dimensionKey, client })));
      continue;
    }
    if (!client) {
      results.push({ dimensionKey, status: 'unknown', reasonCode: 'no_client' });
      continue;
    }
    if (dimensionKey === 'max_workspaces') {
      results.push(await queryDimensionUsage(tenantId, dimensionKey, 'postgres:workspaces', async () => {
        const { rows } = await client.query('SELECT COUNT(*)::int AS observed_usage FROM workspaces WHERE tenant_id = $1', [tenantId]);
        return { observedUsage: rows[0]?.observed_usage ?? 0 };
      }));
      continue;
    }
    if (dimensionKey === 'max_api_keys') {
      results.push(await queryDimensionUsage(tenantId, dimensionKey, 'postgres:api_keys', async () => {
        const { rows } = await client.query('SELECT COUNT(*)::int AS observed_usage FROM api_keys WHERE tenant_id = $1', [tenantId]);
        return { observedUsage: rows[0]?.observed_usage ?? 0 };
      }));
      continue;
    }
    results.push({ dimensionKey, status: 'unknown', reasonCode: 'unsupported_dimension' });
  }
  return results.map((item) => ({ tenantId, ...item }));
}
