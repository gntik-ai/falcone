import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import Ajv from 'ajv';
import { collectPublicApiViolations } from '../../scripts/lib/public-api.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const path = '/v1/secrets/inventory';
const internal = YAML.parse(readFileSync('internal-contracts/secrets/secret-inventory-v1.yaml', 'utf8'));
const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');

test('inventory is published with a dedicated authenticated runtime binding and unchanged history binding', () => {
  const catalog = read('apps/control-plane/route-map.json');
  const runtime = read('apps/control-plane/route-map.runtime.json');
  const entry = catalog.find(route => route.path === path && route.method === 'GET');
  assert.ok(entry);
  assert.equal(entry.module, 'packages/provisioning-orchestrator/src/actions/secret-inventory.mjs');
  assert.equal(entry.export, 'secretInventory');
  assert.equal(entry.invoke, 'params-auth-query');
  const live = runtime.find(route => route.path === path && route.method === 'GET');
  assert.equal(live.module, `/repo/${entry.module}`);
  assert.equal(live.export, entry.export);
  assert.equal(live.invoke, entry.invoke);
  assert.equal(live.auth, 'authenticated');
  assert.equal(live.mergeQueryIntoParams, true);
  const history = catalog.find(route => route.operationId === 'getSecretHistory');
  assert.equal(history.module, 'packages/provisioning-orchestrator/src/actions/secret-rotation-history.mjs');
  assert.equal(history.export, 'main');
  assert.equal(history.invoke, 'params-auth-db');
  assert.ok(read('packages/internal-contracts/src/public-route-catalog.json').routes.some(route => route.path === path && route.method === 'GET'));
  assert.ok(read('deploy/gateway-config/public-route-catalog.json').some(route => route.path === path && route.method === 'GET'));
  assert.ok(read('apps/control-plane-executor/openapi/families/platform.openapi.json').paths[path]?.get);
});

test('internal and published inventory schemas describe pagination, exact metadata and error envelopes', () => {
  for (const doc of [internal, document]) {
    const operation = doc.paths[path].get;
    const params = operation.parameters.filter(param => param.in === 'query');
    assert.equal(params.find(param => param.name === 'domain').required, true);
    assert.deepEqual(params.find(param => param.name === 'domain').schema.enum, ['platform', 'tenant', 'functions', 'gateway', 'iam']);
    assert.deepEqual(params.find(param => param.name === 'offset').schema, { type: 'integer', minimum: 0, default: 0 });
    assert.deepEqual(params.find(param => param.name === 'limit').schema, { type: 'integer', minimum: 1, maximum: 200, default: 50 });
    const response = operation.responses['200'].content['application/json'].schema;
    assert.deepEqual(response.required, ['secrets', 'offset', 'limit']);
    assert.equal(response.additionalProperties, false);
    const item = doc.components.schemas.SecretMetadataItem;
    assert.deepEqual(Object.keys(item.properties).sort(), ['name', 'domain', 'path', 'createdAt', 'updatedAt', 'status', 'secretType', 'tenantId', 'currentVersion', 'requiresForce'].sort());
    assert.equal(item.additionalProperties, false);
    assert.deepEqual(item.not, { anyOf: [{ required: ['value'] }, { required: ['data'] }] });
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(item);
    const row = { name: 'key', domain: 'platform', path: 'platform/key', createdAt: '2026-03-30T00:00:00Z',
      updatedAt: '2026-03-31T00:00:00Z', status: 'active', secretType: 'password', tenantId: null,
      currentVersion: { vaultVersion: 2, state: 'active', activatedAt: '2026-03-31T00:00:00Z' }, requiresForce: true };
    assert.equal(validate(row), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...row, currentVersion: null, requiresForce: false }), true);
    for (const invalid of [{ ...row, value: 'forbidden' }, { ...row, data: {} },
      { ...row, currentVersion: { ...row.currentVersion, data: {} } },
      { ...row, currentVersion: { ...row.currentVersion, state: 'revoked' } }]) assert.equal(validate(invalid), false);
    assert.equal(operation.responses['400'].content['application/json'].schema.$ref, '#/components/schemas/SecretInventoryError');
    assert.equal(operation.responses['403'].content['application/json'].schema.$ref, '#/components/schemas/SecretInventoryError');
    assert.deepEqual(doc.components.schemas.SecretInventoryError.required, ['error']);
  }
  assert.deepEqual(document.paths[path].get.security, [{ bearerAuth: [] }]);
});

test('inventory prefix exception keeps other platform paths subject to the existing family gate', () => {
  assert.deepEqual(collectPublicApiViolations(), []);
  const changed = structuredClone(document);
  changed.paths['/v1/secrets/other'] = changed.paths[path];
  delete changed.paths[path];
  assert.ok(collectPublicApiViolations({ document: changed }).some(error => error.includes('/v1/secrets/other must use one of the allowed prefixes')));
});
