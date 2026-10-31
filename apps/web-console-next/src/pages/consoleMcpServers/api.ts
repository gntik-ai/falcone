import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

export interface McpServerSummary {
  serverId: string
  name: string
  status: 'draft' | 'curated' | 'published'
  lifecycleStatus?: string
  version?: string | null
}
export function listMcpServers(workspaceId: string, signal: AbortSignal) {
  return requestConsoleSessionJson<{ items: McpServerSummary[] }>(`/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers`, {
    method: 'GET', signal, suppressUnauthorizedInvalidation: true,
  })
}
