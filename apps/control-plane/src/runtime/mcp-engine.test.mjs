// Unit tests for the MCP control-plane engine (change: add-mcp-control-plane-runtime).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpEngine } from './mcp-engine.mjs';

const A = { tenantId: 'ten-a', workspaceId: 'ws-a', actorId: 'actor-a', roleName: 'falcone_app' };
const B = { tenantId: 'ten-b', workspaceId: 'ws-b', actorId: 'actor-b', roleName: 'falcone_app' };

// A fake runtime self-call so tool-calls don't need a live HTTP server.
function fakeFetch() {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, async json() { return { rows: [], ok: true, url }; } };
  };
  impl.calls = calls;
  return impl;
}

function engine() {
  return createMcpEngine({ selfBaseUrl: 'http://cp.local', gatewayBaseUrl: 'https://gw.local', fetchImpl: fakeFetch() });
}

test('full loop: create (instant) → curate → publish → get (endpoint+tools+version) → call → audit', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'Acme', source: 'instant' } });
  assert.equal(created.status, 'draft');
  const sid = created.serverId;
  assert.ok(sid);

  await e.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { decisions: {} } });
  const pub = await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });
  assert.equal(pub.requiresReview, false);
  assert.equal(pub.activeVersion, 'v1');

  const view = await e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid });
  assert.equal(view.status, 'published');
  assert.equal(view.version, 'v1');
  assert.ok(view.endpoint.includes(sid));
  assert.ok(view.tools.length > 0);

  const call = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: view.tools[0].name, arguments: { workspaceId: A.workspaceId } } });
  assert.ok(Array.isArray(call.content));

  const audit = await e.executeMcp({ operation: 'list_audit', identity: A, workspaceId: A.workspaceId, serverId: sid });
  assert.ok(audit.items.length >= 1);
  for (const ev of audit.items) assert.equal(ev.scope.tenant_id, 'ten-a');
});

test('cross-tenant: B cannot get / call / audit A\'s server (404)', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'A-srv', source: 'instant' } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });

  await assert.rejects(() => e.executeMcp({ operation: 'get_server', identity: B, workspaceId: B.workspaceId, serverId: sid }), (err) => err.statusCode === 404);
  await assert.rejects(() => e.executeMcp({ operation: 'call_tool', identity: B, workspaceId: B.workspaceId, serverId: sid, body: { name: 'x' } }), (err) => err.statusCode === 404);
  await assert.rejects(() => e.executeMcp({ operation: 'list_audit', identity: B, workspaceId: B.workspaceId, serverId: sid }), (err) => err.statusCode === 404);

  // A's server never appears in B's list.
  const bList = await e.executeMcp({ operation: 'list_servers', identity: B, workspaceId: B.workspaceId });
  assert.equal(bList.items.some((s) => s.serverId === sid), false);
});

test('version pinning: a tool-description change is held for review, then served after approval', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'Pinned', source: 'official' } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });

  // v2 changes a tool description via a real curation decision → requiresReview, NOT served.
  const firstTool = (await e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid })).tools[0].name;
  const pub2 = await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v2', body: { version: 'v2', curation: { decisions: { [firstTool]: { description: 'CHANGED for v2' } } } } });
  assert.equal(pub2.requiresReview, true);
  assert.equal(pub2.activeVersion, 'v1'); // still serving v1

  // approve → v2 serves.
  const approved = await e.executeMcp({ operation: 'approve_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v2' });
  assert.equal(approved.activeVersion, 'v2');
});

test('quota: server-count limit is enforced (429 QUOTA_EXCEEDED with dimension)', async () => {
  const e = createMcpEngine({ fetchImpl: fakeFetch(), plan: { maxServersPerTenant: 1, maxToolsPerServer: 50, toolCallsPerMinutePerServer: 600, toolCallsPerMinutePerOAuthClient: 300, mode: 'enforced' } });
  await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'one', source: 'instant' } });
  await assert.rejects(
    () => e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'two', source: 'instant' } }),
    (err) => err.statusCode === 429 && err.code === 'QUOTA_EXCEEDED' && err.dimension === 'servers_per_tenant',
  );
});

test('delete removes the server (subsequent get → 404)', async () => {
  const e = engine();
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'tmp', source: 'instant' } });
  const sid = created.serverId;
  const del = await e.executeMcp({ operation: 'delete_server', identity: A, workspaceId: A.workspaceId, serverId: sid });
  assert.equal(del.deleted, true);
  await assert.rejects(() => e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid }), (err) => err.statusCode === 404);
});
