import test from 'node:test';
import assert from 'node:assert/strict';
import { readGatewayRouting } from '../../scripts/lib/public-api.mjs';
import { collectRealtimeSseRouteViolations } from '../../scripts/lib/realtime-sse-policy.mjs';

const routing = readGatewayRouting().spec;
for (const [id, path] of [
  ['public-api-realtime-collection-changes', '/v1/realtime/workspaces/ws1/data/appdb/collections/notes/changes'],
  ['public-api-realtime-table-changes', '/v1/realtime/workspaces/ws1/data/appdb/schemas/public/tables/notes/changes'],
]) {
  test(`${id}: anchored GET stream, gateway preflight, stripped context, and capture coexistence`, () => {
    const route = routing.publicRoutes.find((entry) => entry.id === id);
    assert.ok(route);
    assert.deepEqual(collectRealtimeSseRouteViolations(route), []);
    assert.equal(route.upstreamComponent, 'control-plane-executor');
    assert.equal(route.timeoutProfile, 'realtime');
    assert.deepEqual(route.methods, ['GET', 'OPTIONS']);
    assert.equal(route.plugins.cors.allow_methods, 'GET,OPTIONS');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) assert.equal(route.methods.includes(method), false);
    const guard = new RegExp(route.vars[0][2]);
    assert.equal(guard.test(path), true);
    for (const other of [
      `${path}/extra`, `/extra${path}`, `${path}/`,
      '/v1/realtime/workspaces/ws1/mongo-captures',
      '/v1/workspaces/ws1/pg-captures',
    ]) assert.equal(guard.test(other), false, other);
    assert.equal(route.plugins['proxy-rewrite'].headers.set['x-tenant-id'], '');
    const profile = routing.requestValidationProfiles[route.requestValidationProfile];
    assert.deepEqual(profile.requiredRequestHeaders, []);
    assert.equal(route.plugins['request-validation'].header_schema.type, 'object');
    assert.deepEqual(route.plugins['request-validation'].header_schema.required ?? [], []);
  });
}

test('capture management route entries retain their methods and authentication', () => {
  for (const [id, methods] of [['public-api-mongo-captures', ['GET', 'POST']], ['public-api-mongo-capture-disable', ['DELETE']]]) {
    const route = routing.publicRoutes.find((entry) => entry.id === id);
    assert.deepEqual(route.methods, methods);
    assert.equal(route.authMode, 'bearer_oidc');
  }
  assert.ok(routing.families.some((family) => family.id === 'pg-captures' && family.pathPrefix === '/v1/workspaces/{workspaceId}/pg-captures'));
});
