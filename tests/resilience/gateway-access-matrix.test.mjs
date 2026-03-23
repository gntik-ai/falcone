import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAccessAssertion, readGatewayPolicyValues } from '../../scripts/lib/gateway-policy.mjs';
import { readPublicRouteCatalog } from '../../scripts/lib/public-api.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';

const values = readGatewayPolicyValues();
const routeCatalog = readPublicRouteCatalog();
const domainModel = readDomainModel();

test('gateway access matrix enforces expected outcomes for product and passthrough routes', () => {
  for (const assertionEntry of values.gatewayPolicy.accessMatrix.assertions) {
    const evaluation = evaluateAccessAssertion(assertionEntry, values, routeCatalog, domainModel);
    assert.equal(
      evaluation.decision,
      assertionEntry.expect,
      `${assertionEntry.persona}/${assertionEntry.routeKind}/${assertionEntry.family ?? assertionEntry.routeId} -> ${evaluation.reason}`
    );
  }
});
