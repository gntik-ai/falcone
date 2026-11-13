import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Breadcrumbs, Field, FieldLabel, I18nProvider, Link, LiveAnnouncer, Page, SimpleSelect, Tabs, TabsList, TabsPanel, TabsTab, Text, ToastProvider, Toolbar, ToolbarEnd, useHasLiveAnnouncer } from '@gntik-ai/ui'
import { PageHeader, type DataTableColumn } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { databasePath, objectsPath, schemaPath, tablePath, type Kind, type PgColumn, type PgDatabase, type PgIndex, type PgMatView, type PgPolicy, type PgSchema, type PgSecurity, type PgTable, type PgView } from './consolePostgres/api'
import { useCopy, focusRing } from './consolePostgres/copy'
import { Inventory } from './consolePostgres/Inventory'
import { PreviewPanel, Tag } from './consolePostgres/Preview'
import { Action, Details, Empty, FailureView, Heading, Loading } from './consolePostgres/States'
import { Snippets } from './consolePostgres/Snippets'
import { LocalizedToaster } from './consolePostgres/Toaster'
import { useSection, type Collection } from './consolePostgres/useSection'
import { Wizard } from './consolePostgres/Wizard'

function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  // In this foundation loading/error are shared with tenant discovery. This section is only
  // mounted after a database was selected under an active tenant, so these are workspace states.
  if (context.loading) return <section role="status"><Heading title={t('workspaceLoading')} description={t('workspaceLoadingDescription')} /><Loading label={t('workspaceLoading')} /></section>
  if (context.error) return <FailureView section="workspace" error={context.error} retry={() => void context.reloadWorkspaces?.()} />
  return <Empty title={t('workspaceRequired')} description={t('workspaceDescription')} action={context.workspaces.length ? <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="pg-workspace">{t('workspacePicker')}</FieldLabel><SimpleSelect id="pg-workspace" value="" defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(id) => context.selectWorkspace(id || null)} className={`w-full min-w-0 ${focusRing}`} /></Field> : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('workspaceCreate')}</Link> : <Text as="p" variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}
