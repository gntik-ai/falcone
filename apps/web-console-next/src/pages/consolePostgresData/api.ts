import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { requestJson, type JsonValue } from '@in-falcone/console-api/http'

// Requests mirror apps/web-console/src/services/postgresApi.ts field for field: same method,
// path, query parameters and payload shape. Only the calls this page makes are ported.
const enc = encodeURIComponent

export type PgRow = Record<string, JsonValue>
export type PgFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like' | 'ilike'
export const FILTER_OPERATORS: PgFilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in']
export const PAGE_SIZES = [10, 25, 50, 100]
export interface PgFilter { columnName: string; operator: PgFilterOperator; value: string | number | boolean | Array<string | number> }
export interface RowListResult { items: PgRow[]; page?: { size?: number; returned?: number; after?: string }; count?: number }
export interface ApiKeyRecord { id: string; key_type: 'anon' | 'service'; key_prefix: string; scopes: string[]; status: 'active' | 'revoked'; created_at: string; last_used_at?: string | null }
export interface IssuedApiKey { id: string; key: string; prefix: string; keyType: 'anon' | 'service'; scopes: string[] }
export type Target = { workspaceId: string; databaseName: string; schemaName: string; tableName: string }
export type Failure = { status?: number; requestId?: string; message?: string }

export const failureOf = (cause: unknown): Failure => {
  const error = cause as Failure | null
  return { status: typeof error?.status === 'number' ? error.status : undefined, requestId: error?.requestId, message: typeof error?.message === 'string' ? error.message : undefined }
}

const dataBase = ({ workspaceId, databaseName, schemaName, tableName }: Target) =>
  `/v1/postgres/workspaces/${enc(workspaceId)}/data/${enc(databaseName)}/schemas/${enc(schemaName)}/tables/${enc(tableName)}`
function pkQuery(primaryKey: Record<string, string | number>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(primaryKey)) params.set(key, String(value))
  return params.toString()
}
const filterValue = (filter: PgFilter) => filter.operator === 'in' && Array.isArray(filter.value) ? `in.(${filter.value.join(',')})` : `${filter.operator}.${String(filter.value)}`

// postgresApi.ts:124-150
export function listRows(target: Target, options: { pageSize?: number; after?: string; countMode?: 'none' | 'exact'; filters?: PgFilter[] } = {}) {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  if (options.after != null) params.set('page[after]', options.after)
  if (options.countMode) params.set('countMode', options.countMode)
  for (const filter of options.filters ?? []) params.append(filter.columnName, filterValue(filter))
  const query = params.toString()
  return requestConsoleSessionJson<RowListResult>(`${dataBase(target)}/rows${query ? `?${query}` : ''}`)
}
// postgresApi.ts:152-163
export const insertRow = (target: Target, values: PgRow) => requestConsoleSessionJson<{ item: PgRow }>(`${dataBase(target)}/rows`, { method: 'POST', body: { values } })
// postgresApi.ts:165-177
export const updateRow = (target: Target, primaryKey: Record<string, string | number>, changes: PgRow) =>
  requestConsoleSessionJson<{ item: PgRow; affected: number }>(`${dataBase(target)}/rows/by-primary-key?${pkQuery(primaryKey)}`, { method: 'PATCH', body: { changes } })
// postgresApi.ts:179-190
export const deleteRow = (target: Target, primaryKey: Record<string, string | number>) =>
  requestConsoleSessionJson<{ affected: number }>(`${dataBase(target)}/rows/by-primary-key?${pkQuery(primaryKey)}`, { method: 'DELETE' })

const keysBase = (workspaceId: string) => `/v1/workspaces/${enc(workspaceId)}/api-keys`
// postgresApi.ts:267-281
export const issueApiKey = (workspaceId: string, keyType: 'anon' | 'service') => requestConsoleSessionJson<IssuedApiKey>(keysBase(workspaceId), { method: 'POST', body: { keyType } })
export const listApiKeys = (workspaceId: string) => requestConsoleSessionJson<{ items: ApiKeyRecord[] }>(keysBase(workspaceId))
export const revokeApiKey = (workspaceId: string, id: string) => requestConsoleSessionJson<{ id: string; revoked: boolean }>(`${keysBase(workspaceId)}/${enc(id)}`, { method: 'DELETE' })

// postgresApi.ts:313-327: a bare apikey-header request through requestJson. It carries no console
// session token and never triggers the session refresh.
export function previewRowsWithApiKey(apiKey: string, target: Target, options: { pageSize?: number } = {}) {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  const query = params.toString()
  return requestJson<RowListResult>(`${dataBase(target)}/rows${query ? `?${query}` : ''}`, { headers: { apikey: apiKey } })
}

// postgresApi.ts:283-311: copy-paste snippets that use the apikey header the gateway routes by.
const embedRowsUrl = (target: Target, origin?: string) =>
  `${origin ?? 'https://<your-falcone-host>'}/v1/postgres/workspaces/${target.workspaceId}/data/${target.databaseName}/schemas/${target.schemaName}/tables/${target.tableName}/rows`
export const buildFrontendSnippet = (apiKey: string, target: Target, origin?: string) =>
  [`const res = await fetch(`, `  '${embedRowsUrl(target, origin)}',`, `  { headers: { apikey: '${apiKey}' } }`, `)`, `const { items } = await res.json()`].join('\n')
export const buildCurlSnippet = (apiKey: string, target: Target, origin?: string) => [`curl -H 'apikey: ${apiKey}' \\`, `  '${embedRowsUrl(target, origin)}'`].join('\n')

// lib/editor-ux.ts, with parse errors reported as codes so the page can translate them.
export const formatCell = (value: unknown) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
export function collectColumns(rows: Array<Record<string, unknown>>) {
  const seen = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key)
  return Array.from(seen)
}
export type ParseResult = { ok: true; value: Record<string, JsonValue> } | { ok: false; error: 'jsonInvalid' | 'jsonNotObject' }
export function parseJsonObject(text: string): ParseResult {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, error: 'jsonInvalid' } }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'jsonNotObject' }
  return { ok: true, value: parsed as Record<string, JsonValue> }
}
export const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2)
export async function copyToClipboard(text: string) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* Report a failed copy to the caller. */ }
  return false
}
