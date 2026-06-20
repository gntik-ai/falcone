// Unit tests for the first-party Falcone MCP server
// (add-mcp-official-server, #391; completeness add-control-mcp-completeness, #642).
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpMessage } from './mcp-official-server.mjs';
import { OFFICIAL_TOOLS, readTools, mutatingTools, toolByName, BASE_SCOPE } from './mcp-official-catalog.mjs';
import { createMcpConfigStore } from './mcp-config.mjs';

const rpc = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });

test('catalog: every tool is described, schema\'d, and classified; mutating proxy tools carry a scope', () => {
  assert.ok(OFFICIAL_TOOLS.length >= 20, 'the catalog should materially exceed the original nine tools');
  for (const t of OFFICIAL_TOOLS) {
    assert.ok(t.description && t.description.length >= 30, `tool ${t.name} needs a real description`);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.mutates, 'boolean');
    // A mutating PROXY tool carries an explicit mcp:falcone:* scope; the config-set meta-tool is
    // mutating but gated by role (scope null, superadminOnly).
    if (t.mutates && t.kind === 'proxy') assert.ok(t.scope && t.scope.startsWith('mcp:falcone:'), `mutating ${t.name} needs an explicit scope`);
    if (t.kind === 'proxy') { assert.ok(t.method && t.path, `${t.name} needs a method+path`); }
  }
  assert.ok(readTools().length > 0 && mutatingTools().length > 0);
});

test('catalog spans multiple management families', () => {
  const families = new Set(OFFICIAL_TOOLS.map((t) => t.family));
  for (const f of ['workspaces', 'service-accounts', 'databases', 'functions', 'storage', 'events', 'api-keys']) {
    assert.ok(families.has(f), `expected a tool in the ${f} family`);
  }
  assert.ok(families.size >= 8);
});

test('catalog paths target served route shapes (tenant-scoped create, not the bare public path)', () => {
  assert.equal(toolByName('list_workspaces').path, '/v1/workspaces');
  // The deeper #642 bug: create must hit the served tenant-scoped route, not POST /v1/workspaces.
  assert.equal(toolByName('create_workspace').path, '/v1/tenants/{tenantId}/workspaces');
  assert.equal(toolByName('register_function').path, '/v1/workspaces/{workspaceId}/functions');
  assert.equal(toolByName('issue_api_key').path, '/v1/workspaces/{workspaceId}/api-keys');
});

test('tools/list returns enabled tools with readOnlyHint annotations', async () => {
  const res = await handleMcpMessage(rpc('tools/list'), {});
  assert.equal(res.result.tools.length, OFFICIAL_TOOLS.length);
  const read = res.result.tools.find((t) => t.name === 'list_workspaces');
  assert.equal(read.annotations.readOnlyHint, true);
  const mut = res.result.tools.find((t) => t.name === 'create_workspace');
  assert.equal(mut.annotations.readOnlyHint, false);
  assert.equal(mut.annotations.requiredScope, 'mcp:falcone:workspaces:write');
});

test('read tool is callable with only the base scope', async () => {
  let called = null;
  const res = await handleMcpMessage(rpc('tools/call', { name: 'list_workspaces', arguments: {} }), {
    grantedScopes: [BASE_SCOPE], callFalcone: async (m, p) => { called = { m, p }; return [{ id: 'ws1' }]; },
  });
  assert.deepEqual(called, { m: 'GET', p: '/v1/workspaces' });
  assert.ok(res.result.content[0].text.includes('ws1'));
});

test('call without the base scope is refused with -32001', async () => {
  const res = await handleMcpMessage(rpc('tools/call', { name: 'list_workspaces', arguments: {} }), { grantedScopes: [] });
  assert.equal(res.error.code, -32001);
  assert.ok(new RegExp(BASE_SCOPE).test(res.error.message));
});

test('mutating tool is refused without its explicit scope', async () => {
  const res = await handleMcpMessage(rpc('tools/call', { name: 'create_workspace', arguments: { slug: 'x' } }), {
    grantedScopes: [BASE_SCOPE], tenantId: 't1', callFalcone: async () => assert.fail('must not call'),
  });
  assert.equal(res.error.code, -32002);
  assert.ok(/requires scope/.test(res.error.message));
});

test('mutating tool is allowed with its scope; {tenantId} comes from the credential, not args', async () => {
  let called = null;
  const res = await handleMcpMessage(rpc('tools/call', { name: 'create_workspace', arguments: { slug: 'x', environment: 'dev', tenantId: 'EVIL' } }), {
    grantedScopes: [BASE_SCOPE, 'mcp:falcone:workspaces:write'], tenantId: 'tenant-real', roles: [],
    callFalcone: async (m, p, b) => { called = { m, p, b }; return { id: 'ws2' }; },
  });
  assert.equal(called.m, 'POST');
  // tenant injected from the credential; the spoofed arg never reaches the path...
  assert.equal(called.p, '/v1/tenants/tenant-real/workspaces');
  assert.ok(!called.p.includes('EVIL'));
  // ...nor the body (the spoofed tenantId is stripped; only the real fields remain).
  assert.deepEqual(called.b, { slug: 'x', environment: 'dev' });
  assert.ok(res.result.content[0].text.includes('ws2'));
});

