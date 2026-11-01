// Quick-deploy function client. Requests and bodies mirror the legacy
// apps/web-console/src/services/functionsApi.ts:127-237 field for field.
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { JsonValue } from '@in-falcone/console-api/http'

const enc = encodeURIComponent

type JsonObject = Record<string, JsonValue>

export interface FunctionRecord {
  resourceId: string
  actionName: string
  execution?: { runtime?: string } & Record<string, JsonValue | undefined>
}

export interface DeployAccepted { resourceId: string }
export interface InvocationResult { result?: JsonValue }
export interface ActivationRecord { activationId: string; status?: string; startedAt?: string; durationMs?: number }
export type DeploySpec = Record<string, JsonValue>

const workspaceActionsBase = (workspaceId: string) => `/v1/functions/workspaces/${enc(workspaceId)}/actions`
const actionResourceBase = (resourceId: string) => `/v1/functions/actions/${enc(resourceId)}`

export function listFunctions(workspaceId: string) {
  return requestConsoleSessionJson<{ items: FunctionRecord[] }>(workspaceActionsBase(workspaceId))
}

export function deployFunction(workspaceId: string, spec: DeploySpec, tenantId: string) {
  return requestConsoleSessionJson<DeployAccepted>('/v1/functions/actions', {
    method: 'POST',
    body: toFunctionActionWriteRequest(workspaceId, spec, tenantId) as JsonValue,
  })
}

export function invokeFunction(resourceId: string, payload: JsonValue) {
  return requestConsoleSessionJson<InvocationResult>(`${actionResourceBase(resourceId)}/invocations`, {
    method: 'POST',
    body: toFunctionInvocationWriteRequest(payload) as JsonValue,
  })
}

export function listActivations(resourceId: string) {
  return requestConsoleSessionJson<{ items: ActivationRecord[] }>(`${actionResourceBase(resourceId)}/activations`)
}

// Legacy functionsApi.ts:169-221.
export function toFunctionActionWriteRequest(workspaceId: string, spec: DeploySpec, tenantId: string): JsonObject {
  const effectiveTenantId = requiredString(tenantId, 'tenantId')

  if (isJsonObject(spec.source) && isJsonObject(spec.execution)) {
    const { name: _name, runtime: _runtime, code: _code, main: _main, entrypoint: _entrypoint, ...rest } = spec
    const actionName = stringValue(spec.actionName) ?? stringValue(spec.name)
    return {
      ...rest,
      tenantId: effectiveTenantId,
      workspaceId,
      ...(actionName ? { actionName } : {}),
    }
  }

  const actionName = stringValue(spec.actionName) ?? stringValue(spec.name) ?? ''
  const inlineCode = stringValue(spec.code) ?? ''
  const runtime = normalizeRuntime(stringValue(spec.runtime))
  const entrypoint = stringValue(spec.entrypoint) ?? stringValue(spec.main) ?? 'main'

  return {
    tenantId: effectiveTenantId,
    workspaceId,
    actionName,
    source: { kind: 'inline_code', language: 'javascript', inlineCode, entryFile: 'index.js' },
    execution: {
      runtime,
      entrypoint,
      parameters: isJsonObject(spec.parameters) ? spec.parameters : {},
      environment: isStringRecord(spec.environment) ? spec.environment : {},
      limits: normalizeLimits(isJsonObject(spec.limits) ? spec.limits : undefined),
      webAction: { enabled: false, requireAuthentication: true, rawHttpResponse: false },
    },
    activationPolicy: {
      logsAccess: 'workspace_developers',
      resultAccess: 'workspace_developers',
      rerunPolicy: 'manual_only',
      retentionHours: 168,
    },
  }
}

// Legacy functionsApi.ts:223-237.
export function toFunctionInvocationWriteRequest(payload: JsonValue): JsonValue {
  if (isJsonObject(payload) && isInvocationEnvelope(payload)) return payload
  return { parameters: payload }
}

function isInvocationEnvelope(value: JsonObject): boolean {
  return ['parameters', 'triggerContext', 'responseMode', 'idempotencyScope']
    .some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function normalizeRuntime(runtime: string | undefined): string {
  if (runtime == null || runtime === '' || runtime === 'nodejs') return 'nodejs:20'
  return runtime
}

function normalizeLimits(limits: JsonObject | undefined): JsonObject {
  const timeoutSeconds = numericValue(limits?.timeoutSeconds) ?? timeoutMsToSeconds(numericValue(limits?.timeoutMs)) ?? 60
  const memoryMb = numericValue(limits?.memoryMb) ?? 256
  return { timeoutSeconds, memoryMb }
}

function timeoutMsToSeconds(timeoutMs: number | undefined): number | undefined {
  return timeoutMs == null ? undefined : Math.max(1, Math.ceil(timeoutMs / 1000))
}

function numericValue(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function requiredString(value: string | undefined, fieldName: string): string {
  if (value == null || value.trim() === '') throw new Error(`${fieldName} is required`)
  return value.trim()
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isJsonObject(value) && Object.values(value).every((entry) => typeof entry === 'string')
}
