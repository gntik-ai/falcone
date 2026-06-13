// Unit tests for the first-party Falcone MCP server (change add-mcp-official-server, #391).
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpMessage } from './mcp-official-server.mjs';
import { OFFICIAL_TOOLS, readTools, mutatingTools, BASE_SCOPE } from './mcp-official-catalog.mjs';

const rpc = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });

test('catalog: every tool is described, schema\'d, and classified; mutating tools carry a scope', () => {
  assert.ok(OFFICIAL_TOOLS.length >= 5);
  for (const t of OFFICIAL_TOOLS) {
    assert.ok(t.description && t.description.length >= 30, `tool ${t.name} needs a real description`);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(typeof t.mutates, 'boolean');
    if (t.mutates) assert.ok(t.scope && t.scope.startsWith('mcp:falcone:'), `mutating ${t.name} needs an explicit scope`);
    else assert.equal(t.scope, null);
  }
  assert.ok(readTools().length > 0 && mutatingTools().length > 0);
});

test('tools/list returns every tool with a readOnlyHint annotation', async () => {
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

test('mutating tool is refused without its explicit scope', async () => {
  const res = await handleMcpMessage(rpc('tools/call', { name: 'create_workspace', arguments: { slug: 'x' } }), {
    grantedScopes: [BASE_SCOPE], callFalcone: async () => assert.fail('must not call'),
  });
  assert.ok(res.error && /requires scope/.test(res.error.message));
});

test('mutating tool is allowed with its scope and calls the control-plane', async () => {
  let called = null;
  const res = await handleMcpMessage(rpc('tools/call', { name: 'create_workspace', arguments: { slug: 'x', environment: 'dev' } }), {
    grantedScopes: [BASE_SCOPE, 'mcp:falcone:workspaces:write'],
    callFalcone: async (m, p, b) => { called = { m, p, b }; return { id: 'ws2' }; },
  });
  assert.equal(called.m, 'POST');
  assert.equal(called.p, '/v1/workspaces');
  assert.deepEqual(called.b, { slug: 'x', environment: 'dev' });
  assert.ok(res.result.content[0].text.includes('ws2'));
});

test('call without the base scope is refused', async () => {
  const res = await handleMcpMessage(rpc('tools/call', { name: 'list_workspaces', arguments: {} }), { grantedScopes: [] });
  assert.ok(res.error && new RegExp(BASE_SCOPE).test(res.error.message));
});

test('path {id} resolves from args but the tenant is never taken from args', async () => {
  let called = null;
  await handleMcpMessage(rpc('tools/call', { name: 'list_workspace_members', arguments: { workspaceId: 'ws9', tenantId: 'EVIL' } }), {
    grantedScopes: [BASE_SCOPE], callFalcone: async (m, p) => { called = p; return []; },
  });
  assert.equal(called, '/v1/workspaces/ws9/members');
  assert.ok(!called.includes('EVIL'));
});
