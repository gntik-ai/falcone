import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, Field, FieldLabel, JsonViewer, Textarea, useAnnounce, useToast } from '@gntik-ai/ui'
import { FormSection, InlineCallout, PageToolbar, type DataTableColumn } from '@gntik-ai/blocks'
import { PAGE_SIZES, deleteDocument, documentId, failureOf, insertDocument, listDocuments, parseJsonObject, prettyJson, updateDocument, type Failure, type MongoDocument, type MongoFilter, type Target } from './api'
import { ConfirmTyped } from './ConfirmTyped'
import { focusRing, useCopy } from './copy'
import { KeyPanel } from './Keys'
import { Action, Choice, DataGrid, FailureView, Heading, Loading, NoDocuments } from './parts'

export interface Mutations { busy: boolean; active: () => boolean; track: <T>(task: () => Promise<T>) => Promise<T> }
type DocsState = { status: 'loading' | 'ready' | 'error'; docs: MongoDocument[]; next: string | undefined; failure: Failure | null }
type Pager = { key: string; cursor: string | undefined; stack: string[] }
type EditState = { id: string; json: string; target: Target; trigger: HTMLElement | null }
type Scope = 'page' | 'filter' | 'insert' | 'edit'
type Notice = { scope: Scope; message: string } | null
type Item = { key: string; doc: MongoDocument }

