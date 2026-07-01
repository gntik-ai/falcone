import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { matchRoute as matchActionRunnerRoute } from '../env/action-runner/routes.mjs';

const SELF_PATH = '/v1/workspaces/{workspaceId}/consumption';
const ADMIN_PATH = '/v1/tenants/{tenantId}/workspaces/{workspaceId}/consumption';
const HANDLER = '/repo/services/provisioning-orchestrator/src/actions/workspace-consumption-get.mjs';

const runtimeRouteMap = JSON.parse(readFileSync(new URL('../../deploy/kind/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));

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

function matchRuntimeRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

test('fix-739-00: kind runtime routes workspace consumption self and admin paths', () => {
  const compiled = compileRoutes(runtimeRouteMap);

  const self = matchRuntimeRoute(compiled, 'GET', '/v1/workspaces/ws-prod/consumption');
  assert.ok(self, 'GET /v1/workspaces/{workspaceId}/consumption must be routed, not NO_ROUTE');
  assert.equal(self.route.path, SELF_PATH);
  assert.equal(self.route.module, HANDLER);
  assert.equal(self.route.invoke, 'callercontext-overrides');
  assert.deepEqual(self.route.deps, ['db']);
  assert.equal(self.route.auth, 'authenticated');
  assert.deepEqual({ ...self.params }, { workspaceId: 'ws-prod' });

  const admin = matchRuntimeRoute(compiled, 'GET', '/v1/tenants/pro-corp/workspaces/ws-prod/consumption');
  assert.ok(admin, 'explicit tenant workspace consumption route must remain routed');
  assert.equal(admin.route.path, ADMIN_PATH);
  assert.equal(admin.route.module, HANDLER);
  assert.equal(admin.route.invoke, 'callercontext-overrides');
  assert.deepEqual(admin.route.deps, ['db']);
  assert.equal(admin.route.auth, 'authenticated');
  assert.deepEqual({ ...admin.params }, { tenantId: 'pro-corp', workspaceId: 'ws-prod' });
});

test('fix-739-01: action-runner routes workspace consumption self and admin paths', () => {
  const self = matchActionRunnerRoute('GET', '/v1/workspaces/ws-prod/consumption');
  assert.ok(self, 'test action-runner must route the console self workspace consumption path');
  assert.equal(self.route.name, 'workspace-consumption-self');
  assert.equal(self.route.module, HANDLER);
  assert.equal(self.route.invoke, 'params-callercontext-overrides');
  assert.deepEqual(self.route.deps, ['db']);
  assert.deepEqual({ ...self.params }, { workspaceId: 'ws-prod' });

  const admin = matchActionRunnerRoute('GET', '/v1/tenants/pro-corp/workspaces/ws-prod/consumption');
  assert.ok(admin, 'test action-runner must keep the explicit tenant workspace consumption path');
  assert.equal(admin.route.name, 'workspace-consumption-admin');
  assert.equal(admin.route.module, HANDLER);
  assert.equal(admin.route.invoke, 'params-callercontext-overrides');
  assert.deepEqual(admin.route.deps, ['db']);
  assert.deepEqual({ ...admin.params }, { tenantId: 'pro-corp', workspaceId: 'ws-prod' });
});
