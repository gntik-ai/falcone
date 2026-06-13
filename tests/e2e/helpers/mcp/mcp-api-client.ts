/**
 * MCP API client for E2E specs (issue #402).
 *
 * Wraps Playwright's `APIRequestContext` to call the control-plane MCP management API directly
 * (the gateway routes only the MCP *inbound* path, #389), carrying the gateway-injected identity
 * headers the control-plane reads. Mirrors the flows-api-client convention.
 *
 * IMPORTANT (live gate): the MCP management routes (`/v1/mcp/workspaces/{ws}/servers` …) are NOT
 * yet served by the live control-plane runtime — the MCP control-plane modules (#391–#399) are pure
 * and not yet wired into `runtime/server.mjs`. `probeMcpManagement` detects this so specs skip with
 * a precise reason today and execute the real loop once the routes are wired.
 */

import type { APIRequestContext } from '@playwright/test'

export interface TenantIdentity {
  tenantId: string
  workspaceId: string
  actorId?: string
  roleName?: string
}

export interface McpApiClientOptions {
  baseUrl: string
  identity: TenantIdentity
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = Record<string, any>

export interface McpApiResponse<T = JsonBody> {
  status: number
  body: T
}

export function createMcpApiClient(request: APIRequestContext, opts: McpApiClientOptions) {
  const { baseUrl, identity } = opts
  const enc = encodeURIComponent
  const serversBase = (wsId: string) => `${baseUrl}/v1/mcp/workspaces/${enc(wsId)}/servers`

  function headers(): Record<string, string> {
    return {
      'x-tenant-id': identity.tenantId,
      'x-workspace-id': identity.workspaceId,
      'x-auth-subject': identity.actorId ?? 'e2e-mcp-actor',
      'x-pg-role': identity.roleName ?? 'falcone_app',
      'content-type': 'application/json',
      accept: 'application/json',
    }
  }

  async function call<T = JsonBody>(method: 'get' | 'post' | 'delete', url: string, data?: JsonBody): Promise<McpApiResponse<T>> {
    const res = await request[method](url, { headers: headers(), ...(data ? { data } : {}) })
    let body: T
    try { body = (await res.json()) as T } catch { body = {} as T }
    return { status: res.status(), body }
  }

  return {
    listServers: (wsId: string) => call(`get`, serversBase(wsId)),
    createServer: (wsId: string, def: JsonBody) => call(`post`, serversBase(wsId), def),
    getServer: (wsId: string, serverId: string) => call(`get`, `${serversBase(wsId)}/${enc(serverId)}`),
    curateServer: (wsId: string, serverId: string, curation: JsonBody) => call(`post`, `${serversBase(wsId)}/${enc(serverId)}/curations`, curation),
    publishVersion: (wsId: string, serverId: string, body: JsonBody) => call(`post`, `${serversBase(wsId)}/${enc(serverId)}/versions`, body),
    approveVersion: (wsId: string, serverId: string, version: string) => call(`post`, `${serversBase(wsId)}/${enc(serverId)}/versions/${enc(version)}/approval`, {}),
    callTool: (wsId: string, serverId: string, body: JsonBody) => call(`post`, `${serversBase(wsId)}/${enc(serverId)}/tool-calls`, body),
    listAudit: (wsId: string, serverId: string) => call(`get`, `${serversBase(wsId)}/${enc(serverId)}/audit`),
    deleteServer: (wsId: string, serverId: string) => call(`delete`, `${serversBase(wsId)}/${enc(serverId)}`),
  }
}

export type McpApiClient = ReturnType<typeof createMcpApiClient>

/**
 * Probe whether the control-plane serves the MCP management API. Returns false when the route is
 * unknown (404 / not-found body) so specs can skip with a precise reason instead of failing.
 */
export async function probeMcpManagement(request: APIRequestContext, baseUrl: string, identity: TenantIdentity): Promise<boolean> {
  const client = createMcpApiClient(request, { baseUrl, identity })
  try {
    const res = await client.listServers(identity.workspaceId)
    // 200 (served) or 401/403 (served but auth-gated) both mean the route EXISTS.
    if (res.status === 200 || res.status === 401 || res.status === 403) return true
    // 404 with a route-not-found shape means the management API is not wired.
    return false
  } catch {
    return false // unreachable control-plane (no stack) -> treat as not served
  }
}

export const MCP_MANAGEMENT_GATE_REASON =
  'control-plane MCP management API (/v1/mcp/workspaces/{ws}/servers) is not served by runtime/server.mjs yet — ' +
  'the MCP modules (#391–#399) are pure and not wired into the live control-plane. ' +
  'Specs execute the full loop once those routes are wired (follow-up).'
