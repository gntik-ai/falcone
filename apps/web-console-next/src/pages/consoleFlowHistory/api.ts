import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

export interface ExecutionSummary {
  executionId: string
  workflowId: string
  runId?: string | null
  status?: string | null
  startedAt?: string | null
  closedAt?: string | null
  version?: string | number | null
  triggerType?: string | null
  flowId?: string | null
}
export interface ExecutionPage { items: ExecutionSummary[]; nextPageToken?: string | null }
export interface ExecutionFilters {
  flowVersion: string; status: string; triggerType: string; startedAfter: string; startedBefore: string
}
export const emptyFilters: ExecutionFilters = { flowVersion: '', status: '', triggerType: '', startedAfter: '', startedBefore: '' }

// Keep the legacy visibility terms, order, quoting and unconverted datetime-local values.
export function executionsPath(workspaceId: string, flowId: string, filters: ExecutionFilters, pageToken?: string) {
  const search = new URLSearchParams()
  if (filters.status) search.set('status', filters.status)
  const terms: string[] = []
  if (filters.flowVersion) terms.push(`flowVersion = '${filters.flowVersion}'`)
  if (filters.triggerType) terms.push(`triggerType = '${filters.triggerType}'`)
  if (filters.startedAfter) terms.push(`StartTime >= '${filters.startedAfter}'`)
  if (filters.startedBefore) terms.push(`StartTime <= '${filters.startedBefore}'`)
  if (terms.length) search.set('query', terms.join(' AND '))
  if (pageToken) search.set('page[after]', pageToken)
  const qs = search.toString()
  return `/v1/flows/workspaces/${encodeURIComponent(workspaceId)}/flows/${encodeURIComponent(flowId)}/executions${qs ? `?${qs}` : ''}`
}
export function listExecutions(workspaceId: string, flowId: string, filters: ExecutionFilters, pageToken?: string) {
  return requestConsoleSessionJson<ExecutionPage>(executionsPath(workspaceId, flowId, filters, pageToken), {
    method: 'GET', suppressUnauthorizedInvalidation: true,
  })
}
