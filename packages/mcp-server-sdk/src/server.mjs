/**
 * Falcone MCP server wrapper (change: add-mcp-server-sdk, #401).
 *
 * Thin layer over an official MCP server (duck-typed: any object with a `.tool(name, description,
 * inputSchema, handler)` method, e.g. @modelcontextprotocol/sdk's McpServer). `defineFalconeTool`
 * declares a tool whose handler receives `(args, ctx)`; `createFalconeMcpServer` registers it on the
 * underlying server with a wrapper that, per invocation, resolves the tenant from the VERIFIED
 * request (never from tool args) and injects a fresh tenant-scoped ctx. Writing a tool against the
 * platform is then a few lines, automatically tenant-scoped.
 */

import { createFalconeContext } from './context.mjs';

/**
 * Declare a Falcone tool. The handler signature is (args, ctx) where ctx is the tenant-scoped
 * Falcone context.
 * @param {{ name:string, description?:string, inputSchema?:object, handler:(args:any, ctx:object)=>any }} def
 */
export function defineFalconeTool(def = {}) {
  if (!def.name) throw new Error('defineFalconeTool requires a name.');
  if (typeof def.handler !== 'function') throw new Error(`Tool "${def.name}" requires a handler.`);
  return { name: def.name, description: def.description ?? '', inputSchema: def.inputSchema ?? { type: 'object' }, handler: def.handler };
}

/**
 * Wrap an official MCP server with tenant-scoped tool registration.
 * @param {{ mcpServer:object, resolveTenant:(request:object)=>{tenantId:string, workspaceId?:string},
 *           call:(req:object)=>Promise<any> }} input
 * @returns {{ tool:(def:object)=>void }}
 */
export function createFalconeMcpServer({ mcpServer, resolveTenant, call } = {}) {
  if (!mcpServer || typeof mcpServer.tool !== 'function') throw new Error('createFalconeMcpServer requires an MCP server with a .tool() method.');
  if (typeof resolveTenant !== 'function') throw new Error('createFalconeMcpServer requires a resolveTenant function (credential-derived).');
  if (typeof call !== 'function') throw new Error('createFalconeMcpServer requires a call transport.');

  function register(def) {
    const tool = defineFalconeTool(def);
    // The underlying handler receives (args, request); the tenant comes from the request's verified
    // credential via resolveTenant — NEVER from args — and a fresh scoped ctx is built per call.
    mcpServer.tool(tool.name, tool.description, tool.inputSchema, async (args, request) => {
      const { tenantId, workspaceId } = resolveTenant(request) ?? {};
      const ctx = createFalconeContext({ tenantId, workspaceId, call });
      return tool.handler(args ?? {}, ctx);
    });
  }

  return { tool: register };
}
