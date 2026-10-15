import assert from 'node:assert/strict';

export const routeKey = ({ method, path }) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`;
export const openapiRoutes = document => Object.entries(document.paths).flatMap(([path, methods]) => Object.entries(methods)
  .filter(([method]) => ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method))
  .map(([method, operation]) => ({ method, path, operation })));

// server.mjs merges exact method/path keys with seed precedence; normalize parameter names only afterwards.
export function effectiveRoutes(seed, runtime) {
  return [...new Map([...runtime, ...seed].map(route => [`${route.method} ${route.path}`, route])).values()];
}

export function assertPublication({ entries, seed, runtime, document, generated, gateway }) {
  const sources = { routing: effectiveRoutes(seed, runtime), openapi: openapiRoutes(document), generated, gateway };
  for (const entry of entries) {
    assert.ok(['PUBLISH', 'EXCLUDE'].includes(entry.disposition), `${entry.id} is unresolved`);
    assert.ok(entry.inventory_index === null || Number.isInteger(entry.inventory_index));
    if (entry.disposition === 'EXCLUDE') {
      assert.ok(entry.reason?.trim(), `${entry.id} requires an exclusion reason`);
      if (!entry.path) continue;
    } else {
      assert.ok(entry.source, `${entry.id} requires routing source evidence`);
    }
    const key = routeKey(entry);
    for (const [name, routes] of Object.entries(sources)) {
      if (entry.disposition === 'EXCLUDE' && !['openapi', 'gateway'].includes(name)) continue;
      const present = routes.some(route => routeKey(route) === key);
      assert.equal(present, entry.disposition === 'PUBLISH', `${name}: ${entry.disposition} ${key}`);
    }
  }
}
