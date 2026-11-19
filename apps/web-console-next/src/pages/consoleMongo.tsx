import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Breadcrumbs, Card, CardBody, Collapsible, CollapsiblePanel, CollapsibleTrigger, EmptyState, Field, FieldLabel, I18nProvider, JsonViewer, Link, LiveAnnouncer, Page, SimpleSelect, Tabs, TabsList, TabsPanel, TabsTab, Text, ToastProvider, ToolbarButton, useHasLiveAnnouncer } from '@gntik-ai/ui'
import { PageHeader, PageToolbar, type DataTableColumn } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { collectionPath, collectionsPath, databasesPath, documentsPath, documentsUrl, formatBytes, indexesPath, listUrl, viewsPath, type MongoCollection, type MongoDatabase, type MongoDocument, type MongoIndex, type MongoView } from './consoleMongo/api'
import { focusRing, useCopy } from './consoleMongo/copy'
import { PagedBody } from './consoleMongo/Footer'
import { Snippets } from './consoleMongo/Snippets'
import { Chip, Empty, FailureView, Heading, Loading, Section, Table, Tag } from './consoleMongo/States'
import { LocalizedToaster } from './consoleMongo/Toaster'
import { useCursorList, useOne } from './consoleMongo/useRemote'
import { Wizard } from './consoleMongo/Wizard'
import './consoleMongo/page.css'

function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  // Legacy WorkspaceRequiredState.tsx:35-58: loading, error with Reintentar, then the picker, create link or denial note.
  // Tenant discovery and workspaces share loading and error in the shell context. This gate only mounts under an active tenant.
  if (context.loading) return <section role="status"><Heading title={t('workspaceLoading')} description={t('workspaceLoadingDescription')} level="h3" /><Loading label={t('workspaceLoading')} /></section>
  if (context.error) return <FailureView section="workspace" error={context.error} retry={() => void context.reloadWorkspaces?.()} />
  const action: ComponentPropsOf<typeof EmptyState>['primaryAction'] = context.workspaces.length
    ? <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="mongo-workspace">{t('workspacePicker')}</FieldLabel><SimpleSelect id="mongo-workspace" value="" defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(id) => context.selectWorkspace(id || null)} className={`w-full min-w-0 ${focusRing}`} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('workspaceCreate')}</Link> : <Text as="p" variant="body" tone="muted">{t('workspaceDenied')}</Text>
  return <Empty title={t('workspaceRequired')} description="" action={action} />
}
type ComponentPropsOf<T> = T extends (props: infer P) => unknown ? P : never

function TabSet({ value, change, choices, label, children }: { value: string; change: (value: string) => void; choices: string[]; label: string; children: ReactNode }) {
  const { t } = useCopy()
  return <Tabs value={value} defaultValue={choices[0]} onValueChange={(next) => change(String(next))} orientation="horizontal" variant="underline" className="min-w-0">
    <TabsList aria-label={label} indicator={false} fullWidth={false} activateOnFocus={true} className="flex max-w-full flex-wrap">{choices.map((choice) => <TabsTab key={choice} value={choice} icon={undefined} count={undefined} disabled={false} className={focusRing}>{t(choice)}</TabsTab>)}</TabsList>
    <TabsPanel value={value} keepMounted={false} className="min-w-0 space-y-4">{children}</TabsPanel>
  </Tabs>
}

function useViewerLabels() {
  const { t } = useCopy()
  return { copyPath: t('json.copyPath'), copyValue: t('json.copyValue'), copied: t('json.copied'), copyFailed: t('json.copyFailed'), selectHint: t('json.selectHint'), truncated: t('json.truncated'), copyFullHint: t('json.copyFullHint'), keys: (count: number) => t('json.keys', { count }), items: (count: number) => t('json.items', { count }), root: t('json.root') }
}
function Json({ data, label, height = 200 }: { data: unknown; label: string; height?: number }) {
  const labels = useViewerLabels()
  return <div className="min-w-0 max-w-full"><JsonViewer data={data} label={label} defaultExpandDepth={1} maxDepth={undefined} search="" toolbar={false} maxHeight={height} maxDisplayChars={undefined} emptyContent={undefined} labels={labels} className="min-w-0" /></div>
}

