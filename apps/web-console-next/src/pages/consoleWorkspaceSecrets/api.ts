// Workspace function secrets client. Requests and bodies mirror the legacy
// apps/web-console/src/services/secretsApi.ts:60-108 field for field; the only addition is the
// page[after] cursor the legacy page never sent (functions.openapi.json:136-158).
// Secret VALUES are write-only: no method here reads one, and GET .../secrets/{name} is never called.
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { ApiError, JsonValue } from '@in-falcone/console-api/http'

const enc = encodeURIComponent

export interface WorkspaceSecret {
  secretName: string
  /** Legacy alias of secretName tolerated during convergence. */
  name?: string
  tenantId?: string
  workspaceId?: string
  resolvedRefCount?: number
  timestamps?: { createdAt?: string | null; updatedAt?: string | null }
  description?: string | null
}

export interface WorkspaceSecretCollection {
  items: WorkspaceSecret[]
  page?: { size?: number; nextCursor?: string | null }
}

export interface WriteInput { secretValue: string; description?: string }

// Carries status and identifiers only. It never holds a request body, so a secret value cannot
// travel inside a failure.
export interface Failure {
  status?: number
  code?: string
  message?: string
  requestId?: string
  correlationId?: string
}

export const failureOf = (cause: unknown): Failure => {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    message: typeof error.message === 'string' ? error.message : undefined,
    requestId: typeof error.requestId === 'string' ? error.requestId : undefined,
    correlationId: typeof error.correlationId === 'string' ? error.correlationId : undefined,
  }
}

export const SECRET_NAME_RE = /^[a-z][a-z0-9_-]{0,62}$/
export const VALUE_MAX = 65535

const secretsBase = (workspaceId: string) => `/v1/functions/workspaces/${enc(workspaceId)}/secrets`

// Legacy secretsApi.ts:55-57.
export const readSecretName = (secret: WorkspaceSecret): string => secret.secretName ?? secret.name ?? ''

// Legacy secretsApi.ts:112-117.
export const secretEnvVarName = (name: string): string => String(name).toUpperCase().replace(/[^A-Z0-9_]/g, '_')

// The first request carries no query, as legacy; later pages add page[after] only.
export function listSecrets(workspaceId: string, after?: string | null, signal?: AbortSignal) {
  const url = after ? `${secretsBase(workspaceId)}?page%5Bafter%5D=${enc(after)}` : secretsBase(workspaceId)
  return requestConsoleSessionJson<WorkspaceSecretCollection>(url, signal ? { signal } : {})
}

// Legacy secretsApi.ts:71-87.
export function createSecret(workspaceId: string, input: { secretName: string; secretValue: string; description?: string }) {
  const body: { secretName: string; secretValue: string; description?: string } = { secretName: input.secretName, secretValue: input.secretValue }
  if (input.description !== undefined) body.description = input.description
  return requestConsoleSessionJson<WorkspaceSecret>(secretsBase(workspaceId), { method: 'POST', body: body as unknown as JsonValue })
}

// Legacy secretsApi.ts:89-104.
export function updateSecret(workspaceId: string, name: string, input: WriteInput) {
  const body: WriteInput = { secretValue: input.secretValue }
  if (input.description !== undefined) body.description = input.description
  return requestConsoleSessionJson<WorkspaceSecret>(`${secretsBase(workspaceId)}/${enc(name)}`, { method: 'PUT', body: body as unknown as JsonValue })
}

// Legacy secretsApi.ts:106-110.
export function deleteSecret(workspaceId: string, name: string) {
  return requestConsoleSessionJson<unknown>(`${secretsBase(workspaceId)}/${enc(name)}`, { method: 'DELETE' })
}

export const validateName = (name: string): 'required' | 'pattern' | null => !name ? 'required' : SECRET_NAME_RE.test(name) ? null : 'pattern'
export const validateValue = (value: string): 'required' | 'max' | null => value.length === 0 ? 'required' : value.length > VALUE_MAX ? 'max' : null
