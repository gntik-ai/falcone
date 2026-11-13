import { Fragment, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Breadcrumbs, Button, I18nProvider, LiveAnnouncer, Page, Tabs, TabsList, TabsPanel, TabsTab, ToastProvider, Toolbar, ToolbarButton, useHasLiveAnnouncer } from '@gntik-ai/ui'
import { PageHeader, type DataTableColumn } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { databasePath, objectPath, schemaPath, tablePath, type PgColumn, type PgDatabase, type PgIndex, type PgMatView, type PgPolicy, type PgSchema, type PgTable, type PgView, type PreviewTarget } from './consolePostgres/api'
import { Action, Details, Empty, FailureView, Heading, List, Loading, Tag } from './consolePostgres/Parts'
import { useList, useSecurity } from './consolePostgres/useSection'
import { focusRing, formatLabel, useCopy } from './consolePostgres/copy'
import { WorkspaceGate } from './consolePostgres/WorkspaceGate'
import { Preview } from './consolePostgres/Preview'
import { Snippets } from './consolePostgres/Snippets'
import { LocalizedToaster, Wizard } from './consolePostgres/Wizard'

type OpenPreview = (target: PreviewTarget, event: MouseEvent<HTMLButtonElement>) => void
function SectionTabs({ id, tabs, children }: { id: string; tabs: string[]; children: ReactNode[] }) {
  const { t } = useCopy()
  const [tab, setTab] = useState(tabs[0])
  return <Tabs value={tab} defaultValue={tabs[0]} onValueChange={(value) => setTab(String(value))} orientation="horizontal" variant="underline" className="min-w-0 space-y-4">
    <TabsList aria-label={t(id)} indicator={false} fullWidth={false} activateOnFocus={true} className="max-w-full flex-wrap">
      {tabs.map((key) => <TabsTab key={key} value={key} icon={undefined} count={undefined} disabled={false} className={focusRing}>{t(key)}</TabsTab>)}
    </TabsList>
    {tabs.map((key, index) => <TabsPanel key={key} value={key} keepMounted={false} className="min-w-0">{children[index]}</TabsPanel>)}
  </Tabs>
}
function DatabaseList({ select, selected, wizard }: { select: (database: PgDatabase) => void; selected: string | null; wizard: (trigger: HTMLElement | null) => void }) {
  const { t } = useCopy(), state = useList<PgDatabase>(databasePath)
  const label = (value: string) => t(`values.${value}`, { defaultValue: formatLabel(value) })
  const columns: DataTableColumn<PgDatabase>[] = [
    { id: 'name', header: t('database'), sortable: false, cell: (row) => <Action variant="ghost" aria-pressed={selected === row.databaseName} onClick={() => select(row)}>{row.databaseName}</Action> },
    { id: 'state', header: t('state'), sortable: false, cell: (row) => <Tag>{label(row.state)}</Tag> },
    { id: 'owner', header: t('owner'), sortable: false, accessor: (row) => row.ownerRoleName },
    { id: 'placement', header: t('placement'), sortable: false, accessor: (row) => label(row.placementMode) },
  ]
  return <div className="min-w-0 space-y-3">
    {/* Compose page-toolbar from its kit parts: the pinned block always adds search, absent in legacy. */}
    <Toolbar aria-label={t('databaseActions')} orientation="horizontal" loopFocus={true} className="min-w-0 flex-wrap">
      <ToolbarButton variant="primary" size="sm" icon={undefined} disabled={false} className={focusRing} onClick={(event) => wizard(event.currentTarget)}>{t('newDatabase')}</ToolbarButton>
    </Toolbar>
    <List id="databases" title={t('databases')} description={t('databasesDescription')} state={state} columns={columns} onSelect={select} rowId={(row) => row.databaseName} />
  </div>
}
function Schemas({ database, selected, select }: { database: string; selected: string | null; select: (schema: string) => void }) {
  const { t } = useCopy(), state = useList<PgSchema>(schemaPath(database))
  return <List id="schemas" title={t('schemasTitle', { name: database })} description={t('schemasDescription')} state={state} onSelect={(row) => select(row.schemaName)} rowId={(row) => row.schemaName} columns={[
    { id: 'name', header: t('schema'), sortable: false, cell: (row) => <Action variant="ghost" aria-pressed={selected === row.schemaName} onClick={() => select(row.schemaName)}>{row.schemaName}</Action> },
    { id: 'state', header: t('state'), sortable: false, cell: (row) => <Tag>{t(`values.${row.state}`, { defaultValue: formatLabel(row.state) })}</Tag> },
    { id: 'owner', header: t('owner'), sortable: false, accessor: (row) => row.ownerRoleName },
    { id: 'counts', header: t('counts'), sortable: false, accessor: (row) => row.objectCounts ? t('objectCounts', row.objectCounts) : t('none') },
  ]} />
}
function SchemaDetail({ database, schema, selectedTable, selectTable, openPreview }: { database: string; schema: string; selectedTable: string | null; selectTable: (table: string) => void; openPreview: OpenPreview }) {
  const { t } = useCopy()
  const path = objectPath(database, schema)
  const tables = useList<PgTable>(`${path}/tables`), views = useList<PgView>(`${path}/views`), matviews = useList<PgMatView>(`${path}/materialized-views`)
  const label = (value?: string) => value ? t(`values.${value}`, { defaultValue: formatLabel(value) }) : t('none')
  const boolean = (value?: boolean) => t(value ? 'yes' : 'no')
  return <section className="min-w-0 space-y-4" aria-label={t('schemaTitle', { name: schema })}><Heading title={t('schemaTitle', { name: schema })} description={t('schemaDescription')} />
    <SectionTabs id="schemaTabs" tabs={['tables', 'views', 'matviews']}>
      {[
        <List key="tables" id="tables" title={t('tables')} description="" state={tables} onSelect={(row) => selectTable(row.tableName)} rowId={(row) => row.tableName} columns={[
          { id: 'name', header: t('table'), sortable: false, cell: (row) => <Action variant="ghost" aria-pressed={selectedTable === row.tableName} onClick={() => selectTable(row.tableName)}>{row.tableName}</Action> },
          { id: 'state', header: t('state'), sortable: false, cell: (row) => <Tag>{label(row.state)}</Tag> },
          { id: 'columns', header: t('columns'), sortable: false, accessor: (row) => row.columnCount },
        ]} />,
        <List key="views" id="views" title={t('views')} description="" state={views} rowId={(row) => row.viewName} columns={[
          { id: 'name', header: t('view'), sortable: false, accessor: (row) => row.viewName },
          { id: 'state', header: t('state'), sortable: false, cell: (row) => <Tag>{label(row.state)}</Tag> },
          { id: 'columns', header: t('columns'), sortable: false, accessor: (row) => row.columns?.join(', ') || t('none') },
          { id: 'barrier', header: t('securityBarrier'), sortable: false, accessor: (row) => boolean(row.securityBarrier) },
          { id: 'preview', header: t('preview'), sortable: false, cell: (row) => <Action onClick={(event) => openPreview({ kind: 'view', name: row.viewName, view: row }, event)}>{t('previewAction')}</Action> },
        ]} />,
        <List key="matviews" id="matviews" title={t('matviews')} description="" state={matviews} rowId={(row) => row.viewName} columns={[
          { id: 'name', header: t('matview'), sortable: false, accessor: (row) => row.viewName },
          { id: 'state', header: t('state'), sortable: false, cell: (row) => <Tag>{label(row.state)}</Tag> },
          { id: 'data', header: t('withData'), sortable: false, accessor: (row) => boolean(row.withData) },
          { id: 'refresh', header: t('refreshPolicy'), sortable: false, accessor: (row) => row.refreshPolicy || t('none') },
          { id: 'integrity', header: t('integrity'), sortable: false, accessor: (row) => row.integrityProfile?.populationState || t('none') },
          { id: 'preview', header: t('preview'), sortable: false, cell: (row) => <Action onClick={(event) => openPreview({ kind: 'matview', name: row.viewName, view: row }, event)}>{t('previewAction')}</Action> },
        ]} />,
      ]}
    </SectionTabs>
  </section>
}
function TableDetail({ database, schema, table, openPreview }: { database: string; schema: string; table: string; openPreview: OpenPreview }) {
  const { t } = useCopy(), path = tablePath(database, schema, table)
  const columns = useList<PgColumn>(`${path}/columns`), indexes = useList<PgIndex>(`${path}/indexes`), policies = useList<PgPolicy>(`${path}/policies`), security = useSecurity(`${path}/security`)
  const label = (value?: string) => value ? t(`values.${value}`, { defaultValue: formatLabel(value) }) : t('none')
  const record = security.data
  return <section className="min-w-0 space-y-4" aria-label={t('tableTitle', { name: table })}>
    <div className="flex flex-wrap items-start justify-between gap-3"><Heading title={t('tableTitle', { name: table })} description={t('tableDescription')} /><Action onClick={(event) => openPreview({ kind: 'table', name: table }, event)}>{t('previewAction')}</Action></div>
    <SectionTabs id="tableTabs" tabs={['columns', 'indexes', 'policies', 'security']}>
      {[
        <List key="columns" id="columns" title={t('columns')} description="" state={columns} rowId={(row) => row.columnName} columns={[
          { id: 'name', header: t('column'), sortable: false, accessor: (row) => row.columnName },
          { id: 'type', header: t('type'), sortable: false, accessor: (row) => row.dataType?.typeName || t('unknown') },
          { id: 'nullable', header: t('nullable'), sortable: false, cell: (row) => <Tag>{t(row.nullable ? 'null' : 'notNull')}</Tag> },
          { id: 'default', header: t('default'), sortable: false, accessor: (row) => row.defaultExpression || t('none') },
          { id: 'position', header: t('position'), sortable: false, accessor: (row) => row.ordinalPosition ?? t('none') },
        ]} />,
        <List key="indexes" id="indexes" title={t('indexes')} description="" state={indexes} rowId={(row) => row.indexName} columns={[
          { id: 'name', header: t('index'), sortable: false, accessor: (row) => row.indexName },
          { id: 'method', header: t('method'), sortable: false, accessor: (row) => row.indexMethod },
          { id: 'unique', header: t('uniqueness'), sortable: false, cell: (row) => <Tag>{t(row.unique ? 'unique' : 'none')}</Tag> },
          { id: 'keys', header: t('keys'), sortable: false, accessor: (row) => row.keys?.map((key) => key.columnName || key.expression || t('none')).join(', ') || t('none') },
          { id: 'include', header: t('include'), sortable: false, accessor: (row) => row.includeColumns?.join(', ') || t('none') },
        ]} />,
        <List key="policies" id="policies" title={t('policies')} description="" state={policies} emptyKey={record?.rlsEnabled === false ? 'policiesDisabled' : 'policiesEmpty'} rowId={(row) => row.policyName} columns={[
          { id: 'name', header: t('policy'), sortable: false, accessor: (row) => row.policyName },
          { id: 'mode', header: t('mode'), sortable: false, accessor: (row) => label(row.policyMode) },
          { id: 'command', header: t('command'), sortable: false, accessor: (row) => row.appliesTo?.command?.toUpperCase() || t('none') },
          { id: 'roles', header: t('roles'), sortable: false, accessor: (row) => row.appliesTo?.roles?.join(', ') || t('allRoles') },
          { id: 'using', header: t('using'), sortable: false, accessor: (row) => row.usingExpression ? row.usingExpression.length > 60 ? `${row.usingExpression.slice(0, 60)}…` : row.usingExpression : t('none') },
        ]} />,
        <section key="security" ref={security.region} tabIndex={-1} aria-label={t('security')} data-testid="pg-security" className={`min-w-0 space-y-3 ${focusRing}`}><Heading title={t('security')} description="" />
          {security.loading ? <Loading label={t('securityLoading')} /> : security.failure ? <FailureView failure={security.failure} message={t('securityError')} retry={security.reload} /> : !record ? <Empty title={t('securityEmpty')} /> : <Details title={t('security')} items={[
            { id: 'rls', label: t('rlsEnabled'), value: t(record.rlsEnabled ? 'yes' : 'no') },
            { id: 'force', label: t('forceRls'), value: t(record.forceRls ? 'yes' : 'no') },
            { id: 'policies', label: t('policyCount'), value: String(record.policyCount ?? 0) },
            { id: 'classification', label: t('sharedClassification'), value: label(record.sharedTableClassification) },
            { id: 'state', label: t('state'), value: label(record.state) },
          ]} />}
        </section>,
      ]}
    </SectionTabs>
  </section>
}
function Inventory() {
  const { t } = useCopy(), context = useConsoleContext()
  const { activeTenantId: tenant, activeWorkspaceId: workspace } = context
  const [database, setDatabase] = useState<PgDatabase | null>(null), [schema, setSchema] = useState<string | null>(null), [table, setTable] = useState<string | null>(null)
  const [selectionWorkspace, setSelectionWorkspace] = useState(workspace)
  const [wizard, setWizard] = useState(false), [target, setTarget] = useState<(PreviewTarget & { revision: number }) | null>(null)
  const wizardTrigger = useRef<HTMLElement | null>(null), previewTrigger = useRef<HTMLElement | null>(null)
  const breadcrumb = useRef<HTMLElement>(null), focusCrumb = useRef<string | null>(null)
  // A context switch preserves the chosen database while dropping its workspace-scoped descendants.
  if (selectionWorkspace !== workspace) { setSelectionWorkspace(workspace); setSchema(null); setTable(null); setTarget(null); setWizard(false) }
  useLayoutEffect(() => {
    if (!focusCrumb.current) return
    const element = Array.from(breadcrumb.current?.querySelectorAll<HTMLElement>('button, [aria-current="page"]') ?? []).find((item) => item.textContent === focusCrumb.current)
    focusCrumb.current = null
    if (element) { element.tabIndex = 0; element.focus() }
  }, [database, schema, table])
  const reset = (level: 'database' | 'schema' | 'table', label: string) => {
    focusCrumb.current = label
    if (level === 'database') setDatabase(null)
    if (level !== 'table') setSchema(null)
    setTable(null); setTarget(null)
  }
  const crumbs = [{ label: t('databases'), reset: () => reset('database', t('databases')) }, ...(database ? [{ label: database.databaseName, reset: () => reset('schema', database.databaseName) }] : []), ...(schema ? [{ label: schema, reset: () => reset('table', schema) }] : []), ...(table ? [{ label: table, reset: () => {} }] : [])]
  const description = t(!tenant ? 'tenantDescription' : !workspace ? 'noWorkspaceDescription' : 'description')
  const activeTenant = context.tenants.find((item) => item.tenantId === tenant), activeWorkspace = context.workspaces.find((item) => item.workspaceId === workspace)
  const previewContext = useMemo(() => ({ tenant, workspace, database: database?.databaseName ?? null, schema }), [tenant, workspace, database?.databaseName, schema])
  const openPreview: OpenPreview = (value, event) => { previewTrigger.current = event.currentTarget; setTarget({ ...value, revision: Date.now() }) }
  const openWizard = (trigger: HTMLElement | null) => { wizardTrigger.current = trigger; setWizard(true) }
  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('databaseActions')} className="min-w-0 max-w-full space-y-6 wrap-anywhere" data-testid="console-postgres-page" header={<PageHeader as="div" wrapTitle={true} titleRef={undefined} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={description} breadcrumbs={[]} status="postgres" statuses={{ postgres: { label: t('postgresql'), tone: 'neutral' } }} meta={[{ label: t('tenantLabel'), value: activeTenant?.displayName ?? t('noTenant'), icon: undefined, mono: false }, { label: t('workspaceLabel'), value: activeWorkspace?.displayName ?? t('noWorkspace'), icon: undefined, mono: false }]} tabs={null} actions={[]} labels={{ title: t('title'), description, moreActions: t('databaseActions'), sections: t('navigation') }} />}>
    <section className="min-w-0 space-y-3"><Heading title={t('navigation')} description={t('navigationDescription')} /><Breadcrumbs ref={breadcrumb} items={crumbs.map((crumb) => ({ label: crumb.label, href: '#', icon: undefined, hideLabel: false, mono: false, render: <Button type="button" variant="ghost" size="sm" className={focusRing} onClick={(event) => { event.preventDefault(); crumb.reset() }} /> }))} separator="chevron" maxItems={undefined} expandLabel={(count) => t('expandBreadcrumbs', { count })} aria-label={t('navigation')} className="min-w-0 max-w-full overflow-x-auto" /></section>
    {!tenant ? <><Action id="pg-new-database" variant="primary" onClick={(event) => openWizard(event.currentTarget)}>{t('newDatabase')}</Action><Empty title={t('tenantDescription')} /></> : <DatabaseList selected={database?.databaseName ?? null} select={(value) => { setDatabase(value); setSchema(null); setTable(null); setTarget(null) }} wizard={openWizard} />}
    {database && <>
      <Snippets key={database.databaseName} database={database.databaseName} state={database.state} />
      {workspace ? <Schemas key={`${workspace}/${database.databaseName}`} database={database.databaseName} selected={schema} select={(value) => { setSchema(value); setTable(null); setTarget(null) }} /> : <section aria-label={t('schemasTitle', { name: database.databaseName })}><Heading title={t('schemasTitle', { name: database.databaseName })} description={t('schemasDescription')} /><WorkspaceGate /></section>}
      {workspace && schema && <SchemaDetail key={`${workspace}/${database.databaseName}/${schema}`} database={database.databaseName} schema={schema} selectedTable={table} selectTable={(value) => { setTable(value); setTarget(null) }} openPreview={openPreview} />}
      {workspace && schema && table && <TableDetail key={`${workspace}/${database.databaseName}/${schema}/${table}`} database={database.databaseName} schema={schema} table={table} openPreview={openPreview} />}
    </>}
    {target && <Preview key={`${target.kind}/${target.name}/${target.revision}`} context={previewContext} target={target} trigger={previewTrigger.current} close={() => setTarget(null)} />}
    {wizard && <Wizard key={`${tenant}/${workspace}`} close={() => setWizard(false)} trigger={wizardTrigger.current} />}
  </Page>
}
export default function ConsolePostgresPage() {
  const { i18n, t } = useCopy(), { activeTenantId } = useConsoleContext()
  const Announcer = useHasLiveAnnouncer() ? Fragment : LiveAnnouncer
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.copied': t('copied'), 'common.copyFailed': t('clipboardUnavailable') }}><Announcer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Inventory key={activeTenantId ?? ''} /><LocalizedToaster />
  </ToastProvider></Announcer></I18nProvider>
}
