/**
 * Tenant lifecycle factory for restore E2E tests.
 * Creates and destroys isolated tenants via product APIs or DI overrides.
 * @module tests/e2e/fixtures/restore/tenant-factory
 */

import { withRetry } from '../../helpers/retry.mjs';

const CLEANUP_RETRIES = Number(process.env.RESTORE_TEST_CLEANUP_RETRIES) || 3;
const DOMAINS_ENABLED = (process.env.RESTORE_TEST_DOMAINS_ENABLED ?? 'iam,postgres_metadata,kafka,storage')
  .split(',')
  .map(d => d.trim())
  .filter(Boolean);

/**
 * Create a pair of isolated test tenants (src + dst).
 *
 * @param {string} executionId - UUID unique to this test run
 * @param {Object} opts
 * @param {boolean} [opts.withSuspendedDst=false]
 * @param {string[]} [opts.domains]
 * @param {string} [opts.suffix=''] - extra suffix for tenant names (for parallel scenarios)
 * @param {import('../../helpers/api-client.mjs').ApiClient} client
 * @param {Object} [overrides] - DI overrides for unit-testing the factory itself
 * @returns {Promise<{ srcTenantId: string, dstTenantId: string, activeDomains: string[], cleanup: () => Promise<void> }>}
 */
export async function createTestTenants(executionId, opts = {}, client = null, overrides = {}) {
  const suffix = opts.suffix ? `-${opts.suffix}` : '';
  const srcTenantId = `test-restore-${executionId}-src${suffix}`;
  const dstTenantId = `test-restore-${executionId}-dst${suffix}`;
  const activeDomains = opts.domains ?? DOMAINS_ENABLED;

  const createTenant = overrides.createTenant ?? (async (id, state) => {
    if (!client) throw new Error('ApiClient required when no createTenant override');
    const res = await client.post('/v1/admin/tenants', {
      tenant_id: id,
      name: id,
      state: state ?? 'active',
    });
    if (res.status >= 400) {
      throw new Error(`Failed to create tenant ${id}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body;
  });

  const deleteTenant = overrides.deleteTenant ?? (async (id) => {
    if (!client) return;
    await client.del(`/v1/admin/tenants/${id}`);
  });

  // Create tenants
  await createTenant(srcTenantId, 'active');
  await createTenant(dstTenantId, opts.withSuspendedDst ? 'suspended' : 'active');

  const cleanup = async () => {
    for (const id of [srcTenantId, dstTenantId]) {
      try {
        await withRetry(() => deleteTenant(id), { maxAttempts: CLEANUP_RETRIES, delayMs: 500 });
      } catch {
        // Best-effort: tenant might already be gone
      }
    }
  };

  return { srcTenantId, dstTenantId, activeDomains, cleanup };
}
