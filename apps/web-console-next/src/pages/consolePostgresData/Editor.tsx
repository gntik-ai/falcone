import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, Field, FieldLabel, Textarea, useAnnounce, useToast } from '@gntik-ai/ui'
import { FormSection, InlineCallout, type DataTableColumn } from '@gntik-ai/blocks'
import { FILTER_OPERATORS, PAGE_SIZES, collectColumns, deleteRow, failureOf, formatCell, insertRow, listRows, parseJsonObject, prettyJson, updateRow, type Failure, type PgFilter, type PgFilterOperator, type PgRow, type Target } from './api'
import { ConfirmTyped } from './ConfirmTyped'
import { focusRing, useCopy } from './copy'
import { KeyPanel, useKeys } from './Keys'
import { Action, Choice, DataGrid, FailureView, Heading, Loading, NoRows, TextField } from './parts'

export interface Mutations { busy: boolean; active: () => boolean; track: <T>(task: () => Promise<T>) => Promise<T> }
type RowsState = { status: 'loading' | 'ready' | 'error'; rows: PgRow[]; count: number | null; next: string | undefined; failure: Failure | null }
type Pager = { key: string; cursor: string | undefined; stack: string[] }
type EditState = { id: string; json: string; target: Target; trigger: HTMLElement | null }
type Notice = { scope: 'page' | 'edit'; message: string } | null
type Row = { key: string; row: PgRow }

