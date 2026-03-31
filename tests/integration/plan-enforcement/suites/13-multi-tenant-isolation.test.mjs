/**
 * Suite 13 — Multi-tenant isolation (RF-T06-14, CA-14).
 *
 * Verifies that enforcement for one tenant is completely independent
 * from another tenant's plan, overrides, and resources.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_PROFESSIONAL } from '../config/test-plans.mjs';
import { CAPABILITY_MAP } from '../config/test-capabilities.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { createCapabilityOverride } from '../helpers/override-factory.mjs';
import { getSuperadminToken, getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest, controlPlaneRequest } from '../helpers/api-client.mjs';
import { waitForPropagation } from '../helpers/wait-for-propagation.mjs';

describe('13 — Multi-tenant isolation', { skip: !envReady && 'env not configured' }, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  it('two tenants with different plans have independent capabilities', async () => {
    const [tStarter, tPro] = await Promise.all([
      createTestTenant(),
      createTestTenant(),
    ]);
    await assignPlan(tStarter.id, TEST_STARTER.slug);
    await assignPlan(tPro.id, TEST_PROFESSIONAL.slug);

    const saToken = await getSuperadminToken();

    const { body: entStarter } = await controlPlaneRequest(
      'GET', `/api/v1/tenants/${tStarter.id}/entitlements`, { token: saToken },
    );
    const { body: entPro } = await controlPlaneRequest(
      'GET', `/api/v1/tenants/${tPro.id}/entitlements`, { token: saToken },
    );

    assert.equal(entStarter?.capabilities?.realtime, false);
    assert.equal(entPro?.capabilities?.realtime, true);
  });

  it('override on one tenant does not affect the other', async () => {
    const [tA, tB] = await Promise.all([
      createTestTenant(),
      createTestTenant(),
    ]);
    await assignPlan(tA.id, TEST_STARTER.slug);
    await assignPlan(tB.id, TEST_STARTER.slug);

    const saToken = await getSuperadminToken();

    // Override webhooks on tenant A only
    await createCapabilityOverride(tA.id, { capability: 'webhooks', enabled: true });

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tA.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.webhooks;
      },
      { expectedValue: true },
    );

    // Tenant B should still have webhooks disabled
    const { body: entB } = await controlPlaneRequest(
      'GET', `/api/v1/tenants/${tB.id}/entitlements`, { token: saToken },
    );
    assert.equal(entB?.capabilities?.webhooks, false, 'tenant B should not be affected by tenant A override');
  });

  it('gateway enforces per-tenant: starter blocked, professional allowed', async () => {
    const [tStarter, tPro] = await Promise.all([
      createTestTenant(),
      createTestTenant(),
    ]);
    await assignPlan(tStarter.id, TEST_STARTER.slug);
    await assignPlan(tPro.id, TEST_PROFESSIONAL.slug);

    const wsStarter = await createWorkspace(tStarter.id);
    const wsPro = await createWorkspace(tPro.id);

    const tokenStarter = await getTenantOwnerToken(tStarter.id);
    const tokenPro = await getTenantOwnerToken(tPro.id);

    const route = CAPABILITY_MAP.get('realtime').routes[0];

    const gwPathStarter = route.path.replace('{workspaceId}', wsStarter.id);
    const gwPathPro = route.path.replace('{workspaceId}', wsPro.id);

    const [resStarter, resPro] = await Promise.all([
      gatewayRequest(route.method, gwPathStarter, { token: tokenStarter }),
      gatewayRequest(route.method, gwPathPro, { token: tokenPro }),
    ]);

    assert.equal(resStarter.status, 402, 'starter should be blocked');
    assert.ok(resPro.status < 400 || resPro.status === 404, 'professional should be allowed');
  });
});
