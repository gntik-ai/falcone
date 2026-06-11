// MongoDB document data client for the console (change: add-console-mongo-data-editor).
// Calls the control-plane executor's Mongo document routes exactly. URLs match the executor.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export type MongoDocument = Record<string, JsonValue>
export type MongoFilter = Record<string, JsonValue>
export type MongoSort = Record<string, 1 | -1 | 'asc' | 'desc'>

export interface DocumentListResult {
  items: MongoDocument[]
  page?: { size?: number; returned?: number; after?: string }
}

const docsBase = (workspaceId: string, db: string, collection: string) =>
  `/v1/mongo/workspaces/${enc(workspaceId)}/data/${enc(db)}/collections/${enc(collection)}/documents`

export function listDocuments(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  options: { pageSize?: number; after?: string; filter?: MongoFilter; sort?: MongoSort } = {}
): Promise<DocumentListResult> {
  const params = new URLSearchParams()
  if (options.pageSize != null) params.set('page[size]', String(options.pageSize))
  if (options.after != null) params.set('page[after]', options.after)
  if (options.filter && Object.keys(options.filter).length > 0) params.set('filter', JSON.stringify(options.filter))
  if (options.sort && Object.keys(options.sort).length > 0) params.set('sort', JSON.stringify(options.sort))
  const qs = params.toString()
  return requestConsoleSessionJson<DocumentListResult>(
    `${docsBase(workspaceId, databaseName, collectionName)}${qs ? `?${qs}` : ''}`
  )
}

export function insertDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  document: MongoDocument
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    docsBase(workspaceId, databaseName, collectionName),
    { method: 'POST', body: { document } }
  )
}

export function getDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`
  )
}

export function updateDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string,
  update: MongoDocument
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`,
    { method: 'PATCH', body: { update } }
  )
}

export function replaceDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string,
  document: MongoDocument
): Promise<{ item: MongoDocument }> {
  return requestConsoleSessionJson<{ item: MongoDocument }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`,
    { method: 'PUT', body: { document } }
  )
}

export function deleteDocument(
  workspaceId: string,
  databaseName: string,
  collectionName: string,
  documentId: string
): Promise<{ deleted: boolean }> {
  return requestConsoleSessionJson<{ deleted: boolean }>(
    `${docsBase(workspaceId, databaseName, collectionName)}/${enc(documentId)}`,
    { method: 'DELETE' }
  )
}
