// PostgreSQL data + schema + API-key client for the console (change: add-console-postgres-data-editor).
// Centralizes the calls to the control-plane executor (Phases 0-2): DDL execution, row CRUD,
// and workspace API keys. URLs match the executor's HTTP routes exactly.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export interface PgColumnInput {
  columnName: string
  dataType: string
  nullable?: boolean
  constraints?: { primaryKey?: boolean; unique?: boolean; checkExpression?: string }
  defaultExpression?: string
}

export interface DdlResult {
  executed: boolean
  executionMode: 'execute' | 'preview'
  statements: string[]
  statementCount?: number
}

export type PgRow = Record<string, JsonValue>

export interface RowListResult {
  items: PgRow[]
  page?: { size?: number; returned?: number }
  count?: number
}

export interface ApiKeyRecord {
  id: string
  key_type: 'anon' | 'service'
  key_prefix: string
  scopes: string[]
  status: 'active' | 'revoked'
  created_at: string
  last_used_at?: string | null
}

export interface IssuedApiKey {
  id: string
  key: string // plaintext — shown ONCE
  prefix: string
  keyType: 'anon' | 'service'
  scopes: string[]
}

// ---- Schema / DDL (database-scoped) ----
const ddlBase = (db: string, schema: string) =>
  `/v1/postgres/databases/${enc(db)}/schemas/${enc(schema)}`

export function createSchema(databaseName: string, schemaName: string): Promise<DdlResult> {
  return requestConsoleSessionJson<DdlResult>(`/v1/postgres/databases/${enc(databaseName)}/schemas`, {
    method: 'POST',
    body: { schemaName }
  })
}

export function createTable(
  databaseName: string,
  schemaName: string,
  tableName: string,
  columns: PgColumnInput[],
  options: { preview?: boolean } = {}
): Promise<DdlResult> {
  const suffix = options.preview ? '?mode=preview' : ''
  return requestConsoleSessionJson<DdlResult>(`${ddlBase(databaseName, schemaName)}/tables${suffix}`, {
    method: 'POST',
    body: { tableName, columns } as unknown as JsonValue
  })
}

export function addColumn(
  databaseName: string,
  schemaName: string,
  tableName: string,
  column: PgColumnInput
): Promise<DdlResult> {
  return requestConsoleSessionJson<DdlResult>(`${ddlBase(databaseName, schemaName)}/tables/${enc(tableName)}/columns`, {
    method: 'POST',
    body: { ...column } as unknown as JsonValue
  })
}

export function createIndex(
  databaseName: string,
  schemaName: string,
  tableName: string,
  index: { indexName: string; keys: { columnName: string }[]; indexMethod?: string; unique?: boolean }
): Promise<DdlResult> {
  return requestConsoleSessionJson<DdlResult>(`${ddlBase(databaseName, schemaName)}/tables/${enc(tableName)}/indexes`, {
    method: 'POST',
    body: { indexMethod: 'btree', ...index } as unknown as JsonValue
  })
}

// ---- Data rows (workspace-scoped) ----
const dataBase = (workspaceId: string, db: string, schema: string, table: string) =>
  `/v1/postgres/workspaces/${enc(workspaceId)}/data/${enc(db)}/schemas/${enc(schema)}/tables/${enc(table)}`

function pkQuery(primaryKey: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(primaryKey)) params.set(k, String(v))
  return params.toString()
}

export function listRows(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  options: { pageSize?: number; countMode?: 'none' | 'exact' } = {}
): Promise<RowListResult> {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  if (options.countMode) params.set('countMode', options.countMode)
  const qs = params.toString()
  return requestConsoleSessionJson<RowListResult>(`${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows${qs ? `?${qs}` : ''}`)
}

export function insertRow(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  values: PgRow
): Promise<{ item: PgRow }> {
  return requestConsoleSessionJson<{ item: PgRow }>(`${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows`, {
    method: 'POST',
    body: { values }
  })
}

export function updateRow(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  primaryKey: Record<string, string | number>,
  changes: PgRow
): Promise<{ item: PgRow; affected: number }> {
  return requestConsoleSessionJson<{ item: PgRow; affected: number }>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows/by-primary-key?${pkQuery(primaryKey)}`,
    { method: 'PATCH', body: { changes } }
  )
}

export function deleteRow(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  primaryKey: Record<string, string | number>
): Promise<{ affected: number }> {
  return requestConsoleSessionJson<{ affected: number }>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows/by-primary-key?${pkQuery(primaryKey)}`,
    { method: 'DELETE' }
  )
}

export function bulkInsert(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  rows: PgRow[]
): Promise<{ items: PgRow[]; affected: number }> {
  return requestConsoleSessionJson<{ items: PgRow[]; affected: number }>(
    `${dataBase(workspaceId, databaseName, schemaName, tableName)}/rows/bulk/insert`,
    { method: 'POST', body: { rows } }
  )
}

// ---- Workspace API keys ----
const keysBase = (workspaceId: string) => `/v1/workspaces/${enc(workspaceId)}/api-keys`

export function issueApiKey(workspaceId: string, keyType: 'anon' | 'service'): Promise<IssuedApiKey> {
  return requestConsoleSessionJson<IssuedApiKey>(keysBase(workspaceId), { method: 'POST', body: { keyType } })
}

export function listApiKeys(workspaceId: string): Promise<{ items: ApiKeyRecord[] }> {
  return requestConsoleSessionJson<{ items: ApiKeyRecord[] }>(keysBase(workspaceId))
}

export function revokeApiKey(workspaceId: string, id: string): Promise<{ id: string; revoked: boolean }> {
  return requestConsoleSessionJson<{ id: string; revoked: boolean }>(`${keysBase(workspaceId)}/${enc(id)}`, {
    method: 'DELETE'
  })
}

export function rotateApiKey(workspaceId: string, id: string): Promise<IssuedApiKey> {
  return requestConsoleSessionJson<IssuedApiKey>(`${keysBase(workspaceId)}/${enc(id)}/rotations`, { method: 'POST' })
}

// A copy-paste snippet a developer pastes into their frontend to query the table with an anon key.
export function buildFrontendSnippet(params: {
  apiKey: string
  workspaceId: string
  databaseName: string
  schemaName: string
  tableName: string
  origin?: string
}): string {
  const base = `${params.origin ?? 'https://<your-falcone-host>'}/v1/postgres/workspaces/${params.workspaceId}/data/${params.databaseName}/schemas/${params.schemaName}/tables/${params.tableName}/rows`
  return [
    `const res = await fetch(`,
    `  '${base}',`,
    `  { headers: { Authorization: 'ApiKey ${params.apiKey}' } }`,
    `)`,
    `const { items } = await res.json()`
  ].join('\n')
}
