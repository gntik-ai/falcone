import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { routeKey, openapiRoutes } from './helpers/console-publication.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const fixture = read('tests/contracts/fixtures/gateway-only-reconciled.json');
function snapshot() {
  return { operations: openapiRoutes(read('apps/control-plane-executor/openapi/control-plane.openapi.json')),
    routes: read('packages/internal-contracts/src/public-route-catalog.json').routes };
}
function crossCheck({ operations, routes }) {
  for (const row of fixture.rows) {
    for (const [boundary, entries] of Object.entries({ openapi: operations, catalogue: routes })) {
      const matches = entries.filter(entry => routeKey(entry) === routeKey(row));
      assert.equal(matches.length, 1, `${boundary}: row ${row.n} ${routeKey(row)}`);
      assert.equal(matches[0].operation?.operationId ?? matches[0].operationId, row.operationId, `${boundary}: row ${row.n} operationId`);
    }
  }
}

test('the amendment pins 43 console call sites, with 21 additions and 22 existing publications', () => {
  assert.deepEqual(fixture.provenance, { source: 'engineering_control.engineering.ui_inventory',
    commit: '4d0968a8c87c8b6083ef389da0b5b35a3c152840', sha256: 'ae4257b7a01f1c6acb362caa157ddb7476c6dabad87c927ace9e05a3955a6231' });
  assert.deepEqual(fixture.rows.map(row => row.n), Array.from({ length: 43 }, (_, i) => i + 1));
  assert.equal(fixture.rows.filter(row => row.disposition === 'TO_PUBLISH').length, 21);
  assert.equal(fixture.rows.filter(row => row.disposition === 'ALREADY_PUBLISHED').length, 22);
  for (const row of fixture.rows) {
    assert.match(row.console_file, /^apps\/web-console\/src\//);
    assert.ok(existsSync(new URL(`../../${row.console_file}`, import.meta.url)), row.console_file);
  }
  for (const n of [2, 36]) assert.equal(fixture.rows[n - 1].method, 'GET');
  assert.equal(fixture.rows[33].operationId, 'listPostgresDataRows');
  assert.equal(fixture.rows[35].operationId, 'listPostgresDataRows');
});

test('each call site matches exactly one OpenAPI operation and one generated catalogue entry', () => crossCheck(snapshot()));

for (const boundary of ['operations', 'routes']) {
  for (const mutation of ['missing', 'duplicate', 'wrong operationId']) {
    test(`${boundary} rejects a ${mutation} publication`, () => {
      const data = snapshot();
      // Mutate a newly published row independently at each boundary.
      const index = data[boundary].findIndex(entry => routeKey(entry) === routeKey(fixture.rows[1]));
      if (mutation === 'missing') data[boundary].splice(index, 1);
      if (mutation === 'duplicate') data[boundary].push(structuredClone(data[boundary][index]));
      if (mutation === 'wrong operationId') {
        const entry = data[boundary][index];
        (entry.operation ?? entry).operationId = 'wrongOperation';
      }
      assert.throws(() => crossCheck(data), /(?:openapi|catalogue): row 2\b/);
    });
  }
}

test('every addition reaches authentication rather than NO_ROUTE', async () => {
  const server = createControlPlaneServer({ registry: {}, flowExecutor: {}, flowMonitoringExecutor: {} });
  for (const row of fixture.rows.filter(row => row.disposition === 'TO_PUBLISH')) {
    const req = Readable.from([]);
    Object.assign(req, { method: row.method, url: row.path.replaceAll('{}', 'fixture'), headers: {} });
    const chunks = [];
    const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
    res.setHeader = () => {};
    res.writeHead = status => { res.statusCode = status; return res; };
    await server.listeners('request')[0](req, res);
    assert.equal(res.statusCode, 401, `row ${row.n}`);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).code, 'UNAUTHENTICATED', `row ${row.n}`);
  }
});

test('new operations retain mandatory publication metadata and shared gateway responses', () => {
  const data = snapshot();
  for (const row of fixture.rows.filter(row => row.disposition === 'TO_PUBLISH')) {
    const operation = data.operations.find(op => routeKey(op) === routeKey(row)).operation;
    assert.equal(operation['x-family'], row.n === 37 ? 'postgres' : row.n >= 40 ? 'workspaces' : 'flows');
    assert.equal(operation['x-scope'], 'workspace');
    assert.equal(operation['x-visibility'], 'public');
    assert.ok(operation['x-resource-type']);
    assert.equal(operation['x-tenant-binding'], 'required');
    assert.equal(operation['x-workspace-binding'], 'required');
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    for (const status of ['429', '431', '504', ...(row.method === 'GET' ? [] : ['413'])]) assert.ok(operation.responses[status], `row ${row.n}: ${status}`);
    if (row.method !== 'GET') assert.ok(operation.parameters.some(p => p.$ref === '#/components/parameters/IdempotencyKey'));
  }
});
