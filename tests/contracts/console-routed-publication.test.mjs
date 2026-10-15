import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes as seed } from '../../apps/control-plane/routes.mjs';
import { assertPublication, routeKey } from './helpers/console-publication.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const entries = read('tests/contracts/fixtures/console-routed-unpublished-manifest.json').entries;
function snapshot() {
  return { entries, seed, runtime: read('apps/control-plane/route-map.runtime.json'),
    document: read('apps/control-plane-executor/openapi/control-plane.openapi.json'),
    generated: read('packages/internal-contracts/src/public-route-catalog.json').routes,
    gateway: read('deploy/gateway-config/public-route-catalog.json') };
}

test('M1-M9 are published at every contract boundary', () => {
  const data = snapshot();
  const mandatory = entries.filter(entry => /^M[1-9]$/.test(entry.id));
  assert.equal(mandatory.length, 9);
  assert.ok(mandatory.every(entry => entry.disposition === 'PUBLISH'));
  assertPublication({ ...data, entries: mandatory });
});

test('every manifest disposition is resolved across effective routing, OpenAPI and both catalogues', () => {
  assertPublication(snapshot());
});

test('generation preserves an explicitly unified-source operation when composing a maintained family', async () => {
  const { mergePublicApiFamilySource } = await import('../../scripts/lib/public-api-family-source.mjs');
  const operation = { 'x-family': 'storage', 'x-contract-source': 'unified', operationId: 'createWorkspaceStorageBucket' };
  const original = { info: { version: '1.22.0' }, paths: { '/v1/storage/workspaces/{workspaceId}/buckets': { post: operation } }, components: {} };
  const family = { paths: {}, components: {} };
  const result = mergePublicApiFamilySource(original, family, '1.22.0', 'storage');
  assert.deepEqual(result.paths, original.paths);
  assert.deepEqual(mergePublicApiFamilySource(result, { ...family, paths: { '/v1/storage/workspaces/{workspaceId}/buckets': { post: { ...operation, summary: 'stale generated copy' } } } }, '1.22.0', 'storage').paths, original.paths);
});

test('both identity-provider operations are mandatory PUBLISH with honest inventory attribution', () => {
  const providers = entries.filter(entry => entry.path?.endsWith('/auth-config/identity-providers/{alias}'));
  assert.deepEqual(providers.map(entry => entry.method).sort(), ['DELETE', 'PUT']);
  assert.ok(providers.every(entry => entry.disposition === 'PUBLISH' && entry.inventory_index === null));
  for (const entry of entries.filter(entry => entry.path)) {
    assert.match(entry.source, /^apps\/control-plane\/(routes\.mjs|route-map\.runtime\.json):\d+$/);
    const [file, line] = entry.source.split(':');
    assert.ok(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n')[Number(line) - 1].includes(entry.path), `${entry.id} source line must carry its path`);
  }
  for (const index of [229, 230]) {
    const entry = entries.find(entry => entry.inventory_index === index);
    assert.equal(entry.disposition, 'EXCLUDE');
    assert.equal(entry.path, null);
  }
});

test('removing the map-only async query fails, while deleting the shadowed plans map route preserves the seed', () => {
  const data = snapshot();
  const query = entries.find(entry => entry.path === '/v1/async-operation-query');
  assert.equal(query.disposition, 'PUBLISH');
  assert.throws(() => assertPublication({ ...data, runtime: data.runtime.filter(route => routeKey(route) !== routeKey(query)) }), /routing: PUBLISH POST \/v1\/async-operation-query/);
  assert.ok(data.runtime.some(route => route.method === 'GET' && route.path === '/v1/plans'));
  assertPublication({ ...data, runtime: data.runtime.filter(route => !(route.method === 'GET' && route.path === '/v1/plans')) });
});

for (const boundary of ['openapi', 'generated', 'gateway']) {
  test(`removing a PUBLISH operation from ${boundary} fails the manifest cross-check`, () => {
    const data = snapshot();
    if (boundary === 'openapi') delete data.document.paths['/v1/plans'].get;
    else data[boundary] = data[boundary].filter(route => !(route.method === 'GET' && route.path === '/v1/plans'));
    assert.throws(() => assertPublication(data), new RegExp(`${boundary}: PUBLISH GET /v1/plans`));
  });
}
for (const boundary of ['openapi', 'gateway']) {
  test(`publishing an EXCLUDE entry in ${boundary} fails the manifest cross-check`, () => {
    const data = snapshot();
    const entry = { id: 'excluded-fixture', inventory_index: null, method: 'GET', path: '/v1/excluded-fixture',
      disposition: 'EXCLUDE', reason: 'Synthetic excluded endpoint for the negative contract check.' };
    data.entries = [...entries, entry];
    if (boundary === 'openapi') data.document.paths[entry.path] = { [entry.method.toLowerCase()]: {} };
    else data.gateway.push({ method: entry.method, path: entry.path });
    assert.throws(() => assertPublication(data), new RegExp(`${boundary}: EXCLUDE`));
  });
}

test('gateway parity depends on normalized method/path and permits gateway-only privilege metadata', () => {
  const data = snapshot();
  data.gateway = data.gateway.map(route => ({ ...route, path: route.path.replace(/\{[^}]+\}/g, '{alias}'), privilege_domain: 'gateway-only-fixture' }));
  assertPublication(data);
});

test('unified-source additions retain their response schemas when an older generated family is composed', async () => {
  const { mergePublicApiFamilySource } = await import('../../scripts/lib/public-api-family-source.mjs');
  const original = { info: { version: '1.22.0' }, paths: { '/storage/addition': { post: {
    'x-family': 'storage', 'x-contract-source': 'unified', responses: { 201: { schema: { $ref: '#/components/schemas/Addition' } } }
  } } }, components: { schemas: { Addition: { type: 'object', required: ['databaseId'], properties: { databaseId: { type: 'string' } } } } } };
  const family = { paths: {}, components: { schemas: { Addition: { type: 'object' } } } };
  const result = mergePublicApiFamilySource(original, family, '1.22.0', 'storage');
  assert.deepEqual(result.components, original.components);
});
