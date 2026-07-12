import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { routes } from '../../apps/control-plane/routes.mjs';
import { AUTH_HANDLERS } from '../../apps/control-plane/auth-handlers.mjs';

const ROUTE_PATH = '/v1/auth/status-views/{statusViewId}';
const HANDLER = 'getConsoleAccountStatusView';

const runtimeRouteMap = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));
const fullRouteMap = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.json', import.meta.url), 'utf8'));
const authOpenApi = JSON.parse(readFileSync(new URL('../../apps/control-plane-executor/openapi/families/auth.openapi.json', import.meta.url), 'utf8'));

function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

function compileRoutes(routeTable) {
  return routeTable
    .map((r) => ({ ...r, _rx: compilePath(r.path) }))
    .sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
      || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
}

function matchRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

function contractStatusViews() {
  const values = authOpenApi.components?.schemas?.ConsoleStatusViewId?.enum;
  assert.ok(Array.isArray(values), 'ConsoleStatusViewId enum must exist in auth OpenAPI');
  return values;
}

function assertConsoleStatusViewShape(body, expectedStatusView) {
  assert.equal(body.statusView, expectedStatusView);
  assert.equal(typeof body.title, 'string');
  assert.ok(body.title.length >= 3);
  assert.equal(typeof body.message, 'string');
  assert.ok(body.message.length >= 3);
  assert.ok(Array.isArray(body.allowedActions));
  for (const action of body.allowedActions) {
    assert.equal(typeof action.actionId, 'string');
    assert.equal(typeof action.label, 'string');
    assert.equal(typeof action.target, 'string');
  }
}

test('fix-728-00: seed and runtime routes resolve pending_activation status view to the local handler', () => {
  const seedHit = matchRoute(compileRoutes(routes), 'GET', '/v1/auth/status-views/pending_activation');
  assert.ok(seedHit, 'seed routes must resolve status-views request (not NO_ROUTE)');
  assert.equal(seedHit.route.path, ROUTE_PATH);
  assert.equal(seedHit.route.localHandler, HANDLER);
  assert.equal(seedHit.route.auth, 'public');
  assert.equal(seedHit.params.statusViewId, 'pending_activation');

  const runtimeHit = matchRoute(compileRoutes(runtimeRouteMap), 'GET', '/v1/auth/status-views/pending_activation');
  assert.ok(runtimeHit, 'route-map.runtime.json must resolve status-views request loaded by kind image');
  assert.equal(runtimeHit.route.path, ROUTE_PATH);
  assert.equal(runtimeHit.route.localHandler, HANDLER);
  assert.equal(runtimeHit.route.auth, 'public');
  assert.equal(runtimeHit.params.statusViewId, 'pending_activation');
});

test('fix-728-01: public route-map catalog marks the status-view route as a local handler, not a gap', () => {
  const route = fullRouteMap.find((r) => r.operationId === 'getConsoleAccountStatusView');
  assert.ok(route, 'getConsoleAccountStatusView route-map.json entry must exist');
  assert.equal(route.method, 'GET');
  assert.equal(route.path, ROUTE_PATH);
  assert.equal(route.invoke, 'localHandler');
  assert.equal(route.module, 'apps/control-plane/auth-handlers.mjs');
  assert.equal(route.export, HANDLER);
  assert.equal(route.auth, 'public');
  assert.doesNotMatch(route.notes, /\bGAP\b/);
});

test('fix-728-02: pending_activation status view returns ConsoleAccountStatusView with 200', async () => {
  const handler = AUTH_HANDLERS[HANDLER];
  assert.equal(typeof handler, 'function');

  const res = await handler({ params: { statusViewId: 'pending_activation' } });
  assert.equal(res.statusCode, 200);
  assertConsoleStatusViewShape(res.body, 'pending_activation');
  assert.deepEqual(res.body.allowedActions, [], 'pending_activation lets the web console render page-specific actions');
});

test('fix-728-03: every contract ConsoleStatusViewId resolves through the public status-view handler', async () => {
  const handler = AUTH_HANDLERS[HANDLER];
  for (const statusViewId of contractStatusViews()) {
    const res = await handler({ params: { statusViewId } });
    assert.equal(res.statusCode, 200, `${statusViewId} should resolve to a status view`);
    assertConsoleStatusViewShape(res.body, statusViewId);
  }
});

test('fix-728-04: unknown status view returns structured 404', async () => {
  for (const statusViewId of ['not_a_real_view', 'toString']) {
    const res = await AUTH_HANDLERS[HANDLER]({ params: { statusViewId } });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'STATUS_VIEW_NOT_FOUND');
    assert.match(res.body.message, new RegExp(statusViewId));
  }
});
