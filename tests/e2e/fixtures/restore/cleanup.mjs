/**
 * Cleanup utilities for restore E2E test tenants.
 * @module tests/e2e/fixtures/restore/cleanup
 */

import { withRetry } from '../../helpers/retry.mjs';

const CLEANUP_RETRIES = Number(process.env.RESTORE_TEST_CLEANUP_RETRIES) || 3;
const TENANT_PREFIX = 'test-restore-';

/**
 * Delete all tenants matching a specific execution ID.
 *
 * @param {string} executionId
 * @param {import('../../helpers/api-client.mjs').ApiClient} client
 * @param {Object} [overrides]
 */
export async function cleanupByExecutionId(executionId, client, overrides = {}) {
  const listTenants = overrides.listTenants ?? (async () => {
    const res = await client.get('/v1/admin/tenants');
    if (res.status >= 400) return [];
    return Array.isArray(res.body) ? res.body : (res.body?.tenants ?? []);
  });

  const deleteTenant = overrides.deleteTenant ?? (async (id) => {
    await client.del(`/v1/admin/tenants/${id}`);
  });

  const tenants = await listTenants();
  const prefix = `${TENANT_PREFIX}${executionId}`;
  const matching = tenants.filter(t => {
    const id = typeof t === 'string' ? t : (t.tenant_id ?? t.id ?? '');
    return id.startsWith(prefix);
  });

  for (const t of matching) {
    const id = typeof t === 'string' ? t : (t.tenant_id ?? t.id);
    try {
      await withRetry(() => deleteTenant(id), { maxAttempts: CLEANUP_RETRIES, delayMs: 500 });
    } catch {
      // Best-effort
    }
  }
}

/**
 * Delete all stale test-restore-* tenants older than 24h.
 * Safety net for post-hoc cleanup.
 *
 * @param {import('../../helpers/api-client.mjs').ApiClient} client
 * @param {Object} [overrides]
 */
export async function cleanupAllTestTenants(client, overrides = {}) {
  const listTenants = overrides.listTenants ?? (async () => {
    const res = await client.get('/v1/admin/tenants');
    if (res.status >= 400) return [];
    return Array.isArray(res.body) ? res.body : (res.body?.tenants ?? []);
  });

  const deleteTenant = overrides.deleteTenant ?? (async (id) => {
    await client.del(`/v1/admin/tenants/${id}`);
  });

  const tenants = await listTenants();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const t of tenants) {
    const id = typeof t === 'string' ? t : (t.tenant_id ?? t.id ?? '');
    if (!id.startsWith(TENANT_PREFIX)) continue;
    const created = t.created_at ? new Date(t.created_at).getTime() : 0;
    if (created && created > cutoff) continue;

    try {
      await withRetry(() => deleteTenant(id), { maxAttempts: CLEANUP_RETRIES, delayMs: 500 });
    } catch {
      // Best-effort
    }
  }
}
