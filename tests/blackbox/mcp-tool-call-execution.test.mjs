// Black-box tests for change fix-mcp-tool-call-execution (#565).
//
// A published instant/official MCP server's tool-call must SELF-CALL the real executor /
// control-plane route (correct method + path + body) and return that route's result — NOT the
// executor index `{"service":"in-falcone-control-plane"}`.
//
// Root causes (live 2-tenant E2E, 2026-06-18):
//   1. the registry stored only the agent-visible tool contract (name/description/scope), dropping
//      method/path/source → every tool-call had no route → self-called the root `/` → executor index.
//   2. instant tool path templates were wrong (postgres missing /rows; storage on the old
//      /v1/objects path removed in #500; functions on /v1/functions/<id>/invoke; events on
//      /v1/events/publish) → matched no executor route.
//
// Driven through the public engine surface (createMcpEngine + executeMcp) with a capturing fake
// fetch — the executor route the self-call hits is exactly what we assert. The tenant/workspace are
// ALWAYS credential-derived (identity / server context), NEVER taken from tool args.
//
// bbx-mcp-call-01 .. bbx-mcp-call-08
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMcpEngine } from '../../apps/control-plane/src/runtime/mcp-engine.mjs';

const A = { tenantId: 'ten-a', workspaceId: 'ws-a', actorId: 'actor-a', roleName: 'falcone_app' };
const SELF = 'http://exec.local';

// A capturing fake runtime self-call that mirrors the real executor: the root `/` returns the
// executor INDEX (`{"service":"in-falcone-control-plane"}`) — the exact symptom of the bug — while a
// real `/v1/...` route returns a route-specific 200. So a tool-call with NO route (the bug) hits `/`
// and surfaces the index; the fix makes it hit a real route.
function captureFetch() {
  const calls = [];
  const impl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ url, init, path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (path === '/' || path === '') return { status: 200, async json() { return { service: 'in-falcone-control-plane', routes: 99 }; } };
    return { status: 200, async json() { return { ok: true, routed: path, method: init.method }; } };
  };
  impl.calls = calls;
  return impl;
}

function enginePair() {
  const fetchImpl = captureFetch();
  const e = createMcpEngine({ selfBaseUrl: SELF, gatewayBaseUrl: 'https://gw.local', fetchImpl });
  return { e, fetchImpl };
}

// Create an instant server from explicit resources, curate (defaults), publish v1, return its id.
async function publishInstant(e, resources) {
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'srv', source: 'instant', resources } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { decisions: {} } });
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });
  return sid;
}

const PG = { database: 'app', name: 'public', tables: [{ name: 'orders', columns: [{ name: 'id', type: 'bigint' }, { name: 'total', type: 'numeric' }] }] };

test('bbx-mcp-call-01: a published tool-call does NOT return the executor index', async () => {
  const { e } = enginePair();
  const sid = await publishInstant(e, { postgres: PG });
  const call = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'query_orders', arguments: { workspaceId: A.workspaceId } } });
  const text = call.content.map((c) => c.text).join('');
  assert.ok(!text.includes('in-falcone-control-plane'), 'tool-call must not return the executor index');
  assert.match(text, /"ok":true/);
});

test('bbx-mcp-call-02: query_<table> self-calls GET …/tables/<t>/rows', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publishInstant(e, { postgres: PG });
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'query_orders', arguments: { workspaceId: A.workspaceId } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'GET');
  assert.equal(c.path, '/v1/postgres/workspaces/ws-a/data/app/schemas/public/tables/orders/rows');
  assert.equal(c.url, `${SELF}${c.path}`, 'must self-call the executor base url (exact, host-anchored)');
});

test('bbx-mcp-call-03: insert_<table> self-calls POST …/rows with body {row:{...}}', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publishInstant(e, { postgres: PG });
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'insert_orders', arguments: { workspaceId: A.workspaceId, row: { total: 9 } } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/v1/postgres/workspaces/ws-a/data/app/schemas/public/tables/orders/rows');
  assert.deepEqual(c.body, { row: { total: 9 } });
});

test('bbx-mcp-call-04: invoke_<fn> self-calls POST …/actions/<name>/invocations', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publishInstant(e, { functions: [{ id: 'fn1', name: 'resize' }] });
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'invoke_resize', arguments: { payload: { w: 32 } } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/v1/functions/workspaces/ws-a/actions/resize/invocations');
  assert.deepEqual(c.body, { parameters: { w: 32 } });
});

test('bbx-mcp-call-05: storage put self-calls PUT /v1/storage/buckets/<id>/objects/<key>', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publishInstant(e, { storage: [{ name: 'media', id: 'bkt-media' }] });
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'put_object_media', arguments: { key: 'a/b.txt', content: 'hi' } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'PUT');
  assert.equal(c.path, '/v1/storage/buckets/bkt-media/objects/a%2Fb.txt');
  assert.deepEqual(c.body, { content: 'hi' });
});

test('bbx-mcp-call-06: publish_event self-calls POST …/topics/<topic>/publish (topic from args)', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publishInstant(e, { events: [{ name: 'orders.created' }] });
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'publish_event', arguments: { topic: 'orders.created', payload: { id: 1 } } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/v1/events/workspaces/ws-a/topics/orders.created/publish');
  assert.deepEqual(c.body, { id: 1 });
});

test('bbx-mcp-call-07: official create_workspace self-calls the real control-plane route', async () => {
  const { e, fetchImpl } = enginePair();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'plat', source: 'official' } });
  const sid = created.serverId;
  // Grant the mutating scope so the publish gate accepts the official tools.
  await e.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { decisions: {} } });
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'create_workspace', arguments: { slug: 'new-ws' } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'POST');
  // The served route is tenant-scoped (#642 retarget); {tenantId} is filled from the credential.
  assert.equal(c.path, '/v1/tenants/ten-a/workspaces');
  assert.deepEqual(c.body, { slug: 'new-ws' });
});

test('bbx-mcp-call-08: tenant/workspace are credential-derived, never from tool args', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publishInstant(e, { postgres: PG });
  // A caller tries to smuggle another tenant/workspace via args; routing must ignore them.
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'query_orders', arguments: { workspaceId: 'EVIL_WS', tenantId: 'EVIL_TEN' } } });
  const c = fetchImpl.calls.at(-1);
  assert.ok(!c.path.includes('EVIL'), 'smuggled workspace/tenant must not reach the route');
  assert.equal(c.path, '/v1/postgres/workspaces/ws-a/data/app/schemas/public/tables/orders/rows');
  assert.equal(c.init.headers['x-tenant-id'], 'ten-a');
  assert.equal(c.init.headers['x-workspace-id'], 'ws-a');
});
