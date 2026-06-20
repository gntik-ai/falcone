/**
 * First-party MCP server configuration (change: add-control-mcp-completeness, #642).
 *
 * The enabled/disabled state of the first-party control MCP — whether the server is on and which
 * individual tools are turned off — is RUNTIME-configurable through the superadmin-only
 * `set_mcp_config` tool, not just a deploy-time constant. The cp-executor runs single-replica, so a
 * module-level store is the process-wide configuration; `createMcpConfigStore` also gives tests an
 * isolated instance.
 *
 * `tools/list` hides disabled tools and `tools/call` refuses them; when the server is disabled the
 * dispatcher does not grant the base scope, so every tool call is refused.
 */

/**
 * @param {{enabled?:boolean, disabledTools?:string[]}} [initial]
 * @returns {{isServerEnabled:()=>boolean, isToolEnabled:(name:string)=>boolean, get:()=>{enabled:boolean,disabledTools:string[]}, set:(patch:object)=>{enabled:boolean,disabledTools:string[]}}}
 */
export function createMcpConfigStore(initial = {}) {
  const state = {
    enabled: initial.enabled ?? true,
    disabledTools: new Set(initial.disabledTools ?? []),
  };
  const snapshot = () => ({ enabled: state.enabled, disabledTools: [...state.disabledTools].sort() });
  return {
    isServerEnabled: () => state.enabled,
    // A tool is callable only when the server is enabled AND the tool is not individually disabled.
    isToolEnabled: (name) => state.enabled && !state.disabledTools.has(name),
    get: snapshot,
    set: (patch = {}) => {
      if (typeof patch.enabled === 'boolean') state.enabled = patch.enabled;
      for (const n of patch.disableTools ?? []) if (typeof n === 'string') state.disabledTools.add(n);
      for (const n of patch.enableTools ?? []) if (typeof n === 'string') state.disabledTools.delete(n);
      return snapshot();
    },
  };
}

// Process-wide singleton for the runtime. MCP_OFFICIAL_ENABLED=false ships the server disabled by
// default; a superadmin can still flip it on at runtime via set_mcp_config.
export const mcpConfigStore = createMcpConfigStore({
  enabled: (process.env.MCP_OFFICIAL_ENABLED ?? 'true') !== 'false',
});
