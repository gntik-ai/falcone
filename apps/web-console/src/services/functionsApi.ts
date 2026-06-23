// Functions data client for the console (change: add-console-functions-data-editor).
// Calls the control-plane executor's function routes exactly: list/deploy/get/invoke/activations.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export interface FunctionRecord {
  name: string
  runtime?: string
  updatedAt?: string
}

export interface InvocationResult {
  result?: JsonValue
  activationId?: string
  durationMs?: number
  logs?: string[]
}

export interface ActivationRecord {
  activationId: string
  status?: string
  startedAt?: string
  durationMs?: number
}

const actionsBase = (workspaceId: string) => `/v1/functions/workspaces/${enc(workspaceId)}/actions`

export function listFunctions(workspaceId: string): Promise<{ items: FunctionRecord[] }> {
  return requestConsoleSessionJson<{ items: FunctionRecord[] }>(actionsBase(workspaceId))
}

export function deployFunction(
  workspaceId: string,
  spec: { name: string; runtime?: string; code?: string; main?: string } & Record<string, JsonValue>
): Promise<FunctionRecord> {
  return requestConsoleSessionJson<FunctionRecord>(actionsBase(workspaceId), {
    method: 'POST',
    body: spec as unknown as JsonValue
  })
}

export function getFunction(workspaceId: string, name: string): Promise<FunctionRecord> {
  return requestConsoleSessionJson<FunctionRecord>(`${actionsBase(workspaceId)}/${enc(name)}`)
}

export function invokeFunction(
  workspaceId: string,
  name: string,
  payload: JsonValue
): Promise<InvocationResult> {
  return requestConsoleSessionJson<InvocationResult>(
    `${actionsBase(workspaceId)}/${enc(name)}/invocations`,
    { method: 'POST', body: payload }
  )
}

export function listActivations(workspaceId: string, name: string): Promise<{ items: ActivationRecord[] }> {
  return requestConsoleSessionJson<{ items: ActivationRecord[] }>(
    `${actionsBase(workspaceId)}/${enc(name)}/activations`
  )
}

// ---- Function definition export / import (change: add-data-export-import-clone, #683) ----
export interface FunctionDefinitionBundle {
  bundleVersion: string
  tenantId: string
  workspaceId: string
  scope?: { tenantId: string; workspaceId: string }
  resources: Array<Record<string, JsonValue>>
  definitions?: Array<Record<string, JsonValue>>
}

export interface FunctionDefinitionImportResult {
  entityType: string
  targetTenantId: string
  targetWorkspaceId: string
  totalEntries: number
  importedCount: number
  skippedCount: number
}

// Export ONE action's deployable definition bundle (source/runtime/entrypoint/parameters).
export function exportFunctionDefinition(resourceId: string): Promise<FunctionDefinitionBundle> {
  return requestConsoleSessionJson<FunctionDefinitionBundle>(
    `/v1/functions/actions/${enc(resourceId)}/definition-export`
  )
}

// Export every action in a package within a workspace.
export function exportPackageDefinition(workspaceId: string, packageName: string): Promise<FunctionDefinitionBundle> {
  return requestConsoleSessionJson<FunctionDefinitionBundle>(
    `/v1/functions/workspaces/${enc(workspaceId)}/packages/${enc(packageName)}/definition-export`
  )
}

// Import a definition bundle into the caller's workspace (re-scoped to the verified tenant/workspace;
// a cross-scope bundle is rejected server-side with IMPORT_SCOPE_VIOLATION).
export function importFunctionDefinition(
  workspaceId: string,
  bundle: FunctionDefinitionBundle
): Promise<FunctionDefinitionImportResult> {
  return requestConsoleSessionJson<FunctionDefinitionImportResult>(
    `/v1/functions/workspaces/${enc(workspaceId)}/definition-imports`,
    { method: 'POST', body: bundle as unknown as JsonValue }
  )
}

// Import a package definition bundle (every definition must carry a package).
export function importPackageDefinition(
  workspaceId: string,
  bundle: FunctionDefinitionBundle
): Promise<FunctionDefinitionImportResult> {
  return requestConsoleSessionJson<FunctionDefinitionImportResult>(
    `/v1/functions/workspaces/${enc(workspaceId)}/package-definition-imports`,
    { method: 'POST', body: bundle as unknown as JsonValue }
  )
}
