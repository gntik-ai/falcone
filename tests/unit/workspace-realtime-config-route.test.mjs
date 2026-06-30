import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { routes } from '../../deploy/kind/control-plane/routes.mjs';
import { REALTIME_HANDLERS } from '../../deploy/kind/control-plane/realtime-handlers.mjs';

const ROUTE_PATH = '/v1/workspaces/{workspaceId}/realtime';
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

function matchRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

function fakeStore(workspace) {
  return {
    async getWorkspace(_pool, workspaceId) {
      assert.equal(workspaceId, 'ws-acme');
      return workspace;
    },
  };
}

function fakePool(rows) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows };
    },
  };
}

function withRealtimeEndpoint(value, run) {
  const prior = process.env.REALTIME_PUBLIC_ENDPOINT_URL;
  process.env.REALTIME_PUBLIC_ENDPOINT_URL = value;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (prior == null) delete process.env.REALTIME_PUBLIC_ENDPOINT_URL;
      else process.env.REALTIME_PUBLIC_ENDPOINT_URL = prior;
    });
}

test('fix-788-00: route table resolves GET /v1/workspaces/{workspaceId}/realtime to the local config handler', () => {
  const route = routes.find((r) => r.method === 'GET' && r.path === ROUTE_PATH);
  assert.ok(route, `${ROUTE_PATH} must be registered (not 404 NO_ROUTE)`);
  assert.equal(route.localHandler, 'getWorkspaceRealtime');
  assert.equal(route.auth, 'authenticated');
  assert.equal(typeof REALTIME_HANDLERS.getWorkspaceRealtime, 'function');

  const hit = matchRoute(compileRoutes(routes), 'GET', '/v1/workspaces/ws-acme/realtime');
  assert.ok(hit, 'console realtime config request must resolve to a route');
  assert.equal(hit.route.localHandler, 'getWorkspaceRealtime');
  assert.equal(hit.params.workspaceId, 'ws-acme');

  const runtimeRoute = runtimeRouteMap.find((r) => r.method === 'GET' && r.path === ROUTE_PATH);
  assert.ok(runtimeRoute, `${ROUTE_PATH} must be present in route-map.runtime.json loaded by the kind image`);
  assert.equal(runtimeRoute.localHandler, 'getWorkspaceRealtime');
});

test('fix-788-01: owned workspace realtime config returns ConsoleRealtimePage response shape from realtime_channels', async () => {
  await withRealtimeEndpoint('wss://rt.example.test/', async () => {
    const pool = fakePool([
      {
        id: 'ch-pg',
        channel_type: 'postgresql-changes',
        data_source_kind: 'postgres',
        data_source_ref: 'orders-db',
        display_name: 'Orders DB',
        description: 'Postgres order changes',
        status: 'available',
      },
      {
        id: 'ch-mongo',
        channel_type: 'mongodb-changes',
        data_source_kind: 'mongodb',
        data_source_ref: 'profiles',
        display_name: null,
        description: null,
        status: 'available',
      },
    ]);

    const res = await REALTIME_HANDLERS.getWorkspaceRealtime({
      params: { workspaceId: 'ws-acme' },
      identity: { actorType: 'tenant_owner', tenantId: 'ten-acme', sub: 'owner-1' },
      pool,
      store: fakeStore({ id: 'ws-acme-canonical', tenant_id: 'ten-acme' }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.workspaceId, 'ws-acme-canonical');
    assert.equal(res.body.realtimeEndpointUrl, 'wss://rt.example.test');
    assert.deepEqual(res.body.features, { realtime: true });
    assert.deepEqual(res.body.dataSources, [
      {
        id: 'ch-pg',
        type: 'postgresql',
        channelType: 'postgresql-changes',
        dataSourceRef: 'orders-db',
        displayName: 'Orders DB',
        description: 'Postgres order changes',
        status: 'available',
      },
      {
        id: 'ch-mongo',
        type: 'mongodb',
        channelType: 'mongodb-changes',
        dataSourceRef: 'profiles',
        displayName: null,
        description: null,
        status: 'available',
      },
    ]);
    assert.deepEqual(pool.queries[0].params, ['ten-acme', 'ws-acme-canonical']);
    assert.match(pool.queries[0].sql, /FROM realtime_channels/);
  });
});

test('fix-788-02: owned workspace with no realtime_channels rows returns 200 empty config, not 404', async () => {
  const pool = fakePool([]);
  const res = await REALTIME_HANDLERS.getWorkspaceRealtime({
    params: { workspaceId: 'ws-acme' },
    identity: { actorType: 'tenant_owner', tenantId: 'ten-acme', sub: 'owner-1' },
    pool,
    store: fakeStore({ id: 'ws-acme', tenant_id: 'ten-acme' }),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.workspaceId, 'ws-acme');
  assert.deepEqual(res.body.features, { realtime: false });
  assert.deepEqual(res.body.dataSources, []);
});

test('fix-788-02b: read-only same-tenant caller can load the config route', async () => {
  const pool = fakePool([]);
  const res = await REALTIME_HANDLERS.getWorkspaceRealtime({
    params: { workspaceId: 'ws-acme' },
    identity: { actorType: 'tenant_member', tenantId: 'ten-acme', roles: ['tenant_viewer'], sub: 'viewer-1' },
    pool,
    store: fakeStore({ id: 'ws-acme', tenant_id: 'ten-acme' }),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.features, { realtime: false });
});

test('fix-788-03: foreign workspace id is scoped by verified tenant and does not query realtime_channels', async () => {
  const pool = {
    async query() {
      throw new Error('realtime_channels must not be queried before workspace ownership is verified');
    },
  };

  const res = await REALTIME_HANDLERS.getWorkspaceRealtime({
    params: { workspaceId: 'ws-acme' },
    identity: { actorType: 'tenant_owner', tenantId: 'ten-acme', sub: 'owner-1' },
    pool,
    store: fakeStore({ id: 'ws-acme', tenant_id: 'ten-other' }),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
});

test('fix-788-04: missing realtime_channels relation degrades to an empty successful config', async () => {
  const pool = {
    async query() {
      throw Object.assign(new Error('relation "realtime_channels" does not exist'), { code: '42P01' });
    },
  };

  const res = await REALTIME_HANDLERS.getWorkspaceRealtime({
    params: { workspaceId: 'ws-acme' },
    identity: { actorType: 'tenant_owner', tenantId: 'ten-acme', sub: 'owner-1' },
    pool,
    store: fakeStore({ id: 'ws-acme', tenant_id: 'ten-acme' }),
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.features, { realtime: false });
  assert.deepEqual(res.body.dataSources, []);
});
