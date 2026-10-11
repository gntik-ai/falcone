import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildRouteCatalog, collectPublicApiViolations, readPublicApiTaxonomy, readGatewayRouting } from '../../scripts/lib/public-api.mjs';
const source = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json', 'utf8'));
const taxonomy = readPublicApiTaxonomy();
function violations(document) {
  return collectPublicApiViolations({ document, taxonomy, routeCatalog: buildRouteCatalog(document, taxonomy), gatewayRouting: readGatewayRouting() });
}

test('Idempotency-Key is optional and every mutation must still declare it', () => {
  assert.equal(source.components.parameters.IdempotencyKey.required, false);
  assert.deepEqual(violations(source), []);
  const changed = structuredClone(source);
  const operation = changed.paths['/v1/flows/workspaces/{workspaceId}/flows'].post;
  operation.parameters = operation.parameters.filter(p => p.$ref !== '#/components/parameters/IdempotencyKey');
  assert.ok(violations(changed).some(v => v.includes('POST /v1/flows/workspaces/{workspaceId}/flows') && v.includes('Idempotency-Key')));
});

test('all generated families advertise an optional mutation key', async () => {
  const { listFamilyDocumentPaths } = await import('../../scripts/lib/public-api.mjs');
  for (const path of listFamilyDocumentPaths()) {
    const family = JSON.parse(readFileSync(path, 'utf8'));
    if (family.components?.parameters?.IdempotencyKey) assert.equal(family.components.parameters.IdempotencyKey.required, false, path);
  }
});
