import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes as seedRoutes } from '../../../apps/control-plane/routes.mjs';

// Faithfully mirror compilePath/loadRoutes/matchRoute in control-plane/server.mjs.
// Importing that listener would require production dependencies and bind sockets.
function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

export function loadFunctionRuntimeRoutes(seeds = seedRoutes, extra = JSON.parse(readFileSync(
  new URL('../../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8',
))) {
  const byKey = new Map();
  for (const route of [...extra, ...seeds]) byKey.set(`${route.method} ${route.path}`, route);
  const routes = [...byKey.values()].map((route) => ({ ...route, _rx: compilePath(route.path) }));
  routes.sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
    || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
  return routes;
}

export function assertFunctionsServed(publicRoutes, runtimeRoutes = loadFunctionRuntimeRoutes()) {
  const missing = publicRoutes.filter((route) => route.family === 'functions' && !runtimeRoutes.some(
    (runtime) => (runtime.method === route.method || runtime.method === 'ANY')
      && runtime._rx.test(route.path.replace(/\{[^}]+\}/g, 'fixture-id')),
  ));
  assert.deepEqual(missing.map(({ method, path }) => `${method} ${path}`), [],
    `Unserved functions operations:\n${missing.map(({ method, path }) => `${method} ${path}`).join('\n')}`);
}
