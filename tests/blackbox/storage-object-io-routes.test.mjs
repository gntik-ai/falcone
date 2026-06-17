// add-wire-advertised-public-routes (#500): object I/O (upload/download/delete) was advertised but
// NO_ROUTE. Assert the runtime now wires GET/PUT/DELETE for a single object to tenant-scoped
// storage handlers, and that the published catalog advertises the same (real) path — closing the
// catalog↔runtime gap for object storage. Pure: imports the route table + handler map; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { routes } from '../../deploy/kind/control-plane/routes.mjs';
import { STORAGE_HANDLERS } from '../../deploy/kind/control-plane/storage-handlers.mjs';

const OBJECT_PATH = '/v1/storage/buckets/{bucketId}/objects/{objectKey}';

test('object I/O (PUT/GET/DELETE) is wired to storage handlers', () => {
  for (const method of ['PUT', 'GET', 'DELETE']) {
    const route = routes.find((r) => r.method === method && r.path === OBJECT_PATH);
    assert.ok(route, `${method} ${OBJECT_PATH} is registered (not NO_ROUTE)`);
    assert.ok(typeof STORAGE_HANDLERS[route.localHandler] === 'function', `${route.localHandler} handler exists`);
    assert.equal(route.auth, 'authenticated', `${method} object I/O requires auth`);
  }
});

test('the published catalog advertises the real (wired) object I/O path, not the unwired /v1/objects', () => {
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../services/gateway-config/public-route-catalog.json', import.meta.url)), 'utf8'));
  const paths = new Set(catalog.map((r) => r.path));
  assert.ok(paths.has(OBJECT_PATH), 'catalog advertises the wired storage object path');
  assert.ok(!paths.has('/v1/objects/{bucket}/{key}'), 'the old unwired generic object path is gone');
  // Pruned zero-handler routes no longer advertised.
  for (const dead of ['/v1/analytics/query', '/v1/services/configure', '/v1/functions/{id}/config']) {
    assert.ok(!paths.has(dead), `dead route ${dead} pruned from the catalog`);
  }
});
