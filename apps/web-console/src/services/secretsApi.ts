// Workspace secrets data client for the console (change: add-console-secrets-management, #723).
//
// Calls ONLY the five advertised function_workspace_secret routes, built on the authenticated
// console HTTP layer (requestConsoleSessionJson over http.ts) so every call inherits the session
// Authorization bearer, the 401-refresh-retry, X-API-Version, X-Correlation-Id, and (for any
// non-GET) a fresh Idempotency-Key — no per-call header plumbing. Unlike the legacy
// secretRotationActions client, this NEVER uses a bare unauthenticated fetch.
//
// Secret VALUES are write-only end to end: there is NO value-returning method here (none exists
// server-side — the value is resolved only at function deploy, server-side). Read types mirror the
// OpenAPI FunctionWorkspaceSecret / FunctionWorkspaceSecretCollection schemas and carry NO value
// field; only the write-request type carries secretValue.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

// LifecycleTimestamps (subset the screen reads). createdAt/updatedAt are required by the schema.
export interface SecretTimestamps {
  createdAt: string
  updatedAt: string
  activatedAt?: string
  suspendedAt?: string
  deletedAt?: string
}

// FunctionWorkspaceSecret — metadata ONLY (no value field). `name` is the legacy alias tolerated
// during the runtime convergence; `secretName` is the canonical field the screen reads.
export interface WorkspaceSecret {
  secretName: string
  /** Legacy alias of secretName tolerated during convergence; prefer secretName. */
  name?: string
  tenantId: string
  workspaceId: string
  resolvedRefCount: number
  timestamps: SecretTimestamps
  description?: string
}

// FunctionWorkspaceSecretCollection.
export interface WorkspaceSecretCollection {
  items: WorkspaceSecret[]
  page: { size: number; nextCursor?: string }
}

// FunctionWorkspaceSecretWriteRequest — the ONLY type that carries secretValue (write-only).
export interface WorkspaceSecretWriteRequest {
  secretValue: string
  description?: string
}

const secretsBase = (workspaceId: string) => `/v1/functions/workspaces/${enc(workspaceId)}/secrets`

// Read the canonical secretName even if a transitional runtime returns only the legacy `name` alias.
export function readSecretName(secret: WorkspaceSecret): string {
  return secret.secretName ?? secret.name ?? ''
}

// GET …/secrets — list workspace secrets (metadata only, never a value).
export function listSecrets(workspaceId: string): Promise<WorkspaceSecretCollection> {
  return requestConsoleSessionJson<WorkspaceSecretCollection>(secretsBase(workspaceId))
}

// GET …/secrets/{name} — one secret's metadata (never a value).
export function getSecretMeta(workspaceId: string, name: string): Promise<WorkspaceSecret> {
  return requestConsoleSessionJson<WorkspaceSecret>(`${secretsBase(workspaceId)}/${enc(name)}`)
}

// POST …/secrets — CREATE a secret (create-only server-side; 409 on an existing name). The value is
// sent write-only and MUST be cleared from component state by the caller after a successful submit.
export function createSecret(
  workspaceId: string,
  input: { secretName: string; secretValue: string; description?: string }
): Promise<WorkspaceSecret> {
  const body: { secretName: string; secretValue: string; description?: string } = {
    secretName: input.secretName,
    secretValue: input.secretValue
  }
  if (input.description !== undefined) {
    body.description = input.description
  }
  return requestConsoleSessionJson<WorkspaceSecret>(secretsBase(workspaceId), {
    method: 'POST',
    body: body as unknown as JsonValue
  })
}

// PUT …/secrets/{name} — REPLACE a secret's value (prior value superseded). Write-only value.
export function updateSecret(
  workspaceId: string,
  name: string,
  input: WorkspaceSecretWriteRequest
): Promise<WorkspaceSecret> {
  const body: WorkspaceSecretWriteRequest = { secretValue: input.secretValue }
  if (input.description !== undefined) {
    body.description = input.description
  }
  return requestConsoleSessionJson<WorkspaceSecret>(`${secretsBase(workspaceId)}/${enc(name)}`, {
    method: 'PUT',
    body: body as unknown as JsonValue
  })
}

// DELETE …/secrets/{name} — remove a secret (all versions). The runtime follows the published
// contract: 204 with no response body when the secret existed; 404 when it did not.
export function deleteSecret(workspaceId: string, name: string): Promise<unknown> {
  return requestConsoleSessionJson<unknown>(`${secretsBase(workspaceId)}/${enc(name)}`, {
    method: 'DELETE'
  })
}

// Default env-var name for a secret (UPPER_SNAKE) — mirrors the runtime's secretEnvVarName so the
// operator sees how the secret is injected into a function's environment.
export function secretEnvVarName(name: string): string {
  return String(name)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
}
