// Vector-search console (change: add-vector-search-console).
// Three panels over the control-plane executor's pgvector routes (@/services/vectorSearchApi):
//   - KnnSearchPanel: query-vector OR query-text KNN search, metric/top-K, scalar filters for
//     hybrid search, and a ranked results table (nearest-first) including a `distance` column.
//   - VectorIndexPanel: create (HNSW default / IVFFlat) and delete a vector index.
//   - EmbeddingProviderPanel: set/remove the workspace embedding provider. Credentials are
//     referenced by secretRef NAME only — there is NO raw-key/password input anywhere.
import { useRef, useState } from 'react'

import type { ApiError } from '@/lib/http'
import { collectColumns, formatCell } from '@/lib/editor-ux'
import { DestructiveConfirmationDialog } from '@/components/console/DestructiveConfirmationDialog'
import { useDestructiveOp } from '@/components/console/hooks/useDestructiveOp'
import {
  createVectorIndex,
  deleteVectorIndex,
  knnSearch,
  removeEmbeddingProvider,
  setEmbeddingProvider,
  type EmbeddingProviderResult,
  type KnnRow,
  type VectorIndexType,
  type VectorMetric,
  type VectorScalarFilter
} from '@/services/vectorSearchApi'

const METRICS: VectorMetric[] = ['cosine', 'l2', 'inner_product']
const INDEX_TYPES: VectorIndexType[] = ['hnsw', 'ivfflat']

export interface VectorSearchConsoleProps {
  workspaceId: string
  databaseName: string
  schemaName: string
  tableName: string
}

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'Request failed'
}

function errorCode(error: unknown): string | undefined {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.code === 'string' ? candidate.code : undefined
}

interface DraftFilter {
  column: string
  value: string
}

