import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');
const catalog = read('packages/internal-contracts/src/public-route-catalog.json');
const taxonomy = read('packages/internal-contracts/src/public-api-taxonomy.json');

for (const [path, operationId, eventTypes, schemaName] of [
  ['/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes', 'streamCollectionChanges', ['insert', 'replace', 'delete'], 'CollectionChangeEvent'],
  ['/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes', 'streamTableChanges', ['insert', 'update', 'delete'], 'TableChangeEvent'],
]) {
  test(`${operationId} is published as GET SSE with its source event contract`, () => {
    const operation = document.paths[path]?.get;
    assert.ok(operation, 'OpenAPI operation must exist');
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(Object.keys(document.paths[path]), ['get']);
    assert.equal(operation['x-family'], 'realtime');
    assert.equal(operation.parameters.some((parameter) => parameter.in === 'header' && parameter.required), false, 'EventSource cannot set required custom headers');
    assert.ok(operation.parameters.some((parameter) => parameter.name === 'apikey' && parameter.in === 'query' && parameter.required === false));
    assert.equal(operation.responses['200'].content['text/event-stream'].schema.type, 'string');
    assert.deepEqual(document.components.schemas[schemaName].properties.type.enum, eventTypes);
    assert.deepEqual(document.components.schemas[schemaName].required, ['type', 'documentId', 'document']);
    for (const status of ['401', '403', '501']) assert.ok(operation.responses[status].content['application/json']);
    if (operationId === 'streamTableChanges') {
      assert.ok(operation.responses['400'].content['application/json']);
      assert.ok(operation.responses['500']?.content['application/json'], 'pre-stream database failures must declare a JSON error');
      assert.match(operation.responses['500'].description, /CONTROL_PLANE_ERROR.*before streaming/i);
    } else {
      assert.equal(operation.responses['400'], undefined, 'collection stream does not validate PostgreSQL identifiers');
    }
    assert.match(operation.description, /header.*query.*bearer/i);
    assert.match(operation.description, /exactly one.*error.*ends/i);
    const route = catalog.routes.find((entry) => entry.operationId === operationId);
    assert.ok(route, 'public catalog operation must exist');
    assert.equal(route.path, path);
    assert.equal(route.method, 'GET');
    assert.equal(route.family, 'realtime');
    assert.equal(route.gatewayAuthMode, 'query_api_key_sse');
    assert.equal(route.correlationIdRequired, false);
    assert.deepEqual(route.tags, ['Realtime']);
    assert.deepEqual(route.responseContentTypes, ['text/event-stream']);
    assert.deepEqual(route.eventTypes, [...eventTypes, 'error']);
    assert.ok(taxonomy.families.some((family) => family.id === 'realtime'));
  });
}

test('route catalog exposes gateway-facing auth and context metadata for every operation', () => {
  const routeCatalog = catalog;
  const ssePaths = new Map([
    ['streamCollectionChanges', '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes'],
    ['streamTableChanges', '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes']
  ]);

  for (const route of routeCatalog.routes) {
    assert.equal(typeof route.gatewayAuthMode, 'string');
    assert.equal(typeof route.gatewayRouteClass, 'string');
    assert.equal(typeof route.gatewayQosProfile, 'string');
    assert.equal(typeof route.gatewayRequestValidationProfile, 'string');
    assert.equal(Array.isArray(route.gatewayAllowedHeaders), true);
    assert.equal(Array.isArray(route.gatewayContextHeaders), true);
    assert.equal(Array.isArray(route.allowedContentTypes), true);
    assert.equal(route.gatewayAllowedHeaders.includes('Authorization'), true);
    assert.equal(route.gatewayAllowedHeaders.includes('X-API-Version'), true);
    if (ssePaths.has(route.operationId)) {
      assert.equal(route.path, ssePaths.get(route.operationId));
      assert.equal(route.family, 'realtime');
      assert.equal(route.method, 'GET');
      assert.equal(route.gatewayAuthMode, 'query_api_key_sse');
      assert.deepEqual(route.gatewayContextHeaders, [], 'SSE identity is resolved by the executor');
    } else {
      assert.notEqual(route.gatewayAuthMode, 'query_api_key_sse', 'SSE auth must remain limited to the two change-stream operations');
      assert.equal(route.gatewayContextHeaders.includes('X-Auth-Subject'), true, route.operationId);
    }
    assert.equal(route.errorEnvelope, 'ErrorResponse');
    assert.equal(route.internalRequestMode, 'validated_attestation');
    assert.ok(route.maxRequestBodyBytes > 0);
  }
});