// The busy flag lives in the page, above this component, so a database or collection change can never remount the
// editor into a non-busy state (legacy keeps the same guard). Mutations capture their target when they start.
export function MongoDataEditor({ target, mutations, onBack }: { target: Target; mutations: Mutations; onBack: () => void }) {
  const { t } = useCopy(), announce = useAnnounce(), toast = useToast()
  const { workspaceId, databaseName, collectionName } = target
  const targetKey = `${workspaceId}|${databaseName}|${collectionName}`
  const stable = useMemo<Target>(() => ({ workspaceId, databaseName, collectionName }), [workspaceId, databaseName, collectionName])
  const [docsState, setDocsState] = useState<DocsState>({ status: 'loading', docs: [], next: undefined, failure: null })
  const [filterJson, setFilterJson] = useState('{}'), [appliedFilter, setAppliedFilter] = useState<MongoFilter>({})
  const [pageSize, setPageSize] = useState(25), [pager, setPager] = useState<Pager>({ key: targetKey, cursor: undefined, stack: [] })
  const [newDocJson, setNewDocJson] = useState('{}'), [edit, setEdit] = useState<EditState | null>(null), [notice, setNotice] = useState<Notice>(null)
  const [deleting, setDeleting] = useState<{ id: string; index: number; trigger: HTMLElement | null } | null>(null)
  const docsHeading = useRef<HTMLDivElement>(null), insertButton = useRef<HTMLButtonElement>(null), saveButton = useRef<HTMLButtonElement>(null), editArea = useRef<HTMLTextAreaElement>(null)
  const token = useRef(0), mounted = useRef(true), lastEdit = useRef<EditState | null>(null)
  if (edit) lastEdit.current = edit
  const feedback = useRef({ t, announce, toast })
  useLayoutEffect(() => { feedback.current = { t, announce, toast } }, [t, announce, toast])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; token.current++ } }, [])

  // Returning to a previously visited target starts at its first page: the pager is keyed by target and reset on any change.
  let page = pager
  if (pager.key !== targetKey) { page = { key: targetKey, cursor: undefined, stack: [] }; setPager(page) }

  const loadDocs = useCallback(async (silent = false): Promise<void> => {
    const mine = ++token.current
    if (!silent) {
      setDocsState({ status: 'loading', docs: [], next: undefined, failure: null })
      feedback.current.announce(feedback.current.t('documents.loading'), 'polite')
    }
    try {
      const result = await listDocuments(stable, { pageSize, after: page.cursor, filter: appliedFilter })
      if (mounted.current && mine === token.current) setDocsState({ status: 'ready', docs: result.items ?? [], next: result.page?.after, failure: null })
    } catch (cause) {
      // Documents from before a failure are cleared, never shown as fresh.
      if (mounted.current && mine === token.current) setDocsState({ status: 'error', docs: [], next: undefined, failure: failureOf(cause) })
    }
  }, [stable, pageSize, page.cursor, appliedFilter])
  const reloadRef = useRef(loadDocs)
  useLayoutEffect(() => { reloadRef.current = loadDocs }, [loadDocs])
  useEffect(() => { void loadDocs() }, [loadDocs])

  const resetPager = () => setPager({ key: targetKey, cursor: undefined, stack: [] })
  function applyFilter() {
    setNotice(null)
    const parsed = parseJsonObject(filterJson)
    if (!parsed.ok) { fail('filter', t('filterError', { reason: t(parsed.error) })); return }
    setAppliedFilter(parsed.value); resetPager()
  }
  function clearFilter() { setFilterJson('{}'); setAppliedFilter({}); resetPager() }
  function changePageSize(size: number) { setPageSize(size); resetPager() }
  function nextPage() { if (docsState.next) setPager({ key: targetKey, cursor: docsState.next, stack: [...page.stack, page.cursor ?? ''] }) }
  function prevPage() {
    if (page.stack.length === 0) return
    const stack = [...page.stack], previous = stack.pop()
    setPager({ key: targetKey, cursor: previous === '' ? undefined : previous, stack })
  }

  const message = (cause: unknown) => failureOf(cause).message ?? feedback.current.t('requestFailed')
  // Failures and validation errors are announced assertively; the callout carries the same text.
  function fail(scope: Scope, text: string) { setNotice({ scope, message: text }); feedback.current.announce(text, 'assertive') }
  const succeed = (title: string) => { feedback.current.toast.add({ title, description: undefined, tone: 'success', priority: 'low' }); feedback.current.announce(title, 'polite') }
  // The activated control is disabled while a write runs and may drop focus; put it back once it is enabled again.
  const refocus = (get: () => HTMLElement | null | undefined, attempts = 6) => requestAnimationFrame(() => {
    if (!mounted.current) return
    const element = get()
    if (element && !(element as HTMLButtonElement).disabled) element.focus()
    else if (attempts > 0) refocus(get, attempts - 1)
  })
  const survivor = (index: number) => () => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('[data-mongodata-delete]'))
    return buttons[index] ?? buttons[index - 1] ?? docsHeading.current
  }

  async function insert() {
    if (mutations.active()) return
    setNotice(null)
    const parsed = parseJsonObject(newDocJson)
    if (!parsed.ok) { fail('insert', t('newDocError', { reason: t(parsed.error) })); return }
    const snapshot = stable
    try {
      await mutations.track(async () => {
        await insertDocument(snapshot, parsed.value)
        if (mounted.current) setNewDocJson('{}')
        succeed(feedback.current.t('inserted'))
        await reloadRef.current(true)
      })
      refocus(() => insertButton.current)
    } catch (cause) { if (mounted.current) { fail('insert', message(cause)); refocus(() => insertButton.current) } }
  }
  function beginEdit(doc: MongoDocument, trigger: HTMLElement) {
    if (mutations.active()) return
    const id = documentId(doc)
    if (id == null) { fail('page', t('missingIdEdit')); return }
    setNotice(null); setEdit({ id, json: prettyJson(doc), target: stable, trigger })
  }
  async function saveEdit() {
    if (!edit || mutations.active()) return
    const parsed = parseJsonObject(edit.json)
    if (!parsed.ok) { fail('edit', t('editDocError', { reason: t(parsed.error) })); return }
    // _id and id are never part of the PATCH update (legacy MongoDataEditor.tsx:200-205).
    const { _id, id: _plainId, ...update } = parsed.value, current = edit
    setNotice(null)
    try {
      await mutations.track(async () => {
        await updateDocument(current.target, current.id, update)
        if (mounted.current) setEdit(null)
        succeed(feedback.current.t('updated'))
        await reloadRef.current(true)
      })
    } catch (cause) { if (mounted.current) { fail('edit', message(cause)); refocus(() => saveButton.current) } }
  }
  function beginDelete(doc: MongoDocument, index: number, trigger: HTMLElement) {
    if (mutations.active()) return
    const id = documentId(doc)
    if (id == null) { fail('page', t('missingIdDelete')); return }
    setNotice(null); setDeleting({ id, index, trigger })
  }
  // A rejection keeps the confirmation open; ConfirmTyped shows it. A retry sends exactly one more DELETE.
  async function confirmDelete(id: string) {
    const snapshot = stable
    await mutations.track(async () => {
      await deleteDocument(snapshot, id)
      succeed(feedback.current.t('deleted'))
      await reloadRef.current(true)
    })
  }

  const items = useMemo<Item[]>(() => { const seen = new Map<string, number>(); return docsState.docs.map((doc, index) => { const base = documentId(doc) ?? `doc-${index}`, n = seen.get(base) ?? 0; seen.set(base, n + 1); return { key: n ? `${base}#${n}` : base, doc } }) }, [docsState.docs])
  const viewerLabels = { copyPath: t('json.copyPath'), copyValue: t('json.copyValue'), copied: t('json.copied'), copyFailed: t('json.copyFailed'), selectHint: t('json.selectHint'), truncated: t('json.truncated'), copyFullHint: t('json.copyFullHint'), keys: (count: number) => t('json.keys', { count }), items: (count: number) => t('json.items', { count }), root: t('json.root') }
  const columns: DataTableColumn<Item>[] = [
    { id: 'document', header: t('documents.column'), sortable: false, cell: (item) => <div data-mongodata-data="" className="min-w-0"><JsonViewer data={item.doc} label={t('documents.documentLabel', { id: item.key })} defaultExpandDepth={1} maxDepth={undefined} search="" toolbar={false} maxHeight={160} maxDisplayChars={undefined} emptyContent={undefined} labels={viewerLabels} className="min-w-0" /></div> },
    { id: 'actions', header: t('actions'), sortable: false, cell: (item) => { const index = items.indexOf(item); return <div className="flex flex-wrap gap-2">
      <Action disabled={mutations.busy} data-mongodata-edit={documentId(item.doc)} aria-label={t('documents.editAria', { id: documentId(item.doc) ?? item.key })} onClick={(event) => beginEdit(item.doc, event.currentTarget)}>{t('edit')}</Action>
      <Action variant="destructive" disabled={mutations.busy} data-mongodata-delete="" aria-label={t('documents.deleteAria', { id: documentId(item.doc) ?? item.key })} onClick={(event) => beginDelete(item.doc, index, event.currentTarget)}>{t('delete')}</Action>
    </div> } },
  ]
  const filtered = Object.keys(appliedFilter).length > 0
  const callout = (scope: Scope) => notice?.scope === scope && <div className="min-w-0"><InlineCallout tone="destructive" title={t('errorTitle')} labels={{ title: t('errorTitle') }} description={notice.message} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div>
  const shown = edit ?? lastEdit.current

  const filterSlot = <section aria-label={t('filter.title')} className="min-w-0 space-y-4">
    <Heading title={t('filter.title')} />
    <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="mongo-filter-json">{t('filter.label')}</FieldLabel>
      <Textarea id="mongo-filter-json" value={filterJson} onChange={(event) => setFilterJson(event.target.value)} invalid={false} disabled={false} rows={4} resize="vertical" size="md" className="min-w-0 font-mono" /></Field>
    {callout('filter')}
    <div className="flex flex-wrap gap-2">
      <Action variant="primary" onClick={applyFilter}>{t('filter.apply')}</Action>
      <Action onClick={clearFilter}>{t('filter.clear')}</Action>
    </div>
  </section>

  return <section aria-label={t('editorLabel')} className="min-w-0 space-y-6" data-testid="mongodata-editor">
    <div data-mongodata-target="" className="min-w-0"><Heading title={`${databaseName}.${collectionName}`} /></div>
    {callout('page')}
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('filter.title')} searchPlaceholder={t('filter.title')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('filter.title')} className="mongodata-toolbar min-w-0" filters={filterSlot} />
    <section aria-label={t('documents.title')} className="min-w-0 space-y-4" aria-busy={docsState.status === 'loading'} data-testid="mongodata-documents">
      <div ref={docsHeading} tabIndex={-1} className={`min-w-0 ${focusRing}`}><Heading title={docsState.docs.length > 0 ? t('documents.titleCount', { count: docsState.docs.length }) : t('documents.title')} /></div>
      <div role="group" aria-label={t('pager.label')} className="flex flex-wrap items-end gap-3">
        <div className="w-32"><Choice id="page-size" label={t('pager.size')} value={String(pageSize)} items={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))} onChange={(value) => changePageSize(Number(value))} /></div>
        <Action disabled={page.stack.length === 0 || mutations.busy} onClick={prevPage}>{t('pager.previous')}</Action>
        <Action disabled={!docsState.next || mutations.busy} onClick={nextPage}>{t('pager.next')}</Action>
      </div>
      {docsState.status === 'loading' ? <Loading label={t('documents.loading')} />
        : docsState.status === 'error' && docsState.failure ? <FailureView section="documents" error={docsState.failure} retry={() => void loadDocs()} back={<Action onClick={onBack}>{t('back')}</Action>} />
        : items.length === 0 ? <NoDocuments title={filtered ? t('documents.noResults') : t('documents.empty')} description={filtered ? t('documents.noResultsDescription') : t('documents.emptyDescription')} entity={t('documents.title')} clearLabel={t('filter.clear')} onClear={filtered ? clearFilter : undefined} />
        : <DataGrid rows={items} columns={columns} id={(item) => item.key} rowLabel={(item) => documentId(item.doc) ?? item.key} label={t('documents.tableLabel')} loadingLabel={t('documents.loading')} emptyTitle={t('documents.empty')} />}
    </section>
    <FormSection title={t('insert.title')} description={t('insert.description')} headingLevel="h2" divided={false} labels={{ title: t('insert.title'), description: t('insert.description') }} className="min-w-0"
      actions={<Button ref={insertButton} type="button" variant="primary" size="md" loading={false} disabled={mutations.busy} iconOnly={false} icon={undefined} trailingIcon={undefined} data-mongodata-insert="" className={focusRing} onClick={() => void insert()}>{t('insert.submit')}</Button>}>
      <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="new-doc-json">{t('insert.label')}</FieldLabel>
        <Textarea id="new-doc-json" value={newDocJson} onChange={(event) => setNewDocJson(event.target.value)} invalid={false} disabled={false} rows={6} resize="vertical" size="md" className="min-w-0 font-mono" /></Field>
      {callout('insert')}
    </FormSection>
    <KeyPanel target={stable} onError={(text) => { if (text === null) setNotice(null); else fail('page', text) }} />
    <Drawer open={edit != null} side="right" onOpenChange={(next) => { if (!next && !mutations.active()) setEdit(null) }}>
      <DrawerContent size="md" showClose={false} closeLabel={t('close')} container={undefined} initialFocus={() => editArea.current} finalFocus={() => lastEdit.current?.trigger?.isConnected ? lastEdit.current.trigger : true} className="min-w-0 max-w-full" data-testid="mongodata-drawer">
        <DrawerHeader><DrawerTitle className="break-all">{t('editDrawer.title', { id: shown?.id ?? '' })}</DrawerTitle><DrawerDescription>{t('editDrawer.description')}</DrawerDescription></DrawerHeader>
        <DrawerBody className="min-w-0 space-y-4">
          {callout('edit')}
          <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="edit-doc-json">{t('editDrawer.label')}</FieldLabel>
            <Textarea ref={editArea} id="edit-doc-json" value={edit?.json ?? shown?.json ?? '{}'} onChange={(event) => setEdit((current) => current && { ...current, json: event.target.value })} invalid={false} disabled={false} rows={12} resize="vertical" size="md" className="min-w-0 font-mono" /></Field>
        </DrawerBody>
        <DrawerFooter className="flex-wrap gap-2">
          <Button ref={saveButton} type="button" variant="primary" size="sm" loading={false} disabled={mutations.busy} iconOnly={false} icon={undefined} trailingIcon={undefined} className={focusRing} onClick={() => void saveEdit()}>{t('save')}</Button>
          <Action disabled={mutations.busy} onClick={() => { if (!mutations.active()) setEdit(null) }}>{t('cancel')}</Action>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
    {deleting && <ConfirmTyped title={t('deleteConfirm.title')} description={t('deleteConfirm.description', { id: deleting.id })} consequences={[t('deleteConfirm.consequence1'), t('deleteConfirm.consequence2')]} expected={deleting.id} confirmLabel={t('deleteConfirm.confirm')} trigger={deleting.trigger} survivor={survivor(deleting.index)} onConfirm={() => confirmDelete(deleting.id)} onClose={() => { const index = deleting.index; setDeleting(null); refocus(() => (document.activeElement && document.activeElement !== document.body ? null : survivor(index)()), 2) }} />}
  </section>
}
