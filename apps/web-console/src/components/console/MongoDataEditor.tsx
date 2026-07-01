// MongoDB document editor (changes: add-console-mongo-data-editor, add-console-richer-data-editors).
// Lists/inserts/EDITS/deletes documents in a collection via the control-plane executor
// (@/services/mongoApi), with loading + empty states.
import { useCallback, useEffect, useState } from 'react'

import type { ApiError } from '@/lib/http'
import { copyToClipboard, parseJsonObject, prettyJson } from '@/lib/editor-ux'
import {
  buildMongoCurlSnippet,
  buildMongoFrontendSnippet,
  deleteDocument,
  insertDocument,
  listDocuments,
  previewDocumentsWithApiKey,
  updateDocument,
  type MongoDocument,
  type MongoFilter
} from '@/services/mongoApi'
// API-key issuance is a workspace-scoped surface (engine-agnostic); reuse it here.
import { issueApiKey, type IssuedApiKey } from '@/services/postgresApi'

const PAGE_SIZES = [10, 25, 50, 100]

export interface MongoDataEditorProps {
  workspaceId: string
  databaseName: string
  collectionName: string
}

function errorMessage(error: unknown): string {
  const candidate = error as Partial<ApiError>
  return typeof candidate?.message === 'string' ? candidate.message : 'La solicitud falló'
}

function documentId(doc: MongoDocument): string | undefined {
  const id = doc._id ?? doc.id
  return id == null ? undefined : String(id)
}