function TabSet({ value, change, choices, label, children }: { value: string; change: (value: string) => void; choices: string[]; label: string; children: ReactNode }) {
  const { t } = useCopy()
  return <Tabs value={value} defaultValue={choices[0]} onValueChange={(next) => change(String(next))} orientation="horizontal" variant="underline" className="min-w-0">
    <TabsList aria-label={label} indicator={false} fullWidth={false} activateOnFocus={true} className="flex max-w-full flex-wrap">{choices.map((choice) => <TabsTab key={choice} value={choice} icon={undefined} count={undefined} disabled={false} className={focusRing}>{t(choice)}</TabsTab>)}</TabsList>
    <TabsPanel value={value} keepMounted={false} className="min-w-0 space-y-4">{children}</TabsPanel>
  </Tabs>
}
function Surface() {
  const { t } = useCopy(), context = useConsoleContext()
  const { activeTenantId: tenant, activeWorkspaceId: workspace } = context
  const [database, setDatabase] = useState<string | null>(null), [schema, setSchema] = useState<string | null>(null), [table, setTable] = useState<string | null>(null)
  const [schemaTab, setSchemaTab] = useState('tables'), [detailTab, setDetailTab] = useState('columns')
  const [wizard, setWizard] = useState(false), [preview, setPreview] = useState<{ kind: Kind; name: string; resource?: PgView | PgMatView; opener: HTMLElement | null } | null>(null)
  const breadcrumbRef = useRef<HTMLElement | null>(null), crumbIntent = useRef(false)
  const wizardOpener = useRef<HTMLElement | null>(null), lastWorkspace = useRef(workspace)
  const databases = useSection<Collection<PgDatabase>>(tenant ? databasePath : null)
  const schemas = useSection<Collection<PgSchema>>(database && workspace ? schemaPath(database) : null, true, workspace)
  const objectPath = database && schema && workspace ? objectsPath(database, schema) : null
  const tables = useSection<Collection<PgTable>>(objectPath ? `${objectPath}/tables` : null)
  const views = useSection<Collection<PgView>>(objectPath ? `${objectPath}/views` : null)
  const matviews = useSection<Collection<PgMatView>>(objectPath ? `${objectPath}/materialized-views` : null)
  const detailPath = database && schema && table && workspace ? tablePath(database, schema, table) : null
  const columns = useSection<Collection<PgColumn>>(detailPath ? `${detailPath}/columns` : null)
  const indexes = useSection<Collection<PgIndex>>(detailPath ? `${detailPath}/indexes` : null)
  const policies = useSection<Collection<PgPolicy>>(detailPath ? `${detailPath}/policies` : null)
  const security = useSection<PgSecurity>(detailPath ? `${detailPath}/security` : null, false)
  function clearTable() { setTable(null); setDetailTab('columns'); setPreview(null) }
  function clearSchema() { setSchema(null); setSchemaTab('tables'); clearTable() }
  function chooseDatabase(name: string | null) { setDatabase(name); clearSchema() }
  function chooseSchema(name: string | null) { setSchema(name); setSchemaTab('tables'); clearTable() }
  useLayoutEffect(() => { if (lastWorkspace.current !== workspace) { lastWorkspace.current = workspace; clearSchema(); setWizard(false) } }, [workspace])
  useLayoutEffect(() => { if (crumbIntent.current) { crumbIntent.current = false; const current = breadcrumbRef.current?.querySelector<HTMLElement>('[aria-current="page"]'); if (current) { current.tabIndex = -1; current.classList.add(...focusRing.split(' ')); current.focus() } } }, [database, schema, table])
  const human = (value?: string | null) => value ? t(`enums.${value}`, { defaultValue: value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }) : t('none')
  const yn = (value: boolean) => t(value ? 'yes' : 'no')
  const stateColumn = <T extends { state: string }>(): DataTableColumn<T> => ({ id: 'state', header: t('state'), sortable: false, cell: (row) => <Tag>{human(row.state)}</Tag> })
  const previewAction = (kind: Kind, name: string, resource?: PgView | PgMatView) => <Action onClick={(event) => setPreview({ kind, name, resource, opener: event.currentTarget })}>{t('preview')}</Action>
  const title = (kind: string, name: string | null) => <Heading title={t(kind, { name })} description={kind === 'table' ? t('tableDescription') : t('descriptions.tables')} />
  return <>
    <section className="min-w-0 space-y-4"><Heading title={t('navigation')} description={t('navigationDescription')} />
      <Breadcrumbs ref={breadcrumbRef} aria-label={t('navigation')} maxItems={10} separator="chevron" expandLabel={(count) => t('expandBreadcrumbs', { count })} className="max-w-full flex-wrap" items={[
        { label: t('databases'), href: '#', icon: undefined, hideLabel: false, mono: false, render: <button type="button" className={focusRing} onClick={(event) => { event.preventDefault(); crumbIntent.current = true; chooseDatabase(null) }} /> },
        ...(database ? [{ label: database, href: '#', icon: undefined, hideLabel: false, mono: false, render: <button type="button" className={focusRing} onClick={(event) => { event.preventDefault(); crumbIntent.current = true; clearSchema() }} /> }] : []),
        ...(schema ? [{ label: schema, href: '#', icon: undefined, hideLabel: false, mono: false, render: <button type="button" className={focusRing} onClick={(event) => { event.preventDefault(); crumbIntent.current = true; clearTable() }} /> }] : []),
        ...(table ? [{ label: table, href: undefined, icon: undefined, hideLabel: false, mono: false, render: undefined }] : []),
      ]} />
    </section>
    <Toolbar variant="plain" aria-label={t('actions')} className="flex min-w-0 flex-wrap"><ToolbarEnd><Action variant="primary" onClick={(event) => { wizardOpener.current = event.currentTarget; setWizard(true) }}>{t('newDatabase')}</Action></ToolbarEnd></Toolbar>
    {!tenant ? <Empty title={t('noTenant')} /> : <Inventory state={databases} kind="databases" id={(row) => row.databaseName} columns={[
      { id: 'name', header: t('databaseName'), sortable: false, cell: (row) => <Action variant="ghost" aria-pressed={database === row.databaseName} onClick={() => chooseDatabase(row.databaseName)}>{row.databaseName}</Action> }, stateColumn(),
      { id: 'owner', header: t('owner'), sortable: false, accessor: (row) => row.ownerRoleName }, { id: 'placement', header: t('placement'), sortable: false, cell: (row) => human(row.placementMode) },
    ]} />}
    {database && <>
      <Snippets key={database} name={database} state={databases.data?.items?.find((row) => row.databaseName === database)?.state ?? null} />
      {!workspace ? <section className="min-w-0 space-y-4"><Heading title={t('schemaHeading', { name: database })} description={t('descriptions.schemas')} /><WorkspaceGate /></section> : <Inventory state={schemas} kind="schemas" title={t('schemaHeading', { name: database })} id={(row) => row.schemaName} columns={[
        { id: 'name', header: t('schemaName'), sortable: false, cell: (row) => <Action variant="ghost" aria-pressed={schema === row.schemaName} onClick={() => chooseSchema(row.schemaName)}>{row.schemaName}</Action> }, stateColumn(),
        { id: 'owner', header: t('owner'), sortable: false, accessor: (row) => row.ownerRoleName }, { id: 'counts', header: t('counts'), sortable: false, cell: (row) => row.objectCounts ? t('objectCounts', row.objectCounts) : t('none') },
      ]} />}
    </>}
    {schema && workspace && <section className="min-w-0 space-y-4">{title('schema', schema)}<TabSet value={schemaTab} change={setSchemaTab} choices={['tables', 'views', 'matviews']} label={t('schema', { name: schema })}>
      {schemaTab === 'tables' && <Inventory state={tables} kind="tables" id={(row) => row.tableName} columns={[
        { id: 'name', header: t('tableName'), sortable: false, cell: (row) => <Action variant="ghost" aria-pressed={table === row.tableName} onClick={() => { setTable(row.tableName); setDetailTab('columns'); setPreview(null) }}>{row.tableName}</Action> }, stateColumn(),
        { id: 'columns', header: t('columns'), sortable: false, accessor: (row) => row.columnCount },
      ]} />}
      {schemaTab === 'views' && <Inventory state={views} kind="views" id={(row) => row.viewName} columns={[
        { id: 'name', header: t('viewName'), sortable: false, accessor: (row) => row.viewName }, stateColumn(), { id: 'columns', header: t('columns'), sortable: false, cell: (row) => row.columns?.join(', ') || t('none') },
        { id: 'barrier', header: t('securityBarrier'), sortable: false, cell: (row) => <Tag>{yn(Boolean(row.securityBarrier))}</Tag> }, { id: 'preview', header: t('preview'), sortable: false, cell: (row) => previewAction('view', row.viewName, row) },
      ]} />}
      {schemaTab === 'matviews' && <Inventory state={matviews} kind="matviews" id={(row) => row.viewName} columns={[
        { id: 'name', header: t('matviewName'), sortable: false, accessor: (row) => row.viewName }, stateColumn(), { id: 'data', header: t('withData'), sortable: false, cell: (row) => <Tag>{yn(Boolean(row.withData))}</Tag> },
        { id: 'refresh', header: t('refreshPolicy'), sortable: false, cell: (row) => row.refreshPolicy || t('none') }, { id: 'integrity', header: t('integrity'), sortable: false, cell: (row) => row.integrityProfile?.populationState || t('none') }, { id: 'preview', header: t('preview'), sortable: false, cell: (row) => previewAction('matview', row.viewName, row) },
      ]} />}
    </TabSet></section>}
    {table && schema && workspace && <section className="min-w-0 space-y-4">{title('table', table)}{previewAction('table', table)}<TabSet value={detailTab} change={setDetailTab} choices={['columns', 'indexes', 'policies', 'security']} label={t('table', { name: table })}>
      {detailTab === 'columns' && <Inventory state={columns} kind="columns" id={(row) => row.columnName} columns={[
        { id: 'name', header: t('columnName'), sortable: false, accessor: (row) => row.columnName }, { id: 'type', header: t('type'), sortable: false, cell: (row) => row.dataType?.typeName || t('unknown') }, { id: 'nullable', header: t('nullable'), sortable: false, cell: (row) => <Tag>{t(row.nullable ? 'null' : 'notNull')}</Tag> }, { id: 'default', header: t('default'), sortable: false, cell: (row) => row.defaultExpression || t('none') }, { id: 'position', header: t('position'), sortable: false, cell: (row) => row.ordinalPosition ?? t('none') },
      ]} />}
      {detailTab === 'indexes' && <Inventory state={indexes} kind="indexes" id={(row) => row.indexName} columns={[
        { id: 'name', header: t('indexName'), sortable: false, accessor: (row) => row.indexName }, { id: 'method', header: t('method'), sortable: false, accessor: (row) => row.indexMethod }, { id: 'unique', header: t('uniqueness'), sortable: false, cell: (row) => row.unique ? <Tag>{t('unique')}</Tag> : t('none') }, { id: 'keys', header: t('keys'), sortable: false, cell: (row) => row.keys?.map((key) => key.columnName || key.expression || t('none')).join(', ') || t('none') }, { id: 'include', header: t('include'), sortable: false, cell: (row) => row.includeColumns?.join(', ') || t('none') },
      ]} />}
      {detailTab === 'policies' && <Inventory state={policies} kind="policies" emptyKey={security.data?.rlsEnabled === false ? 'policiesDisabled' : 'policies'} id={(row) => row.policyName} columns={[
        { id: 'name', header: t('policyName'), sortable: false, accessor: (row) => row.policyName }, { id: 'mode', header: t('mode'), sortable: false, cell: (row) => human(row.policyMode) }, { id: 'command', header: t('command'), sortable: false, cell: (row) => row.appliesTo?.command?.toUpperCase() || t('none') }, { id: 'roles', header: t('roles'), sortable: false, cell: (row) => row.appliesTo?.roles?.join(', ') || t('allRoles') }, { id: 'using', header: t('using'), sortable: false, cell: (row) => row.usingExpression ? row.usingExpression.length > 60 ? `${row.usingExpression.slice(0, 60)}…` : row.usingExpression : t('none') },
      ]} />}
      {detailTab === 'security' && <section id={`pg-${security.path}`} tabIndex={-1} className={`min-w-0 ${focusRing}`} aria-busy={security.busy}>
        {security.busy ? <Loading label={t('loading.security')} /> : security.error ? <FailureView section="security" error={security.error} retry={security.retry} /> : !security.data ? <Empty title={t('empty.security')} /> : <Details title={t('security')} items={[
          { id: 'rls', label: t('rlsEnabled'), value: yn(security.data.rlsEnabled) }, { id: 'force', label: t('forceRls'), value: yn(security.data.forceRls) }, { id: 'count', label: t('policyCount'), value: String(security.data.policyCount ?? 0) }, { id: 'classification', label: t('classification'), value: human(security.data.sharedTableClassification) }, { id: 'state', label: t('state'), value: human(security.data.state) },
        ]} />}
      </section>}
    </TabSet></section>}
    {preview && <PreviewPanel key={`${preview.kind}-${preview.name}`} context={{ tenant, workspace, database, schema }} target={preview} opener={preview.opener} close={() => setPreview(null)} />}
    {wizard && <Wizard close={() => setWizard(false)} opener={wizardOpener.current} />}
  </>
}
export default function ConsolePostgresPage() {
  const { t, i18n } = useCopy(), context = useConsoleContext()
  const Announcer = useHasLiveAnnouncer() ? Fragment : LiveAnnouncer
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId), workspace = context.workspaces.find((item) => item.workspaceId === context.activeWorkspaceId)
  const heading = useRef<HTMLHeadingElement>(null), previousTenant = useRef(context.activeTenantId)
  useEffect(() => { if (previousTenant.current !== context.activeTenantId) { previousTenant.current = context.activeTenantId; heading.current?.focus() } }, [context.activeTenantId])
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.loading': t('loading.databases'), 'common.copy': t('copy'), 'common.copied': t('copied'), 'common.copyFailed': t('copyFailed') }}><Announcer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="postgres-page" header={<PageHeader as="header" wrapTitle={true} titleRef={(node) => { heading.current = node; if (node) { node.id = 'pg-heading'; node.classList.add(...focusRing.split(' ')) } }} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={t(!context.activeTenantId ? 'noTenant' : !context.activeWorkspaceId ? 'noWorkspace' : 'description')} breadcrumbs={[]} status="postgres" statuses={{ postgres: { label: t('badge'), tone: 'neutral' } }} meta={[{ label: t('organization'), value: tenant?.displayName ?? t('noneTenant'), icon: undefined, mono: false }, { label: t('workspace'), value: workspace?.displayName ?? t('noneWorkspace'), icon: undefined, mono: false }]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('navigation') }} />}>
      <Surface key={context.activeTenantId ?? ''} />
    </Page><LocalizedToaster />
  </ToastProvider></Announcer></I18nProvider>
}
