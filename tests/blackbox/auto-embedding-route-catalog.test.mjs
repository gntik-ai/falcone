// Black-box test suite for change add-write-time-auto-embedding — public route catalog gate.
// The catalog at deploy/gateway-config/public-route-catalog.json is the AUTHORITATIVE
// allow-list: a path not present there is rejected (404-before-route) at the gateway.
// These tests assert the public-facing embedding-mapping routes are present with the correct
// privilege_domain (structural_admin — mapping config is operator-level, consistent with the
// embedding-provider routes), and that they are never mis-domained as data_access.
//
// Tests: bbx-auto-emb-route-01 .. bbx-auto-emb-route-03
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

// bbx-auto-emb-route-01: configure embedding mapping is structural_admin.
test('bbx-auto-emb-route-01: POST /v1/collections/{name}/embedding-mapping is structural_admin', () => {
  assert.ok(has('POST', '/v1/collections/{name}/embedding-mapping', 'structural_admin'));
});

// bbx-auto-emb-route-02: remove embedding mapping is structural_admin.
test('bbx-auto-emb-route-02: DELETE /v1/collections/{name}/embedding-mapping is structural_admin', () => {
  assert.ok(has('DELETE', '/v1/collections/{name}/embedding-mapping', 'structural_admin'));
});

// bbx-auto-emb-route-03: mapping config must NEVER be data_access (privilege drift guard).
test('bbx-auto-emb-route-03: embedding-mapping is not mis-domained as data_access', () => {
  assert.ok(!has('POST', '/v1/collections/{name}/embedding-mapping', 'data_access'), 'mapping config must stay structural_admin');
  assert.ok(!has('DELETE', '/v1/collections/{name}/embedding-mapping', 'data_access'), 'mapping config must stay structural_admin');
});
