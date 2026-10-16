import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');
const catalog = read('packages/internal-contracts/src/public-route-catalog.json');
const routes = read('apps/control-plane/route-map.json').filter(r => r.invoke === 'params-auth-db');

test('four secret rotation operations publish the route-map methods and paths once', () => {
  assert.equal(routes.length, 4);
  const operations = Object.entries(document.paths).flatMap(([path, methods]) => Object.entries(methods).filter(([, op]) => op.operationId).map(([method, op]) => ({ path, method: method.toUpperCase(), ...op })));
  for (const route of routes) {
    const matches = operations.filter(op => op.operationId === route.operationId);
    assert.equal(matches.length, 1, route.operationId);
    const op = matches[0];
    assert.equal(op.path, route.path);
    assert.equal(op.method, route.method);
    assert.equal(op['x-family'], 'platform');
    assert.equal(op.parameters.find(p => p.name === 'secretName').schema.pattern, '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
    assert.deepEqual(op.parameters.find(p => p.name === 'domain').schema.enum, ['platform', 'gateway', 'iam', 'functions', 'tenant']);
    assert.ok(!op.parameters.some(p => ['secretPath', 'tenantId'].includes(p.name)));
    const entries = catalog.routes.filter(entry => entry.operationId === route.operationId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, route.path);
    assert.equal(entries[0].method, route.method);
    for (const status of ['400', '403']) assert.equal(op.responses[status].content['application/json'].schema.$ref, '#/components/schemas/SecretRotationErrorBody');
    for (const status of ['200', '401', '429', '431', '504', ...(route.method === 'POST' ? ['413'] : [])]) assert.ok(op.responses[status], `${route.operationId} ${status}`);
  }
});

test('quality CI always runs the two secret rotation blackbox regressions', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.quality.steps.find(step => step.name === 'Secret rotation regressions');
  assert.ok(step);
  assert.equal(step.if, undefined);
  assert.deepEqual(step.run.replace(/\\\n/g, ' ').trim().split(/\s+/), [
    'node', '--test', 'tests/blackbox/secret-consumer-status-cross-tenant.test.mjs', 'tests/blackbox/control-plane-image-imports.test.mjs'
  ]);
});
