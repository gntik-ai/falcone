import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listEnabledApisixRoutes,
  readGatewayPolicyValues,
  REQUIRED_PASSTHROUGH_PLUGINS,
  REQUIRED_PRODUCT_PLUGINS
} from '../../scripts/lib/gateway-policy.mjs';
import { readGatewayRouting, readPublicRouteCatalog } from '../../scripts/lib/public-api.mjs';

test('gateway contract publishes APISIX policy for every public family and passthrough route', () => {
  const values = readGatewayPolicyValues();
  const enabledRoutes = listEnabledApisixRoutes(values);
  const gatewayRouting = readGatewayRouting();
  const routeCatalog = readPublicRouteCatalog();

  for (const family of gatewayRouting.spec.families) {
    const route = enabledRoutes.find((entry) => entry.name === `public-api-${family.id}`);
    assert.ok(route, `missing APISIX route for family ${family.id}`);
    assert.equal(route.uri, `${family.pathPrefix}/*`);
    assert.equal(route.labels['gateway.in-atelier.io/family'], family.id);
    assert.deepEqual(Object.keys(route.plugins).sort(), REQUIRED_PRODUCT_PLUGINS.slice().sort());
  }

  for (const routeId of ['keycloak_admin', 'openwhisk_admin']) {
    const route = enabledRoutes.find((entry) => entry.labels?.['gateway.in-atelier.io/passthrough-id'] === routeId);
    assert.ok(route, `missing enabled passthrough route ${routeId}`);
    assert.deepEqual(Object.keys(route.plugins).sort(), REQUIRED_PASSTHROUGH_PLUGINS.slice().sort());
    assert.equal(route.labels['gateway.in-atelier.io/audit-required'], 'true');
  }

  const catalogFamilies = new Set(routeCatalog.routes.map((route) => route.family));
  for (const family of gatewayRouting.spec.families) {
    assert.equal(catalogFamilies.has(family.id), true, `route catalog missing family ${family.id}`);
  }
});

test('route catalog exposes gateway-facing auth and context metadata for every operation', () => {
  const routeCatalog = readPublicRouteCatalog();

  for (const route of routeCatalog.routes) {
    assert.equal(typeof route.gatewayAuthMode, 'string');
    assert.equal(typeof route.gatewayRouteClass, 'string');
    assert.equal(Array.isArray(route.gatewayAllowedHeaders), true);
    assert.equal(Array.isArray(route.gatewayContextHeaders), true);
    assert.equal(route.gatewayAllowedHeaders.includes('Authorization'), true);
    assert.equal(route.gatewayAllowedHeaders.includes('X-API-Version'), true);
    assert.equal(route.gatewayContextHeaders.includes('X-Auth-Subject'), true);
  }
});
