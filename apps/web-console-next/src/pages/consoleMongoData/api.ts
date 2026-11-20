// Document client and anonymous-key client. Methods, paths, query strings and bodies mirror the legacy
// legacy base 69296937330b61be2bbf2c7267520196499fc038:src/services/mongoApi.ts:18-206 and components/console/MongoDataEditor.tsx field for field.
// The page never sends Mongo import, export or PUT replace, and never lists, revokes or rotates API keys.
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { requestJson, type ApiError, type JsonValue } from '@in-falcone/console-api/http'

const enc = encodeURIComponent

export type MongoDocument = Record<string, JsonValue>
export type MongoFilter = Record<string, JsonValue>
export const PAGE_SIZES = [10, 25, 50, 100]

export interface DocumentListResult {
  items: MongoDocument[]
  page?: { size?: number; returned?: number; after?: string }
}
export interface IssuedApiKey {
  id: string
  key: string // plaintext, shown once and kept in component memory only
  prefix: string
  keyType: 'anon' | 'service'
  scopes: string[]
}
export interface Target { workspaceId: string; databaseName: string; collectionName: string }
export type Failure = { status?: number; requestId?: string; message?: string }

export const failureOf = (cause: unknown): Failure => {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, requestId: error.requestId ?? error.correlationId, message: typeof error.message === 'string' ? error.message : undefined }
}

const docsBase = ({ workspaceId, databaseName, collectionName }: Target) =>
  `/v1/mongo/workspaces/${enc(workspaceId)}/data/${enc(databaseName)}/collections/${enc(collectionName)}/documents`

export function listDocuments(target: Target, options: { pageSize?: number; after?: string; filter?: MongoFilter } = {}) {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  if (options.after != null) params.set('page[after]', options.after)
  // An empty filter object sends no filter parameter.
  if (options.filter && Object.keys(options.filter).length > 0) params.set('filter', JSON.stringify(options.filter))
  const qs = params.toString()
  return requestConsoleSessionJson<DocumentListResult>(`${docsBase(target)}${qs ? `?${qs}` : ''}`)
}
export function insertDocument(target: Target, document: MongoDocument) {
  return requestConsoleSessionJson<{ item: MongoDocument }>(docsBase(target), { method: 'POST', body: { document } })
}
export function updateDocument(target: Target, documentId: string, update: MongoDocument) {
  return requestConsoleSessionJson<{ item: MongoDocument }>(`${docsBase(target)}/${enc(documentId)}`, { method: 'PATCH', body: { update } })
}
export function deleteDocument(target: Target, documentId: string) {
  return requestConsoleSessionJson<{ deleted: boolean }>(`${docsBase(target)}/${enc(documentId)}`, { method: 'DELETE' })
}
// Anonymous-key issuance is a workspace-scoped surface shared with the PostgreSQL editor (legacy postgresApi.ts:261).
export function issueAnonKey(workspaceId: string) {
  return requestConsoleSessionJson<IssuedApiKey>(`/v1/workspaces/${enc(workspaceId)}/api-keys`, { method: 'POST', body: { keyType: 'anon' } })
}

// Read-only preview AS the issued key: a bare request carrying the `apikey` header and no Authorization,
// exactly what a frontend embed sends. It goes through requestJson, so a 401 never starts a session refresh.
export function previewDocumentsWithApiKey(apiKey: string, target: Target, options: { pageSize?: number } = {}) {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  const qs = params.toString()
  return requestJson<DocumentListResult>(`${docsBase(target)}${qs ? `?${qs}` : ''}`, { headers: { apikey: apiKey } })
}

interface SnippetParams extends Target { apiKey: string; origin?: string }
// Legacy embedDocsUrl interpolates the raw ids without encoding.
const embedDocsUrl = (params: SnippetParams) =>
  `${params.origin ?? 'https://<your-falcone-host>'}/v1/mongo/workspaces/${params.workspaceId}/data/${params.databaseName}/collections/${params.collectionName}/documents`
// The gateway routes anon and service keys by the `apikey` header, not Authorization.
export function buildFrontendSnippet(params: SnippetParams): string {
  return [`const res = await fetch(`, `  '${embedDocsUrl(params)}',`, `  { headers: { apikey: '${params.apiKey}' } }`, `)`, `const { items } = await res.json()`].join('\n')
}
export function buildCurlSnippet(params: SnippetParams): string {
  return [`curl -H 'apikey: ${params.apiKey}' \\`, `  '${embedDocsUrl(params)}'`].join('\n')
}

// Pure helpers ported from legacy base 69296937330b61be2bbf2c7267520196499fc038:src/lib/editor-ux.ts.
export type ParseResult = { ok: true; value: MongoDocument } | { ok: false; error: 'jsonInvalid' | 'jsonObjectExpected' }
export function parseJsonObject(text: string): ParseResult {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { ok: false, error: 'jsonInvalid' } }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'jsonObjectExpected' }
  return { ok: true, value: parsed as MongoDocument }
}
export const prettyJson = (value: unknown) => JSON.stringify(value ?? {}, null, 2)
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  return false
}
// MongoDataEditor.tsx:44-47: the id is _id, else id, stringified.
export function documentId(doc: MongoDocument): string | undefined {
  const id = doc._id ?? doc.id
  return id == null ? undefined : String(id)
}
