import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, Field, FieldLabel, SimpleSelect, Text, Textarea, Toolbar } from '@gntik-ai/ui'
import { FormSection, InlineCallout } from '@gntik-ai/blocks'
import { collectColumns, deleteRow, failureOf, FILTER_OPERATORS, formatCell, insertRow, listRows, PAGE_SIZES, parseJsonObject, prettyJson, updateRow, type Failure, type PgFilter, type PgFilterOperator, type PgRow, type Target } from './api'
import { Confirmation, ConfirmDestructiveDialog } from './Confirm'
import { focusRing, useCopy } from './copy'
import { Action, Empty, FailureView, Heading, Loading, NoResults, Table, TextField } from './States'
import { KeysPanel } from './Keys'

type Pager = { key: string; cursor: string | undefined; stack: string[] }

function JsonField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Textarea id={id} value={value} onValueChange={onChange} rows={8} size="md" invalid={false} clearable={false} spellCheck={false} className={`w-full min-w-0 font-mono ${focusRing}`} /></Field>
}

// The row editor and API-key panel. `busy` belongs to the page, above the target-keyed state, so a
// pending insert, edit or delete keeps its controls disabled when the database, schema or table
// changes and even if this editor remounts. A settled mutation reloads only the target it started on.
export function Editor({ target, busy, setBusy, onBack, notify }: { target: Target; busy: boolean; setBusy: (busy: boolean) => void; onBack: () => void; notify: (message: string) => void }) {
  const { t } = useCopy()
  const { workspaceId, databaseName, schemaName, tableName } = target
  const key = [workspaceId, databaseName, schemaName, tableName].join('\u0000')
  const [rows, setRows] = useState<PgRow[]>([]), [count, setCount] = useState<number | null>(null), [nextAfter, setNextAfter] = useState<string | undefined>(undefined)
  const [load, setLoad] = useState<{ busy: boolean; error: Failure | null }>({ busy: true, error: null })
  const [filters, setFilters] = useState<PgFilter[]>([]), [draftColumn, setDraftColumn] = useState(''), [draftOp, setDraftOp] = useState<PgFilterOperator>('eq'), [draftValue, setDraftValue] = useState('')
  const [pageSize, setPageSize] = useState(25)
  const [pager, setPager] = useState<Pager>({ key, cursor: undefined, stack: [] })
  const [newRowJson, setNewRowJson] = useState('{}'), [editing, setEditing] = useState<{ id: string; opener: HTMLElement | null } | null>(null), [editJson, setEditJson] = useState('{}')
  const [error, setError] = useState<string | null>(null), [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const generation = useRef(0), live = useRef(true), currentKey = useRef(key)
  currentKey.current = key
  // A target change starts again from the first page without a second request.
  const active = pager.key === key ? pager : { key, cursor: undefined, stack: [] }
  const reset = () => setPager({ key, cursor: undefined, stack: [] })

  const reloadRows = useCallback(async () => {
    const token = ++generation.current
    setLoad({ busy: true, error: null })
    try {
      const result = await listRows({ workspaceId, databaseName, schemaName, tableName }, { countMode: 'exact', pageSize, after: active.cursor, filters })
      if (!live.current || generation.current !== token) return
      setRows(result.items); setCount(typeof result.count === 'number' ? result.count : null); setNextAfter(result.page?.after); setLoad({ busy: false, error: null })
    } catch (cause) {
      if (!live.current || generation.current !== token) return
      // Rows from a failed read are never shown as fresh.
      setRows([]); setCount(null); setNextAfter(undefined); setLoad({ busy: false, error: failureOf(cause) })
    }
  }, [workspaceId, databaseName, schemaName, tableName, pageSize, active.cursor, filters])
  const latest = useRef(reloadRows)
  latest.current = reloadRows
  useEffect(() => { live.current = true; void reloadRows(); return () => { live.current = false; generation.current++ } }, [reloadRows])
  const reloadIfCurrent = async (started: string) => { if (live.current && currentKey.current === started) await latest.current() }
  const message = (cause: unknown) => failureOf(cause).message ?? t('mutationFailed')

  function addFilter() {
    if (draftColumn.trim() === '') return
    const value = draftOp === 'in' ? draftValue.split(',').map((entry) => entry.trim()) : draftValue
    setFilters([...filters, { columnName: draftColumn.trim(), operator: draftOp, value }])
    setDraftColumn(''); setDraftValue(''); reset()
  }
  function removeFilter(index: number) { setFilters(filters.filter((_, i) => i !== index)); reset() }
  function changePageSize(size: number) { setPageSize(size); reset() }
  function nextPage() { if (nextAfter) setPager({ key, cursor: nextAfter, stack: [...active.stack, active.cursor ?? ''] }) }
  function prevPage() {
    if (active.stack.length === 0) return
    const stack = [...active.stack], previous = stack.pop()
    setPager({ key, cursor: previous === '' ? undefined : previous, stack })
  }

  async function handleInsert() {
    if (busy) return
    setError(null)
    const parsed = parseJsonObject(newRowJson)
    if (!parsed.ok) { setError(t('newRowInvalid', { error: t(parsed.error) })); return }
    const started = key
    setBusy(true)
    try {
      await insertRow(target, parsed.value)
      setNewRowJson('{}'); notify(t('inserted'))
      await reloadIfCurrent(started)
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  function beginEdit(row: PgRow, opener: HTMLElement) {
    if (row.id == null) { setError(t('missingKeyEdit')); return }
    setError(null)
    setEditing({ id: String(row.id), opener }); setEditJson(prettyJson(row))
  }
  async function saveEdit() {
    if (editing == null || busy) return
    const parsed = parseJsonObject(editJson)
    if (!parsed.ok) { setError(t('editRowInvalid', { error: t(parsed.error) })); return }
    const { id: _id, ...changes } = parsed.value
    const started = key
    setError(null); setBusy(true)
    try {
      await updateRow(target, { id: editing.id }, changes)
      setEditing(null); notify(t('updated'))
      await reloadIfCurrent(started)
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }
  function askDelete(row: PgRow, opener: HTMLElement) {
    if (row.id == null) { setError(t('missingKeyDelete')); return }
    const id = String(row.id), started = key
    setError(null)
    setConfirmation({
      title: t('deleteTitle', { id }), description: t('deleteDescription'), consequences: [t('deleteConsequenceRow', { id, table: `${schemaName}.${tableName}` }), t('deleteConsequenceUndo')],
      value: id, confirmLabel: t('deleteConfirm'), opener, testId: 'pgdata-delete-dialog',
      run: async () => {
        setBusy(true)
        try { await deleteRow(target, { id }); notify(t('deleted')); await reloadIfCurrent(started) }
        catch (cause) { setError(message(cause)) } finally { setBusy(false) }
      },
    })
  }

  const callout = error && <div role="alert" data-testid="pgdata-error"><InlineCallout tone="destructive" title={t('mutationErrorTitle')} description={error} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} /></div>
  const columns = collectColumns(rows).map((column) => ({ id: column, header: column, sortable: false, cell: (row: PgRow) => formatCell(row[column]) }))
  const dataColumns = [...columns, { id: 'pgdata-actions', header: t('columnActions'), sortable: false, cell: (row: PgRow) => <div className="flex flex-wrap gap-2">
    <Action disabled={busy} onClick={(event) => beginEdit(row, event.currentTarget)}>{t('edit')}</Action>
    <Action variant="destructive" disabled={busy} onClick={(event) => askDelete(row, event.currentTarget)}>{t('delete')}</Action>
  </div> }]
  const notFound = load.error?.status === 404
  return <section aria-label={t('editorLabel')} className="min-w-0 space-y-6" data-testid="pgdata-editor">
    <Heading title={`${schemaName}.${tableName}`} id="pgdata-target-heading" />
    {!editing && callout}

    <section aria-label={t('filtersTitle')} className="min-w-0 space-y-3">
      <Heading title={t('filtersTitle')} description={t('filtersDescription')} level="h3" />
      {filters.length > 0 && <ul aria-label={t('filterList')} className="flex flex-wrap gap-2">{filters.map((filter, index) => <li key={`${filter.columnName}-${filter.operator}-${index}`} className="min-w-0 max-w-full">
        <Badge tone="neutral" variant="outline" size="md" shape="rounded" dot={false} onRemove={() => removeFilter(index)} removeLabel={t('removeFilter')}>{`${filter.columnName} ${filter.operator} ${String(filter.value)}`}</Badge></li>)}</ul>}
      <Toolbar variant="plain" aria-label={t('filtersTitle')} className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <TextField id="pgdata-filter-column" label={t('filterColumn')} placeholder={undefined} value={draftColumn} onChange={setDraftColumn} />
        <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="pgdata-filter-op">{t('filterOperator')}</FieldLabel>
          <SimpleSelect id="pgdata-filter-op" value={draftOp} placeholder={undefined} clearable={false} size="md" items={FILTER_OPERATORS.map((op) => ({ value: op, label: op }))} onValueChange={(next) => setDraftOp(next as PgFilterOperator)} className={`w-full min-w-0 ${focusRing}`} /></Field>
        <TextField id="pgdata-filter-value" label={t(draftOp === 'in' ? 'filterValueIn' : 'filterValue')} placeholder={undefined} value={draftValue} onChange={setDraftValue} />
        <div><Action variant="primary" onClick={addFilter}>{t('addFilter')}</Action></div>
      </Toolbar>
    </section>

    <section aria-label={t('rowsTitle')} aria-busy={load.busy} className="min-w-0 space-y-4" data-testid="pgdata-rows">
      <Heading title={count != null ? t('rowsTitleCount', { count }) : t('rowsTitle')} description={t('rowsDescription')} />
      <div aria-label={t('pagination')} role="group" className="flex min-w-0 flex-wrap items-end gap-3">
        <Field invalid={false} disabled={false} className="w-32 min-w-0"><FieldLabel htmlFor="pgdata-page-size">{t('pageSize')}</FieldLabel>
          <SimpleSelect id="pgdata-page-size" value={String(pageSize)} placeholder={undefined} clearable={false} size="md" items={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))} onValueChange={(next) => changePageSize(Number(next))} className={`w-full min-w-0 ${focusRing}`} /></Field>
        <Action disabled={active.stack.length === 0 || busy} onClick={prevPage}>{t('previous')}</Action>
        <Action disabled={!nextAfter || busy} onClick={nextPage}>{t('next')}</Action>
        {!load.busy && !load.error && <Text as="p" variant="supporting" tone="muted">{t('rowsShown', { count: rows.length })}</Text>}
      </div>
      {load.busy ? <Loading label={t('rowsLoading')} />
        : notFound ? <div data-testid="pgdata-not-found"><Empty title={t('notFound')} description={t('notFoundDescription')} action={<Action variant="primary" onClick={onBack}>{t('back')}</Action>} /></div>
        : load.error ? <FailureView error={load.error} section={t('rowsTitle')} message="rowsError" retry={() => void reloadRows()} testId="pgdata-failure-rows" />
        : rows.length === 0 ? <NoResults title={t('rowsEmpty')} description={t('rowsEmptyDescription')} />
        : <Table rows={rows} columns={dataColumns} id={(row, index) => `${index}:${String(row.id ?? '')}`} label={t('tableLabel')} />}
    </section>

    <FormSection title={t('insertTitle')} description={t('insertDescription')} headingLevel="h2" divided={false} labels={{ title: t('insertTitle'), description: t('insertDescription') }}
      actions={<Action variant="primary" disabled={busy} onClick={() => void handleInsert()}>{t('insert')}</Action>}>
      <JsonField id="pgdata-new-row" label={t('insertLabel')} value={newRowJson} onChange={setNewRowJson} />
    </FormSection>

    <KeysPanel target={target} refreshKey={JSON.stringify([databaseName, schemaName, tableName, pageSize, active.cursor ?? null, filters])} report={setError} notify={notify} />

    <Drawer open={editing != null} onOpenChange={(next, event) => { if (!next) { if (busy) event.cancel(); else setEditing(null) } }} side="right">
      <DrawerContent size="md" showClose={false} closeLabel={t('close')} container={undefined} keepMounted={false} finalFocus={() => editing?.opener?.isConnected ? editing.opener : true} className="min-w-0 max-w-full wrap-anywhere" data-testid="pgdata-drawer">
        <DrawerHeader><DrawerTitle>{t('editTitle', { id: editing?.id ?? '' })}</DrawerTitle><DrawerDescription>{t('editDescription')}</DrawerDescription></DrawerHeader>
        <DrawerBody className="min-h-0 flex-1 space-y-4 overflow-y-auto">{callout}<JsonField id="pgdata-edit-row" label={t('editLabel')} value={editJson} onChange={setEditJson} /></DrawerBody>
        <DrawerFooter className="flex-wrap gap-2"><Action variant="primary" disabled={busy} onClick={() => void saveEdit()}>{t('save')}</Action><Action disabled={busy} onClick={() => setEditing(null)}>{t('cancel')}</Action></DrawerFooter>
      </DrawerContent>
    </Drawer>
    {confirmation && <ConfirmDestructiveDialog confirmation={confirmation} close={() => setConfirmation(null)} />}
  </section>
}
