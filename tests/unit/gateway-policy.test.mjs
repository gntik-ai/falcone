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

test('SSE plugin exceptions are named, never family-wide', () => {
  for (const id of ['public-api-realtime-collection-changes', 'public-api-realtime-table-changes']) {
    assert.ok(!requiredProductPlugins('realtime', id, 'query_api_key_sse').includes('openid-connect'));
  }
  assert.ok(requiredProductPlugins('realtime').includes('openid-connect'));
  assert.ok(requiredProductPlugins('realtime', 'public-api-mongo-captures', 'query_api_key_sse').includes('openid-connect'));
});

test('full gateway validation rejects a widened SSE exception and missing safety plugins', () => {
  const values = readGatewayPolicyValues();
  const routes = values.bootstrap.reconcile.apisix.routes;
  const route = routes.find((entry) => entry.name === 'public-api-realtime-collection-changes');
  assert.ok(route, 'paired charts must publish the named stream route');
  for (const plugin of ['cors', 'limit-count', 'proxy-rewrite']) {
    const modified = structuredClone(values);
    delete modified.bootstrap.reconcile.apisix.routes.find((entry) => entry.name === route.name).plugins[plugin];
    assert.ok(collectGatewayPolicyViolations({ values: modified }).some((message) => message.includes(plugin)));
  }
  const widened = structuredClone(route);
  widened.name = 'public-api-unrelated';
  widened.authMode = 'query_api_key_sse';
  routes.push(widened);
  assert.ok(collectGatewayPolicyViolations({ values }).some((message) => message.includes('not allowlisted')));
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
