/**
 * Suite 05 — Override propagation: CRUD + expiration (RF-T06-05, CA-07, CA-08).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_PROFESSIONAL } from '../config/test-plans.mjs';
import { CAPABILITY_MAP } from '../config/test-capabilities.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { createCapabilityOverride, createOverride, revokeOverride } from '../helpers/override-factory.mjs';
import { getSuperadminToken, getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest, controlPlaneRequest } from '../helpers/api-client.mjs';
import { getConsoleCapabilities } from '../helpers/console-api-client.mjs';
import { waitForPropagation } from '../helpers/wait-for-propagation.mjs';

describe('05 — Override propagation', { skip: !envReady && 'env not configured' }, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  it('CA-07a: enabling override on starter enables webhooks', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);
    const saToken = await getSuperadminToken();

    await createCapabilityOverride(tenant.id, { capability: 'webhooks', enabled: true });

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.webhooks;
      },
      { expectedValue: true },
    );

    const route = CAPABILITY_MAP.get('webhooks').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.ok(status < 400 || status === 404, `gateway should allow webhooks (got ${status})`);

    const { body: caps } = await getConsoleCapabilities(tenant.id, token);
    assert.equal(caps?.webhooks?.enabled ?? caps?.webhooks, true);
  });

  it('CA-07b: restrictive override on professional disables sql_admin_api', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);
    const saToken = await getSuperadminToken();

    await createCapabilityOverride(tenant.id, { capability: 'sql_admin_api', enabled: false });

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.sql_admin_api;
      },
      { expectedValue: false },
    );

    const route = CAPABILITY_MAP.get('sql_admin_api').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token });
    assert.equal(status, 402, 'gateway should block sql_admin_api after restrictive override');
  });

  it('CA-07c+d: numeric override raises limit, revocation restores plan base', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const saToken = await getSuperadminToken();

    // Override max_pg_databases: 5 → 15
    const ov = await createOverride(tenant.id, { dimension: 'max_pg_databases', value: 15 });

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.quotas?.max_pg_databases?.effectiveLimit ??
               body?.quotas?.max_pg_databases?.limit;
      },
      { expectedValue: 15 },
    );

    // Revoke → back to 5
    await revokeOverride(tenant.id, ov.id);

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.quotas?.max_pg_databases?.effectiveLimit ??
               body?.quotas?.max_pg_databases?.limit;
      },
      { expectedValue: 5 },
    );
  });

  it('CA-08: override with short expiry stops applying after expiration', {
    todo: 'requires sweep cycle < 60s — may be flaky in slow environments',
  }, async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const saToken = await getSuperadminToken();

    const expiresAt = new Date(Date.now() + 30_000).toISOString(); // 30s
    await createCapabilityOverride(tenant.id, {
      capability: 'webhooks',
      enabled: true,
      expiresAt,
    });

    // Verify override is active
    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.webhooks;
      },
      { expectedValue: true },
    );

    // Wait for expiry + sweep
    await new Promise((r) => setTimeout(r, 45_000));

    // Should revert to plan base (false for starter)
    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.webhooks;
      },
      { expectedValue: false },
    );
  });
});
