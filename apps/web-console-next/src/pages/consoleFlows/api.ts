import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

export interface FlowSummary {
  flowId: string; name: string; status?: string; dslApiVersion?: string
  createdAt?: string; updatedAt?: string; createdBy?: string
}
export interface TriggerAck { status: 'triggered'; scheduleId: string }
export const flowsPath = (workspaceId: string) => `/v1/flows/workspaces/${encodeURIComponent(workspaceId)}/flows`
export function listFlows(workspaceId: string) {
  return requestConsoleSessionJson<{ items: FlowSummary[] }>(flowsPath(workspaceId), { method: 'GET' })
}
export function createFlowDraft(workspaceId: string, name: string) {
  return requestConsoleSessionJson<FlowSummary>(flowsPath(workspaceId), { method: 'POST', body: { name } })
}
export function triggerFlowSchedule(workspaceId: string, flowId: string) {
  return requestConsoleSessionJson<TriggerAck>(`${flowsPath(workspaceId)}/${encodeURIComponent(flowId)}/schedule/trigger`, { method: 'POST' })
}
// The designer remains in the legacy document until its own migration lands.
export const designerNavigation = { assign: (href: string) => window.location.assign(href) }
