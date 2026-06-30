import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

import type { McpServerDetailInput } from './mcp-server-detail'

/**
 * Console API calls for the MCP server detail page (issue #397).
 * Both ride the authenticated console session (OAuth bearer attached by requestConsoleSessionJson).
 */

/** Fetch a single MCP server's detail (registry-backed: active version, endpoint, curated tools). */
export async function fetchMcpServerDetail(
  workspaceId: string,
  serverId: string,
  signal?: AbortSignal
): Promise<McpServerDetailInput> {
  return requestConsoleSessionJson<McpServerDetailInput>(
    `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverId)}`,
    { signal }
  )
}

export interface InvokeMcpToolResult {
  result?: unknown
  error?: { code?: number; message?: string }
}

/**
 * Invoke a tool from the playground through the gateway, via the console session OAuth flow.
 * The control-plane forwards the JSON-RPC tools/call to the tenant's server and returns the result.
 */
export async function invokeMcpTool(
  workspaceId: string,
  serverId: string,
  toolName: string,
  args: Record<string, JsonValue>,
  signal?: AbortSignal
): Promise<InvokeMcpToolResult> {
  return requestConsoleSessionJson<InvokeMcpToolResult>(
    `/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverId)}/tool-calls`,
    { method: 'POST', body: { name: toolName, arguments: args }, signal }
  )
}
