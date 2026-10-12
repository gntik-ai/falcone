import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');
const catalog = read('packages/internal-contracts/src/public-route-catalog.json');
const taxonomy = read('packages/internal-contracts/src/public-api-taxonomy.json');
const streams = [
  ['/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes', ['insert', 'replace', 'delete']],
  ['/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes', ['insert', 'update', 'delete']],
];

test('both realtime GET streams publish source-specific events, auth precedence and errors', () => {
  assert.ok(taxonomy.families.some(family => family.id === 'realtime-changes'));
  for (const [path, events] of streams) {
    const operation = document.paths[path]?.get;
    assert.ok(operation, `missing GET ${path}`);
    assert.deepEqual(Object.keys(document.paths[path]), ['get']);
    assert.deepEqual(operation['x-realtime-event-types'], events);
    assert.ok(operation.responses['200'].content['text/event-stream']);
    assert.match(operation.description, /header.*precedence/i);
    assert.match(operation.description, /non-flc_/);
    assert.match(operation.responses['401'].description, /UNAUTHENTICATED/);
    assert.match(operation.responses['403'].description, /FORBIDDEN/);
    assert.match(operation.responses['501'].description, /REALTIME_DISABLED/);
    assert.match(operation.responses['200'].description, /WORKSPACE_DB_UNRESOLVED/);
    assert.ok(operation.security.some(requirement => 'realtimeQueryKey' in requirement));
    assert.ok(!operation.parameters.some(parameter => parameter.in === 'header' && parameter.required));
    const route = catalog.routes.find(route => route.path === path && route.method === 'GET');
    assert.equal(route?.family, 'realtime-changes');
    assert.deepEqual(route.realtimeEventTypes, events);
    assert.deepEqual(route.responseContentTypes, ['text/event-stream']);
  }
});
