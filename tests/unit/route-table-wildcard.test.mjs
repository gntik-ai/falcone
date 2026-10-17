import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePath as compileProductPath, loadRoutes, matchRoute } from '../../apps/control-plane/route-table.mjs';
import { routes as seedRoutes } from '../../apps/control-plane/routes.mjs';
import { matchRoute as matchActionRunnerRoute } from '../env/action-runner/routes.mjs';
import { startMetricsServer } from './helpers/control-plane-metrics-server.mjs';

const runtimeRoutes = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));
const schedulingPath = '/v1/scheduling/*';
const matchingPaths = [
  '/v1/scheduling',
  '/v1/scheduling/',
  '/v1/scheduling/jobs',
  '/v1/scheduling/jobs/j1',
  '/v1/scheduling/jobs/j1/pause',
  '/v1/scheduling/config',
  '/v1/scheduling/summary',
];
const otherPaths = [
  '/v1/schedulingx',
  '/v1/scheduling-jobs',
  '/v1/other/jobs',
];

// Local verbatim pre-fix compilePath reference, with only the export omitted.
function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)         // escape regex metas (our { } handled next)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')    // {param} -> named group
    .replace(/\/\\\*$/, '(?:/.*)?')                          // trailing /* -> optional rest
    .replace(/\\\*/g, '.*');                                 // bare * -> rest
  return new RegExp('^' + rx + '/?$');
}

test('trailing wildcard matches the scheduling prefix and every subpath', () => {
  const regex = compileProductPath(schedulingPath);
  for (const path of matchingPaths) assert.ok(regex.test(path), path);
});

test('trailing wildcard does not match other path prefixes', () => {
  const regex = compileProductPath(schedulingPath);
  for (const path of otherPaths) assert.equal(regex.test(path), false, path);
});

test('non-trailing wildcard matches arbitrary text', () => {
  const regex = compileProductPath('/v1/files/*.json');
  assert.ok(regex.test('/v1/files/report.json'));
  assert.equal(regex.test('/v1/files/reportXjson'), false);
});

test('parameter templates still capture named groups', () => {
  const match = compileProductPath('/v1/a/{id}/b').exec('/v1/a/x1/b');
  assert.ok(match);
  assert.equal(match.groups.id, 'x1');
});

test('a dot in a template matches only a literal dot', () => {
  const regex = compileProductPath('/v1/a.b');
  assert.ok(regex.test('/v1/a.b'));
  assert.equal(regex.test('/v1/axb'), false);
});

test('all non-wildcard runtime and seed routes keep their pre-fix regex source', () => {
  for (const route of [...runtimeRoutes, ...seedRoutes]) {
    if (route.path.includes('*')) continue;
    assert.equal(compileProductPath(route.path).source, compilePath(route.path).source,
      `${route.method} ${route.path}`);
  }
});

test('runtime and seed routes resolve scheduling subpaths to the ANY wildcard', () => {
  const matched = matchRoute(loadRoutes(runtimeRoutes, seedRoutes), 'GET', '/v1/scheduling/jobs');
  assert.ok(matched);
  assert.equal(matched.route.path, schedulingPath);
  assert.equal(matched.route.method, 'ANY');
});

test('a literal scheduling route takes precedence over the wildcard', () => {
  const literal = { method: 'GET', path: '/v1/scheduling/summary' };
  const routes = loadRoutes([...runtimeRoutes, literal], seedRoutes);
  const matched = matchRoute(routes, 'GET', literal.path);
  assert.ok(matched);
  assert.equal(matched.route.path, literal.path);
  assert.equal(matched.route.method, 'GET');
});

test('product routing agrees with the action-runner scheduling route for every sample', () => {
  const routes = loadRoutes(runtimeRoutes, seedRoutes);
  for (const path of [...matchingPaths, ...otherPaths]) {
    const harnessMatches = matchActionRunnerRoute('GET', path)?.route.name === 'scheduling';
    const productMatches = matchRoute(routes, 'GET', path)?.route.path === schedulingPath;
    assert.equal(productMatches, harnessMatches, path);
  }
});

test('unauthenticated scheduling subpaths reach authentication over HTTP', async (t) => {
  const server = await startMetricsServer();
  for (const path of [
    '/v1/scheduling/jobs',
    '/v1/scheduling/config',
    '/v1/scheduling/jobs/j1/pause',
  ]) {
    await t.test(path, async () => {
      const response = await server.request(path);
      assert.equal(response.status, 401);
      assert.equal(JSON.parse(response.body).code, 'UNAUTHENTICATED');
    });
  }
});
