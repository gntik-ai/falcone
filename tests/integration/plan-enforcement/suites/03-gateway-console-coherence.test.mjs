/**
 * Suite 03 — Gateway ↔ Console API coherence (RF-T06-03, CA-03 partial).
 *
 * Verifies direct coherence between gateway enforcement and console display
 * without using resolution as intermediary.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_PROFESSIONAL } from '../config/test-plans.mjs';
import { CAPABILITY_MAP } from '../config/test-capabilities.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest } from '../helpers/api-client.mjs';
import { getConsoleCapabilities, getConsoleQuotas } from '../helpers/console-api-client.mjs';
import { createDatabase } from '../helpers/resource-factory.mjs';
import { waitForPropagation } from '../helpers/wait-for-propagation.mjs';

describe('03 — Gateway ↔ Console API coherence', { skip: !envReady && 'env not configured' }, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  it('disabled capability: gateway 402 AND console shows disabled (realtime)', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);

    const route = CAPABILITY_MAP.get('realtime').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.equal(status, 402, 'gateway should block realtime');

    const { body: caps } = await getConsoleCapabilities(tenant.id, token);
    const val = caps?.realtime?.enabled ?? caps?.realtime;
    assert.equal(val, false, 'console should show realtime as disabled');
  });

  it('disabled capability: gateway 402 AND console shows disabled (webhooks)', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);

    const route = CAPABILITY_MAP.get('webhooks').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.equal(status, 402);

    const { body: caps } = await getConsoleCapabilities(tenant.id, token);
    assert.equal(caps?.webhooks?.enabled ?? caps?.webhooks, false);
  });

  it('enabled capability: gateway 2xx AND console shows enabled (realtime)', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);

    const route = CAPABILITY_MAP.get('realtime').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.ok(status < 400 || status === 404, `gateway should allow realtime (got ${status})`);

    const { body: caps } = await getConsoleCapabilities(tenant.id, token);
    assert.equal(caps?.realtime?.enabled ?? caps?.realtime, true);
  });

  it('enabled capability: gateway 2xx AND console shows enabled (sql_admin_api)', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);

    const route = CAPABILITY_MAP.get('sql_admin_api').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.ok(status < 400 || status === 404, `gateway should allow sql_admin_api (got ${status})`);

    const { body: caps } = await getConsoleCapabilities(tenant.id, token);
    assert.equal(caps?.sql_admin_api?.enabled ?? caps?.sql_admin_api, true);
  });

  it('quota at limit: gateway blocks AND console shows at-limit', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    // test-starter: max_workspaces: 3
    const token = await getTenantOwnerToken(tenant.id);

    // Create 3 workspaces to reach limit
    for (let i = 0; i < 3; i++) {
      await createWorkspace(tenant.id, `ws-fill-${i}`);
    }

    // 4th should be blocked
    let blocked = false;
    try {
      await createWorkspace(tenant.id, 'ws-over-limit');
    } catch (err) {
      blocked = err.message.includes('400') || err.message.includes('429') || err.message.includes('403');
    }
    assert.ok(blocked, 'gateway should block workspace creation at limit');

    // Console should show at-limit
    await waitForPropagation(
      async () => {
        const { body } = await getConsoleQuotas(tenant.id, token);
        return body?.max_workspaces?.usage ?? body?.max_workspaces?.currentUsage;
      },
      { expectedValue: 3 },
    );
  });
});
