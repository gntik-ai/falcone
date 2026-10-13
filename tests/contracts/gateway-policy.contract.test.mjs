import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listEnabledApisixRoutes,
  readGatewayPolicyValues,
  REQUIRED_PASSTHROUGH_PLUGINS,
  requiredProductPlugins
} from '../../scripts/lib/gateway-policy.mjs';
import { readGatewayRouting, readPublicRouteCatalog } from '../../scripts/lib/public-api.mjs';
import { collectRealtimeSseRouteViolations, REALTIME_SSE_ROUTES } from '../../scripts/lib/realtime-sse-policy.mjs';
import {
  listConsoleRoutesByTier,
  listConsoleWorkflowRoutes,
  summarizeConsoleEndpointSeparation
} from '../../apps/control-plane-executor/src/public-api-catalog.mjs';

test('gateway contract publishes APISIX policy for every public family and passthrough route', () => {
  const values = readGatewayPolicyValues();
  const enabledRoutes = listEnabledApisixRoutes(values);
  const gatewayRouting = readGatewayRouting();
  const routeCatalog = readPublicRouteCatalog();

  for (const family of gatewayRouting.spec.families) {
    if (family.id === 'realtime') {
      for (const id of Object.keys(REALTIME_SSE_ROUTES)) {
        const route = enabledRoutes.find((entry) => entry.name === id);
        assert.ok(route, `missing APISIX SSE route ${id}`);
        assert.deepEqual(collectRealtimeSseRouteViolations(route), []);
      }
      continue;
    }
    const route = enabledRoutes.find((entry) => entry.name === `public-api-${family.id}`);
    assert.ok(route, `missing APISIX route for family ${family.id}`);
    assert.equal(route.uri, `${family.pathPrefix}/*`);
    assert.equal(route.labels['gateway.in-falcone.io/family'], family.id);
    assert.deepEqual(Object.keys(route.plugins).sort(), requiredProductPlugins(family.id).slice().sort());
    assert.equal(route.plugins['limit-count'].rejected_code, 429);
    assert.ok(route.plugins['client-control'].max_body_size > 0);

    if (family.id === 'websockets') {
      assert.equal(route.enableWebsocket, true);
    }
  }

  const realtimeRoute = enabledRoutes.find((entry) => entry.name === 'realtime');
  assert.ok(realtimeRoute);
  assert.equal(realtimeRoute.enableWebsocket, true);

  for (const routeId of ['keycloak_admin']) {
    const route = enabledRoutes.find((entry) => entry.labels?.['gateway.in-falcone.io/passthrough-id'] === routeId);
    assert.ok(route, `missing enabled passthrough route ${routeId}`);
    assert.deepEqual(Object.keys(route.plugins).sort(), REQUIRED_PASSTHROUGH_PLUGINS.slice().sort());
    assert.equal(route.labels['gateway.in-falcone.io/audit-required'], 'true');
    assert.ok(route.plugins['client-control'].max_body_size > 0);
  }

  const catalogFamilies = new Set(routeCatalog.routes.map((route) => route.family));
  for (const family of gatewayRouting.spec.families) {
    assert.equal(catalogFamilies.has(family.id), true, `route catalog missing family ${family.id}`);
  }
});

test('gateway metrics and event-gateway QoS remain explicit in values and catalog', () => {
  const values = readGatewayPolicyValues();
  const routeCatalog = readPublicRouteCatalog();

  assert.equal(values.gatewayPolicy.observability.gatewayMetrics.enabled, true);
  assert.equal(values.gatewayPolicy.observability.gatewayMetrics.plugin, 'prometheus');
  assert.equal(values.gatewayPolicy.observability.gatewayMetrics.metricsPath, '/apisix/prometheus/metrics');
  assert.equal(values.gatewayPolicy.observability.gatewayMetrics.seriesPrefix, 'in_falcone_event_gateway_');
  assert.ok(values.gatewayPolicy.observability.gatewayMetrics.requiredSeries.includes('in_falcone_event_gateway_publish_total'));

  const publishRoute = routeCatalog.routes.find((route) => route.path === '/v1/events/topics/{resourceId}/publish');
  const websocketRoute = routeCatalog.routes.find((route) => route.path === '/v1/websockets/sessions');
  assert.equal(publishRoute.gatewayQosProfile, 'event_gateway');
  assert.equal(publishRoute.gatewayRequestValidationProfile, 'event_gateway');
  assert.equal(websocketRoute.gatewayQosProfile, 'realtime');
  assert.equal(websocketRoute.gatewayRequestValidationProfile, 'realtime');
});

test('route catalog helpers can filter and summarize console endpoint separation metadata', () => {
  const spaRoutes = listConsoleRoutesByTier('spa');
  const wf002Routes = listConsoleWorkflowRoutes('WF-CON-002');
  const summary = summarizeConsoleEndpointSeparation();

  assert.equal(spaRoutes.some((route) => route.operationId === 'createTenant'), true);
  assert.equal(spaRoutes.some((route) => route.operationId === 'getTenantWorkflowJobStatus'), true);
  assert.equal(wf002Routes.some((route) => route.operationId === 'createTenant'), true);
  assert.equal(wf002Routes.some((route) => route.operationId === 'getTenantWorkflowJobStatus'), true);
  assert.equal(summary.spa.operationIds.includes('createWorkspace'), true);
  assert.equal(summary.platform.operationIds.includes('getRouteCatalog'), true);
});
