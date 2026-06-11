// MongoDB document editor (change: add-console-mongo-data-editor).
// Lists/inserts/deletes documents in a collection via the control-plane executor
// (@/services/mongoApi).
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@/lib/http'
import {
  deleteDocument,
  insertDocument,
  listDocuments,
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
  const [newDocJson, setNewDocJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const result = await listDocuments(workspaceId, databaseName, collectionName, { pageSize: 50 })
      setDocs(result.items)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [workspaceId, databaseName, collectionName])

  useEffect(() => {
    void reload()
  }, [reload])

  async function handleInsert() {
    setError(null)
    setBusy(true)
    try {
      const document = JSON.parse(newDocJson) as MongoDocument
      await insertDocument(workspaceId, databaseName, collectionName, document)
      setNewDocJson('{}')
      await reload()
    } catch (caught) {
      setError(caught instanceof SyntaxError ? 'New document is not valid JSON' : errorMessage(caught))
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

      <h3>Documents</h3>
      <ul>
        {docs.map((doc, index) => (
          <li key={documentId(doc) ?? index}>
            <code>{JSON.stringify(doc)}</code>
            <button type="button" onClick={() => void handleDelete(doc)} disabled={busy}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <h3>Insert document</h3>
      <label htmlFor="new-doc-json">New document (JSON)</label>
      <textarea id="new-doc-json" value={newDocJson} onChange={(event) => setNewDocJson(event.target.value)} />
      <button type="button" onClick={() => void handleInsert()} disabled={busy}>
        Insert
      </button>
    </section>
  )
}
