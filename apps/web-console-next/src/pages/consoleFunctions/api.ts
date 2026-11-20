// Functions administration client. Methods, paths, query strings and bodies mirror the legacy page
// legacy base 69296937330b61be2bbf2c7267520196499fc038:src/pages/ConsoleFunctionsPage.tsx and services/functionsApi.ts field for field.
// Every request goes through the shared session client, which owns the single 401 refresh and replay.
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { ApiError, JsonValue } from '@in-falcone/console-api/http'

const enc = encodeURIComponent

export interface FunctionExecutionLimits { timeoutMs?: number; memoryMb?: number; logSizeKb?: number; concurrentInvocations?: number }
export interface FunctionExecution {
  entrypoint?: string
  runtime?: string
  environment?: Record<string, string>
  limits?: FunctionExecutionLimits
  parameters?: Record<string, unknown>
  secretRefs?: string[]
}
export interface FunctionSource { kind?: string; inlineCode?: string; artifactRef?: string; imageRef?: string; entryFile?: string; digest?: string }
export interface ActivationPolicy { mode?: string; retentionDays?: number; logsRetained?: boolean; resultRetained?: boolean }
export interface FunctionActivation {
  activationId: string
  resourceId: string
  status: string
  startedAt: string
  finishedAt?: string
  durationMs: number
  triggerKind: string
  statusCode?: number
  memoryMb?: number
  invocationId?: string
  policy?: ActivationPolicy
}
export interface FunctionAction {
  resourceId: string
  tenantId?: string
  workspaceId?: string
  actionName: string
  packageName?: string
  namespaceName?: string
  subjectRef?: string
  status?: string
  activeVersionId?: string
  rollbackAvailable?: boolean
  versionCount?: number
  unresolvedSecretRefs?: number
  deploymentDigest?: string
  execution: FunctionExecution
  activationPolicy?: ActivationPolicy
  source: FunctionSource
  provisioning?: { state?: string; failureClass?: string; gatingMode?: string }
  httpExposure?: { enabled?: boolean; publicUrl?: string; authPolicy?: string; status?: string }
  kafkaTriggers?: { triggerId?: string; topicRef?: string; status?: string; deliveryMode?: string }[]
  cronTriggers?: { triggerId?: string; schedule?: string; timezone?: string; status?: string; overlapPolicy?: string }[]
  storageTriggers?: { triggerId?: string; bucketRef?: string; eventTypes?: string[]; status?: string }[]
  secretReferences?: { secretName: string; injectionMode?: string }[]
  latestActivation?: FunctionActivation
  timestamps?: { createdAt?: string; updatedAt?: string }
}
export interface FunctionInventory {
  workspaceId: string
  actions: FunctionAction[]
  counts?: { actions?: number; packages?: number; rules?: number; triggers?: number; httpExposures?: number }
  quotaStatus?: { limit?: number; used?: number; remaining?: number; enforcementMode?: string }
}
export interface FunctionVersion {
  versionId: string
  resourceId: string
  versionNumber?: number
  status?: string
  originType?: string
  rollbackEligible?: boolean
  deploymentDigest?: string
  execution?: FunctionExecution
  source?: FunctionSource
  activationPolicy?: ActivationPolicy
  timestamps?: { createdAt?: string; updatedAt?: string }
}
export interface VersionCollection { items: FunctionVersion[]; page?: { size?: number; nextCursor?: string } }
export interface ActivationCollection { items: FunctionActivation[]; page?: { total?: number; after?: string } }
export interface ActivationLog { activationId: string; lines: string[]; truncated: boolean; policy?: ActivationPolicy }
export interface ActivationResult { activationId: string; status: string; result?: unknown; contentType?: string; policy?: ActivationPolicy }
export interface InvocationAccepted {
  invocationId: string
  resourceId: string
  status: string
  acceptedAt: string
  activationId?: string
  result?: unknown
  contentType?: string
  logs?: string[]
  durationMs?: number
  activationPolicy?: ActivationPolicy
}
export interface MutationAccepted { requestId?: string; resourceId?: string; status?: string; correlationId?: string; acceptedAt?: string }
export interface RollbackAccepted { requestId: string; resourceId: string; requestedVersionId: string; status: string; correlationId: string; acceptedAt: string }
export type ResponseMode = 'accepted' | 'wait_for_result'

export interface DeployDraft { actionName: string; runtime: string; entrypoint: string; inlineCode: string; timeoutMs: string; memoryMb: string }

// What a failed request keeps for display: the status picks the copy, the ids go to the error panel.
export interface Failure { status?: number; code?: string; requestId?: string }
export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined, code: typeof error.code === 'string' ? error.code : undefined, requestId: error.requestId ?? error.correlationId }
}
export const isAbort = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError'

// Legacy ConsoleFunctionsPage.tsx:385-390: a fresh key per operation, replaced only after success.
export function buildIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `fn_${Date.now()}`
}

