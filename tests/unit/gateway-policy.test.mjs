import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectGatewayPolicyViolations,
  evaluateAccessAssertion,
  listEnabledApisixRoutes,
  readGatewayPolicyValues,
  requiredProductPlugins
} from '../../scripts/lib/gateway-policy.mjs';
import { readPublicRouteCatalog } from '../../scripts/lib/public-api.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';

test('gateway policy package remains internally consistent', () => {
  const values = readGatewayPolicyValues();
  assert.equal(values.gatewayPolicy.correlation.generateWhenMissing, true);
  assert.equal(values.gatewayPolicy.errorEnvelope.schema, 'ErrorResponse');
  assert.ok(Object.keys(values.gatewayPolicy.qos.profiles).length > 0);
  assert.deepEqual(collectGatewayPolicyViolations(), []);
});

test('Mongo requires realm JWKS authentication while other product routes retain OIDC', () => {
  assert.ok(requiredProductPlugins('mongo').includes('issuer-jwks-auth'));
  assert.ok(!requiredProductPlugins('mongo').includes('openid-connect'));
  assert.ok(requiredProductPlugins('events').includes('openid-connect'));
  assert.ok(!requiredProductPlugins('events').includes('issuer-jwks-auth'));
});

test('gateway policy rejects Mongo routes missing the verifier or restoring OIDC', () => {
  const values = readGatewayPolicyValues();
  const mongo = values.bootstrap.reconcile.apisix.routes.find((route) => route.name === 'public-api-mongo');
  delete mongo.plugins['issuer-jwks-auth'];
  mongo.plugins['openid-connect'] = {};
  const violations = collectGatewayPolicyViolations({ values });
  assert.ok(violations.includes('APISIX route public-api-mongo must enable plugin issuer-jwks-auth.'));
  assert.ok(violations.includes('APISIX route public-api-mongo must use issuer-jwks-auth instead of openid-connect.'));

  mongo.plugins['issuer-jwks-auth'] = {};
  assert.ok(collectGatewayPolicyViolations({ values }).includes(
    'APISIX route public-api-mongo must use issuer-jwks-auth instead of openid-connect.'
  ));
});

test('the Mongo verifier cannot replace OIDC on another product route', () => {
  const values = readGatewayPolicyValues();
  const events = values.bootstrap.reconcile.apisix.routes.find((route) => route.name === 'public-api-events');
  delete events.plugins['openid-connect'];
  events.plugins['issuer-jwks-auth'] = {};
  assert.ok(collectGatewayPolicyViolations({ values }).includes(
    'APISIX route public-api-events must enable plugin openid-connect.'
  ));
});

test('enabled APISIX routes honor passthrough mode switches', () => {
  const values = readGatewayPolicyValues();
  const enabledNames = listEnabledApisixRoutes(values).map((route) => route.name);

  assert.equal(enabledNames.includes('native-keycloak-admin'), true);

  const limited = structuredClone(values);
  limited.gatewayPolicy.passthrough.mode = 'limited';
  const limitedNames = listEnabledApisixRoutes(limited).map((route) => route.name);
  assert.equal(limitedNames.includes('native-keycloak-admin'), true);

  const disabled = structuredClone(values);
  disabled.gatewayPolicy.passthrough.mode = 'disabled';
  const disabledNames = listEnabledApisixRoutes(disabled).map((route) => route.name);
  assert.equal(disabledNames.includes('native-keycloak-admin'), false);
});

