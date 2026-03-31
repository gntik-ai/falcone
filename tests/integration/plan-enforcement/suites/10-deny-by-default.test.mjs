/**
 * Suite 10 — Deny-by-default on resolution failure (RF-T06-10, CA-09, EC-07).
 *
 * NOTE: The mechanism to simulate resolution service unavailability is
 * environment-dependent. Strategies considered:
 *   1. Feature flag that disables the resolution endpoint
 *   2. kubectl scale to 0 replicas
 *   3. Istio fault injection
 *   4. Temporarily misconfigure APISIX upstream
 *
 * This test documents the expected behavior and may be skipped
 * if no fault-injection mechanism is available.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady, env } from '../config/test-env.mjs';
import { TEST_PROFESSIONAL } from '../config/test-plans.mjs';
import { CAPABILITY_MAP } from '../config/test-capabilities.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest } from '../helpers/api-client.mjs';

const FAULT_INJECTION_AVAILABLE = process.env.RESOLUTION_FAULT_INJECTION === 'true';

describe('10 — Deny-by-default on resolution failure', {
  skip: (!envReady && 'env not configured') ||
        (!FAULT_INJECTION_AVAILABLE && 'fault injection not available (set RESOLUTION_FAULT_INJECTION=true)'),
}, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  it('gateway denies capability-gated routes when resolution is unavailable', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);

    // First verify it works normally
    const route = CAPABILITY_MAP.get('realtime').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const pre = await gatewayRequest(route.method, gwPath, { token });
    assert.ok(pre.status < 400 || pre.status === 404, 'should work before fault');

    // Inject fault (environment-specific)
    // The actual mechanism depends on the test environment setup.
    // Example: POST to a test-only admin endpoint to simulate failure.
    try {
      await gatewayRequest('POST', '/__test/fault/resolution-down', {
        token,
        body: { enabled: true },
      });
    } catch {
      // If fault endpoint doesn't exist, test will still validate the concept
    }

    // Allow time for caches to expire
    await new Promise((r) => setTimeout(r, 5000));

    // Gateway should deny (not silently allow)
    const during = await gatewayRequest(route.method, gwPath, { token });
    assert.ok(
      during.status >= 400,
      `gateway should deny during resolution outage (got ${during.status})`,
    );

    // Restore
    try {
      await gatewayRequest('POST', '/__test/fault/resolution-down', {
        token,
        body: { enabled: false },
      });
    } catch {
      // Best effort restore
    }
  });
});
