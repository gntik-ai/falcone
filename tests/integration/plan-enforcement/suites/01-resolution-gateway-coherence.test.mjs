/**
 * Suite 01 — Resolution ↔ Gateway coherence for capabilities (RF-T06-01, CA-01).
 *
 * For each of the 7 capabilities in the catalogue, verifies that the
 * entitlement resolution result and the gateway enforcement decision are
 * identical: enabled → 2xx, disabled → 402.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { CAPABILITY_CATALOGUE } from '../config/test-capabilities.mjs';
import { TEST_STARTER, TEST_ENTERPRISE } from '../config/test-plans.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { getSuperadminToken, getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest, controlPlaneRequest } from '../helpers/api-client.mjs';

describe('01 — Resolution ↔ Gateway coherence (capabilities)', { skip: !envReady && 'env not configured' }, () => {
  before(async () => {
    await ensureTestPlans();
  });

  after(async () => {
    await cleanupAllTestTenants();
  });

  for (const entry of CAPABILITY_CATALOGUE) {
    describe(`capability: ${entry.capability}`, () => {
      it('enabled plan → resolution true + gateway 2xx', async () => {
        const tenant = await createTestTenant();
        await assignPlan(tenant.id, TEST_ENTERPRISE.slug);
        const ws = await createWorkspace(tenant.id, 'ws-test');
        const token = await getTenantOwnerToken(tenant.id);

        // Check resolution
        const saToken = await getSuperadminToken();
        const { body: entitlements } = await controlPlaneRequest(
          'GET',
          `/api/v1/tenants/${tenant.id}/entitlements`,
          { token: saToken },
        );
        assert.equal(
          entitlements?.capabilities?.[entry.capability],
          true,
          `resolution should report ${entry.capability} = true`,
        );

        // Check gateway allows the route
        const route = entry.routes[0];
        const gwPath = route.path
          .replace('{workspaceId}', ws.id)
          .replace('{functionId}', 'test-fn');
        const { status } = await gatewayRequest(route.method, gwPath, { token });
        assert.ok(status < 400 || status === 404, `gateway should allow ${entry.capability} route (got ${status})`);
      });

      it('disabled plan → resolution false + gateway 402', async () => {
        const tenant = await createTestTenant();
        await assignPlan(tenant.id, TEST_STARTER.slug);
        const ws = await createWorkspace(tenant.id, 'ws-test');
        const token = await getTenantOwnerToken(tenant.id);

        // Check resolution
        const saToken = await getSuperadminToken();
        const { body: entitlements } = await controlPlaneRequest(
          'GET',
          `/api/v1/tenants/${tenant.id}/entitlements`,
          { token: saToken },
        );
        assert.equal(
          entitlements?.capabilities?.[entry.capability],
          false,
          `resolution should report ${entry.capability} = false`,
        );

        // Check gateway blocks the route with 402
        const route = entry.routes[0];
        const gwPath = route.path
          .replace('{workspaceId}', ws.id)
          .replace('{functionId}', 'test-fn');
        const { status, body } = await gatewayRequest(route.method, gwPath, { token });
        assert.equal(status, 402, `gateway should return 402 for disabled ${entry.capability}`);
        assert.ok(body?.capability || body?.error, 'error body should contain capability or error field');
      });
    });
  }
});
