// Postgres data editor (changes: add-console-postgres-data-editor, add-console-richer-data-editors).
// A real row data-grid (list/insert/EDIT/delete via the data API) with loading/empty states and
// an exact row count, plus an API-keys panel (issue anon/service keys, copy the plaintext once,
// copy-paste frontend snippet, revoke). Wired to the control-plane executor via @/services/postgresApi.
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@/lib/http'
import { collectColumns, copyToClipboard, formatCell, parseJsonObject, prettyJson } from '@/lib/editor-ux'
import {
  buildCurlSnippet,
  buildFrontendSnippet,
  deleteRow,
  insertRow,
  issueApiKey,
  listApiKeys,
  listRows,
  previewRowsWithApiKey,
  revokeApiKey,
  updateRow,
  type ApiKeyRecord,
  type IssuedApiKey,
  type PgFilter,
  type PgFilterOperator,
  type PgRow
} from '@/services/postgresApi'

const FILTER_OPERATORS: PgFilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in']
const PAGE_SIZES = [10, 25, 50, 100]

export interface PostgresDataEditorProps {
  workspaceId: string
  databaseName: string
  schemaName: string
  tableName: string
}

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'Request failed'
}

export function PostgresDataEditor({ workspaceId, databaseName, schemaName, tableName }: PostgresDataEditorProps) {
  const [rows, setRows] = useState<PgRow[]>([])
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<PgFilter[]>([])
  const [draftColumn, setDraftColumn] = useState('')
  const [draftOp, setDraftOp] = useState<PgFilterOperator>('eq')
  const [draftValue, setDraftValue] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [nextAfter, setNextAfter] = useState<string | undefined>(undefined)
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [issued, setIssued] = useState<IssuedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [previewRows, setPreviewRows] = useState<PgRow[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [newRowJson, setNewRowJson] = useState('{}')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editJson, setEditJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadRows = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listRows(workspaceId, databaseName, schemaName, tableName, {
        countMode: 'exact',
        pageSize,
        after: cursor,
        filters
      })
      setRows(result.items)
      setCount(typeof result.count === 'number' ? result.count : null)
      setNextAfter(result.page?.after)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, databaseName, schemaName, tableName, pageSize, cursor, filters])

  // Reset pagination to the first page whenever the table identity changes.
  useEffect(() => {
    setCursor(undefined)
    setCursorStack([])
  }, [workspaceId, databaseName, schemaName, tableName])

  function addFilter() {
    if (draftColumn.trim() === '') return
    const value = draftOp === 'in' ? draftValue.split(',').map((entry) => entry.trim()) : draftValue
    setFilters([...filters, { columnName: draftColumn.trim(), operator: draftOp, value }])
    setDraftColumn('')
    setDraftValue('')
    setCursor(undefined)
    setCursorStack([])
  }

  function removeFilter(index: number) {
    setFilters(filters.filter((_, i) => i !== index))
    setCursor(undefined)
    setCursorStack([])
  }

  function changePageSize(size: number) {
    setPageSize(size)
    setCursor(undefined)
    setCursorStack([])
  }

  function nextPage() {
    if (!nextAfter) return
    setCursorStack([...cursorStack, cursor ?? ''])
    setCursor(nextAfter)
  }

  function prevPage() {
    if (cursorStack.length === 0) return
    const stack = [...cursorStack]
    const previous = stack.pop()
    setCursorStack(stack)
    setCursor(previous === '' ? undefined : previous)
  }

  const reloadKeys = useCallback(async () => {
    try {
      const result = await listApiKeys(workspaceId)
      setKeys(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [workspaceId])

  useEffect(() => {
    void reloadRows()
    void reloadKeys()
  }, [reloadRows, reloadKeys])

  const columns = collectColumns(rows)
  // The real host a frontend would call (so the copy-paste embed is runnable as-is).
  const embedOrigin = typeof window !== 'undefined' ? window.location.origin : undefined

  async function handleInsert() {
    setError(null)
    setStatus(null)
    const parsed = parseJsonObject(newRowJson)
    if (!parsed.ok) {
      setError(`New row: ${parsed.error}`)
      return
    }
    setBusy(true)
    try {
      await insertRow(workspaceId, databaseName, schemaName, tableName, parsed.value)
      setNewRowJson('{}')
      setStatus('Row inserted')
      await reloadRows()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function beginEdit(row: PgRow) {
    if (row.id == null) {
      setError('Row has no "id" primary key to edit by')
      return
    }
    setError(null)
    setStatus(null)
    setEditingId(String(row.id))
    setEditJson(prettyJson(row))
  }

  async function saveEdit() {
    if (editingId == null) return
    const parsed = parseJsonObject(editJson)
    if (!parsed.ok) {
      setError(`Edited row: ${parsed.error}`)
      return
    }
    const { id: _id, ...changes } = parsed.value
    setBusy(true)
    try {
      await updateRow(workspaceId, databaseName, schemaName, tableName, { id: editingId }, changes)
      setEditingId(null)
      setStatus('Row updated')
      await reloadRows()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(row: PgRow) {
    if (row.id == null) {
      setError('Row has no "id" primary key to delete by')
      return
    }
    setBusy(true)
    try {
      await deleteRow(workspaceId, databaseName, schemaName, tableName, { id: String(row.id) })
      setStatus('Row deleted')
      await reloadRows()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleIssue(keyType: 'anon' | 'service') {
    setError(null)
    try {
      const key = await issueApiKey(workspaceId, keyType)
      setIssued(key)
      setCopied(false)
      setPreviewRows(null)
      setPreviewError(null)
      await reloadKeys()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  // Run a read-only preview AS the issued key — a bare apikey-header request, exactly what a
  // frontend embed does — to prove the key works end-to-end through the gateway.
  async function handlePreview() {
    if (!issued) return
    setPreviewError(null)
    setPreviewBusy(true)
    try {
      const result = await previewRowsWithApiKey(issued.key, workspaceId, databaseName, schemaName, tableName, { pageSize: 10 })
      setPreviewRows(result.items)
    } catch (caught) {
      setPreviewError(errorMessage(caught))
    } finally {
      setPreviewBusy(false)
    }
  }

  async function handleRevoke(id: string) {
    try {
      await revokeApiKey(workspaceId, id)
      await reloadKeys()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function handleCopyKey() {
    if (!issued) return
    setCopied(await copyToClipboard(issued.key))
  }

  return (
    <section aria-label="Postgres data editor">
      <h2>
        {schemaName}.{tableName}
      </h2>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}

      <div aria-label="Filters">
        <h3>Filters</h3>
        <ul>
          {filters.map((filter, index) => (
            <li key={`${filter.columnName}-${filter.operator}-${index}`}>
              {filter.columnName} {filter.operator} {String(filter.value)}
              <button type="button" onClick={() => removeFilter(index)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <label htmlFor="filter-column">Column</label>
        <input id="filter-column" value={draftColumn} onChange={(event) => setDraftColumn(event.target.value)} />
        <label htmlFor="filter-op">Operator</label>
        <select id="filter-op" value={draftOp} onChange={(event) => setDraftOp(event.target.value as PgFilterOperator)}>
          {FILTER_OPERATORS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <label htmlFor="filter-value">Value{draftOp === 'in' ? ' (comma-separated)' : ''}</label>
        <input id="filter-value" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} />
        <button type="button" onClick={addFilter}>
          Add filter
        </button>
      </div>

      <h3>Rows{count != null ? ` (${count})` : ''}</h3>
      <div aria-label="Pagination">
        <label htmlFor="page-size">Page size</label>
        <select id="page-size" value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button type="button" onClick={prevPage} disabled={cursorStack.length === 0 || busy}>
          Previous
        </button>
        <button type="button" onClick={nextPage} disabled={!nextAfter || busy}>
          Next
        </button>
      </div>
      {loading ? (
        <p>Loading rows…</p>
      ) : rows.length === 0 ? (
        <p>No rows yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={typeof row.id === 'string' ? row.id : index}>
                {columns.map((column) => (
                  <td key={column}>{formatCell(row[column])}</td>
                ))}
                <td>
                  <button type="button" onClick={() => beginEdit(row)} disabled={busy}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void handleDelete(row)} disabled={busy}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editingId != null ? (
        <div aria-label="Edit row">
          <h3>Edit row {editingId}</h3>
          <label htmlFor="edit-row-json">Row (JSON)</label>
          <textarea id="edit-row-json" value={editJson} onChange={(event) => setEditJson(event.target.value)} />
          <button type="button" onClick={() => void saveEdit()} disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => setEditingId(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : null}

      <h3>Insert row</h3>
      <label htmlFor="new-row-json">New row (JSON)</label>
      <textarea id="new-row-json" value={newRowJson} onChange={(event) => setNewRowJson(event.target.value)} />
      <button type="button" onClick={() => void handleInsert()} disabled={busy}>
        Insert
      </button>

      <h3>API keys</h3>
      <button type="button" onClick={() => void handleIssue('anon')}>
        Issue anon key
      </button>
      <button type="button" onClick={() => void handleIssue('service')}>
        Issue service key
      </button>
      {issued ? (
        <div role="status">
          <p>Copy this key now — it will not be shown again:</p>
          <code>{issued.key}</code>
          <button type="button" onClick={() => void handleCopyKey()}>
            {copied ? 'Copied!' : 'Copy key'}
          </button>

          <div aria-label="Anon-key embed">
            <h4>Embed (fetch)</h4>
            <pre>{buildFrontendSnippet({ apiKey: issued.key, workspaceId, databaseName, schemaName, tableName, origin: embedOrigin })}</pre>
            <h4>Embed (curl)</h4>
            <pre>{buildCurlSnippet({ apiKey: issued.key, workspaceId, databaseName, schemaName, tableName, origin: embedOrigin })}</pre>
            <button type="button" onClick={() => void handlePreview()} disabled={previewBusy}>
              Run read-only preview
            </button>
            {previewError ? <p role="alert">{previewError}</p> : null}
            {previewRows != null ? (
              <div aria-label="Embed preview">
                <p>Preview as this key — {previewRows.length} row(s):</p>
                <table>
                  <thead>
                    <tr>
                      {collectColumns(previewRows).map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, index) => (
                      <tr key={typeof row.id === 'string' ? row.id : index}>
                        {collectColumns(previewRows).map((column) => (
                          <td key={column}>{formatCell(row[column])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <ul>
        {keys.map((key) => (
          <li key={key.id}>
            <span>
              {key.key_prefix}… ({key.key_type}, {key.status})
            </span>
            {key.status === 'active' ? (
              <button type="button" onClick={() => void handleRevoke(key.id)}>
                Revoke
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
