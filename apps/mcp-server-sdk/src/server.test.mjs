import test from 'node:test';
import assert from 'node:assert/strict';
import { createFalconeMcpServer, defineFalconeTool } from './server.mjs';

// A fake official MCP server: captures tool registrations so we can invoke them.
function fakeMcpServer() {
  const tools = new Map();
  return {
    tool(name, description, inputSchema, handler) { tools.set(name, { description, inputSchema, handler }); },
    async invoke(name, args, request) { return tools.get(name).handler(args, request); },
    tools,
  };
}

function recordingCall() {
  const calls = [];
  const fn = async (req) => { calls.push(req); return { rows: [{ id: 1 }] }; };
  fn.calls = calls;
  return fn;
}

test('defineFalconeTool: validates name + handler', () => {
  assert.throws(() => defineFalconeTool({ handler: () => {} }), /name/);
  assert.throws(() => defineFalconeTool({ name: 'x' }), /handler/);
  const t = defineFalconeTool({ name: 'x', handler: () => 1 });
  assert.equal(t.name, 'x');
  assert.deepEqual(t.inputSchema, { type: 'object' });
});

test('a tool reads the tenant DB in a few lines, scoped automatically from the request credential', async () => {
  const mcp = fakeMcpServer();
  const call = recordingCall();
  // tenant comes from the verified request (credential), NOT from tool args
  const resolveTenant = (request) => ({ tenantId: request.auth.tenantId, workspaceId: request.auth.workspaceId });
  const falcone = createFalconeMcpServer({ mcpServer: mcp, resolveTenant, call });

  falcone.tool(defineFalconeTool({
    name: 'list_orders',
    description: 'List the tenant orders',
    handler: async (args, ctx) => ctx.db.select('orders', { status: args.status }),
  }));

  const result = await mcp.invoke('list_orders', { status: 'open' }, { auth: { tenantId: 'ten-a', workspaceId: 'ws-1' } });
  assert.deepEqual(result, { rows: [{ id: 1 }] });
  assert.equal(call.calls[0].tenantId, 'ten-a');
  assert.equal(call.calls[0].table, 'orders');
  assert.deepEqual(call.calls[0].filter, { status: 'open' });
});

test('no escape: a tenant value in tool args never changes the resolved scope', async () => {
  const mcp = fakeMcpServer();
  const call = recordingCall();
  const resolveTenant = (request) => ({ tenantId: request.auth.tenantId, workspaceId: request.auth.workspaceId });
  const falcone = createFalconeMcpServer({ mcpServer: mcp, resolveTenant, call });

  falcone.tool(defineFalconeTool({
    name: 'evil',
    // tool tries to use args.tenantId to reach another tenant
    handler: async (args, ctx) => ctx.db.select('orders', { tenantId: args.tenantId }),
  }));

  await mcp.invoke('evil', { tenantId: 'ten-EVIL' }, { auth: { tenantId: 'ten-a', workspaceId: 'ws-1' } });
  // the authoritative scope is resolved from the verified request, never from tool args
  assert.equal(call.calls[0].tenantId, 'ten-a');
  assert.equal(call.calls[0].workspaceId, 'ws-1');
});

test('createFalconeMcpServer: validates its dependencies', () => {
  assert.throws(() => createFalconeMcpServer({ resolveTenant: () => {}, call: async () => {} }), /\.tool\(\) method/);
  assert.throws(() => createFalconeMcpServer({ mcpServer: { tool() {} }, call: async () => {} }), /resolveTenant/);
  assert.throws(() => createFalconeMcpServer({ mcpServer: { tool() {} }, resolveTenant: () => {} }), /call transport/);
});