function KnnSearchPanel({
  workspaceId,
  databaseName,
  schemaName,
  tableName,
  onConfigureProvider
}: VectorSearchConsoleProps & { onConfigureProvider: () => void }) {
  const [mode, setMode] = useState<'vector' | 'text'>('vector')
  const [queryVectorText, setQueryVectorText] = useState('')
  const [queryText, setQueryText] = useState('')
  const [vectorColumn, setVectorColumn] = useState('embedding')
  const [metric, setMetric] = useState<VectorMetric>('cosine')
  const [topK, setTopK] = useState(10)
  const [selectText, setSelectText] = useState('')
  const [filters, setFilters] = useState<DraftFilter[]>([])
  const [draftColumn, setDraftColumn] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [rows, setRows] = useState<KnnRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorIsProviderMissing, setErrorIsProviderMissing] = useState(false)
  const [busy, setBusy] = useState(false)

  function addFilter() {
    if (draftColumn.trim() === '') return
    setFilters([...filters, { column: draftColumn.trim(), value: draftValue }])
    setDraftColumn('')
    setDraftValue('')
  }

  function removeFilter(index: number) {
    setFilters(filters.filter((_, i) => i !== index))
  }

  function buildFilterObject(): VectorScalarFilter | undefined {
    if (filters.length === 0) return undefined
    const obj: VectorScalarFilter = {}
    for (const filter of filters) obj[filter.column] = filter.value
    return obj
  }

  function buildSelect(): string[] | undefined {
    const parts = selectText
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    return parts.length > 0 ? parts : undefined
  }

  async function handleSearch() {
    setError(null)
    setErrorIsProviderMissing(false)
    if (vectorColumn.trim() === '') {
      setError('Vector column is required')
      return
    }

    let queryVector: number[] | undefined
    let textQuery: string | undefined
    if (mode === 'vector') {
      let parsed: unknown
      try {
        parsed = JSON.parse(queryVectorText)
      } catch {
        setError('Query vector: not valid JSON')
        return
      }
      if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'number')) {
        setError('Query vector: expected a JSON array of numbers')
        return
      }
      queryVector = parsed as number[]
    } else {
      if (queryText.trim() === '') {
        setError('Query text is required')
        return
      }
      textQuery = queryText
    }

    setBusy(true)
    try {
      const result = await knnSearch(workspaceId, databaseName, schemaName, tableName, {
        ...(queryVector ? { queryVector } : {}),
        ...(textQuery ? { queryText: textQuery } : {}),
        vectorColumn: vectorColumn.trim(),
        metric,
        topK,
        filter: buildFilterObject(),
        select: buildSelect()
      })
      setRows(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
      setErrorIsProviderMissing(errorCode(caught) === 'EMBEDDING_PROVIDER_MISSING')
    } finally {
      setBusy(false)
    }
  }

  // Vector columns are noisy in a table; the user can name what to show via `select`.
  const columns = rows ? collectColumns(rows).filter((column) => column !== 'distance').concat('distance') : []

  return (
    <section aria-label="KNN search">
      <h3>KNN similarity search</h3>
      {error ? (
        <p role="alert">
          {errorIsProviderMissing ? `${errorCodeLabel()} — ` : ''}
          {error}
          {errorIsProviderMissing ? (
            <>
              {' '}
              <button type="button" onClick={onConfigureProvider}>
                Configure embedding provider
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <fieldset>
        <legend>Query mode</legend>
        <label>
          <input
            type="radio"
            name="knn-mode"
            checked={mode === 'vector'}
            onChange={() => setMode('vector')}
          />
          Use a query vector
        </label>
        <label>
          <input type="radio" name="knn-mode" checked={mode === 'text'} onChange={() => setMode('text')} />
          Use query text
        </label>
      </fieldset>

      {mode === 'vector' ? (
        <>
          <label htmlFor="knn-query-vector">Query vector (JSON array)</label>
          <textarea
            id="knn-query-vector"
            value={queryVectorText}
            onChange={(event) => setQueryVectorText(event.target.value)}
            placeholder="[0.12, -0.34, 0.56]"
          />
        </>
      ) : (
        <>
          <label htmlFor="knn-query-text">Query text</label>
          <input id="knn-query-text" value={queryText} onChange={(event) => setQueryText(event.target.value)} />
        </>
      )}

      <label htmlFor="knn-vector-column">Vector column</label>
      <input id="knn-vector-column" value={vectorColumn} onChange={(event) => setVectorColumn(event.target.value)} />

      <label htmlFor="knn-metric">Metric</label>
      <select id="knn-metric" value={metric} onChange={(event) => setMetric(event.target.value as VectorMetric)}>
        {METRICS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>

      <label htmlFor="knn-topk">Top-K</label>
      <input
        id="knn-topk"
        type="number"
        min={1}
        value={topK}
        onChange={(event) => setTopK(Number(event.target.value))}
      />

      <label htmlFor="knn-select">Select columns (comma-separated, optional)</label>
      <input id="knn-select" value={selectText} onChange={(event) => setSelectText(event.target.value)} />

      <div aria-label="Scalar filters">
        <h4>Scalar filters (hybrid search)</h4>
        <ul>
          {filters.map((filter, index) => (
            <li key={`${filter.column}-${index}`}>
              {filter.column} = {filter.value}
              <button type="button" onClick={() => removeFilter(index)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <label htmlFor="knn-filter-column">Filter column</label>
        <input id="knn-filter-column" value={draftColumn} onChange={(event) => setDraftColumn(event.target.value)} />
        <label htmlFor="knn-filter-value">Filter value</label>
        <input id="knn-filter-value" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} />
        <button type="button" onClick={addFilter}>
          Add filter
        </button>
      </div>

      <button type="button" onClick={() => void handleSearch()} disabled={busy}>
        Search
      </button>

      {busy ? <p>Searching…</p> : null}

      {rows != null ? (
        rows.length === 0 ? (
          <p>No matches.</p>
        ) : (
          <table aria-label="KNN results">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={typeof row.id === 'string' ? row.id : index}>
                  {columns.map((column) => (
                    <td key={column}>{formatCell(row[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </section>
  )
}

function errorCodeLabel() {
  return 'EMBEDDING_PROVIDER_MISSING'
}

function VectorIndexPanel({ databaseName, schemaName, tableName }: Omit<VectorSearchConsoleProps, 'workspaceId'>) {
  const [column, setColumn] = useState('')
  const [indexType, setIndexType] = useState<VectorIndexType>('hnsw')
  const [metric, setMetric] = useState<VectorMetric>('cosine')
  const [indexName, setIndexName] = useState('')
  const [deleteName, setDeleteName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    setError(null)
    setStatus(null)
    if (column.trim() === '') {
      setError('Index column is required')
      return
    }
    setBusy(true)
    try {
      await createVectorIndex(databaseName, schemaName, tableName, {
        column: column.trim(),
        indexType,
        metric,
        ...(indexName.trim() ? { indexName: indexName.trim() } : {})
      })
      setStatus(`Vector index created on ${column.trim()} (${indexType}).`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setError(null)
    setStatus(null)
    if (deleteName.trim() === '') {
      setError('Delete index name is required')
      return
    }
    setBusy(true)
    try {
      await deleteVectorIndex(databaseName, schemaName, tableName, deleteName.trim())
      setStatus(`Vector index "${deleteName.trim()}" deleted.`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Vector index">
      <h3>Vector index</h3>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}

      <h4>Create index</h4>
      <label htmlFor="vi-column">Index column</label>
      <input id="vi-column" value={column} onChange={(event) => setColumn(event.target.value)} />
      <label htmlFor="vi-type">Index type</label>
      <select id="vi-type" value={indexType} onChange={(event) => setIndexType(event.target.value as VectorIndexType)}>
        {INDEX_TYPES.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <label htmlFor="vi-metric">Metric</label>
      <select id="vi-metric" value={metric} onChange={(event) => setMetric(event.target.value as VectorMetric)}>
        {METRICS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <label htmlFor="vi-name">Index name (optional)</label>
      <input id="vi-name" value={indexName} onChange={(event) => setIndexName(event.target.value)} />
      <button type="button" onClick={() => void handleCreate()} disabled={busy}>
        Create index
      </button>

      <h4>Delete index</h4>
      <label htmlFor="vi-delete-name">Delete index name</label>
      <input id="vi-delete-name" value={deleteName} onChange={(event) => setDeleteName(event.target.value)} />
      <button type="button" onClick={() => void handleDelete()} disabled={busy}>
        Delete index
      </button>
    </section>
  )
}

const EmbeddingProviderPanel = function EmbeddingProviderPanel({
  workspaceId,
  panelRef
}: {
  workspaceId: string
  panelRef: React.Ref<HTMLElement>
}) {
  const [providerType, setProviderType] = useState('')
  const [model, setModel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [dimension, setDimension] = useState('')
  const [secretRef, setSecretRef] = useState('')
  const [result, setResult] = useState<EmbeddingProviderResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const destructiveOp = useDestructiveOp()

  async function handleSave() {
    setError(null)
    setStatus(null)
    setResult(null)
    if (providerType.trim() === '' || model.trim() === '' || secretRef.trim() === '') {
      setError('Provider type, model, and secret reference are required')
      return
    }
    setBusy(true)
    try {
      const saved = await setEmbeddingProvider(workspaceId, {
        providerType: providerType.trim(),
        model: model.trim(),
        ...(endpoint.trim() ? { endpoint: endpoint.trim() } : {}),
        ...(dimension.trim() ? { dimension: Number(dimension.trim()) } : {}),
        secretRef: secretRef.trim()
      })
      setResult(saved)
      setStatus('Embedding provider saved.')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function openRemoveDialog() {
    setError(null)
    setStatus(null)
    destructiveOp.openDialog({
      level: 'WARNING',
      operationId: 'remove-embedding-provider',
      resourceName: workspaceId,
      resourceType: 'embedding provider',
      impactDescription: 'Query-text KNN search will stop working until a new provider is configured.',
      onConfirm: async () => {
        await removeEmbeddingProvider(workspaceId)
        setResult(null)
        setStatus('Embedding provider removed.')
      }
    })
  }

  return (
    <section aria-label="Embedding provider" ref={panelRef}>
      <h3>Embedding provider</h3>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}
      {result?.warning ? <p role="status">{result.warning}</p> : null}

      <label htmlFor="ep-type">Provider type</label>
      <input id="ep-type" value={providerType} onChange={(event) => setProviderType(event.target.value)} />
      <label htmlFor="ep-model">Model</label>
      <input id="ep-model" value={model} onChange={(event) => setModel(event.target.value)} />
      <label htmlFor="ep-endpoint">Endpoint (optional)</label>
      <input id="ep-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
      <label htmlFor="ep-dimension">Dimension (optional)</label>
      <input
        id="ep-dimension"
        type="number"
        min={1}
        value={dimension}
        onChange={(event) => setDimension(event.target.value)}
      />
      {/* Credentials are referenced by secret NAME only — NEVER a raw API key. No password input. */}
      <label htmlFor="ep-secret-ref">Secret Reference Name — not a raw API key</label>
      <input id="ep-secret-ref" type="text" value={secretRef} onChange={(event) => setSecretRef(event.target.value)} />

      <button type="button" onClick={() => void handleSave()} disabled={busy}>
        Save provider
      </button>
      <button type="button" onClick={openRemoveDialog} disabled={busy}>
        Remove provider
      </button>

      <DestructiveConfirmationDialog
        open={destructiveOp.isOpen}
        config={destructiveOp.config}
        opState={destructiveOp.opState}
        confirmError={destructiveOp.confirmError}
        onConfirm={() => void destructiveOp.handleConfirm()}
        onCancel={destructiveOp.handleCancel}
      />
    </section>
  )
}

export function VectorSearchConsole({ workspaceId, databaseName, schemaName, tableName }: VectorSearchConsoleProps) {
  const providerPanelRef = useRef<HTMLElement | null>(null)

  function scrollToProvider() {
    providerPanelRef.current?.scrollIntoView?.({ behavior: 'smooth' })
  }

  return (
    <section aria-label="Vector search console">
      <h2>
        {schemaName}.{tableName} — vector search
      </h2>
      <KnnSearchPanel
        workspaceId={workspaceId}
        databaseName={databaseName}
        schemaName={schemaName}
        tableName={tableName}
        onConfigureProvider={scrollToProvider}
      />
      <VectorIndexPanel databaseName={databaseName} schemaName={schemaName} tableName={tableName} />
      <EmbeddingProviderPanel workspaceId={workspaceId} panelRef={providerPanelRef} />
    </section>
  )
}
