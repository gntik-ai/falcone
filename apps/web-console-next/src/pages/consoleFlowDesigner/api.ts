import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { ApiError, JsonValue } from '@in-falcone/console-api/http'
import type { FlowDefinition, TaskTypeDescriptor } from './flows'

const enc = encodeURIComponent

const flowsBase = (workspaceId: string) => `/v1/flows/workspaces/${enc(workspaceId)}/flows`

export interface FlowSummary {
  flowId: string
  name: string
  status?: string
  dslApiVersion?: string
  createdAt?: string
  updatedAt?: string
  createdBy?: string
}

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

export interface FlowPublishResult {
  flowId: string
  version: number
  createdAt?: string
}

// A server-side semantic error entry as carried on a 422 FLOW_VALIDATION_FAILED envelope.
export interface FlowServerError {
  code: string
  nodeId?: string | null
  message: string
  params?: Record<string, unknown>
}

// Normalised rejection a caller can map onto canvas nodes. `body.errors` mirrors the spec
// requirement ("the rejected Promise SHALL carry an error object whose body.errors array
// includes entries with nodeId fields").
export interface FlowApiError {
  status: number
  code: string
  message: string
  body: { errors: FlowServerError[] }
}

export function isFlowApiError(value: unknown): value is FlowApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'body' in value &&
    typeof (value as { body?: unknown }).body === 'object' &&
    (value as { body: { errors?: unknown } }).body !== null &&
    Array.isArray((value as { body: { errors?: unknown } }).body.errors)
  )
}

// Re-shape a raw ApiError into a FlowApiError, lifting the preserved top-level `errors` array
// (see http.ts DV3) into `body.errors`. A non-422 / errors-less rejection still yields an
// empty array so the caller can branch on `body.errors.length`.
function toFlowApiError(rawError: unknown): FlowApiError {
  const error = (rawError ?? {}) as Partial<ApiError> & { errors?: unknown }
  const rawErrors: unknown[] = Array.isArray(error.errors) ? (error.errors as unknown[]) : []
  const errors: FlowServerError[] = rawErrors
    .filter(
      (entry): entry is { [key: string]: unknown } =>
        typeof entry === 'object' && entry !== null && !Array.isArray(entry)
    )
    .map((entry) => ({
      code: typeof entry.code === 'string' ? entry.code : 'FLW-EUNKNOWN',
      nodeId: typeof entry.nodeId === 'string' ? entry.nodeId : null,
      message: typeof entry.message === 'string' ? entry.message : 'Validation error',
      ...(typeof entry.params === 'object' && entry.params !== null && !Array.isArray(entry.params)
        ? { params: entry.params as Record<string, unknown> }
        : {})
    }))
  return {
    status: typeof error.status === 'number' ? error.status : 0,
    code: typeof error.code === 'string' ? error.code : 'FLOW_API_ERROR',
    message: typeof error.message === 'string' ? error.message : 'Flow API request failed',
    body: { errors }
  }
}

export function getFlow(workspaceId: string, flowId: string): Promise<FlowDefinitionRecord> {
  return requestConsoleSessionJson<FlowDefinitionRecord>(`${flowsBase(workspaceId)}/${enc(flowId)}`)
}

export function updateFlowDraft(
  workspaceId: string,
  flowId: string,
  input: { name?: string; definition: FlowDefinition }
): Promise<FlowDefinitionRecord> {
  return requestConsoleSessionJson<FlowDefinitionRecord>(`${flowsBase(workspaceId)}/${enc(flowId)}`, {
    method: 'PATCH',
    body: { name: input.name, definition: input.definition } as unknown as JsonValue
  })
}

export async function publishFlow(
  workspaceId: string,
  flowId: string
): Promise<FlowPublishResult> {
  try {
    return await requestConsoleSessionJson<FlowPublishResult>(
      `${flowsBase(workspaceId)}/${enc(flowId)}/versions`,
      { method: 'POST' }
    )
  } catch (rawError) {
    throw toFlowApiError(rawError)
  }
}


export interface FlowScheduleTriggerAck { status: 'triggered'; scheduleId: string }
export function triggerFlowSchedule(workspaceId: string, flowId: string): Promise<FlowScheduleTriggerAck> {
  return requestConsoleSessionJson<FlowScheduleTriggerAck>(`${flowsBase(workspaceId)}/${enc(flowId)}/schedule/trigger`, { method: 'POST' })
}
export async function listTaskTypes(workspaceId: string): Promise<TaskTypeDescriptor[]> {
  const response = await requestConsoleSessionJson<{ items: TaskTypeDescriptor[] }>(`/v1/flows/workspaces/${enc(workspaceId)}/task-types`)
  return response.items ?? []
}