const workspaceBase = (workspaceId: string) => `/v1/functions/workspaces/${enc(workspaceId)}`
const actionBase = (resourceId: string) => `/v1/functions/actions/${enc(resourceId)}`
const activationBase = (resourceId: string, activationId: string) => `${actionBase(resourceId)}/activations/${enc(activationId)}`

// Legacy :525-545 loads the inventory and falls back to the actions collection on any inventory failure.
export async function loadInventory(workspaceId: string, signal?: AbortSignal): Promise<FunctionInventory> {
  try {
    return await requestConsoleSessionJson<FunctionInventory>(`${workspaceBase(workspaceId)}/inventory`, { signal })
  } catch (first) {
    if (isAbort(first)) throw first
    try {
      const fallback = await requestConsoleSessionJson<{ items: FunctionAction[] }>(`${workspaceBase(workspaceId)}/actions?page[size]=50`, { signal })
      return { workspaceId, actions: fallback.items ?? [], counts: { actions: fallback.items?.length ?? 0 } }
    } catch (second) {
      throw new InventoryError(first, second)
    }
  }
}
// Both sources failed; the copy is chosen from the fallback error first (legacy :542).
export class InventoryError extends Error {
  constructor(readonly inventory: unknown, readonly fallback: unknown) { super('inventory unavailable') }
}

export const getAction = (resourceId: string, signal?: AbortSignal) => requestConsoleSessionJson<FunctionAction>(actionBase(resourceId), { signal })
export const listVersions = (resourceId: string, signal?: AbortSignal) => requestConsoleSessionJson<VersionCollection>(`${actionBase(resourceId)}/versions?page[size]=50`, { signal })
export const listActivations = (resourceId: string, signal?: AbortSignal) => requestConsoleSessionJson<ActivationCollection>(`${actionBase(resourceId)}/activations?page[size]=50`, { signal })
export const getActivation = (resourceId: string, activationId: string, signal?: AbortSignal) => requestConsoleSessionJson<FunctionActivation>(activationBase(resourceId, activationId), { signal })
export const getActivationLogs = (resourceId: string, activationId: string, signal?: AbortSignal) => requestConsoleSessionJson<ActivationLog>(`${activationBase(resourceId, activationId)}/logs`, { signal })
export const getActivationResult = (resourceId: string, activationId: string, signal?: AbortSignal) => requestConsoleSessionJson<ActivationResult>(`${activationBase(resourceId, activationId)}/result`, { signal })

export function invokeFunction(resourceId: string, parameters: Record<string, unknown>, responseMode: ResponseMode, key: string) {
  return requestConsoleSessionJson<InvocationAccepted>(`${actionBase(resourceId)}/invocations`, {
    method: 'POST',
    body: { parameters, responseMode, idempotencyScope: 'request' } as JsonValue,
    headers: { 'Idempotency-Key': key },
  })
}

// Legacy :792-824. Empty limits are omitted from the serialised body.
export function deployFunction(mode: 'create' | 'edit', ctx: { tenantId: string; workspaceId: string; resourceId: string | null; activationPolicy?: ActivationPolicy }, draft: DeployDraft, key: string) {
  const timeoutMs = draft.timeoutMs.trim() ? Number(draft.timeoutMs) : undefined
  const memoryMb = draft.memoryMb.trim() ? Number(draft.memoryMb) : undefined
  const body = {
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    actionName: draft.actionName.trim(),
    activationPolicy: ctx.activationPolicy ?? { mode: 'workspace_default' },
    execution: { runtime: draft.runtime.trim(), entrypoint: draft.entrypoint.trim(), limits: { timeoutMs, memoryMb } },
    source: { kind: 'inline_code', inlineCode: draft.inlineCode, entryFile: 'index.js' },
  }
  return requestConsoleSessionJson<MutationAccepted>(mode === 'create' ? '/v1/functions/actions' : actionBase(ctx.resourceId ?? ''), {
    method: mode === 'create' ? 'POST' : 'PATCH',
    body: body as unknown as JsonValue,
    headers: { 'Idempotency-Key': key },
  })
}

// Request payload value, not display copy: it is sent verbatim in every locale, as the legacy page does.
export const ROLLBACK_REASON = 'Reversión iniciada desde la consola'

export function rollbackFunction(resourceId: string, versionId: string, reason: string, key: string) {
  return requestConsoleSessionJson<RollbackAccepted>(`${actionBase(resourceId)}/rollback`, {
    method: 'POST',
    body: { versionId, reason } as JsonValue,
    headers: { 'Idempotency-Key': key },
  })
}

// Legacy functionsApi.ts:145-150.
export const deleteFunction = (resourceId: string, key: string) =>
  requestConsoleSessionJson<MutationAccepted>(actionBase(resourceId), { method: 'DELETE', headers: { 'Idempotency-Key': key } })
