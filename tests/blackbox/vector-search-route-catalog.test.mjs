// Black-box test suite for change add-vector-search — public route catalog gate.
// The catalog at deploy/gateway-config/public-route-catalog.json is the AUTHORITATIVE
// allow-list: a path not present there is rejected (404-before-route) at the gateway.
// These tests assert the five new vector routes are present with the correct
// privilege_domain, and that no vector path is silently mis-domained.
//
// Tests: bbx-vec-route-01 .. bbx-vec-route-06
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const catalog = JSON.parse(readFileSync(resolve(REPO, 'deploy/gateway-config/public-route-catalog.json'), 'utf8'));

function has(method, path, domain) {
  return catalog.some((r) => r.method === method && r.path === path && r.privilege_domain === domain);
}

// bbx-vec-route-01: search route is data_access.
test('bbx-vec-route-01: POST /v1/collections/{name}/search is data_access', () => {
  assert.ok(has('POST', '/v1/collections/{name}/search', 'data_access'), 'search route present as data_access');
});

// bbx-vec-route-02: create vector index is structural_admin.
test('bbx-vec-route-02: POST /v1/collections/{name}/vector-indexes is structural_admin', () => {
  assert.ok(has('POST', '/v1/collections/{name}/vector-indexes', 'structural_admin'));
});

// bbx-vec-route-03: delete vector index is structural_admin.
test('bbx-vec-route-03: DELETE /v1/collections/{name}/vector-indexes/{indexName} is structural_admin', () => {
  assert.ok(has('DELETE', '/v1/collections/{name}/vector-indexes/{indexName}', 'structural_admin'));
});

// bbx-vec-route-04: set embedding provider is structural_admin.
test('bbx-vec-route-04: PUT /v1/workspaces/{id}/embedding-provider is structural_admin', () => {
  assert.ok(has('PUT', '/v1/workspaces/{id}/embedding-provider', 'structural_admin'));
});

// bbx-vec-route-05: remove embedding provider is structural_admin.
test('bbx-vec-route-05: DELETE /v1/workspaces/{id}/embedding-provider is structural_admin', () => {
  assert.ok(has('DELETE', '/v1/workspaces/{id}/embedding-provider', 'structural_admin'));
});

// bbx-vec-route-06: the search route must NEVER be structural_admin (privilege drift guard).
test('bbx-vec-route-06: the search route is not mis-domained as structural_admin', () => {
  assert.ok(!has('POST', '/v1/collections/{name}/search', 'structural_admin'), 'search must stay data_access');
  // And vector-index management must NEVER be data_access.
  assert.ok(!has('POST', '/v1/collections/{name}/vector-indexes', 'data_access'), 'index mgmt must stay structural_admin');
});
