/**
 * Falcone CLI credential + tenant/workspace context (change: add-mcp-cli, #400).
 *
 * The CLI authenticates with Falcone credentials; the tenant is fixed by the credential and is
 * NEVER widened by a flag. A `--tenant` that disagrees with the credential's tenant is refused —
 * the CLI can never construct a request targeting another tenant (no cross-tenant access, ADR-2).
 */

import { CliError } from './cli.mjs';

/**
 * Resolve the call context from environment credentials + flags.
 * @param {{ env?:Record<string,string|undefined>, flags?:Record<string,string|boolean> }} input
 * @returns {{ token:string, tenantId:string, workspaceId:string|null, apiBaseUrl:string }}
 */
export function resolveContext({ env = {}, flags = {} } = {}) {
  const token = env.FALCONE_TOKEN;
  if (!token) {
    throw new CliError('Not authenticated. Run a Falcone login or set FALCONE_TOKEN.', 3);
  }
  const tenantId = env.FALCONE_TENANT;
  if (!tenantId) {
    throw new CliError('No tenant in the active credential (FALCONE_TENANT).', 3);
  }
  // A --tenant flag may only echo the credential's tenant; it can never select another.
  if (flags.tenant != null && String(flags.tenant) !== tenantId) {
    throw new CliError(`Cross-tenant access refused: credential is scoped to "${tenantId}".`, 4);
  }
  const workspaceId = (flags.workspace != null ? String(flags.workspace) : env.FALCONE_WORKSPACE) ?? null;
  const apiBaseUrl = env.FALCONE_API_URL ?? 'https://api.falcone.local';
  return { token, tenantId, workspaceId, apiBaseUrl };
}

/** Authorization header for an authenticated control-plane request. */
export function authHeaders(context) {
  return { Authorization: `Bearer ${context.token}` };
}

/** Require a workspace in context (deploy/dev are workspace-scoped). */
export function requireWorkspace(context) {
  if (!context.workspaceId) {
    throw new CliError('A workspace is required. Pass --workspace <id> or set FALCONE_WORKSPACE.', 3);
  }
  return context.workspaceId;
}