test('named path params resolve from args and are stripped from the mutating body', async () => {
  let called = null;
  await handleMcpMessage(rpc('tools/call', { name: 'issue_api_key', arguments: { workspaceId: 'ws9', keyType: 'service', scopes: ['data:read'] } }), {
    grantedScopes: [BASE_SCOPE, 'mcp:falcone:api-keys:write'], tenantId: 't1',
    callFalcone: async (m, p, b) => { called = { m, p, b }; return { id: 'k1' }; },
  });
  assert.equal(called.p, '/v1/workspaces/ws9/api-keys');
  // workspaceId consumed by the path is not duplicated into the body
  assert.deepEqual(called.b, { keyType: 'service', scopes: ['data:read'] });
});

test('a read tool whose path needs a missing arg returns a clear error (no proxy call)', async () => {
  const res = await handleMcpMessage(rpc('tools/call', { name: 'get_workspace', arguments: {} }), {
    grantedScopes: [BASE_SCOPE], tenantId: 't1', callFalcone: async () => assert.fail('must not call'),
  });
  assert.equal(res.error.code, -32602);
  assert.ok(/workspaceId/.test(res.error.message));
});

// ---- authoring planner (plan_project) ----
test('plan_project returns an ordered plan with dependencies, performing no proxy calls', async () => {
  const res = await handleMcpMessage(rpc('tools/call', {
    name: 'plan_project',
    arguments: { workspaces: [{ slug: 'app', environment: 'dev', database: { engine: 'postgresql' }, functions: [{ name: 'hello' }] }] },
  }), { grantedScopes: [BASE_SCOPE], callFalcone: async () => assert.fail('authoring is in-process') });
  const plan = JSON.parse(res.result.content[0].text);
  assert.equal(plan.steps[0].tool, 'create_workspace');
  const db = plan.steps.find((s) => s.tool === 'provision_database');
  assert.deepEqual(db.dependsOn, [plan.steps[0].id], 'database depends on the workspace creation step');
  assert.ok(plan.steps.some((s) => s.tool === 'register_function'));
});

test('plan_project rejects an under-specified spec', async () => {
  const res = await handleMcpMessage(rpc('tools/call', { name: 'plan_project', arguments: { workspaces: [] } }), {
    grantedScopes: [BASE_SCOPE],
  });
  assert.equal(res.error.code, -32602);
});

// ---- superadmin-gated configuration ----
test('set_mcp_config is refused for a non-superadmin and applied for a superadmin', async () => {
  const config = createMcpConfigStore();
  const denied = await handleMcpMessage(rpc('tools/call', { name: 'set_mcp_config', arguments: { disableTools: ['create_workspace'] } }), {
    grantedScopes: [BASE_SCOPE], roles: ['tenant_owner'], config,
  });
  assert.equal(denied.error.code, -32002);
  assert.ok(config.isToolEnabled('create_workspace'), 'config unchanged after a denied set');

  const ok = await handleMcpMessage(rpc('tools/call', { name: 'set_mcp_config', arguments: { disableTools: ['create_workspace'] } }), {
    grantedScopes: [BASE_SCOPE], roles: ['superadmin'], config,
  });
  assert.ok(!ok.error);
  assert.ok(!config.isToolEnabled('create_workspace'), 'superadmin disabled the tool');
});

test('a disabled tool disappears from tools/list and is uncallable', async () => {
  const config = createMcpConfigStore({ disabledTools: ['create_workspace'] });
  const list = await handleMcpMessage(rpc('tools/list'), { config });
  assert.ok(!list.result.tools.some((t) => t.name === 'create_workspace'));
  const call = await handleMcpMessage(rpc('tools/call', { name: 'create_workspace', arguments: { slug: 'x' } }), {
    grantedScopes: [BASE_SCOPE, 'mcp:falcone:workspaces:write'], tenantId: 't1', config,
    callFalcone: async () => assert.fail('disabled tool must not proxy'),
  });
  assert.equal(call.error.code, -32601);
});

test('get_mcp_config reports the live configuration', async () => {
  const config = createMcpConfigStore({ disabledTools: ['provision_topic'] });
  const res = await handleMcpMessage(rpc('tools/call', { name: 'get_mcp_config', arguments: {} }), {
    grantedScopes: [BASE_SCOPE], roles: ['tenant_owner'], config,
  });
  const cfg = JSON.parse(res.result.content[0].text);
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.disabledTools, ['provision_topic']);
});

test('initialize advertises the official server', async () => {
  const res = await handleMcpMessage(rpc('initialize'), {});
  assert.equal(res.result.serverInfo.name, 'falcone-official-mcp');
  assert.ok(res.result.capabilities.tools);
});
