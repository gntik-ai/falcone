/**
 * `falcone mcp deploy` — push image/source to the runtime via the control-plane (change: add-mcp-cli, #400).
 *
 * Pure construction of the workspace-scoped deploy request (and result formatting). The request path
 * is derived from the credential context's workspace — never from arguments — so a deploy can only
 * target the caller's own tenant/workspace (no cross-tenant access). Rides the #394 custom-hosting
 * deploy path on the control-plane.
 */

import { CliError } from '../cli.mjs';
import { authHeaders, requireWorkspace } from '../context.mjs';

/**
 * Build the authenticated control-plane request that deploys an MCP server.
 * Exactly one of image / source must be provided.
 * @param {{ context:object, image?:string, source?:string, name?:string }} input
 * @returns {{ method:'POST', url:string, headers:Record<string,string>, body:object }}
 */
export function buildDeployRequest({ context, image, source, name } = {}) {
  const workspaceId = requireWorkspace(context);
  if (!image && !source) throw new CliError('Provide --image <ref> or --source <dir> to deploy.', 2);
  if (image && source) throw new CliError('Provide only one of --image or --source.', 2);
  const path = `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers`;
  return {
    method: 'POST',
    url: `${context.apiBaseUrl}${path}`,
    headers: { 'Content-Type': 'application/json', ...authHeaders(context) },
    body: source ? { source, name } : { image, name },
  };
}

/** Format the control-plane deploy response into the endpoint line printed to the user. */
export function formatDeployResult(response = {}) {
  const endpoint = response.endpoint ?? response.endpointUrl ?? response.url ?? null;
  if (!endpoint) return 'Deployed. Endpoint not yet available — check `falcone mcp` once the server is Ready.';
  return `Deployed. Endpoint: ${endpoint}`;
}
