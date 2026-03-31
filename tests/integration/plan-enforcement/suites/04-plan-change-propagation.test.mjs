/**
 * Suite 04 — Plan change propagation: upgrade and downgrade (RF-T06-04, CA-05, CA-06).
 *
 * Verifies that plan changes propagate to resolution, gateway, and console
 * within the configured TTL.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_PROFESSIONAL } from '../config/test-plans.mjs';
import { CAPABILITY_MAP } from '../config/test-capabilities.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan, changePlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { getSuperadminToken, getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest, controlPlaneRequest } from '../helpers/api-client.mjs';
import { getConsoleCapabilities } from '../helpers/console-api-client.mjs';
import { waitForPropagation } from '../helpers/wait-for-propagation.mjs';

describe('04 — Plan change propagation', { skip: !envReady && 'env not configured' }, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  it('upgrade: starter → professional enables realtime and raises max_workspaces', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);
    const saToken = await getSuperadminToken();

    // Pre-upgrade: realtime disabled
    const route = CAPABILITY_MAP.get('realtime').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const pre = await gatewayRequest(route.method, gwPath, { token });
    assert.equal(pre.status, 402, 'pre-upgrade: gateway should block realtime');

    // Upgrade
    await changePlan(tenant.id, TEST_PROFESSIONAL.slug);

    // Wait for resolution to converge
    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.realtime;
      },
      { expectedValue: true },
    );

    // Gateway should now allow realtime
    const post = await gatewayRequest(route.method, gwPath, { token });
    assert.ok(post.status < 400 || post.status === 404, `post-upgrade: gateway should allow realtime (got ${post.status})`);

    // Console should show enabled
    const { body: caps } = await getConsoleCapabilities(tenant.id, token);
    assert.equal(caps?.realtime?.enabled ?? caps?.realtime, true);

    // max_workspaces should be 10
    const { body: ent } = await controlPlaneRequest(
      'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
    );
    const wsLimit = ent?.quotas?.max_workspaces?.effectiveLimit ??
                    ent?.quotas?.max_workspaces?.limit;
    assert.equal(wsLimit, 10);
  });

  it('downgrade: professional → starter disables realtime and shows over-limit', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
    const token = await getTenantOwnerToken(tenant.id);
    const saToken = await getSuperadminToken();

    // Create 8 workspaces (exceeds starter limit of 3)
    const workspaces = [];
    for (let i = 0; i < 8; i++) {
      workspaces.push(await createWorkspace(tenant.id, `ws-dg-${i}`));
    }

    // Downgrade
    await changePlan(tenant.id, TEST_STARTER.slug);

    // Wait for resolution
    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.realtime;
      },
      { expectedValue: false },
    );

    // Gateway should block realtime
    const route = CAPABILITY_MAP.get('realtime').routes[0];
    const gwPath = route.path.replace('{workspaceId}', workspaces[0].id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.equal(status, 402, 'post-downgrade: gateway should block realtime');

    // Resolution should show max_workspaces: 3
    const { body: ent } = await controlPlaneRequest(
      'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
    );
    const wsLimit = ent?.quotas?.max_workspaces?.effectiveLimit ??
                    ent?.quotas?.max_workspaces?.limit;
    assert.equal(wsLimit, 3);

    // Existing 8 workspaces should NOT be deleted
    // but new creation should be blocked (over-limit 8/3)
    let blocked = false;
    try {
      await createWorkspace(tenant.id, 'ws-over');
    } catch {
      blocked = true;
    }
    assert.ok(blocked, 'new workspace creation should be blocked after downgrade');
  });
});
