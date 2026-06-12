// Vector-search client for the console (change: add-vector-search-console).
// Wraps the control-plane executor's pgvector routes exactly: KNN similarity search,
// vector-index create/delete, and the workspace embedding-provider set/remove. URLs match
// the executor's HTTP routes (apps/control-plane/src/runtime/server.mjs). Credentials are
// referenced by secretRef NAME only — a raw API key is never sent or stored here.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

export type VectorMetric = 'cosine' | 'l2' | 'inner_product'
export type VectorIndexType = 'hnsw' | 'ivfflat'

// A scalar filter for hybrid search (column → value). Mirrors the executor's `filter` body field.
export type VectorScalarFilter = Record<string, JsonValue>

export interface KnnSearchParams {
  // Provide EITHER a query vector OR query text (in-platform embedding via the provider).
  queryVector?: number[]
  queryText?: string
  vectorColumn: string
  metric?: VectorMetric
  topK?: number
  filter?: VectorScalarFilter
  // Columns to return; omit the raw vector column by default to keep the result table readable.
  select?: string[]
}

// Each returned row is a normal Postgres row plus a `distance` (nearest-first ordering).
export type KnnRow = Record<string, JsonValue> & { distance?: number }

export interface KnnSearchResult {
  items: KnnRow[]
  returned?: number
  knn?: JsonValue
  access?: JsonValue
}

export interface DdlResult {
  executed: boolean
  executionMode?: 'execute' | 'preview'
  statements?: string[]
  statementCount?: number
}

export interface CreateVectorIndexParams {
  column: string
  indexType?: VectorIndexType
  metric?: VectorMetric
  indexName?: string
}

export interface EmbeddingProviderConfig {
  providerType: string
  model: string
  endpoint?: string
  dimension?: number
  // The NAME of a Kubernetes/Vault secret reference — never a raw API key value.
  secretRef: string
}

export interface EmbeddingProviderResult {
  providerType?: string
  model?: string
  endpoint?: string
  dimension?: number
  secretRef?: string
  updatedAt?: string
  // Returned when an existing provider is replaced: stored vectors may need re-indexing.
  warning?: string
}

export interface RemoveEmbeddingProviderResult {
  removed?: boolean
}

// ---- KNN search (workspace-scoped data route) ----
const searchUrl = (workspaceId: string, db: string, schema: string, table: string) =>
  `/v1/postgres/workspaces/${enc(workspaceId)}/data/${enc(db)}/schemas/${enc(schema)}/tables/${enc(table)}/search`

export function knnSearch(
  workspaceId: string,
  databaseName: string,
  schemaName: string,
  tableName: string,
  params: KnnSearchParams
): Promise<KnnSearchResult> {
  const body: Record<string, JsonValue> = { vectorColumn: params.vectorColumn }
  if (params.queryVector != null) body.queryVector = params.queryVector
  if (params.queryText != null) body.queryText = params.queryText
  if (params.metric != null) body.metric = params.metric
  if (params.topK != null) body.topK = params.topK
  if (params.filter != null) body.filter = params.filter
  if (params.select != null) body.select = params.select
  return requestConsoleSessionJson<KnnSearchResult>(searchUrl(workspaceId, databaseName, schemaName, tableName), {
    method: 'POST',
    body
  })
}

// ---- Vector index (database-scoped DDL route) ----
const vectorIndexBase = (db: string, schema: string, table: string) =>
  `/v1/postgres/databases/${enc(db)}/schemas/${enc(schema)}/tables/${enc(table)}/vector-indexes`

export function createVectorIndex(
  databaseName: string,
  schemaName: string,
  tableName: string,
  params: CreateVectorIndexParams
): Promise<DdlResult> {
  const body: Record<string, JsonValue> = {
    indexType: params.indexType ?? 'hnsw',
    column: params.column
  }
  if (params.metric != null) body.metric = params.metric
  if (params.indexName != null) body.indexName = params.indexName
  return requestConsoleSessionJson<DdlResult>(vectorIndexBase(databaseName, schemaName, tableName), {
    method: 'POST',
    body
  })
}

export function deleteVectorIndex(
  databaseName: string,
  schemaName: string,
  tableName: string,
  indexName: string
): Promise<DdlResult> {
  return requestConsoleSessionJson<DdlResult>(`${vectorIndexBase(databaseName, schemaName, tableName)}/${enc(indexName)}`, {
    method: 'DELETE'
  })
}

// ---- Embedding provider (workspace-scoped) ----
const embeddingProviderUrl = (workspaceId: string) => `/v1/workspaces/${enc(workspaceId)}/embedding-provider`

export function setEmbeddingProvider(
  workspaceId: string,
  config: EmbeddingProviderConfig
): Promise<EmbeddingProviderResult> {
  const body: Record<string, JsonValue> = {
    providerType: config.providerType,
    model: config.model,
    secretRef: config.secretRef
  }
  if (config.endpoint != null && config.endpoint !== '') body.endpoint = config.endpoint
  if (config.dimension != null) body.dimension = config.dimension
  return requestConsoleSessionJson<EmbeddingProviderResult>(embeddingProviderUrl(workspaceId), {
    method: 'PUT',
    body
  })
}

export function removeEmbeddingProvider(workspaceId: string): Promise<RemoveEmbeddingProviderResult> {
  return requestConsoleSessionJson<RemoveEmbeddingProviderResult>(embeddingProviderUrl(workspaceId), {
    method: 'DELETE'
  })
}
