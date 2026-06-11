// Postgres data editor (changes: add-console-postgres-data-editor, add-console-richer-data-editors).
// A real row data-grid (list/insert/EDIT/delete via the data API) with loading/empty states and
// an exact row count, plus an API-keys panel (issue anon/service keys, copy the plaintext once,
// copy-paste frontend snippet, revoke). Wired to the control-plane executor via @/services/postgresApi.
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@/lib/http'
import { collectColumns, copyToClipboard, formatCell, parseJsonObject, prettyJson } from '@/lib/editor-ux'
import {
  buildFrontendSnippet,
  deleteRow,
  insertRow,
  issueApiKey,
  listApiKeys,
  listRows,
  revokeApiKey,
  updateRow,
  type ApiKeyRecord,
  type IssuedApiKey,
  type PgRow
} from '@/services/postgresApi'

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
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [issued, setIssued] = useState<IssuedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [newRowJson, setNewRowJson] = useState('{}')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editJson, setEditJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadRows = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listRows(workspaceId, databaseName, schemaName, tableName, { countMode: 'exact' })
      setRows(result.items)
      setCount(typeof result.count === 'number' ? result.count : null)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, databaseName, schemaName, tableName])

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
      await reloadKeys()
    } catch (caught) {
      setError(errorMessage(caught))
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

      <h3>Rows{count != null ? ` (${count})` : ''}</h3>
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
          <pre>
            {buildFrontendSnippet({ apiKey: issued.key, workspaceId, databaseName, schemaName, tableName })}
          </pre>
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
