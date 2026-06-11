// Postgres data editor (change: add-console-postgres-data-editor).
// A real row data-grid (list/insert/delete via the data API) + an API-keys panel
// (issue anon/service keys, show the plaintext once, copy-paste frontend snippet, revoke).
// Wired to the control-plane executor through @/services/postgresApi.
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@/lib/http'
import {
  buildFrontendSnippet,
  deleteRow,
  insertRow,
  issueApiKey,
  listApiKeys,
  listRows,
  revokeApiKey,
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

function formatCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function PostgresDataEditor({ workspaceId, databaseName, schemaName, tableName }: PostgresDataEditorProps) {
  const [rows, setRows] = useState<PgRow[]>([])
  const [keys, setKeys] = useState<ApiKeyRecord[]>([])
  const [issued, setIssued] = useState<IssuedApiKey | null>(null)
  const [newRowJson, setNewRowJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reloadRows = useCallback(async () => {
    try {
      const result = await listRows(workspaceId, databaseName, schemaName, tableName, { countMode: 'exact' })
      setRows(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
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

  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))

  async function handleInsert() {
    setError(null)
    setBusy(true)
    try {
      const values = JSON.parse(newRowJson) as PgRow
      await insertRow(workspaceId, databaseName, schemaName, tableName, values)
      setNewRowJson('{}')
      await reloadRows()
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'New row is not valid JSON' : errorMessage(caught))
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

  return (
    <section aria-label="Postgres data editor">
      <h2>
        {schemaName}.{tableName}
      </h2>
      {error ? <p role="alert">{error}</p> : null}

      <h3>Rows</h3>
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
                <button type="button" onClick={() => void handleDelete(row)} disabled={busy}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Insert row</h3>
      <label htmlFor="new-row-json">New row (JSON)</label>
      <textarea
        id="new-row-json"
        value={newRowJson}
        onChange={(event) => setNewRowJson(event.target.value)}
      />
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
