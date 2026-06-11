// Contract: anon/service API-key gateway routes (Supabase-style).
//
// The executor exposes a data API that frontend apps reach with an `apikey: flc_...` header
// instead of a Keycloak JWT. These APISIX routes are selected by the apikey header, carry NO
// openid-connect (the executor verifies the key), forward to the executor, and exist ONLY
// when the executor is enabled (upstream.requiresExecutor). This test pins that contract at
// the values layer (template-level enable/disable gating is verified by helm render).
import test from 'node:test';
import assert from 'node:assert/strict';
import { listEnabledApisixRoutes, readGatewayPolicyValues } from '../../scripts/lib/gateway-policy.mjs';

const routes = listEnabledApisixRoutes(readGatewayPolicyValues());
const byName = (name) => routes.find((r) => r.name === name);

const USAGE = [
  { name: 'public-api-postgres-apikey', family: 'postgres', uri: '/v1/postgres/*', jwt: 'public-api-postgres' },
  { name: 'public-api-mongo-apikey', family: 'mongo', uri: '/v1/mongo/*', jwt: 'public-api-mongo' },
  { name: 'public-api-events-apikey', family: 'events', uri: '/v1/events/*', jwt: 'public-api-events' },
  { name: 'public-api-functions-apikey', family: 'functions', uri: '/v1/functions/*', jwt: 'public-api-functions' },
];

for (const r of USAGE) {
  test(`${r.name} is an executor-only, apikey-selected, OIDC-free data route`, () => {
    const route = byName(r.name);
    assert.ok(route, `${r.name} must be declared`);
    assert.equal(route.uri, r.uri);
    // executor-only + data-plane
    assert.equal(route.upstream?.requiresExecutor, true);
    assert.equal(route.upstream?.dataPlane, true);
    // selected by a Supabase-style apikey header
    assert.deepEqual(route.vars, [['http_apikey', '~~', '^flc_']]);
    // NO JWT enforcement at the gateway — the executor verifies the key
    assert.ok(!('openid-connect' in (route.plugins ?? {})), `${r.name} must not enable openid-connect`);
    assert.ok('cors' in (route.plugins ?? {}), `${r.name} must keep cors for browser callers`);
    // per-key rate limit (noisy-neighbor guard) keyed by the apikey header, 429 on breach
    const limit = route.plugins?.['limit-count'];
    assert.ok(limit, `${r.name} must rate-limit the public anon/service surface`);
    assert.equal(limit.key, '$http_apikey', `${r.name} rate limit must be keyed per api-key`);
    // var_combination interpolates $http_apikey → per-key buckets (var would key globally)
    assert.equal(limit.key_type, 'var_combination', `${r.name} rate limit must use var_combination for per-key buckets`);
    assert.equal(limit.rejected_code, 429);
    assert.ok(Number(limit.count) > 0, `${r.name} rate limit must declare a positive count`);
    // higher priority than the JWT route so a key request wins when the header is present
    const jwt = byName(r.jwt);
    assert.ok(jwt, `${r.jwt} must exist`);
    assert.ok(route.priority > jwt.priority, `${r.name} priority must exceed ${r.jwt}`);
    // distinct route-kind so it is exempt from the JWT product-plugin gate
    assert.equal(route.labels?.['gateway.in-falcone.io/route-kind'], 'product_api_apikey');
  });
}

test('api-key issuance route targets the executor with admin (JWT) auth, scoped to the api-keys subpath', () => {
  const route = byName('public-api-workspace-api-keys');
  assert.ok(route, 'public-api-workspace-api-keys must be declared');
  assert.equal(route.upstream?.requiresExecutor, true);
  assert.equal(route.upstream?.dataPlane, true);
  assert.deepEqual(route.vars, [['uri', '~~', '^/v1/workspaces/[^/]+/api-keys']]);
  // issuance is admin-only → JWT enforced at the gateway
  assert.ok('openid-connect' in (route.plugins ?? {}), 'issuance route must enforce openid-connect');
  // must outrank the generic /v1/workspaces/* route
  const workspaces = byName('public-api-workspaces');
  assert.ok(route.priority > workspaces.priority, 'issuance route must outrank public-api-workspaces');
});

test('every requiresExecutor route is also a data-plane route (so the split sends it to the executor)', () => {
  for (const route of routes.filter((r) => r.upstream?.requiresExecutor)) {
    assert.equal(route.upstream?.dataPlane, true, `${route.name} requiresExecutor must imply dataPlane`);
  }
});