test('access matrix evaluation differentiates product and passthrough access', () => {
  const values = readGatewayPolicyValues();
  const routeCatalog = readPublicRouteCatalog();
  const domainModel = readDomainModel();

  assert.equal(
    evaluateAccessAssertion(
      { persona: 'workspace_developer', routeKind: 'product_api', path: '/v1/functions/actions', method: 'POST' },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'allow'
  );
  assert.equal(
    evaluateAccessAssertion(
      { persona: 'workspace_viewer', routeKind: 'product_api', path: '/v1/functions/actions', method: 'POST' },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'deny'
  );
  assert.equal(
    evaluateAccessAssertion(
      { persona: 'workspace_service_account', routeKind: 'product_api', path: '/v1/events/topics/{resourceId}/publish', method: 'POST' },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'allow'
  );
  assert.equal(
    evaluateAccessAssertion(
      { persona: 'tenant_admin', routeKind: 'product_api', path: '/v1/functions/actions', method: 'POST' },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'deny'
  );
  assert.equal(
    evaluateAccessAssertion(
      { persona: 'tenant_developer', routeKind: 'product_api', path: '/v1/tenants/{tenantId}/effective-capabilities', method: 'GET' },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'allow'
  );
  assert.equal(
    evaluateAccessAssertion(
      { persona: 'tenant_viewer', routeKind: 'product_api', path: '/v1/functions/actions/{resourceId}', method: 'GET' },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'deny'
  );
  assert.equal(
    evaluateAccessAssertion(
      {
        persona: 'mixed_tenant_viewer_workspace_developer',
        routeKind: 'product_api',
        path: '/v1/functions/actions',
        method: 'POST'
      },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'allow'
  );
  assert.equal(
    evaluateAccessAssertion(
      {
        persona: 'mixed_tenant_developer_workspace_viewer',
        routeKind: 'product_api',
        path: '/v1/functions/actions',
        method: 'POST'
      },
      values,
      routeCatalog,
      domainModel
    ).decision,
    'deny'
  );
  assert.equal(
    evaluateAccessAssertion({ persona: 'superadmin', routeKind: 'passthrough', routeId: 'keycloak_admin' }, values, routeCatalog, domainModel).decision,
    'allow'
  );
  assert.equal(
    evaluateAccessAssertion({ persona: 'workspace_developer', routeKind: 'passthrough', routeId: 'keycloak_admin' }, values, routeCatalog, domainModel).decision,
    'deny'
  );
});

test('only realtime-changes exempts OIDC and request validation', () => {
  assert.deepEqual(requiredProductPlugins('realtime-changes'), ['cors', 'limit-count', 'client-control', 'proxy-rewrite']);
  for (const family of ['events', 'mongo-captures', 'realtime', 'realtime-changes-other']) {
    assert.ok(requiredProductPlugins(family).includes('openid-connect'));
    assert.ok(requiredProductPlugins(family).includes('request-validation'));
  }
  assert.ok(requiredProductPlugins('mongo').includes('request-validation'));
});

test('realtime query-key policy requires blank identity headers and a changes-only URI', async () => {
  const { realtimeChangesFixture } = await import('../contracts/fixtures/realtime-changes-values.mjs');
  for (const mutate of [
    ...['x-tenant-id', 'x-workspace-id', 'x-auth-subject', 'x-actor-roles', 'x-gateway-auth'].map(
      header => route => { delete route.plugins['proxy-rewrite'].headers.set[header]; }),
    route => { route.vars = []; },
    ...['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => route => { route.methods.push(method); }),
    route => { route.vars = [['uri', '~~', '/changes']]; },
    route => { route.plugins['limit-count'].key = '$arg_apikey'; },
  ]) {
    const fixture = realtimeChangesFixture();
    mutate(fixture.route);
    assert.ok(collectGatewayPolicyViolations(fixture).some(message => message.includes('public-api-realtime-changes')));
  }
});

test('every other family retains authentication and request validation in full policy checks', async () => {
  const { realtimeChangesFixture } = await import('../contracts/fixtures/realtime-changes-values.mjs');
  const baseline = realtimeChangesFixture();
  for (const family of baseline.gatewayRouting.spec.families.filter(family => family.id !== 'realtime-changes')) {
    for (const plugin of [family.id === 'mongo' ? 'issuer-jwks-auth' : 'openid-connect', 'request-validation']) {
      const fixture = structuredClone(baseline);
      const route = fixture.values.bootstrap.reconcile.apisix.routes.find(route => route.name === `public-api-${family.id}`);
      delete route.plugins[plugin];
      assert.ok(collectGatewayPolicyViolations(fixture).includes(`APISIX route public-api-${family.id} must enable plugin ${plugin}.`));
    }
  }
});
