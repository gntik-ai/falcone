/**
 * Falcone official (first-party) MCP server — request handler
 * (change: add-mcp-official-server, #391; completeness: add-control-mcp-completeness, #642).
 *
 * Hand-rolled JSON-RPC 2.0 over Streamable HTTP. Read-first: read tools are callable with the base
 * scope; a mutating proxied tool is REFUSED unless the tool's explicit scope is in the caller's
 * granted scopes. The tenant is credential-derived by the gateway/token and substituted into
 * `{tenantId}` path segments — NEVER taken from tool arguments.
 *
 * Tool dispatch is by `tool.kind`:
 *   'proxy'      → resolved to a REST request and sent via ctx.callFalcone (the management surface)
 *   'authoring'  → handled in-process by the deterministic planner (mcp-authoring.mjs)
 *   'config-get' → returns the live server configuration
 *   'config-set' → mutates the server configuration (superadmin role required)
 */
import { OFFICIAL_TOOLS, BASE_SCOPE, toolByName, toolsListForClient } from './mcp-official-catalog.mjs';
import { planProject } from './mcp-authoring.mjs';

const PROTOCOL_VERSION = '2025-11-25';
const SUPERADMIN_ROLES = new Set(['superadmin', 'platform_admin']);
const ALL_TOOL_NAMES = new Set(OFFICIAL_TOOLS.map((t) => t.name));

// Permissive default config when the runtime injects none (e.g. unit tests of the proxy path):
// every tool enabled; mutating the config is unavailable without a real store.
const DEFAULT_CONFIG = {
  isServerEnabled: () => true,
  isToolEnabled: () => true,
  get: () => ({ enabled: true, disabledTools: [] }),
  set: () => { throw new Error('MCP configuration store not available'); },
};

function rpc(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
function textResult(id, value) {
  return rpc(id, { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
}

// Substitute a path template against the credential-derived tenant + tool args. `{tenantId}` ALWAYS
// comes from the credential (never args); every other `{name}` is taken from args. Consumed arg
// names are recorded so they can be stripped from a mutating request body.
function resolvePath(template, tenantId, args, consumed) {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (name === 'tenantId') {
      if (!tenantId) throw Object.assign(new Error('no tenant resolved from the credential'), { rpcCode: -32004 });
      return encodeURIComponent(tenantId);
    }
    const v = args[name];
    if (v === undefined || v === null || v === '') {
      throw Object.assign(new Error(`missing required path argument: ${name}`), { rpcCode: -32602 });
    }
    consumed.add(name);
    return encodeURIComponent(String(v));
  });
}

function omit(obj, keys) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.has(k)) out[k] = v;
  return out;
}

/**
 * @param {object} msg  a JSON-RPC request ({ id, method, params })
 * @param {object} ctx
 * @param {string[]} [ctx.grantedScopes]  scopes from the verified credential (#390)
 * @param {string[]} [ctx.roles]          roles from the verified credential (superadmin gate)
 * @param {string}   [ctx.tenantId]       credential-derived tenant, for `{tenantId}` substitution
 * @param {(method:string, path:string, body?:object)=>Promise<any>} [ctx.callFalcone]  control-plane client
 * @param {object}   [ctx.config]         MCP config store (mcp-config.mjs); defaults to all-enabled
 * @returns {Promise<object>} a JSON-RPC response
 */
export async function handleMcpMessage(msg, ctx = {}) {
  const { id, method, params } = msg ?? {};
  const grantedScopes = new Set(ctx.grantedScopes ?? []);
  const roles = ctx.roles ?? [];
  const tenantId = ctx.tenantId;
  const callFalcone = ctx.callFalcone;
  const config = ctx.config ?? DEFAULT_CONFIG;

  switch (method) {
    case 'initialize':
      return rpc(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: 'falcone-official-mcp', version: '0.2.0' },
        capabilities: { tools: {} },
      });

    case 'tools/list':
      return rpc(id, { tools: toolsListForClient((name) => config.isToolEnabled(name)) });

    case 'tools/call': {
      const tool = toolByName(params?.name);
      if (!tool) return rpcErr(id, -32602, `unknown tool: ${params?.name}`);

      // A disabled tool (superadmin config) is invisible in tools/list and uncallable here.
      if (!config.isToolEnabled(tool.name)) return rpcErr(id, -32601, `tool not available: ${tool.name}`);

      // Base scope is always required to use the server at all (granted to an authenticated
      // principal by the dispatcher when the server is enabled).
      if (!grantedScopes.has(BASE_SCOPE)) return rpcErr(id, -32001, `missing required scope: ${BASE_SCOPE}`);

      const args = params?.arguments ?? {};

      // ---- in-process tools (no proxy) ----
      if (tool.kind === 'authoring') {
        try {
          return textResult(id, planProject(args, { toolNames: ALL_TOOL_NAMES }));
        } catch (e) {
          return rpcErr(id, -32602, e.message);
        }
      }
      if (tool.kind === 'config-get') {
        return textResult(id, config.get());
      }
      if (tool.kind === 'config-set') {
        if (!roles.some((r) => SUPERADMIN_ROLES.has(r))) {
          return rpcErr(id, -32002, `tool "${tool.name}" requires a platform superadmin role`);
        }
        return textResult(id, config.set(args));
      }

      // ---- proxied management tools ----
      // Read-first: a mutating tool needs its explicit per-tool scope.
      if (tool.mutates && tool.scope && !grantedScopes.has(tool.scope)) {
        return rpcErr(id, -32002, `mutating tool "${tool.name}" requires scope: ${tool.scope}`);
      }
      if (typeof callFalcone !== 'function') return rpcErr(id, -32003, 'control-plane client not available');

      let path;
      let body;
      try {
        const consumed = new Set();
        path = resolvePath(tool.path, tenantId, args, consumed);
        // The body of a mutating call is the args minus the segments consumed by the path. `tenantId`
        // is always stripped too: the tenant is credential-derived and must never reach the upstream
        // from arguments, in the path OR the body — even if a client supplies an extra arg.
        consumed.add('tenantId');
        body = tool.mutates ? omit(args, consumed) : undefined;
      } catch (e) {
        return rpcErr(id, e.rpcCode ?? -32602, e.message);
      }

      const result = await callFalcone(tool.method, path, body);
      return textResult(id, result);
    }

    case 'ping':
      return rpc(id, {});

    default:
      return rpcErr(id, -32601, `method not found: ${method}`);
  }
}

export { OFFICIAL_TOOLS };