// Expansion lives with the page, so it survives a tab round trip for the same collection selection.
function DocumentCard({ document, index, open, setOpen }: { document: MongoDocument; index: number; open: boolean; setOpen: (open: boolean) => void }) {
  const { t } = useCopy(), id = String(document._id)
  return <Card variant="default" className="min-w-0" data-testid="mongo-document"><CardBody className="min-w-0 space-y-3">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><Text as="p" variant="supporting" tone="muted">{t('documentLabel')}</Text><Text as="p" variant="label" tone="default" id={`mongo-doc-${index}`}>{id}</Text></div>
    </div>
    <Collapsible open={open} onOpenChange={setOpen} variant="subtle" className="min-w-0">
      <CollapsibleTrigger showChevron={true} aria-describedby={`mongo-doc-${index}`} data-mongo-row="" className={focusRing}>{t(open ? 'hideJson' : 'showJson')}</CollapsibleTrigger>
      <CollapsiblePanel keepMounted={false} className="min-w-0"><Json data={document} label={t('documentJson', { id })} height={384} /></CollapsiblePanel>
    </Collapsible>
  </CardBody></Card>
}

function Surface() {
  const { t, i18n } = useCopy(), context = useConsoleContext()
  const { activeTenantId: tenant, activeWorkspaceId: workspace } = context
  const [database, setDatabase] = useState<string | null>(null), [picked, setPicked] = useState<{ workspace: string | null; name: string } | null>(null)
  const [databaseTab, setDatabaseTab] = useState('collections'), [collectionTab, setCollectionTab] = useState('indexes')
  const [wizard, setWizard] = useState(false), [expanded, setExpanded] = useState<number[]>([])
  const toolbar = useRef<HTMLDivElement>(null), breadcrumbRef = useRef<HTMLElement | null>(null), crumbIntent = useRef(false), lastWorkspace = useRef(workspace)

  // A collection belongs to the workspace it was picked in, so a switch never requests the old collection under the new workspace.
  const collection = picked && picked.workspace === workspace ? picked.name : null
  const scoped = database && workspace ? `${workspace}:${database}` : null
  const target = scoped && collection ? `${scoped}:${collection}` : null
  const databases = useCursorList<MongoDatabase>(tenant ? `databases:${tenant}` : null, (cursor) => listUrl(databasesPath, cursor))
  const collections = useCursorList<MongoCollection>(scoped ? `collections:${scoped}` : null, (cursor) => listUrl(collectionsPath(database!), cursor))
  const views = useCursorList<MongoView>(scoped ? `views:${scoped}` : null, (cursor) => listUrl(viewsPath(database!), cursor))
  const detail = useOne<MongoCollection>(target ? `detail:${target}` : null, target ? collectionPath(database!, collection!) : '')
  const indexes = useCursorList<MongoIndex>(target ? `indexes:${target}` : null, (cursor) => listUrl(indexesPath(database!, collection!), cursor))
  const documents = useCursorList<MongoDocument>(target ? `documents:${target}` : null, (cursor) => documentsUrl(documentsPath(workspace!, database!, collection!), cursor))

  // Expansion is keyed by row position like legacy (ConsoleMongoPage.tsx:173, :727), because object-valued _id values can stringify identically.
  // It is cleared on every collection selection (legacy :309) and kept across tab switches.
  const toggleDocument = (position: number, open: boolean) => setExpanded((current) => open ? [...current.filter((item) => item !== position), position] : current.filter((item) => item !== position))
  function chooseCollection(name: string | null) { setPicked(name === null ? null : { workspace, name }); setCollectionTab('indexes'); setExpanded([]) }
  function chooseDatabase(name: string | null) { setDatabase(name); setDatabaseTab('collections'); chooseCollection(null) }
  // A workspace switch refetches collections and views through their keys and drops the collection detail.
  useLayoutEffect(() => { if (lastWorkspace.current !== workspace) { lastWorkspace.current = workspace; chooseCollection(null); setWizard(false) } }, [workspace])
  useLayoutEffect(() => { if (crumbIntent.current) { crumbIntent.current = false; const current = breadcrumbRef.current?.querySelector<HTMLElement>('[aria-current="page"]'); if (current) { current.tabIndex = -1; current.classList.add(...focusRing.split(' ')); current.focus() } } }, [database, collection])

  const locale = i18n.language, none = t('none')
  const bytes = (value?: number) => formatBytes(value, locale, none)
  const yes = (value?: boolean) => t(value ? 'yes' : 'no')
  const opener = () => Array.from(toolbar.current?.querySelectorAll<HTMLElement>('button') ?? []).find((button) => button.textContent?.trim() === t('newDatabase')) ?? null
  const crumb = (action: () => void) => <button type="button" className={focusRing} onClick={(event) => { event.preventDefault(); crumbIntent.current = true; action() }} />

  const databaseColumns: DataTableColumn<MongoDatabase>[] = [
    { id: 'name', header: t('columns.database'), sortable: false, cell: (row) => row.databaseName },
    { id: 'dataSize', header: t('columns.dataSize'), sortable: false, cell: (row) => bytes(row.stats?.dataSize) },
    { id: 'storageSize', header: t('columns.storageSize'), sortable: false, cell: (row) => bytes(row.stats?.storageSize) },
    { id: 'collections', header: t('columns.collections'), sortable: false, cell: (row) => row.stats?.collections ?? none },
    { id: 'indexes', header: t('columns.indexes'), sortable: false, cell: (row) => row.stats?.indexes ?? none },
  ]
  const typeTone = (type?: string) => type === 'capped' ? 'warning' : type === 'time-series' ? 'info' : 'neutral'
  const collectionColumns: DataTableColumn<MongoCollection>[] = [
    { id: 'name', header: t('columns.collection'), sortable: false, cell: (row) => row.collectionName },
    { id: 'type', header: t('columns.type'), sortable: false, cell: (row) => { const type = row.collectionType ?? 'standard'; return <Tag label={t(`types.${type}`, { defaultValue: type })} tone={typeTone(type)} /> } },
    { id: 'documents', header: t('columns.documents'), sortable: false, cell: (row) => row.documentCount ?? none },
    { id: 'size', header: t('columns.size'), sortable: false, cell: (row) => bytes(row.estimatedSize) },
    { id: 'validation', header: t('columns.validation'), sortable: false, cell: (row) => row.validation?.validator ? <Tag label={t('validationActive')} tone="success" /> : <Tag label={t('validationNone')} tone="neutral" /> },
  ]
  const viewColumns: DataTableColumn<MongoView>[] = [
    { id: 'name', header: t('columns.view'), sortable: false, cell: (row) => <span tabIndex={-1} data-mongo-row="" className={focusRing}>{row.viewName}</span> },
    { id: 'source', header: t('columns.source'), sortable: false, cell: (row) => row.viewOn ?? none },
    { id: 'pipeline', header: t('columns.pipeline'), sortable: false, cell: (row) => <Json data={row.pipeline ?? []} label={t('columns.pipeline')} height={160} /> },
  ]
  const rebuildTone = (state?: string) => state === 'in_progress' ? 'warning' : state === 'failed' ? 'destructive' : 'neutral'
  const indexColumns: DataTableColumn<MongoIndex>[] = [
    { id: 'name', header: t('columns.index'), sortable: false, cell: (row) => <span tabIndex={-1} data-mongo-row="" className={focusRing}>{row.indexName}</span> },
    { id: 'fields', header: t('columns.fields'), sortable: false, cell: (row) => (row.keys ?? []).map((key) => `${key.fieldName}: ${String(key.direction ?? none)}`).join(', ') || none },
    { id: 'type', header: t('columns.type'), sortable: false, cell: (row) => row.indexType ?? none },
    { id: 'unique', header: t('columns.unique'), sortable: false, cell: (row) => yes(row.unique) },
    { id: 'sparse', header: t('columns.sparse'), sortable: false, cell: (row) => yes(row.sparse) },
    { id: 'ttl', header: t('columns.ttl'), sortable: false, cell: (row) => row.ttlSeconds ?? none },
    { id: 'partial', header: t('columns.partialFilter'), sortable: false, cell: (row) => row.partialFilterExpression ? <Json data={row.partialFilterExpression} label={t('columns.partialFilter')} height={128} /> : none },
    { id: 'rebuild', header: t('columns.rebuild'), sortable: false, cell: (row) => row.rebuildState ? <Tag label={t(`rebuild.${row.rebuildState}`, { defaultValue: row.rebuildState })} tone={rebuildTone(row.rebuildState)} /> : none },
  ]
  const onlyId = indexes.items.length === 1 && indexes.items[0]?.indexName === '_id_' && indexes.cursor === null
  const validation = detail.data?.validation

  return <>
    <h2 className="sr-only">{t('navigationHeading')}</h2>
    <Breadcrumbs ref={breadcrumbRef} aria-label={t('navigation')} maxItems={10} separator="chevron" expandLabel={(count) => t('expandBreadcrumbs', { count })} className="max-w-full flex-wrap" items={[
      { label: t('databases'), href: '#', icon: undefined, hideLabel: false, mono: false, render: crumb(() => chooseDatabase(null)) },
      ...(database ? [{ label: database, href: collection ? '#' : undefined, icon: undefined, hideLabel: false, mono: false, render: collection ? crumb(() => chooseCollection(null)) : undefined }] : []),
      ...(collection ? [{ label: collection, href: undefined, icon: undefined, hideLabel: false, mono: false, render: undefined }] : []),
    ]} />
    <div ref={toolbar} className="min-w-0">
      <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('actions')} searchPlaceholder={t('actions')} views={[]} view="" defaultView="" onViewChange={undefined} aria-label={t('actions')} className="mongo-toolbar min-w-0 flex-wrap"
        filters={<ToolbarButton variant="secondary" icon={undefined} disabled={!tenant} onClick={() => void databases.reload()}>{t('refresh')}</ToolbarButton>}
        primaryAction={{ label: t('newDatabase'), variant: 'primary', onClick: () => setWizard(true) }} />
    </div>
    {!tenant ? <Empty level="h2" title={t('noTenant')} /> : <Section id="mongo-databases" name="databases" title={t('databases')} description={t('databasesDescription')} busy={databases.busy} error={databases.error} retry={() => void databases.reload()}>
      {databases.items.length ? <PagedBody list={databases} name="databases"><Table rows={databases.items} id={(row) => row.databaseName} selection={{ name: 'mongo-databases', selectedId: database, choose: chooseDatabase }} label={t('tableLabels.databases')} loadingLabel={t('loading.databases')} columns={databaseColumns} /></PagedBody> : <Empty title={t('empty.databases')} />}
    </Section>}
    {database && <section className="min-w-0 space-y-4" aria-label={t('databaseHeading', { name: database })}>
      <Heading title={t('databaseHeading', { name: database })} description={t('databaseDescription')} />
      <TabSet value={databaseTab} change={setDatabaseTab} choices={['collections', 'views']} label={t('databaseHeading', { name: database })}>
        {databaseTab === 'collections' && (!workspace ? <WorkspaceGate /> : <Section id="mongo-collections" name="collections" title={t('collections')} level="h3" busy={collections.busy} error={collections.error} retry={() => void collections.reload()}>
          {collections.items.length ? <PagedBody list={collections} name="collections"><Table rows={collections.items} id={(row) => row.collectionName} selection={{ name: 'mongo-collections', selectedId: collection, choose: chooseCollection }} label={t('tableLabels.collections')} loadingLabel={t('loading.collections')} columns={collectionColumns} /></PagedBody> : <Empty title={t('empty.collections')} />}
        </Section>)}
        {databaseTab === 'views' && <Section id="mongo-views" name="views" title={t('views')} level="h3" busy={views.busy} error={views.error} retry={() => void views.reload()}>
          {views.items.length ? <PagedBody list={views} name="views"><Table rows={views.items} id={(row) => row.viewName} label={t('tableLabels.views')} loadingLabel={t('loading.views')} columns={viewColumns} /></PagedBody> : <Empty title={t('empty.views')} />}
        </Section>}
      </TabSet>
    </section>}
    {collection && database && workspace && <>
      <Snippets database={database} collection={collection} workspace={Boolean(workspace)} />
      <section className="min-w-0 space-y-4" aria-label={t('collectionHeading', { name: collection })}>
        <Heading title={t('collectionHeading', { name: collection })} description={t('collectionDescription')} />
        <TabSet value={collectionTab} change={setCollectionTab} choices={['indexes', 'validation', 'documents']} label={t('collectionHeading', { name: collection })}>
          {collectionTab === 'indexes' && <Section id="mongo-indexes" name="indexes" title={t('indexes')} level="h3" busy={indexes.busy} error={indexes.error} retry={() => void indexes.reload()}>
            {onlyId || !indexes.items.length ? <Empty title={t(onlyId ? 'empty.onlyId' : 'empty.indexes')} /> : <PagedBody list={indexes} name="indexes"><Table rows={indexes.items} id={(row) => row.indexName} label={t('tableLabels.indexes')} loadingLabel={t('loading.indexes')} columns={indexColumns} /></PagedBody>}
          </Section>}
          {collectionTab === 'validation' && <Section id="mongo-validation" name="validation" title={t('validation')} level="h3" busy={detail.busy} error={detail.error} retry={() => void detail.reload()}>
            {!validation?.validator ? <Empty title={t('empty.validation')} /> : <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap gap-2"><Chip>{t('validationLevel', { value: validation.validationLevel ?? none })}</Chip><Chip>{t('validationAction', { value: validation.validationAction ?? none })}</Chip></div>
              <Json data={validation.validator} label={t('validation')} height={384} />
            </div>}
          </Section>}
          {collectionTab === 'documents' && <Section key={target} id="mongo-documents" name="documents" title={t('documents')} level="h3" busy={documents.busy} error={documents.error} retry={() => void documents.reload()}>
            {documents.items.length ? <PagedBody list={documents} name="documents"><div className="min-w-0 space-y-3">{documents.items.map((document, index) => <DocumentCard key={`${String(document._id)}-${index}`} document={document} index={index} open={expanded.includes(index)} setOpen={(open) => toggleDocument(index, open)} />)}</div></PagedBody> : <Empty title={t('empty.documents')} />}
          </Section>}
        </TabSet>
      </section>
    </>}
    {wizard && <Wizard close={() => setWizard(false)} opener={opener} onReplayUnavailable={() => void databases.reload()} />}
  </>
}

