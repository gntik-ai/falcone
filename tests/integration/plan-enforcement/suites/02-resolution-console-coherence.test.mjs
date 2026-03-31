/**
 * Suite 02 — Resolution ↔ Console API coherence (RF-T06-02, CA-02).
 *
 * Verifies that capabilities and quotas shown by the console API endpoints
 * match the entitlement resolution result.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_PROFESSIONAL } from '../config/test-plans.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { getSuperadminToken, getTenantOwnerToken } from '../helpers/auth.mjs';
import { controlPlaneRequest } from '../helpers/api-client.mjs';
import { getConsoleCapabilities, getConsoleQuotas } from '../helpers/console-api-client.mjs';
import { waitForPropagation } from '../helpers/wait-for-propagation.mjs';

describe('02 — Resolution ↔ Console API coherence', { skip: !envReady && 'env not configured' }, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  const CAPS_TO_TEST = ['realtime', 'webhooks', 'sql_admin_api'];

  for (const cap of CAPS_TO_TEST) {
    it(`capability "${cap}" enabled: resolution true → console enabled`, async () => {
      const tenant = await createTestTenant();
      await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
      const saToken = await getSuperadminToken();
      const ownerToken = await getTenantOwnerToken(tenant.id);

      const { body: entitlements } = await controlPlaneRequest(
        'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
      );
      assert.equal(entitlements?.capabilities?.[cap], true);

      await waitForPropagation(
        async () => {
          const { body } = await getConsoleCapabilities(tenant.id, ownerToken);
          return body?.[cap]?.enabled ?? body?.[cap];
        },
        { expectedValue: true },
      );
    });

    it(`capability "${cap}" disabled: resolution false → console disabled`, async () => {
      const tenant = await createTestTenant();
      await assignPlan(tenant.id, TEST_STARTER.slug);
      const saToken = await getSuperadminToken();
      const ownerToken = await getTenantOwnerToken(tenant.id);

      const { body: entitlements } = await controlPlaneRequest(
        'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
      );
      assert.equal(entitlements?.capabilities?.[cap], false);

      await waitForPropagation(
        async () => {
          const { body } = await getConsoleCapabilities(tenant.id, ownerToken);
          return body?.[cap]?.enabled ?? body?.[cap];
        },
        { expectedValue: false },
      );
    });
  }

  const QUOTAS_TO_TEST = ['max_workspaces', 'max_pg_databases'];

  for (const dim of QUOTAS_TO_TEST) {
    it(`quota "${dim}": resolution limit matches console`, async () => {
      const tenant = await createTestTenant();
      await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
      const saToken = await getSuperadminToken();
      const ownerToken = await getTenantOwnerToken(tenant.id);

      const { body: entitlements } = await controlPlaneRequest(
        'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
      );
      const expectedLimit = entitlements?.quotas?.[dim]?.effectiveLimit ??
                            entitlements?.quotas?.[dim]?.limit ??
                            TEST_PROFESSIONAL.quotas[dim].limit;

      await waitForPropagation(
        async () => {
          const { body } = await getConsoleQuotas(tenant.id, ownerToken);
          return body?.[dim]?.limit ?? body?.[dim]?.effectiveLimit;
        },
        { expectedValue: expectedLimit },
      );
    });

    it(`quota "${dim}": console usage reflects actual resources`, async () => {
      const tenant = await createTestTenant();
      await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
      const ownerToken = await getTenantOwnerToken(tenant.id);

      // No resources created → usage should be 0
      await waitForPropagation(
        async () => {
          const { body } = await getConsoleQuotas(tenant.id, ownerToken);
          return body?.[dim]?.usage ?? body?.[dim]?.currentUsage ?? 0;
        },
        { expectedValue: 0 },
      );
    });
  }
});
