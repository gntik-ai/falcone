import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { openapiRoutes, routeKey } from './helpers/console-publication.mjs';
import { request } from './helpers/gateway-only-http.mjs';
import { buildFamilyDocument, buildPublicApiDocs, buildRouteCatalog, readPublicApiTaxonomy } from '../../scripts/lib/public-api.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const manifest = read('tests/contracts/fixtures/gateway-only-reconciled.json');
const snapshot = () => ({ manifest: structuredClone(manifest),
  document: read('apps/control-plane-executor/openapi/control-plane.openapi.json'),
  catalog: read('packages/internal-contracts/src/public-route-catalog.json').routes });
const toPublish = [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 37, 40, 41, 42, 43];

function assertReconciled({ manifest: { provenance, rows }, document, catalog }) {
  assert.equal(provenance.inventory_commit, '4d0968a8c87c8b6083ef389da0b5b35a3c152840');
  assert.equal(provenance.inventory_sha256, 'ae4257b7a01f1c6acb362caa157ddb7476c6dabad87c927ace9e05a3955a6231');
  assert.equal(rows.length, 43, '43 pinned rows');
  assert.deepEqual(rows.map(r => r.n), Array.from({ length: 43 }, (_, i) => i + 1), 'unique amendment row numbers');
  assert.deepEqual(rows.filter(r => r.disposition === 'TO_PUBLISH').map(r => r.n), toPublish);
  assert.equal(rows.filter(r => r.disposition === 'ALREADY_PUBLISHED').length, 22);
  const source = openapiRoutes(document);
  for (const row of rows) {
    assert.ok(['TO_PUBLISH', 'ALREADY_PUBLISHED'].includes(row.disposition));
    assert.match(row.console_file, /^(pages|services|lib)\/[A-Za-z0-9_./-]+\.(ts|tsx)$/);
    assert.ok(!row.console_file.split('/').includes('..'));
    assert.ok(existsSync(new URL(`../../apps/web-console/src/${row.console_file}`, import.meta.url)), `row ${row.n}: console file exists`);
    const key = routeKey(row);
    const duplicates = rows.filter(r => routeKey(r) === key);
    if (duplicates.length > 1) assert.deepEqual(duplicates.map(r => r.n), [34, 36], 'only rows 34 and 36 share a route');
    for (const [boundary, routes] of [['openapi', source], ['catalog', catalog]]) {
      const matches = routes.filter(r => routeKey(r) === key);
      assert.equal(matches.length, 1, `${boundary}: exactly one ${key}`);
      assert.equal(matches[0].operation?.operationId ?? matches[0].operationId, row.operationId, `${boundary}: operationId for row ${row.n}`);
    }
  }
  for (const n of [2, 36]) assert.equal(rows.find(r => r.n === n).method, 'GET');
  assert.equal(rows[33].operationId, 'listPostgresDataRows');
  assert.equal(rows[35].operationId, 'listPostgresDataRows');
}

test('43 amendment rows reconcile to exactly one OpenAPI operation and public catalogue entry each', () => {
  assertReconciled(snapshot());
});

test('each TO_PUBLISH endpoint reaches authentication rather than NO_ROUTE', async t => {
  const server = createControlPlaneServer({ registry: {}, flowExecutor: {}, flowMonitoringExecutor: {} });
  t.after(() => server.closeAllConnections());
  for (const row of manifest.rows.filter(r => r.disposition === 'TO_PUBLISH')) {
    const path = row.path.replaceAll('{}', 'fixture');
    const response = await request(server, row.method, path);
    assert.equal(response.status, 401, `row ${row.n}: must reach authentication`);
    assert.equal(response.body.code, 'UNAUTHENTICATED');
  }
});

for (const mutation of ['missing', 'duplicate', 'wrong operationId']) {
  test(`a ${mutation} fixture row fails reconciliation`, () => {
    const data = snapshot();
    if (mutation === 'missing') data.manifest.rows.splice(1, 1);
    if (mutation === 'duplicate') data.manifest.rows[1] = structuredClone(data.manifest.rows[0]);
    if (mutation === 'wrong operationId') data.manifest.rows[1].operationId = 'wrongOperation';
    assert.throws(() => assertReconciled(data), /43 pinned rows|unique amendment row numbers|operationId/);
  });
}

for (const boundary of ['openapi', 'catalog']) {
  for (const mutation of ['missing', 'duplicate', 'wrong operationId']) {
    test(`${boundary}: a ${mutation} operation fails reconciliation`, () => {
      const data = snapshot();
      const row = data.manifest.rows[1];
      if (boundary === 'openapi') {
        const { path, method, operation } = openapiRoutes(data.document).find(r => routeKey(r) === routeKey(row));
        if (mutation === 'missing') delete data.document.paths[path][method];
        if (mutation === 'duplicate') data.document.paths[path.replace('{workspaceId}', '{otherWorkspace}')] = { [method]: structuredClone(operation) };
        if (mutation === 'wrong operationId') operation.operationId = 'wrongOperation';
      } else {
        const index = data.catalog.findIndex(r => routeKey(r) === routeKey(row));
        if (mutation === 'missing') data.catalog.splice(index, 1);
        if (mutation === 'duplicate') data.catalog.push(structuredClone(data.catalog[index]));
        if (mutation === 'wrong operationId') data.catalog[index].operationId = 'wrongOperation';
      }
      assert.throws(() => assertReconciled(data), /exactly one|operationId/);
    });
  }
}

test('parameter names do not change reconciliation keys', () => {
  const data = snapshot();
  data.catalog = data.catalog.map(r => ({ ...r, path: r.path.replace(/\{[^}]+\}/g, '{parameter}') }));
  assertReconciled(data);
});

test('withdrawing the 21 unified operations removes their generated discovery entries', () => {
  const { document } = snapshot();
  const taxonomy = readPublicApiTaxonomy();
  const originalDocs = buildPublicApiDocs(document, taxonomy);
  const published = manifest.rows.filter(r => r.disposition === 'TO_PUBLISH');
  const docEntries = [];
  for (const row of published) {
    const { path, method } = openapiRoutes(document).find(r => routeKey(r) === routeKey(row));
    const docEntry = `| ${row.method} | \`${path}\` |`;
    assert.ok(originalDocs.includes(docEntry), 'published route must appear before withdrawal');
    docEntries.push(docEntry);
    delete document.paths[path][method];
    if (Object.keys(document.paths[path]).length === 0) delete document.paths[path];
  }
  const catalog = buildRouteCatalog(document, taxonomy);
  const docs = buildPublicApiDocs(document, taxonomy, catalog);
  const families = ['flows', 'postgres', 'workspaces'].flatMap(family => openapiRoutes(buildFamilyDocument(document, taxonomy, family)));
  for (const row of published) {
    assert.ok(!catalog.routes.some(r => routeKey(r) === routeKey(row)));
    assert.ok(!families.some(r => routeKey(r) === routeKey(row)));
  }
  for (const entry of docEntries) assert.ok(!docs.includes(entry));
  for (const row of manifest.rows.filter(r => r.disposition === 'ALREADY_PUBLISHED')) {
    assert.equal(catalog.routes.filter(r => routeKey(r) === routeKey(row)).length, 1);
  }
});