export default function ConsoleMongoPage() {
  const { t, i18n } = useCopy(), context = useConsoleContext()
  const Announcer = useHasLiveAnnouncer() ? Fragment : LiveAnnouncer
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId), workspace = context.workspaces.find((item) => item.workspaceId === context.activeWorkspaceId)
  const heading = useRef<HTMLHeadingElement>(null), previousTenant = useRef(context.activeTenantId)
  useEffect(() => { if (previousTenant.current !== context.activeTenantId) { previousTenant.current = context.activeTenantId; heading.current?.focus() } }, [context.activeTenantId])
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.loading': t('loading.databases'), 'common.copy': t('copy'), 'common.copied': t('copied'), 'common.copyFailed': t('copyFailed') }}><Announcer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="mongo-page" header={<PageHeader as="header" wrapTitle={true} titleRef={(node) => { heading.current = node; if (node) { node.id = 'mongo-heading'; node.classList.add(...focusRing.split(' ')) } }} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={t(!context.activeTenantId ? 'noTenant' : !context.activeWorkspaceId ? 'noWorkspace' : 'description')} breadcrumbs={[]} status="mongodb" statuses={{ mongodb: { label: t('badge'), tone: 'neutral' } }} meta={[{ label: t('organization'), value: tenant?.displayName ?? t('noneTenant'), icon: undefined, mono: false }, { label: t('workspace'), value: workspace?.displayName ?? t('noneWorkspace'), icon: undefined, mono: false }]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('navigation') }} />}>
      <Surface key={context.activeTenantId ?? ''} />
    </Page><LocalizedToaster />
  </ToastProvider></Announcer></I18nProvider>
}
