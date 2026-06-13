/**
 * Falcone official (first-party) MCP server — request handler
 * (change: add-mcp-official-server, #391).
 *
 * Hand-rolled JSON-RPC 2.0 over Streamable HTTP (the Server SDK #401 will replace this).
 * Read-first: read tools are callable with the base scope; a mutating tools/call is REFUSED
 * unless the tool's explicit scope is in the caller's granted scopes. The tenant is
 * credential-derived by the gateway (#389) / token (#390) — never taken from tool arguments.
 */
import { OFFICIAL_TOOLS, BASE_SCOPE, toolByName, toolsListForClient } from './mcp-official-catalog.mjs';

const PROTOCOL_VERSION = '2025-11-25';

function rpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

/**
 * @param {object} msg  a JSON-RPC request ({ id, method, params })
 * @param {object} ctx
 * @param {string[]} [ctx.grantedScopes]  scopes from the verified OAuth token (#390)
 * @param {(method:string, path:string, body?:object)=>Promise<any>} [ctx.callFalcone]  injected control-plane client
 * @returns {Promise<object>} a JSON-RPC response
 */
export async function handleMcpMessage(msg, ctx = {}) {
  const { id, method, params } = msg ?? {};
  const grantedScopes = new Set(ctx.grantedScopes ?? []);
  const callFalcone = ctx.callFalcone;

  switch (method) {
    case 'initialize':
      return rpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: 'falcone-official-mcp', version: '0.1.0' },
        capabilities: { tools: {} },
      });

    case 'tools/list':
      return rpc(id, { tools: toolsListForClient() });

    case 'tools/call': {
      const tool = toolByName(params?.name);
      if (!tool) return rpcErr(id, -32602, `unknown tool: ${params?.name}`);

      // Base scope is always required to use the server at all.
      if (!grantedScopes.has(BASE_SCOPE)) {
        return rpcErr(id, -32001, `missing required scope: ${BASE_SCOPE}`);
      }
      // Read-first: a mutating tool needs its explicit per-tool scope.
      if (tool.mutates && !grantedScopes.has(tool.scope)) {
        return rpcErr(id, -32002, `mutating tool "${tool.name}" requires scope: ${tool.scope}`);
      }
      if (typeof callFalcone !== 'function') {
        return rpcErr(id, -32003, 'control-plane client not available');
      }

      const args = params?.arguments ?? {};
      // Resolve the {id} path segment from a tool arg WITHOUT ever taking the tenant from args.
      const path = tool.path.replace('{id}', encodeURIComponent(args.workspaceId ?? args.id ?? ''));
      const body = tool.mutates ? args : undefined;
      const result = await callFalcone(tool.method, path, body);
      return rpc(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] });
    }

    case 'ping':
      return rpc(id, {});

    default:
      return rpcErr(id, -32601, `method not found: ${method}`);
  }
}

export { OFFICIAL_TOOLS };