// The busy flag lives in the page, above this component, so a database, schema or table change can never
// remount the editor into a non-busy state (legacy keeps the same guard). Mutations capture their target when they start.
export function PostgresDataEditor({ target, mutations, onBack }: { target: Target; mutations: Mutations; onBack: () => void }) {
  const { t, i18n } = useCopy(), announce = useAnnounce(), toast = useToast()
  const { workspaceId, databaseName, schemaName, tableName } = target
  const targetKey = `${workspaceId}|${databaseName}|${schemaName}|${tableName}`
  const stable = useMemo<Target>(() => ({ workspaceId, databaseName, schemaName, tableName }), [workspaceId, databaseName, schemaName, tableName])
  const [rowsState, setRowsState] = useState<RowsState>({ status: 'loading', rows: [], count: null, next: undefined, failure: null })
  const [filters, setFilters] = useState<PgFilter[]>([]), [draftColumn, setDraftColumn] = useState(''), [draftOp, setDraftOp] = useState<PgFilterOperator>('eq'), [draftValue, setDraftValue] = useState('')
  const [pageSize, setPageSize] = useState(25), [pager, setPager] = useState<Pager>({ key: targetKey, cursor: undefined, stack: [] })
  const [newRowJson, setNewRowJson] = useState('{}'), [edit, setEdit] = useState<EditState | null>(null), [notice, setNotice] = useState<Notice>(null)
  const [deleting, setDeleting] = useState<{ id: string; trigger: HTMLElement | null } | null>(null)
  const keys = useKeys(workspaceId)
  const rowsHeading = useRef<HTMLDivElement>(null), insertButton = useRef<HTMLButtonElement>(null), editArea = useRef<HTMLTextAreaElement>(null)
  const token = useRef(0), mounted = useRef(true), lastEdit = useRef<EditState | null>(null), deleted = useRef(false)
  if (edit) lastEdit.current = edit
  const feedback = useRef({ t, announce, toast })
  useLayoutEffect(() => { feedback.current = { t, announce, toast } }, [t, announce, toast])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current++ } }, [])

  // Returning to a previously visited target starts at its first page: the pager is keyed by target and reset on any change.
  let page = pager
  if (pager.key !== targetKey) { page = { key: targetKey, cursor: undefined, stack: [] }; setPager(page) }

  const loadRows = useCallback(async (silent = false): Promise<void> => {
    const mine = ++token.current
    if (!silent) {
      setRowsState({ status: 'loading', rows: [], count: null, next: undefined, failure: null })
      feedback.current.announce(feedback.current.t('rows.loading'), 'polite')
    }
    try {
      const result = await listRows(stable, { countMode: 'exact', pageSize, after: page.cursor, filters })
      if (mounted.current && mine === token.current) setRowsState({ status: 'ready', rows: result.items ?? [], count: typeof result.count === 'number' ? result.count : null, next: result.page?.after, failure: null })
    } catch (cause) {
      // Rows from before a failure are cleared, never shown as fresh.
      if (mounted.current && mine === token.current) setRowsState({ status: 'error', rows: [], count: null, next: undefined, failure: failureOf(cause) })
    }
  }, [stable, pageSize, page.cursor, filters])
  const reloadRef = useRef(loadRows)
  useLayoutEffect(() => { reloadRef.current = loadRows }, [loadRows])
  const reloadKeys = keys.reload
  useEffect(() => { void loadRows(); void reloadKeys() }, [loadRows, reloadKeys])

  const resetPager = () => setPager({ key: targetKey, cursor: undefined, stack: [] })
  function addFilter() {
    if (draftColumn.trim() === '') return
    const value = draftOp === 'in' ? draftValue.split(',').map((entry) => entry.trim()) : draftValue
    setFilters([...filters, { columnName: draftColumn.trim(), operator: draftOp, value }]); setDraftColumn(''); setDraftValue(''); resetPager()
  }
  function removeFilter(index: number) { setFilters(filters.filter((_, i) => i !== index)); resetPager() }
  function changePageSize(size: number) { setPageSize(size); resetPager() }
  function nextPage() { if (rowsState.next) setPager({ key: targetKey, cursor: rowsState.next, stack: [...page.stack, page.cursor ?? ''] }) }
  function prevPage() {
    if (page.stack.length === 0) return
    const stack = [...page.stack], previous = stack.pop()
    setPager({ key: targetKey, cursor: previous === '' ? undefined : previous, stack })
  }

  const message = (cause: unknown) => failureOf(cause).message ?? feedback.current.t('requestFailed')
  const succeed = (title: string) => { feedback.current.toast.add({ title, description: undefined, tone: 'success', priority: 'low' }); feedback.current.announce(title, 'polite') }
  // After a reload the activated control may be gone; keep focus on a stable control, never on body.
  const settleFocus = (selector = '[data-pgdata-none]') => requestAnimationFrame(() => {
    if (!mounted.current || (document.activeElement && document.activeElement !== document.body)) return
    ;(document.querySelector<HTMLElement>(selector) ?? rowsHeading.current ?? insertButton.current)?.focus()
  })

  async function insert() {
    if (mutations.active()) return
    setNotice(null)
    const parsed = parseJsonObject(newRowJson)
    if (!parsed.ok) { setNotice({ scope: 'page', message: t('newRowError', { reason: t(parsed.error) }) }); return }
    const snapshot = stable
    try {
      await mutations.track(async () => {
        await insertRow(snapshot, parsed.value)
        if (mounted.current) setNewRowJson('{}')
        succeed(feedback.current.t('inserted'))
        await reloadRef.current(true)
      })
      settleFocus('[data-pgdata-insert]')
    } catch (cause) { if (mounted.current) setNotice({ scope: 'page', message: message(cause) }) }
  }
  function beginEdit(row: PgRow, trigger: HTMLElement) {
    if (mutations.active()) return
    if (row.id == null) { setNotice({ scope: 'page', message: t('missingKeyEdit') }); return }
    setNotice(null); setEdit({ id: String(row.id), json: prettyJson(row), target: stable, trigger })
  }
  async function saveEdit() {
    if (!edit || mutations.active()) return
    const parsed = parseJsonObject(edit.json)
    if (!parsed.ok) { setNotice({ scope: 'edit', message: t('editRowError', { reason: t(parsed.error) }) }); return }
    const { id: _id, ...changes } = parsed.value, current = edit
    setNotice(null)
    try {
      await mutations.track(async () => {
        await updateRow(current.target, { id: current.id }, changes)
        if (mounted.current) setEdit(null)
        succeed(feedback.current.t('updated'))
        await reloadRef.current(true)
      })
      settleFocus(`[data-pgdata-edit="${CSS.escape(current.id)}"]`)
    } catch (cause) { if (mounted.current) setNotice({ scope: 'edit', message: message(cause) }) }
  }
  function beginDelete(row: PgRow, trigger: HTMLElement) {
    if (mutations.active()) return
    if (row.id == null) { setNotice({ scope: 'page', message: t('missingKeyDelete') }); return }
    setNotice(null); deleted.current = false; setDeleting({ id: String(row.id), trigger })
  }
  async function confirmDelete(id: string) {
    const snapshot = stable
    try {
      await mutations.track(async () => {
        await deleteRow(snapshot, { id })
        succeed(feedback.current.t('deleted'))
        await reloadRef.current(true)
      })
      deleted.current = true
    } catch (cause) { if (mounted.current) setNotice({ scope: 'page', message: message(cause) }) }
  }

  const items = useMemo<Row[]>(() => { const seen = new Map<string, number>(); return rowsState.rows.map((row, index) => { const base = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id) : `row-${index}`, n = seen.get(base) ?? 0; seen.set(base, n + 1); return { key: n ? `${base}#${n}` : base, row } }) }, [rowsState.rows])
  const columns: DataTableColumn<Row>[] = [
    ...collectColumns(rowsState.rows).map((column): DataTableColumn<Row> => ({ id: `col:${column}`, header: column, sortable: false, accessor: (item) => formatCell(item.row[column]) })),
    { id: 'actions', header: t('actions'), sortable: false, cell: (item) => <div className="flex flex-wrap gap-2">
      <Action disabled={mutations.busy} data-pgdata-edit={item.row.id == null ? undefined : String(item.row.id)} aria-label={t('rows.editAria', { id: String(item.row.id ?? item.key) })} onClick={(event) => beginEdit(item.row, event.currentTarget)}>{t('edit')}</Action>
      <Action variant="destructive" disabled={mutations.busy} aria-label={t('rows.deleteAria', { id: String(item.row.id ?? item.key) })} onClick={(event) => beginDelete(item.row, event.currentTarget)}>{t('delete')}</Action>
    </div> },
  ]
  const formatted = new Intl.NumberFormat(i18n.language).format(rowsState.count ?? 0)
  const shown = edit ?? lastEdit.current
  const callout = (scope: 'page' | 'edit') => notice?.scope === scope && <div className="min-w-0"><InlineCallout tone="destructive" title={t('errorTitle')} labels={{ title: t('errorTitle') }} description={notice.message} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div>
  const opLabel = (op: string) => t(`operators.${op}`)

  return <section aria-label={t('editorLabel')} className="min-w-0 space-y-6" data-testid="pgdata-editor">
    <div data-pgdata-target="" className="min-w-0"><Heading title={`${schemaName}.${tableName}`} /></div>
    {callout('page')}
    <section aria-label={t('filters.title')} className="min-w-0 space-y-4">
      <Heading title={t('filters.title')} />
      {filters.length > 0 && <ul className="flex flex-wrap gap-2" aria-label={t('filters.active')}>{filters.map((filter, index) => <li key={`${filter.columnName}-${filter.operator}-${index}`}>
        <Badge tone="neutral" variant="outline" size="md" shape="rounded" dot={false} onRemove={() => removeFilter(index)} removeLabel={t('filters.remove', { filter: `${filter.columnName} ${filter.operator} ${String(filter.value)}` })} className="max-w-full">{filter.columnName} {filter.operator} {String(filter.value)}</Badge></li>)}</ul>}
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <TextField id="filter-column" label={t('filters.column')} value={draftColumn} onChange={setDraftColumn} />
        <Choice id="filter-op" label={t('filters.operator')} value={draftOp} items={FILTER_OPERATORS.map((op) => ({ value: op, label: opLabel(op) }))} onChange={setDraftOp} />
        <TextField id="filter-value" label={draftOp === 'in' ? t('filters.valueList') : t('filters.value')} value={draftValue} onChange={setDraftValue} />
      </div>
      <Action variant="primary" onClick={addFilter}>{t('filters.add')}</Action>
    </section>
    <section aria-label={t('rows.title')} className="min-w-0 space-y-4" aria-busy={rowsState.status === 'loading'} data-testid="pgdata-rows">
      <div ref={rowsHeading} tabIndex={-1} className={`min-w-0 ${focusRing}`}><Heading title={rowsState.count != null ? t('rows.titleCount', { total: formatted }) : t('rows.title')} /></div>
      <div role="group" aria-label={t('pager.label')} className="flex flex-wrap items-end gap-3">
        <div className="w-32"><Choice id="page-size" label={t('pager.size')} value={String(pageSize)} items={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))} onChange={(value) => changePageSize(Number(value))} /></div>
        <Action disabled={page.stack.length === 0 || mutations.busy} onClick={prevPage}>{t('pager.previous')}</Action>
        <Action disabled={!rowsState.next || mutations.busy} onClick={nextPage}>{t('pager.next')}</Action>
      </div>
      {rowsState.status === 'loading' ? <Loading label={t('rows.loading')} />
        : rowsState.status === 'error' && rowsState.failure ? <FailureView section="rows" error={rowsState.failure} retry={() => void loadRows()} back={<Action onClick={onBack}>{t('back')}</Action>} />
        : items.length === 0 ? <NoRows title={t('rows.empty')} description={t('rows.emptyDescription')} entity={t('rows.title')} />
        : <DataGrid rows={items} columns={columns} id={(item) => item.key} rowLabel={(item) => String(item.row.id ?? item.key)} label={t('rows.tableLabel')} loadingLabel={t('rows.loading')} emptyTitle={t('rows.empty')} />}
    </section>
    <FormSection title={t('insert.title')} description={t('insert.description')} headingLevel="h2" divided={false} labels={{ title: t('insert.title'), description: t('insert.description') }} className="min-w-0"
      actions={<Button ref={insertButton} type="button" variant="primary" size="md" loading={false} disabled={mutations.busy} iconOnly={false} icon={undefined} trailingIcon={undefined} data-pgdata-insert="" className={focusRing} onClick={() => void insert()}>{t('insert.submit')}</Button>}>
      <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="new-row-json">{t('insert.label')}</FieldLabel>
        <Textarea id="new-row-json" value={newRowJson} onChange={(event) => setNewRowJson(event.target.value)} invalid={false} disabled={false} rows={6} resize="vertical" size="md" className="min-w-0 font-mono" /></Field>
    </FormSection>
    <KeyPanel target={stable} keys={keys} reload={keys.reload} onError={(text) => setNotice(text === null ? null : { scope: 'page', message: text })} />
    <Drawer open={edit != null} side="right" onOpenChange={(next) => { if (!next && !mutations.active()) setEdit(null) }}>
      <DrawerContent size="md" showClose={false} closeLabel={t('close')} container={undefined} initialFocus={() => editArea.current} finalFocus={() => lastEdit.current?.trigger?.isConnected ? lastEdit.current.trigger : true} className="min-w-0 max-w-full" data-testid="pgdata-drawer">
        <DrawerHeader><DrawerTitle className="break-all">{t('editDrawer.title', { id: shown?.id ?? '' })}</DrawerTitle><DrawerDescription>{t('editDrawer.description')}</DrawerDescription></DrawerHeader>
        <DrawerBody className="min-w-0 space-y-4">
          {callout('edit')}
          <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="edit-row-json">{t('editDrawer.label')}</FieldLabel>
            <Textarea ref={editArea} id="edit-row-json" value={edit?.json ?? shown?.json ?? '{}'} onChange={(event) => setEdit((current) => current && { ...current, json: event.target.value })} invalid={false} disabled={false} rows={12} resize="vertical" size="md" className="min-w-0 font-mono" /></Field>
        </DrawerBody>
        <DrawerFooter className="flex-wrap gap-2">
          <Action variant="primary" disabled={mutations.busy} onClick={() => void saveEdit()}>{t('save')}</Action>
          <Action disabled={mutations.busy} onClick={() => { if (!mutations.active()) setEdit(null) }}>{t('cancel')}</Action>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
    {deleting && <ConfirmTyped title={t('deleteConfirm.title')} description={t('deleteConfirm.description', { id: deleting.id })} consequences={[t('deleteConfirm.consequence1'), t('deleteConfirm.consequence2')]} expected={deleting.id} confirmLabel={t('deleteConfirm.confirm')} trigger={deleting.trigger} onConfirm={() => confirmDelete(deleting.id)} onClose={() => { setDeleting(null); if (deleted.current) settleFocus() }} />}
  </section>
}