export function MongoDataEditor({ workspaceId, databaseName, collectionName }: MongoDataEditorProps) {
  const [docs, setDocs] = useState<MongoDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [filterJson, setFilterJson] = useState('{}')
  const [appliedFilter, setAppliedFilter] = useState<MongoFilter>({})
  const [pageSize, setPageSize] = useState(25)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [nextAfter, setNextAfter] = useState<string | undefined>(undefined)
  const [newDocJson, setNewDocJson] = useState('{}')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editJson, setEditJson] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<IssuedApiKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [previewDocs, setPreviewDocs] = useState<MongoDocument[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const embedOrigin = typeof window !== 'undefined' ? window.location.origin : undefined

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listDocuments(workspaceId, databaseName, collectionName, { pageSize, after: cursor, filter: appliedFilter })
      setDocs(result.items)
      setNextAfter(result.page?.after)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, databaseName, collectionName, pageSize, cursor, appliedFilter])

  useEffect(() => {
    void reload()
  }, [reload])

  // Reset pagination to the first page when the collection identity changes.
  useEffect(() => {
    setCursor(undefined)
    setCursorStack([])
  }, [workspaceId, databaseName, collectionName])

  function applyFilter() {
    setError(null)
    const parsed = parseJsonObject(filterJson)
    if (!parsed.ok) {
      setError(`Filtro: ${parsed.error}`)
      return
    }
    setAppliedFilter(parsed.value)
    setCursor(undefined)
    setCursorStack([])
  }

  function clearFilter() {
    setFilterJson('{}')
    setAppliedFilter({})
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

  async function handleIssueKey() {
    setError(null)
    try {
      const key = await issueApiKey(workspaceId, 'anon')
      setIssued(key)
      setCopied(false)
      setPreviewDocs(null)
      setPreviewError(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  async function handleCopyKey() {
    if (!issued) return
    setCopied(await copyToClipboard(issued.key))
  }

  // Read-only preview AS the issued key — a bare apikey request, exactly what a frontend does.
  async function handlePreviewEmbed() {
    if (!issued) return
    setPreviewError(null)
    setPreviewBusy(true)
    try {
      const result = await previewDocumentsWithApiKey(issued.key, workspaceId, databaseName, collectionName, { pageSize: 10 })
      setPreviewDocs(result.items)
    } catch (caught) {
      setPreviewError(errorMessage(caught))
    } finally {
      setPreviewBusy(false)
    }
  }

  async function handleInsert() {
    setError(null)
    setStatus(null)
    const parsed = parseJsonObject(newDocJson)
    if (!parsed.ok) {
      setError(`Documento nuevo: ${parsed.error}`)
      return
    }
    setBusy(true)
    try {
      await insertDocument(workspaceId, databaseName, collectionName, parsed.value)
      setNewDocJson('{}')
      setStatus('Documento insertado')
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
      setError('El documento no tiene _id para editarlo')
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
      setError(`Documento editado: ${parsed.error}`)
      return
    }
    const { _id, id, ...update } = parsed.value
    setBusy(true)
    try {
      await updateDocument(workspaceId, databaseName, collectionName, editingId, update)
      setEditingId(null)
      setStatus('Documento actualizado')
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
      setError('El documento no tiene _id para eliminarlo')
      return
    }
    setBusy(true)
    try {
      await deleteDocument(workspaceId, databaseName, collectionName, id)
      setStatus('Documento eliminado')
      await reload()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Editor de datos Mongo">
      <h2>
        {databaseName}.{collectionName}
      </h2>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}

      <div aria-label="Filtro">
        <h3>Filtro</h3>
        <label htmlFor="mongo-filter-json">Filtro (consulta MongoDB en JSON)</label>
        <textarea id="mongo-filter-json" value={filterJson} onChange={(event) => setFilterJson(event.target.value)} />
        <button type="button" onClick={applyFilter}>
          Aplicar filtro
        </button>
        <button type="button" onClick={clearFilter}>
          Limpiar
        </button>
      </div>

      <h3>Documentos{docs.length > 0 ? ` (${docs.length})` : ''}</h3>
      <div aria-label="Paginación">
        <label htmlFor="mongo-page-size">Tamaño de página</label>
        <select id="mongo-page-size" value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))}>
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <button type="button" onClick={prevPage} disabled={cursorStack.length === 0 || busy}>
          Anterior
        </button>
        <button type="button" onClick={nextPage} disabled={!nextAfter || busy}>
          Siguiente
        </button>
      </div>
      {loading ? (
        <p>Cargando documentos…</p>
      ) : docs.length === 0 ? (
        <p>Todavía no hay documentos.</p>
      ) : (
        <ul>
          {docs.map((doc, index) => (
            <li key={documentId(doc) ?? index}>
              <code>{JSON.stringify(doc)}</code>
              <button type="button" onClick={() => beginEdit(doc)} disabled={busy}>
                Editar
              </button>
              <button type="button" onClick={() => void handleDelete(doc)} disabled={busy}>
                Eliminar
              </button>
            </li>
          ))}
        </ul>
      )}

      {editingId != null ? (
        <div aria-label="Editar documento">
          <h3>Editar documento {editingId}</h3>
          <label htmlFor="edit-doc-json">Documento (JSON)</label>
          <textarea id="edit-doc-json" value={editJson} onChange={(event) => setEditJson(event.target.value)} />
          <button type="button" onClick={() => void saveEdit()} disabled={busy}>
            Guardar
          </button>
          <button type="button" onClick={() => setEditingId(null)} disabled={busy}>
            Cancelar
          </button>
        </div>
      ) : null}

      <h3>Insertar documento</h3>
      <label htmlFor="new-doc-json">Documento nuevo (JSON)</label>
      <textarea id="new-doc-json" value={newDocJson} onChange={(event) => setNewDocJson(event.target.value)} />
      <button type="button" onClick={() => void handleInsert()} disabled={busy}>
        Insertar
      </button>

      <h3>Embed con clave anónima</h3>
      <button type="button" onClick={() => void handleIssueKey()}>
        Emitir clave anónima
      </button>
      {issued ? (
        <div role="status" aria-label="Embed con clave anónima">
          <p>Copia esta clave ahora; no volverá a mostrarse:</p>
          <code>{issued.key}</code>
          <button type="button" onClick={() => void handleCopyKey()}>
            {copied ? 'Copiada' : 'Copiar clave'}
          </button>
          <h4>Fragmento fetch</h4>
          <pre>{buildMongoFrontendSnippet({ apiKey: issued.key, workspaceId, databaseName, collectionName, origin: embedOrigin })}</pre>
          <h4>Fragmento curl</h4>
          <pre>{buildMongoCurlSnippet({ apiKey: issued.key, workspaceId, databaseName, collectionName, origin: embedOrigin })}</pre>
          <button type="button" onClick={() => void handlePreviewEmbed()} disabled={previewBusy}>
            Ejecutar vista previa de solo lectura
          </button>
          {previewError ? <p role="alert">{previewError}</p> : null}
          {previewDocs != null ? (
            <div aria-label="Vista previa de integración">
              <p>Vista previa con esta clave: {previewDocs.length} documento(s).</p>
              <ul>
                {previewDocs.map((doc, index) => (
                  <li key={documentId(doc) ?? index}>
                    <code>{JSON.stringify(doc)}</code>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
