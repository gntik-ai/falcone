// MongoDB document editor (changes: add-console-mongo-data-editor, add-console-richer-data-editors,
// add-757-console-dataplane-design-system).
// Lists/inserts/EDITS/deletes documents in a collection via the control-plane executor
// (@/services/mongoApi), with loading + empty states.
// #757: every control renders via the shared design-system primitives (Button/Textarea/Label/Card)
// — this component previously had zero className usage anywhere.
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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
    <section aria-label="Editor de datos Mongo" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          {databaseName}.{collectionName}
        </h2>
      </div>
      {error ? (
        <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {status ? (
        <p role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {status}
        </p>
      ) : null}

      <Card aria-label="Filtro">
        <CardHeader>
          <CardTitle>Filtro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mongo-filter-json">Filtro (consulta MongoDB en JSON)</Label>
            <Textarea id="mongo-filter-json" value={filterJson} onChange={(event) => setFilterJson(event.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={applyFilter}>
              Aplicar filtro
            </Button>
            <Button type="button" variant="outline" onClick={clearFilter}>
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentos{docs.length > 0 ? ` (${docs.length})` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div aria-label="Paginación" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mongo-page-size">Tamaño de página</Label>
              <Select id="mongo-page-size" className="w-28" value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))}>
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={prevPage} disabled={cursorStack.length === 0 || busy}>
              Anterior
            </Button>
            <Button type="button" variant="outline" onClick={nextPage} disabled={!nextAfter || busy}>
              Siguiente
            </Button>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando documentos…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay documentos.</p>
          ) : (
            <ul className="space-y-2">
              {docs.map((doc, index) => (
                <li
                  key={documentId(doc) ?? index}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-sm"
                >
                  <code className="min-w-0 flex-1 truncate">{JSON.stringify(doc)}</code>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => beginEdit(doc)} disabled={busy}>
                      Editar
                    </Button>
                    <Button type="button" variant="destructive" size="sm" onClick={() => void handleDelete(doc)} disabled={busy}>
                      Eliminar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {editingId != null ? (
        <Card aria-label="Editar documento">
          <CardHeader>
            <CardTitle>Editar documento {editingId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-doc-json">Documento (JSON)</Label>
              <Textarea id="edit-doc-json" value={editJson} onChange={(event) => setEditJson(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void saveEdit()} disabled={busy}>
                Guardar
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditingId(null)} disabled={busy}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Insertar documento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-doc-json">Documento nuevo (JSON)</Label>
            <Textarea id="new-doc-json" value={newDocJson} onChange={(event) => setNewDocJson(event.target.value)} />
          </div>
          <Button type="button" onClick={() => void handleInsert()} disabled={busy}>
            Insertar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Embed con clave anónima</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button type="button" onClick={() => void handleIssueKey()}>
            Emitir clave anónima
          </Button>
          {issued ? (
            <div role="status" aria-label="Embed con clave anónima" className="space-y-4 rounded-2xl border border-border bg-background/40 p-4">
              <p className="text-sm text-muted-foreground">Copia esta clave ahora; no volverá a mostrarse:</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-muted px-2 py-1 text-sm">{issued.key}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyKey()}>
                  {copied ? 'Copiada' : 'Copiar clave'}
                </Button>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Fragmento fetch</h4>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-muted/70 p-4 text-xs">
                  {buildMongoFrontendSnippet({ apiKey: issued.key, workspaceId, databaseName, collectionName, origin: embedOrigin })}
                </pre>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-foreground">Fragmento curl</h4>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-muted/70 p-4 text-xs">
                  {buildMongoCurlSnippet({ apiKey: issued.key, workspaceId, databaseName, collectionName, origin: embedOrigin })}
                </pre>
              </div>
              <Button type="button" variant="outline" onClick={() => void handlePreviewEmbed()} disabled={previewBusy}>
                Ejecutar vista previa de solo lectura
              </Button>
              {previewError ? (
                <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {previewError}
                </p>
              ) : null}
              {previewDocs != null ? (
                <div aria-label="Vista previa de integración" className="space-y-2">
                  <p className="text-sm text-muted-foreground">Vista previa con esta clave: {previewDocs.length} documento(s).</p>
                  <ul className="space-y-2">
                    {previewDocs.map((doc, index) => (
                      <li key={documentId(doc) ?? index} className="rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-sm">
                        <code>{JSON.stringify(doc)}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}
