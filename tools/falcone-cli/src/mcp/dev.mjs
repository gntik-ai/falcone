/**
 * `falcone mcp dev` — local run + tunnel + MCP Inspector (change: add-mcp-cli, #400).
 *
 * Pure construction of the dev plan: run the local server, open an authenticated tunnel to the
 * tenant context, and point the MCP Inspector at it. Returns the plan (commands + URLs); the
 * command executes it. The tunnel/Inspector are bound to the credential's tenant/workspace, so the
 * dev loop can only target the caller's own tenant.
 */

import { requireWorkspace } from '../context.mjs';

/**
 * @param {{ context:object, port?:number, inspectorPort?:number, runCommand?:string }} input
 * @returns {{ run:{command:string, port:number}, tunnel:{tenantId:string, workspaceId:string, localPort:number},
 *             inspector:{url:string, target:string} }}
 */
export function buildDevPlan({ context, port = 8080, inspectorPort = 6274, runCommand = 'npm start' } = {}) {
  const workspaceId = requireWorkspace(context);
  const target = `http://127.0.0.1:${port}`;
  return {
    run: { command: runCommand, port },
    tunnel: {
      tenantId: context.tenantId, // credential-derived; the dev loop is tenant-scoped
      workspaceId,
      localPort: port,
    },
    inspector: {
      url: `http://127.0.0.1:${inspectorPort}`,
      target,
    },
  };
}
