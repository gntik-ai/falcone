// Flow control-plane API client for the console (change: add-console-flow-designer).
//
// Typed wrappers over the #361 flow API. Every call goes through `requestConsoleSessionJson`
// (same pattern as functionsApi.ts) so the bearer token + refresh are handled centrally.
//
// Endpoint shapes (verified against apps/control-plane-executor/src/runtime/server.mjs + flow-executor.mjs):
//   GET    /v1/flows/workspaces/{ws}/flows                       -> { items: FlowSummary[] }
//   POST   /v1/flows/workspaces/{ws}/flows                       -> FlowDefinitionRecord  (create draft)
//   GET    /v1/flows/workspaces/{ws}/flows/{flowId}              -> FlowDefinitionRecord
//   PATCH  /v1/flows/workspaces/{ws}/flows/{flowId}              -> FlowDefinitionRecord  (update draft)
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/validate     -> { valid: true } | 422 { errors: [...] }
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/versions     -> FlowPublishResult     (publish = pin a version)
//
// The "publish" verb in this UI maps to POST .../versions (validate-then-pin), since the #361
// API has no dedicated /publish route (see design.md DV4).
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { ApiError, JsonValue } from '@/lib/http'
import type { FlowDefinition } from '@/types/flows'

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
      message: typeof entry.message === 'string' ? entry.message : 'Validation error'
    }))
  return {
    status: typeof error.status === 'number' ? error.status : 0,
    code: typeof error.code === 'string' ? error.code : 'FLOW_API_ERROR',
    message: typeof error.message === 'string' ? error.message : 'Flow API request failed',
    body: { errors }
  }
}

export function listFlows(workspaceId: string): Promise<{ items: FlowSummary[] }> {
  return requestConsoleSessionJson<{ items: FlowSummary[] }>(flowsBase(workspaceId))
}

export function getFlow(workspaceId: string, flowId: string): Promise<FlowDefinitionRecord> {
  return requestConsoleSessionJson<FlowDefinitionRecord>(`${flowsBase(workspaceId)}/${enc(flowId)}`)
}

export function createFlowDraft(
  workspaceId: string,
  input: { name: string; definition?: FlowDefinition }
): Promise<FlowDefinitionRecord> {
  return requestConsoleSessionJson<FlowDefinitionRecord>(flowsBase(workspaceId), {
    method: 'POST',
    body: { name: input.name, definition: input.definition } as unknown as JsonValue
  })
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

export async function validateFlow(
  workspaceId: string,
  flowId: string
): Promise<{ valid: boolean }> {
  try {
    return await requestConsoleSessionJson<{ valid: boolean }>(
      `${flowsBase(workspaceId)}/${enc(flowId)}/validate`,
      { method: 'POST' }
    )
  } catch (rawError) {
    throw toFlowApiError(rawError)
  }
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

// ---- Flow schedule management (change: add-flow-schedule-management-api / #680) -------------
//
// Operate in place on a flow's cron Temporal Schedule (created on publish) WITHOUT deleting the
// flow. Endpoint shapes (verified against apps/control-plane-executor/src/runtime/server.mjs +
// flow-executor.mjs; tenant isolation is identity-derived, identical to the rest of the Flows API):
//   GET    /v1/flows/workspaces/{ws}/schedules                       -> { items: FlowScheduleSummary[] }
//   GET    /v1/flows/workspaces/{ws}/flows/{flowId}/schedule         -> FlowSchedule (404 if none)
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/schedule/pause   -> FlowSchedule (paused=true)
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/schedule/resume  -> FlowSchedule (paused=false)
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/schedule/trigger -> { status: 'triggered'; scheduleId }

// One recent (or upcoming-derived) schedule action, trimmed to the stable fields the API exposes.
export interface FlowScheduleRecentAction {
  scheduledAt: string | null
  takenAt: string | null
  workflowId: string | null
}

// The normalized schedule resource the executor returns (stable shape — never raw Temporal internals).
export interface FlowSchedule {
  scheduleId: string
  flowId?: string
  workspaceId: string
  paused: boolean
  note?: string | null
  // The schedule's cron expression(s); may be empty when Temporal only exposes structured calendars.
  cron: string[]
  // Upcoming scheduled fire times, ISO-8601 (empty while the schedule is paused).
  nextActionTimes: string[]
  recentActions?: FlowScheduleRecentAction[]
}

// The list summary is the same normalized resource (the executor reuses one normalizer).
export type FlowScheduleSummary = FlowSchedule

export interface FlowScheduleTriggerAck {
  status: 'triggered'
  scheduleId: string
}

export function listFlowSchedules(workspaceId: string): Promise<{ items: FlowScheduleSummary[] }> {
  return requestConsoleSessionJson<{ items: FlowScheduleSummary[] }>(
    `/v1/flows/workspaces/${enc(workspaceId)}/schedules`
  )
}

export function getFlowSchedule(workspaceId: string, flowId: string): Promise<FlowSchedule> {
  return requestConsoleSessionJson<FlowSchedule>(`${flowsBase(workspaceId)}/${enc(flowId)}/schedule`)
}

export function pauseFlowSchedule(workspaceId: string, flowId: string): Promise<FlowSchedule> {
  return requestConsoleSessionJson<FlowSchedule>(
    `${flowsBase(workspaceId)}/${enc(flowId)}/schedule/pause`,
    { method: 'POST' }
  )
}

export function resumeFlowSchedule(workspaceId: string, flowId: string): Promise<FlowSchedule> {
  return requestConsoleSessionJson<FlowSchedule>(
    `${flowsBase(workspaceId)}/${enc(flowId)}/schedule/resume`,
    { method: 'POST' }
  )
}

export function triggerFlowSchedule(
  workspaceId: string,
  flowId: string
): Promise<FlowScheduleTriggerAck> {
  return requestConsoleSessionJson<FlowScheduleTriggerAck>(
    `${flowsBase(workspaceId)}/${enc(flowId)}/schedule/trigger`,
    { method: 'POST' }
  )
}
