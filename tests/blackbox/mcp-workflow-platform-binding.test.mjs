// Black-box tests for change add-mcp-workflow-and-platform-binding (#566).
//
// Two gaps, same root cause as #565:
//   - the flow→MCP-tool mapper (mcp-workflows-tools.mjs) was imported only by its own test → no
//     MCP tool could start a Falcone workflow. It is now wired into the instant generator so a
//     workspace's published flows become long-running MCP tools.
//   - the platform "official" MCP server's 9 management tools did not execute (returned the
//     executor index). They now self-call the real control-plane route (proxied upstream).
//
// Driven through the public engine surface (createMcpEngine + executeMcp) with a capturing fake
// fetch. Tenant/workspace are ALWAYS credential-derived, NEVER from tool args.
//
// bbx-mcp-flow-01 .. bbx-mcp-flow-03, bbx-mcp-platform-01 .. bbx-mcp-platform-02
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMcpEngine } from '../../apps/control-plane/src/runtime/mcp-engine.mjs';
import { generateFromFlows } from '../../apps/control-plane/src/mcp-instant-generator.mjs';

const A = { tenantId: 'ten-a', workspaceId: 'ws-a', actorId: 'actor-a', roleName: 'falcone_app' };
const SELF = 'http://exec.local';

function captureFetch() {
  const calls = [];
  const impl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ url, init, path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    // Mirror the real executor: the root `/` returns the index (the bug symptom).
    if (path === '/' || path === '') return { status: 200, async json() { return { service: 'in-falcone-control-plane', routes: 99 }; } };
    // The executor's start_execution route returns 201 + an executionId (the MCP Task id).
    return { status: 201, async json() { return { executionId: 'exec-1', status: 'running' }; } };
  };
  impl.calls = calls;
  return impl;
}

function enginePair() {
  const fetchImpl = captureFetch();
  const e = createMcpEngine({ selfBaseUrl: SELF, gatewayBaseUrl: 'https://gw.local', fetchImpl });
  return { e, fetchImpl };
}

async function publish(e, source, resources) {
  const created = await e.executeMcp({ operation: 'create_server', identity: A, workspaceId: A.workspaceId, body: { name: 'srv', source, resources } });
  const sid = created.serverId;
  await e.executeMcp({ operation: 'curate_server', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { decisions: {} } });
  await e.executeMcp({ operation: 'publish_version', identity: A, workspaceId: A.workspaceId, serverId: sid, version: 'v1', body: { version: 'v1' } });
  return sid;
}

test('bbx-mcp-flow-01: the flow generator is wired into the engine (published flow → MCP tool)', async () => {
  const { e } = enginePair();
  const sid = await publish(e, 'instant', { flows: [{ id: 'flw_1', name: 'Nightly Report' }] });
  const view = await e.executeMcp({ operation: 'get_server', identity: A, workspaceId: A.workspaceId, serverId: sid });
  const tool = view.tools.find((t) => t.name === 'run_flow_nightly-report');
  assert.ok(tool, 'a published flow must surface as an MCP tool');
  assert.ok(tool.mutates, 'a flow run is mutating');
});

test('bbx-mcp-flow-02: invoking a flow tool self-calls the real flows executions route + {input}', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publish(e, 'instant', { flows: [{ id: 'flw_1', name: 'Nightly Report' }] });
  const call = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'run_flow_nightly-report', arguments: { date: '2026-06-18' } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/v1/flows/workspaces/ws-a/flows/flw_1/executions');
  assert.deepEqual(c.body, { input: { date: '2026-06-18' } });
  // The started workflow's result (executionId) is returned, NOT the executor index.
  const text = call.content.map((x) => x.text).join('');
  assert.ok(!text.includes('in-falcone-control-plane'));
  assert.match(text, /exec-1/);
});

test('bbx-mcp-flow-03: a flow tool ignores any smuggled tenant/workspace in args', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publish(e, 'instant', { flows: [{ id: 'flw_1', name: 'Nightly Report' }] });
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'run_flow_nightly-report', arguments: { date: 'd', tenantId: 'EVIL', workspaceId: 'EVIL_WS' } } });
  const c = fetchImpl.calls.at(-1);
  assert.ok(!c.path.includes('EVIL'));
  assert.equal(c.path, '/v1/flows/workspaces/ws-a/flows/flw_1/executions');
  assert.deepEqual(c.body, { input: { date: 'd' } }, 'smuggled tenant/workspace stripped from the flow input');
});

test('bbx-mcp-platform-01: a platform read tool self-calls a real control-plane route (not the index)', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publish(e, 'official');
  const call = await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'list_workspaces', arguments: {} } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'GET');
  assert.equal(c.path, '/v1/workspaces');
  const text = call.content.map((x) => x.text).join('');
  assert.ok(!text.includes('in-falcone-control-plane'), 'platform tool must not return the executor index');
});

test('bbx-mcp-platform-02: a platform mutating tool self-calls the control-plane with its body', async () => {
  const { e, fetchImpl } = enginePair();
  const sid = await publish(e, 'official');
  await e.executeMcp({ operation: 'call_tool', identity: A, workspaceId: A.workspaceId, serverId: sid, body: { name: 'create_schema', arguments: { name: 'reporting' } } });
  const c = fetchImpl.calls.at(-1);
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/v1/schemas');
  assert.deepEqual(c.body, { name: 'reporting' });
});

test('bbx-mcp-platform-03: generateFromFlows is the reused mapper (parity with mcp-workflows-tools)', () => {
  // Smoke that the wiring goes through the reviewed mapper (not a re-implementation).
  const [t] = generateFromFlows('srv', [{ id: 'flw_9', name: 'Sync' }]);
  assert.equal(t.name, 'run_flow_sync');
  assert.equal(t.path, '/v1/flows/workspaces/{workspaceId}/flows/flw_9/executions');
  assert.equal(t.longRunning, true);
});
