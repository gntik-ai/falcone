// Postgres data editor (changes: add-console-postgres-data-editor, add-console-richer-data-editors,
// add-757-console-dataplane-design-system).
// A real row data-grid (list/insert/EDIT/delete via the data API) with loading/empty states and
// an exact row count, plus an API-keys panel (issue anon/service keys, copy the plaintext once,
// copy-paste frontend snippet, revoke). Wired to the control-plane executor via @/services/postgresApi.
// #757: every control renders via the shared design-system primitives (Button/Input/Select/
// Textarea/Label/Card/Table) — this component previously had zero className usage anywhere.
import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
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
  return typeof candidate?.message === 'string' ? candidate.message : 'La solicitud falló'
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
      setError(`Fila nueva: ${parsed.error}`)
      return
    }
    setBusy(true)
    try {
      await insertRow(workspaceId, databaseName, schemaName, tableName, parsed.value)
      setNewRowJson('{}')
      setStatus('Fila insertada')
      await reloadRows()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  function beginEdit(row: PgRow) {
    if (row.id == null) {
      setError('La fila no tiene clave primaria "id" para editarla')
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
      setError(`Fila editada: ${parsed.error}`)
      return
    }
    const { id: _id, ...changes } = parsed.value
    setBusy(true)
    try {
      await updateRow(workspaceId, databaseName, schemaName, tableName, { id: editingId }, changes)
      setEditingId(null)
      setStatus('Fila actualizada')
      await reloadRows()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(row: PgRow) {
    if (row.id == null) {
      setError('La fila no tiene clave primaria "id" para eliminarla')
      return
    }
    setBusy(true)
    try {
      await deleteRow(workspaceId, databaseName, schemaName, tableName, { id: String(row.id) })
      setStatus('Fila eliminada')
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
    <section aria-label="Editor de datos Postgres" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          {schemaName}.{tableName}
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

      <Card aria-label="Filtros">
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {filters.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {filters.map((filter, index) => (
                <li
                  key={`${filter.columnName}-${filter.operator}-${index}`}
                  className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm"
                >
                  <span>
                    {filter.columnName} {filter.operator} {String(filter.value)}
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => removeFilter(index)}>
                    Quitar
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-column">Columna</Label>
              <Input id="filter-column" value={draftColumn} onChange={(event) => setDraftColumn(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-op">Operador</Label>
              <Select id="filter-op" value={draftOp} onChange={(event) => setDraftOp(event.target.value as PgFilterOperator)}>
                {FILTER_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="filter-value">Valor{draftOp === 'in' ? ' (separado por comas)' : ''}</Label>
              <Input id="filter-value" value={draftValue} onChange={(event) => setDraftValue(event.target.value)} />
            </div>
          </div>
          <Button type="button" onClick={addFilter}>
            Añadir filtro
          </Button>
        </CardContent>
      </Card>

      <Card aria-label="Filas">
        <CardHeader>
          <CardTitle>Filas{count != null ? ` (${count})` : ''}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div aria-label="Paginación" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="page-size">Tamaño de página</Label>
              <Select id="page-size" className="w-28" value={pageSize} onChange={(event) => changePageSize(Number(event.target.value))}>
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
            <p className="text-sm text-muted-foreground">Cargando filas…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay filas.</p>
          ) : (
            <Table aria-label="Filas de la tabla">
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={typeof row.id === 'string' ? row.id : index}>
                    {columns.map((column) => (
                      <TableCell key={column}>{formatCell(row[column])}</TableCell>
                    ))}
                    <TableCell>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => beginEdit(row)} disabled={busy}>
                          Editar
                        </Button>
                        <Button type="button" variant="destructive" size="sm" onClick={() => void handleDelete(row)} disabled={busy}>
                          Eliminar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {editingId != null ? (
        <Card aria-label="Editar fila">
          <CardHeader>
            <CardTitle>Editar fila {editingId}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-row-json">Fila (JSON)</Label>
              <Textarea id="edit-row-json" value={editJson} onChange={(event) => setEditJson(event.target.value)} />
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
          <CardTitle>Insertar fila</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-row-json">Fila nueva (JSON)</Label>
            <Textarea id="new-row-json" value={newRowJson} onChange={(event) => setNewRowJson(event.target.value)} />
          </div>
          <Button type="button" onClick={() => void handleInsert()} disabled={busy}>
            Insertar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Claves API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void handleIssue('anon')}>
              Emitir clave anónima
            </Button>
            <Button type="button" variant="secondary" onClick={() => void handleIssue('service')}>
              Emitir clave de servicio
            </Button>
          </div>
          {issued ? (
            <div role="status" className="space-y-4 rounded-2xl border border-border bg-background/40 p-4">
              <p className="text-sm text-muted-foreground">Copia esta clave ahora; no volverá a mostrarse:</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-lg bg-muted px-2 py-1 text-sm">{issued.key}</code>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleCopyKey()}>
                  {copied ? 'Copiada' : 'Copiar clave'}
                </Button>
              </div>

              <div aria-label="Integración con clave anónima" className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Fragmento fetch</h4>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-muted/70 p-4 text-xs">
                    {buildFrontendSnippet({ apiKey: issued.key, workspaceId, databaseName, schemaName, tableName, origin: embedOrigin })}
                  </pre>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Fragmento curl</h4>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-muted/70 p-4 text-xs">
                    {buildCurlSnippet({ apiKey: issued.key, workspaceId, databaseName, schemaName, tableName, origin: embedOrigin })}
                  </pre>
                </div>
                <Button type="button" variant="outline" onClick={() => void handlePreview()} disabled={previewBusy}>
                  Ejecutar vista previa de solo lectura
                </Button>
                {previewError ? (
                  <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    {previewError}
                  </p>
                ) : null}
                {previewRows != null ? (
                  <div aria-label="Vista previa de embed" className="space-y-3">
                    <p className="text-sm text-muted-foreground">Vista previa con esta clave: {previewRows.length} fila(s).</p>
                    <Table aria-label="Vista previa de filas con la clave emitida">
                      <TableHeader>
                        <TableRow>
                          {collectColumns(previewRows).map((column) => (
                            <TableHead key={column}>{column}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewRows.map((row, index) => (
                          <TableRow key={typeof row.id === 'string' ? row.id : index}>
                            {collectColumns(previewRows).map((column) => (
                              <TableCell key={column}>{formatCell(row[column])}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {keys.length > 0 ? (
            <ul className="space-y-2">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/40 px-3 py-2 text-sm"
                >
                  <span>
                    {key.key_prefix}… ({key.key_type}, {key.status})
                  </span>
                  {key.status === 'active' ? (
                    <Button type="button" variant="destructive" size="sm" onClick={() => void handleRevoke(key.id)}>
                      Revocar
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}
