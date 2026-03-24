import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectGatewayPolicyViolations,
  evaluateAccessAssertion,
  listEnabledApisixRoutes,
  readGatewayPolicyValues
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

test('enabled APISIX routes honor passthrough mode switches', () => {
  const values = readGatewayPolicyValues();
  const enabledNames = listEnabledApisixRoutes(values).map((route) => route.name);

  assert.equal(enabledNames.includes('native-keycloak-admin'), true);
  assert.equal(enabledNames.includes('native-openwhisk-admin'), true);

  const limited = structuredClone(values);
  limited.gatewayPolicy.passthrough.mode = 'limited';
  const limitedNames = listEnabledApisixRoutes(limited).map((route) => route.name);
  assert.equal(limitedNames.includes('native-keycloak-admin'), true);
  assert.equal(limitedNames.includes('native-openwhisk-admin'), false);

  const disabled = structuredClone(values);
  disabled.gatewayPolicy.passthrough.mode = 'disabled';
  const disabledNames = listEnabledApisixRoutes(disabled).map((route) => route.name);
  assert.equal(disabledNames.includes('native-keycloak-admin'), false);
  assert.equal(disabledNames.includes('native-openwhisk-admin'), false);
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
