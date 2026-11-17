import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { JsonValue } from '@in-falcone/console-api/http'
import type { FlowDefinition } from './flows'

const enc = encodeURIComponent
const flowsBase = (workspaceId: string) => `/v1/flows/workspaces/${enc(workspaceId)}/flows`

export interface FlowDefinitionRecord {
  flowId: string
  name: string
  status?: string
  dslApiVersion?: string
  definition?: FlowDefinition
  definitionYaml?: string | null
  createdAt?: string
  updatedAt?: string
}

export type NodeStatus = 'scheduled' | 'started' | 'retrying' | 'completed' | 'failed' | 'skipped' | 'waiting-approval'
export interface ExecutionAttempt { status: NodeStatus; attemptNumber?: number; startedAt?: string | null; completedAt?: string | null }
export interface ExecutionNodeDetail {
  nodeId: string
  status?: NodeStatus | null
  input?: JsonValue | null
  output?: JsonValue | null
  error?: { message: string; stack?: string } | null
  attempts?: ExecutionAttempt[]
}
export interface ExecutionDetail {
  executionId: string
  workflowId: string
  status?: string | null
  version?: string | number | null
  startedAt?: string | null
  closedAt?: string | null
  input?: JsonValue | null
  result?: JsonValue | null
  events?: Array<{ nodeId: string; eventId?: string; type?: string }>
  nodes?: ExecutionNodeDetail[]
}

// Terminal Temporal statuses drive the cancel-disabled and retry-visible gating.
const TERMINAL = new Set(['Completed', 'Failed', 'Canceled', 'Cancelled', 'Terminated', 'TimedOut', 'ContinuedAsNew'])
export function isTerminalExecution(status: string | null | undefined): boolean {
  return status != null && TERMINAL.has(status)
}

export function getFlow(workspaceId: string, flowId: string): Promise<FlowDefinitionRecord> {
  return requestConsoleSessionJson<FlowDefinitionRecord>(`${flowsBase(workspaceId)}/${enc(flowId)}`)
}
export function getExecution(workspaceId: string, flowId: string, executionId: string): Promise<ExecutionDetail> {
  return requestConsoleSessionJson<ExecutionDetail>(`${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}`)
}
export function cancelExecution(workspaceId: string, flowId: string, executionId: string): Promise<{ executionId: string; status: string }> {
  return requestConsoleSessionJson(`${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}/cancellations`, { method: 'POST' })
}
export function retryExecution(workspaceId: string, flowId: string, executionId: string): Promise<{ executionId: string; status: string; version?: number }> {
  return requestConsoleSessionJson(`${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}/retries`, { method: 'POST' })
}
// The signal name is the approval node id; the payload carries the decision and that node.
export function sendApprovalSignal(workspaceId: string, flowId: string, executionId: string, signalName: string, decision: { approved: boolean; nodeId?: string }): Promise<{ executionId: string; signal: string; delivered: boolean }> {
  return requestConsoleSessionJson(`${flowsBase(workspaceId)}/${enc(flowId)}/executions/${enc(executionId)}/signals/${enc(signalName)}`,
    { method: 'POST', body: { approved: decision.approved, nodeId: decision.nodeId } as unknown as JsonValue })
}
