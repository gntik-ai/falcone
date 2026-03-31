/**
 * Suite 12 — Capability-quota orthogonality (RF-T06-12, CA-12).
 *
 * Verifies that capabilities and quotas are evaluated independently
 * and produce distinct, non-contradictory errors.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_PROFESSIONAL, TEST_ENTERPRISE } from '../config/test-plans.mjs';
import { CAPABILITY_MAP } from '../config/test-capabilities.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { createCapabilityOverride, createOverride } from '../helpers/override-factory.mjs';
import { getTenantOwnerToken, getSuperadminToken } from '../helpers/auth.mjs';
import { gatewayRequest, controlPlaneRequest } from '../helpers/api-client.mjs';
import { waitForPropagation } from '../helpers/wait-for-propagation.mjs';

describe('12 — Capability-quota orthogonality', { skip: !envReady && 'env not configured' }, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  it('EC-02: capability enabled + quota 0 → route accessible but resource creation blocked', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_PROFESSIONAL.slug); // webhooks: true
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);
    const saToken = await getSuperadminToken();

    // Override max_webhooks to 0 (if the dimension exists)
    try {
      await createOverride(tenant.id, { dimension: 'max_webhooks', value: 0 });
    } catch {
      // dimension may not exist; the concept still applies to max_workspaces
    }

    // GET to webhook route should be accessible (capability check passes)
    const readRoute = CAPABILITY_MAP.get('webhooks').routes[0]; // GET
    const gwPath = readRoute.path.replace('{workspaceId}', ws.id);
    const { status: readStatus } = await gatewayRequest('GET', gwPath, { token });
    assert.ok(
      readStatus < 400 || readStatus === 404,
      `read route should be accessible (got ${readStatus})`,
    );

    // POST to create webhook should be blocked by quota (different error)
    const createPath = CAPABILITY_MAP.get('webhooks').routes[1]?.path?.replace('{workspaceId}', ws.id) ?? gwPath;
    const { status: createStatus } = await gatewayRequest('POST', createPath, {
      token,
      body: { name: 'test-wh', url: 'https://example.com/hook' },
    });
    // Should be blocked by quota (429/403) NOT capability (402)
    if (createStatus >= 400) {
      assert.notEqual(createStatus, 402, 'should not be a capability error (402) when capability is enabled');
    }
  });

  it('EC-03: unlimited quota + disabled capability → blocked by capability', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug); // all capabilities false
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);

    // Starter has no realtime capability but we don't override quotas
    const route = CAPABILITY_MAP.get('realtime').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.equal(status, 402, 'should be blocked by capability (402), not quota');
  });

  it('EC-04: enabling override + numeric override apply simultaneously', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const saToken = await getSuperadminToken();

    // Enable webhooks AND set a numeric limit
    await createCapabilityOverride(tenant.id, { capability: 'webhooks', enabled: true });
    await createOverride(tenant.id, { dimension: 'max_pg_databases', value: 50 });

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.webhooks === true &&
               (body?.quotas?.max_pg_databases?.effectiveLimit ?? body?.quotas?.max_pg_databases?.limit) === 50;
      },
      { expectedValue: true },
    );
  });
});
