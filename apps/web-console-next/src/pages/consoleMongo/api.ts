export type MongoDatabase = {
  databaseName: string
  stats?: { dataSize?: number; storageSize?: number; collections?: number; indexes?: number; avgObjSize?: number }
}
export type MongoCollectionValidation = {
  validationLevel?: 'off' | 'moderate' | 'strict'
  validationAction?: 'error' | 'warn'
  validator?: unknown
}
export type MongoCollection = {
  collectionName: string
  collectionType?: 'standard' | 'capped' | 'time-series'
  documentCount?: number
  estimatedSize?: number
  validation?: MongoCollectionValidation
}
export type MongoIndex = {
  indexName: string
  keys?: { fieldName: string; direction?: 1 | -1 | 'text' | 'hashed' | '2dsphere' }[]
  indexType?: 'single' | 'compound' | 'text' | 'geo' | 'hashed'
  unique?: boolean
  sparse?: boolean
  ttlSeconds?: number
  partialFilterExpression?: unknown
  rebuildState?: 'idle' | 'in_progress' | 'failed'
}
export type MongoView = { viewName: string; viewOn?: string; pipeline?: unknown[] }
export type MongoDocument = { _id: unknown; [key: string]: unknown }
// Lists answer with page.nextCursor and documents with page.after; both mean "more rows follow".
export type Collection<T> = { items?: T[]; page?: { nextCursor?: string | null; after?: string | null; size?: number } }
export type Failure = { status?: number; code?: string; requestId?: string; message?: string }

export const failureOf = (cause: unknown): Failure => {
  const error = (cause ?? {}) as Failure
  return { status: typeof error.status === 'number' ? error.status : undefined, code: error.code, requestId: error.requestId, message: error.message }
}
export const isAbort = (cause: unknown) => (cause as { name?: string } | null)?.name === 'AbortError'

export const segment = encodeURIComponent
export const databasesPath = '/v1/mongo/databases'
export const collectionsPath = (database: string) => `${databasesPath}/${segment(database)}/collections`
export const viewsPath = (database: string) => `${databasesPath}/${segment(database)}/views`
export const collectionPath = (database: string, collection: string) => `${collectionsPath(database)}/${segment(collection)}`
export const indexesPath = (database: string, collection: string) => `${collectionPath(database, collection)}/indexes`
export const documentsPath = (workspace: string, database: string, collection: string) =>
  `/v1/mongo/workspaces/${segment(workspace)}/data/${segment(database)}/collections/${segment(collection)}/documents`

// The first page keeps the legacy literal query; a later page appends the cursor exactly as the server issued it.
export const listUrl = (path: string, cursor: string | null) =>
  cursor === null ? `${path}?page[size]=100` : `${path}?page[size]=100&page[after]=${segment(cursor)}`
export function documentsUrl(path: string, cursor: string | null) {
  const query = new URLSearchParams({ 'page[size]': '20' })
  if (cursor !== null) query.set('page[after]', cursor)
  return `${path}?${query}`
}

// Locale-formatted byte count with the legacy base-1024 units and one decimal below 10.
const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
export function formatBytes(bytes: number | null | undefined, locale: string, empty: string) {
  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes < 0) return empty
  if (bytes < 1024) return `${new Intl.NumberFormat(locale).format(bytes)} B`
  let value = bytes / 1024, unit = 1
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  const digits = value >= 10 ? 0 : 1
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)} ${units[unit]}`
}
