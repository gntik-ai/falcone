/**
 * Black-box tests for per-tenant / per-workspace gateway rate-limit partitioning
 * (add-per-tenant-gateway-rate-limit).
 *
 * These tests drive only the public configuration-reader surface and the plan
 * quota-resolution surface. There is NO live APISIX in this suite, so we assert
 * the CONFIGURATION CONTRACT (the partition key the gateway will use) plus the
 * RESOLUTION LOGIC that drives the per-tenant ceiling. The live 429 partitioning
 * behaviour is verified separately via /e2e-issue.
 *
 * bbx-gw-rate-01: every qosProfile declares a non-empty limitKey, planQuotaSource, limitCeiling
 * bbx-gw-rate-02: tenant-scoped qosProfiles partition by X-Tenant-Id
 * bbx-gw-rate-03: workspace-bound qosProfiles partition by the compound X-Tenant-Id:X-Workspace-Id
 * bbx-gw-rate-04: every enabled product_api APISIX route keys limit-count per-tenant (not $consumer_name), rejected_code 429
 * bbx-gw-rate-05: workspace-bound product_api routes key limit-count by the compound tenant+workspace var
 * bbx-gw-rate-06: premium-plan tenant resolves a strictly greater requests/min ceiling than a free-plan tenant (AC3)
 * bbx-gw-rate-07: static fallback floor is retained on every qosProfile (requestsPerMinute + limitCeiling)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { readGatewayRouting } from '../../scripts/lib/public-api.mjs';
import { readGatewayPolicyValues, listEnabledApisixRoutes } from '../../scripts/lib/gateway-policy.mjs';
import {
  resolveTenantEffectiveCapabilities,
  resolveTenantRateLimit
} from '../../services/internal-contracts/src/index.mjs';

const RATE_METRIC_KEY = 'tenant.api_requests_per_minute.max';

// qosProfiles whose route families bind a workspace (workspaceBinding: required).
const WORKSPACE_BOUND_QOS_PROFILES = new Set(['provisioning', 'event_gateway', 'realtime']);

function qosProfiles() {
  return readGatewayRouting()?.spec?.qosProfiles ?? {};
}

function rateLimitFromQuotas(planId) {
  const resolution = resolveTenantEffectiveCapabilities({ planId });
  const quota = (resolution.quotas ?? []).find((entry) => entry.metricKey === RATE_METRIC_KEY);
  assert.ok(quota, `plan ${planId} must resolve a ${RATE_METRIC_KEY} quota`);
  return quota.limit;
}

test('bbx-gw-rate-01: every qosProfile declares limitKey, planQuotaSource, limitCeiling', () => {
  const profiles = qosProfiles();
  const names = Object.keys(profiles);
  assert.ok(names.length >= 9, `expected at least 9 qosProfiles, found ${names.length}`);

  for (const [name, profile] of Object.entries(profiles)) {
    assert.equal(
      typeof profile.limitKey === 'string' && profile.limitKey.length > 0,
      true,
      `qosProfile ${name} must declare a non-empty limitKey`
    );
    assert.equal(
      typeof profile.planQuotaSource === 'string' && profile.planQuotaSource.length > 0,
      true,
      `qosProfile ${name} must declare a planQuotaSource`
    );
    assert.equal(
      typeof profile.limitCeiling === 'string' && profile.limitCeiling.length > 0,
      true,
      `qosProfile ${name} must declare a limitCeiling`
    );
  }
});

test('bbx-gw-rate-02: tenant-scoped qosProfiles partition by X-Tenant-Id', () => {
  const profiles = qosProfiles();
  for (const [name, profile] of Object.entries(profiles)) {
    if (WORKSPACE_BOUND_QOS_PROFILES.has(name)) continue;
    assert.equal(
      profile.limitKey,
      'X-Tenant-Id',
      `tenant-scoped qosProfile ${name} must partition by X-Tenant-Id`
    );
  }
});

test('bbx-gw-rate-03: workspace-bound qosProfiles partition by the compound X-Tenant-Id:X-Workspace-Id', () => {
  const profiles = qosProfiles();
  for (const name of WORKSPACE_BOUND_QOS_PROFILES) {
    assert.ok(profiles[name], `qosProfile ${name} must exist`);
    assert.equal(
      profiles[name].limitKey,
      'X-Tenant-Id:X-Workspace-Id',
      `workspace-bound qosProfile ${name} must use the compound tenant+workspace key`
    );
  }
});

test('bbx-gw-rate-04: every enabled product_api APISIX route keys limit-count per-tenant, rejected_code 429', () => {
  const routes = listEnabledApisixRoutes().filter(
    (route) => route?.labels?.['gateway.in-falcone.io/route-kind'] === 'product_api'
  );
  assert.ok(routes.length > 0, 'expected at least one enabled product_api route');

  for (const route of routes) {
    const limitCount = route.plugins?.['limit-count'];
    assert.ok(limitCount, `route ${route.name} must declare a limit-count plugin`);
    assert.equal(limitCount.rejected_code, 429, `route ${route.name} must reject with HTTP 429`);
    assert.equal(
      String(limitCount.key).includes('$consumer_name'),
      false,
      `route ${route.name} must not key the rate-limit counter on the shared consumer name`
    );
    assert.equal(
      String(limitCount.key).includes('$http_x_tenant_id'),
      true,
      `route ${route.name} must partition the rate-limit counter per tenant`
    );
  }
});

test('bbx-gw-rate-05: workspace-bound product_api routes key limit-count by tenant+workspace', () => {
  const routes = listEnabledApisixRoutes().filter(
    (route) =>
      route?.labels?.['gateway.in-falcone.io/route-kind'] === 'product_api' &&
      route?.labels?.['gateway.in-falcone.io/workspace-binding'] === 'required'
  );
  assert.ok(routes.length > 0, 'expected at least one workspace-bound product_api route');

  for (const route of routes) {
    const limitCount = route.plugins?.['limit-count'];
    assert.ok(limitCount, `route ${route.name} must declare a limit-count plugin`);
    assert.equal(
      limitCount.key_type,
      'var_combination',
      `workspace-bound route ${route.name} must use a var_combination key_type`
    );
    assert.equal(
      String(limitCount.key).includes('$http_x_tenant_id'),
      true,
      `workspace-bound route ${route.name} must include the tenant var`
    );
    assert.equal(
      String(limitCount.key).includes('$http_x_workspace_id'),
      true,
      `workspace-bound route ${route.name} must include the workspace var`
    );
  }
});

test('bbx-gw-rate-06: premium-plan tenant resolves a strictly greater rate ceiling than free-plan tenant (AC3)', () => {
  const freeLimit = rateLimitFromQuotas('pln_01starter');
  const premiumLimit = rateLimitFromQuotas('pln_01enterprise');

  assert.equal(typeof freeLimit, 'number');
  assert.equal(typeof premiumLimit, 'number');
  assert.ok(
    premiumLimit > freeLimit,
    `premium ceiling (${premiumLimit}) must be strictly greater than free ceiling (${freeLimit})`
  );

  // The exported helper applies the static floor and must never drop below the plan quota.
  assert.equal(resolveTenantRateLimit({ planId: 'pln_01enterprise', staticFloor: 0 }), premiumLimit);
  assert.equal(resolveTenantRateLimit({ planId: 'pln_01starter', staticFloor: 0 }), freeLimit);
  assert.ok(
    resolveTenantRateLimit({ planId: 'pln_01enterprise', staticFloor: 0 }) >
      resolveTenantRateLimit({ planId: 'pln_01starter', staticFloor: 0 })
  );
});

test('bbx-gw-rate-07: static fallback floor is retained on every qosProfile', () => {
  const profiles = qosProfiles();
  for (const [name, profile] of Object.entries(profiles)) {
    assert.equal(
      Number.isInteger(profile.requestsPerMinute) && profile.requestsPerMinute > 0,
      true,
      `qosProfile ${name} must retain a positive static requestsPerMinute floor`
    );
    assert.equal(
      profile.limitCeiling,
      'max_of_plan_and_static',
      `qosProfile ${name} must declare the grace-period ceiling strategy`
    );
  }

  // resolveTenantRateLimit must honour the static floor when it exceeds the plan quota.
  const planLimit = rateLimitFromQuotas('pln_01starter');
  const highFloor = planLimit + 1000;
  assert.equal(
    resolveTenantRateLimit({ planId: 'pln_01starter', staticFloor: highFloor }),
    highFloor,
    'resolveTenantRateLimit must return the static floor when it exceeds the plan quota'
  );
});
