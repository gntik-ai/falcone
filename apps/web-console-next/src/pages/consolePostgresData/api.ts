// Row editor and API-key client. Methods, paths, query strings and bodies mirror the legacy
// legacy base 69296937330b61be2bbf2c7267520196499fc038:src/services/postgresApi.ts:100-340 and components/console/PostgresDataEditor.tsx field for field.
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { requestJson, type ApiError, type JsonValue } from '@in-falcone/console-api/http'

const enc = encodeURIComponent

export type PgRow = Record<string, JsonValue>
export type PgFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like' | 'ilike'
export const FILTER_OPERATORS: PgFilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in']
export const PAGE_SIZES = [10, 25, 50, 100]

export interface PgFilter {
  columnName: string
  operator: PgFilterOperator
  value: string | number | boolean | Array<string | number>
}
export interface RowListResult {
  items: PgRow[]
  page?: { size?: number; returned?: number; after?: string }
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
  key: string // plaintext, shown once and kept in component memory only
  prefix: string
  keyType: 'anon' | 'service'
  scopes: string[]
}
export interface Target { workspaceId: string; databaseName: string; schemaName: string; tableName: string }
export type Failure = { status?: number; requestId?: string; message?: string }

export const failureOf = (cause: unknown): Failure => {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId, message: typeof error.message === 'string' ? error.message : undefined }
}

const dataBase = ({ workspaceId, databaseName, schemaName, tableName }: Target) =>
  `/v1/postgres/workspaces/${enc(workspaceId)}/data/${enc(databaseName)}/schemas/${enc(schemaName)}/tables/${enc(tableName)}`
const keysBase = (workspaceId: string) => `/v1/workspaces/${enc(workspaceId)}/api-keys`

function pkQuery(primaryKey: Record<string, string | number>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(primaryKey)) params.set(k, String(v))
  return params.toString()
}
function filterToQueryValue(filter: PgFilter): string {
  if (filter.operator === 'in' && Array.isArray(filter.value)) return `in.(${filter.value.join(',')})`
  return `${filter.operator}.${String(filter.value)}`
}

export function listRows(target: Target, options: { pageSize?: number; after?: string; countMode?: 'none' | 'exact'; filters?: PgFilter[] } = {}) {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  if (options.after != null) params.set('page[after]', options.after)
  if (options.countMode) params.set('countMode', options.countMode)
  // PostgREST-style filters: one query parameter per filter, duplicates allowed.
  for (const filter of options.filters ?? []) params.append(filter.columnName, filterToQueryValue(filter))
  const qs = params.toString()
  return requestConsoleSessionJson<RowListResult>(`${dataBase(target)}/rows${qs ? `?${qs}` : ''}`)
}
export function insertRow(target: Target, values: PgRow) {
  return requestConsoleSessionJson<{ item: PgRow }>(`${dataBase(target)}/rows`, { method: 'POST', body: { values } })
}
export function updateRow(target: Target, primaryKey: Record<string, string | number>, changes: PgRow) {
  return requestConsoleSessionJson<{ item: PgRow; affected: number }>(`${dataBase(target)}/rows/by-primary-key?${pkQuery(primaryKey)}`, { method: 'PATCH', body: { changes } })
}
export function deleteRow(target: Target, primaryKey: Record<string, string | number>) {
  return requestConsoleSessionJson<{ affected: number }>(`${dataBase(target)}/rows/by-primary-key?${pkQuery(primaryKey)}`, { method: 'DELETE' })
}
export function issueApiKey(workspaceId: string, keyType: 'anon' | 'service') {
  return requestConsoleSessionJson<IssuedApiKey>(keysBase(workspaceId), { method: 'POST', body: { keyType } })
}
export function listApiKeys(workspaceId: string) {
  return requestConsoleSessionJson<{ items: ApiKeyRecord[] }>(keysBase(workspaceId))
}
export function revokeApiKey(workspaceId: string, id: string) {
  return requestConsoleSessionJson<{ id: string; revoked: boolean }>(`${keysBase(workspaceId)}/${enc(id)}`, { method: 'DELETE' })
}

// Read-only preview AS the issued key: a bare request carrying the `apikey` header and no Authorization,
// exactly what a frontend embed sends. It goes through requestJson, so a 401 never starts a session refresh.
export function previewRowsWithApiKey(apiKey: string, target: Target, options: { pageSize?: number } = {}) {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  const qs = params.toString()
  return requestJson<RowListResult>(`${dataBase(target)}/rows${qs ? `?${qs}` : ''}`, { headers: { apikey: apiKey } })
}

interface SnippetParams extends Target { apiKey: string; origin?: string }
const embedRowsUrl = (params: SnippetParams) =>
  `${params.origin ?? 'https://<your-falcone-host>'}/v1/postgres/workspaces/${params.workspaceId}/data/${params.databaseName}/schemas/${params.schemaName}/tables/${params.tableName}/rows`
// The gateway routes anon and service keys by the `apikey` header, not Authorization.
export function buildFrontendSnippet(params: SnippetParams): string {
  return [`const res = await fetch(`, `  '${embedRowsUrl(params)}',`, `  { headers: { apikey: '${params.apiKey}' } }`, `)`, `const { items } = await res.json()`].join('\n')
}
export function buildCurlSnippet(params: SnippetParams): string {
  return [`curl -H 'apikey: ${params.apiKey}' \\`, `  '${embedRowsUrl(params)}'`].join('\n')
}

// Pure helpers ported from legacy base 69296937330b61be2bbf2c7267520196499fc038:src/lib/editor-ux.ts.
export const formatCell = (value: unknown): string => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
export function collectColumns(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key)
  return Array.from(seen)
}
export type ParseResult = { ok: true; value: PgRow } | { ok: false; error: 'jsonInvalid' | 'jsonObjectExpected' }
export function parseJsonObject(text: string): ParseResult {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, error: 'jsonInvalid' } }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'jsonObjectExpected' }
  return { ok: true, value: parsed as PgRow }
}
export const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2)
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  return false
}
