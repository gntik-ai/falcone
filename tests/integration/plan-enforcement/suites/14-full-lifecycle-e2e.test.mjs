/**
 * Suite 14 — Full lifecycle E2E integrator (E1–E8).
 *
 * Executes a complete lifecycle with a single tenant covering all major
 * scenarios in sequence. This captures sequential coherence that isolated
 * tests cannot.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_PROFESSIONAL } from '../config/test-plans.mjs';
import { CAPABILITY_MAP } from '../config/test-capabilities.mjs';
import { createTestTenant, deleteTestTenant } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan, changePlan } from '../helpers/plan-factory.mjs';
import { createWorkspace, setSubQuota } from '../helpers/workspace-factory.mjs';
import { createCapabilityOverride, createOverride, revokeOverride } from '../helpers/override-factory.mjs';
import { createDatabase, createKafkaTopic } from '../helpers/resource-factory.mjs';
import { getSuperadminToken, getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest, controlPlaneRequest } from '../helpers/api-client.mjs';
import { waitForPropagation } from '../helpers/wait-for-propagation.mjs';

describe('14 — Full lifecycle E2E', { skip: !envReady && 'env not configured', timeout: 300_000 }, () => {
  let tenant;
  let saToken;
  let ownerToken;
  let ws1;

  before(async () => {
    await ensureTestPlans();
    saToken = await getSuperadminToken();
  });

  after(async () => {
    if (tenant) await deleteTestTenant(tenant.id);
  });

  it('E1: create tenant + assign professional → verify coherence', async () => {
    tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_PROFESSIONAL.slug);
    ownerToken = await getTenantOwnerToken(tenant.id);
    ws1 = await createWorkspace(tenant.id, 'ws-lifecycle');

    const { body: ent } = await controlPlaneRequest(
      'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
    );
    assert.equal(ent?.capabilities?.realtime, true);
    assert.equal(ent?.capabilities?.webhooks, true);

    const route = CAPABILITY_MAP.get('realtime').routes[0];
    const gwPath = route.path.replace('{workspaceId}', ws1.id);
    const { status } = await gatewayRequest(route.method, gwPath, { token: ownerToken });
    assert.ok(status < 400 || status === 404);
  });

  it('E8: create workspaces + sub-quotas → verify enforcement', async () => {
    const ws2 = await createWorkspace(tenant.id, 'ws-subq');
    await setSubQuota(tenant.id, ws1.id, 'max_pg_databases', 6);
    await setSubQuota(tenant.id, ws2.id, 'max_pg_databases', 4);

    // Create DBs in ws1
    for (let i = 0; i < 6; i++) {
      await createDatabase(tenant.id, ws1.id);
    }
    let blocked = false;
    try { await createDatabase(tenant.id, ws1.id); } catch { blocked = true; }
    assert.ok(blocked, 'ws1 should be blocked at sub-quota');
  });

  it('E4: enabling override → verify propagation', async () => {
    await createCapabilityOverride(tenant.id, {
      capability: 'custom_domains',
      enabled: true,
    });

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.custom_domains;
      },
      { expectedValue: true },
    );
  });

  it('E5: restrictive override → verify propagation', async () => {
    await createCapabilityOverride(tenant.id, {
      capability: 'webhooks',
      enabled: false,
    });

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

  it('E6: numeric override → verify', async () => {
    const ov = await createOverride(tenant.id, { dimension: 'max_pg_databases', value: 50 });

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.quotas?.max_pg_databases?.effectiveLimit ??
               body?.quotas?.max_pg_databases?.limit;
      },
      { expectedValue: 50 },
    );
  });

  it('E3: downgrade → verify', async () => {
    await changePlan(tenant.id, TEST_STARTER.slug);

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.realtime;
      },
      { expectedValue: false },
    );
  });

  it('E2: upgrade → verify', async () => {
    await changePlan(tenant.id, TEST_PROFESSIONAL.slug);

    await waitForPropagation(
      async () => {
        const { body } = await controlPlaneRequest(
          'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
        );
        return body?.capabilities?.realtime;
      },
      { expectedValue: true },
    );
  });
});
