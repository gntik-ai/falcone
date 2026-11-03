import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

export interface WorkspaceRealtimeResponse {
  workspaceId: string
  realtimeEndpointUrl?: string | null
  features?: { realtime?: boolean }
  dataSources?: Array<{ type?: string | null }>
}
export function getWorkspaceRealtime(workspaceId: string) {
  return requestConsoleSessionJson<WorkspaceRealtimeResponse>(`/v1/workspaces/${workspaceId}/realtime`)
}
