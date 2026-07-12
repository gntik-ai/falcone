/**
 * Regression test for fix-785-function-update-patch-route (#785).
 *
 * Bug: the web console's "Actualizar función" submits `PATCH /v1/functions/actions/{id}`
 * (the canonical `updateFunctions` operation), but the kind control-plane registered the
 * by-id update route as `PUT` only. The server's `matchRoute` is exact-method, so a PATCH
 * request found no route and returned `404 {code:'NO_ROUTE', message:'No action mapped for
 * PATCH …'}`. Function updates from the console were permanently broken.
 *
 * Fix: register the kind-CP by-id update route as `PATCH` (replacing the drifted `PUT`),
 * matching the published `updateFunctions` (PATCH) contract.
 *
 * This test is RED on `main` (route is `PUT` → matchRoute('PATCH', …) returns null) and
 * GREEN on the branch (route is `PATCH` → resolves to the `fnDeploy` update handler). It is
 * fully self-contained: no network, no cluster, no DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { routes } from '../../apps/control-plane/routes.mjs';

const BY_ID_PATH = '/v1/functions/actions/{actionId}';

// ---- faithful copy of the kind-CP route matcher --------------------------------------------
// Importing `server.mjs` has import-time side effects (it builds a runtime, reads env, etc.),
// so we mirror the two relevant functions verbatim from
// apps/control-plane/server.mjs (compilePath: lines 96-103, matchRoute: lines 117-124)
// to prove the console's PATCH request resolves through the real matching logic.
function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m) // escape regex metas (our { } handled next)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)') // {param} -> named group
    .replace(/\/\\\*$/, '(?:/.*)?') // trailing /* -> optional rest
    .replace(/\\\*/g, '.*'); // bare * -> rest
  return new RegExp('^' + rx + '/?$');
}

function matchRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

const COMPILED = routes.map((r) => ({ ...r, _rx: compilePath(r.path) }));

// ---- contract source of truth (avoid hardcoding the expected method) -----------------------
// packages/internal-contracts/src/public-route-catalog.json declares the canonical method for
// the `updateFunctions` operation on the by-id actions path.
function contractUpdateFunctionsMethod() {
  const catalogUrl = new URL(
    '../../packages/internal-contracts/src/public-route-catalog.json',
    import.meta.url,
  );
  const catalog = JSON.parse(readFileSync(fileURLToPath(catalogUrl), 'utf8'));
  const entries = Array.isArray(catalog) ? catalog : catalog.routes ?? Object.values(catalog).flat();
  const entry = entries.find(
    (e) => e && e.operationId === 'updateFunctions',
  );
  assert.ok(entry, 'updateFunctions entry not found in public-route-catalog.json');
  return entry.method;
}

test('fix-785-00: the by-id function-update route is registered as exactly one PATCH → fnDeploy', () => {
  const updateEntries = routes.filter(
    (r) => r.path === BY_ID_PATH && r.localHandler === 'fnDeploy',
  );
  assert.equal(
    updateEntries.length,
    1,
    `expected exactly one fnDeploy update entry for ${BY_ID_PATH}, found ${updateEntries.length}`,
  );
  assert.equal(updateEntries[0].method, 'PATCH');
  assert.equal(updateEntries[0].auth, 'authenticated');

  // The drifted PUT must be gone (clean replace, not a leftover alias).
  const putEntry = routes.find((r) => r.path === BY_ID_PATH && r.method === 'PUT');
  assert.equal(putEntry, undefined, 'stale PUT registration for the by-id update route must be removed');
});

test('fix-785-01: a console PATCH /v1/functions/actions/{id} resolves to the update handler (not 404 NO_ROUTE)', () => {
  // WHEN the console submits the function-update request (PATCH) for an existing action.
  const hit = matchRoute(COMPILED, 'PATCH', '/v1/functions/actions/act_123');

  // THEN the kind control-plane dispatches it to the update/redeploy handler — NOT null.
  // Pre-fix (route was PUT) this returned `null` → server.mjs answers 404 NO_ROUTE
  // ("No action mapped for PATCH …"), the exact symptom in the issue.
  assert.ok(hit, 'PATCH /v1/functions/actions/{id} must resolve to a route (pre-fix: null → 404 NO_ROUTE)');
  assert.equal(hit.route.localHandler, 'fnDeploy');
  assert.equal(hit.route.path, BY_ID_PATH);
  assert.equal(hit.params.actionId, 'act_123');
});

test('fix-785-02: the registered update method equals the published updateFunctions (PATCH) contract', () => {
  const contractMethod = contractUpdateFunctionsMethod();
  assert.equal(contractMethod, 'PATCH', 'public-route-catalog updateFunctions method should be PATCH');

  const registered = routes.find((r) => r.path === BY_ID_PATH && r.localHandler === 'fnDeploy');
  assert.ok(registered, 'by-id update route not registered');
  assert.equal(
    registered.method,
    contractMethod,
    'kind-CP update route method must match the contract updateFunctions method',
  );
});
