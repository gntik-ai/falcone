// MongoDB document editor (changes: add-console-mongo-data-editor, add-console-richer-data-editors).
// Lists/inserts/EDITS/deletes documents in a collection via the control-plane executor
// (@/services/mongoApi), with loading + empty states.
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@/lib/http'
import { parseJsonObject, prettyJson } from '@/lib/editor-ux'
import {
  deleteDocument,
  insertDocument,
  listDocuments,
  updateDocument,
  type MongoDocument
} from '@/services/mongoApi'

export interface MongoDataEditorProps {
  workspaceId: string
  databaseName: string
  collectionName: string
}

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'Request failed'
}

function documentId(doc: MongoDocument): string | undefined {
  const id = doc._id ?? doc.id
  return id == null ? undefined : String(id)
}

export function MongoDataEditor({ workspaceId, databaseName, collectionName }: MongoDataEditorProps) {
  const [docs, setDocs] = useState<MongoDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [newDocJson, setNewDocJson] = useState('{}')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editJson, setEditJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listDocuments(workspaceId, databaseName, collectionName, { pageSize: 50 })
      setDocs(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, databaseName, collectionName])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleInsert() {
    setError(null)
    setStatus(null)
    const parsed = parseJsonObject(newDocJson)
    if (!parsed.ok) {
      setError(`New document: ${parsed.error}`)
      return
    }
    setBusy(true)
    try {
      await insertDocument(workspaceId, databaseName, collectionName, parsed.value)
      setNewDocJson('{}')
      setStatus('Document inserted')
      await reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function beginEdit(doc: MongoDocument) {
    const id = documentId(doc)
    if (id == null) {
      setError('Document has no _id to edit by')
      return
    }
    setError(null)
    setStatus(null)
    setEditingId(id)
    setEditJson(prettyJson(doc))
  }

  async function saveEdit() {
    if (editingId == null) return
    const parsed = parseJsonObject(editJson)
    if (!parsed.ok) {
      setError(`Edited document: ${parsed.error}`)
      return
    }
    const { _id, id, ...update } = parsed.value
    setBusy(true)
    try {
      await updateDocument(workspaceId, databaseName, collectionName, editingId, update)
      setEditingId(null)
      setStatus('Document updated')
      await reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(doc: MongoDocument) {
    const id = documentId(doc)
    if (id == null) {
      setError('Document has no _id to delete by')
      return
    }
    setBusy(true)
    try {
      await deleteDocument(workspaceId, databaseName, collectionName, id)
      setStatus('Document deleted')
      await reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Mongo data editor">
      <h2>
        {databaseName}.{collectionName}
      </h2>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}

      <h3>Documents{docs.length > 0 ? ` (${docs.length})` : ''}</h3>
      {loading ? (
        <p>Loading documents…</p>
      ) : docs.length === 0 ? (
        <p>No documents yet.</p>
      ) : (
        <ul>
          {docs.map((doc, index) => (
            <li key={documentId(doc) ?? index}>
              <code>{JSON.stringify(doc)}</code>
              <button type="button" onClick={() => beginEdit(doc)} disabled={busy}>
                Edit
              </button>
              <button type="button" onClick={() => void handleDelete(doc)} disabled={busy}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {editingId != null ? (
        <div aria-label="Edit document">
          <h3>Edit document {editingId}</h3>
          <label htmlFor="edit-doc-json">Document (JSON)</label>
          <textarea id="edit-doc-json" value={editJson} onChange={(event) => setEditJson(event.target.value)} />
          <button type="button" onClick={() => void saveEdit()} disabled={busy}>
            Save
          </button>
          <button type="button" onClick={() => setEditingId(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : null}

      <h3>Insert document</h3>
      <label htmlFor="new-doc-json">New document (JSON)</label>
      <textarea id="new-doc-json" value={newDocJson} onChange={(event) => setNewDocJson(event.target.value)} />
      <button type="button" onClick={() => void handleInsert()} disabled={busy}>
        Insert
      </button>
    </section>
  )
}
