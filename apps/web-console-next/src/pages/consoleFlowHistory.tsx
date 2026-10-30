import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useParams } from 'react-router-dom'
import { EmptyState, Field, FieldLabel, I18nProvider, Input, Link, LiveAnnouncer, Page, SimpleSelect, StatusTag, Text, Toolbar, ToolbarButton, useAnnounce } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, InlineCallout, NoAccessEmpty, NoResultsEmpty, NotFoundEmpty, PageHeader, PageToolbar, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import i18n from '../i18n'
import es from '../locales/es/pages.console-flow-history-page.json'
import en from '../locales/en/pages.console-flow-history-page.json'
import { emptyFilters, listExecutions, type ExecutionFilters, type ExecutionPage, type ExecutionSummary } from './consoleFlowHistory/api'
import './consoleFlowHistory/page.css'

i18n.addResourceBundle('es', 'pages.console-flow-history-page', es)
i18n.addResourceBundle('en', 'pages.console-flow-history-page', en)
const statusTones = { Running: 'info', Completed: 'success', Failed: 'destructive', Canceled: 'neutral', Terminated: 'neutral', TimedOut: 'warning' } as const
const filterStatuses = Object.keys(statusTones)
const runStatusTones = { ...statusTones, Cancelled: 'neutral', unknown: 'neutral' } as const
const triggers = ['manual', 'cron', 'webhook', 'platform_event'] as const
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId' | 'message'>

function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    requestId: error.requestId ?? error.correlationId ?? '',
    // Only the access-denied state displays backend copy. Network/unknown errors stay localized.
    message: error.status === 403 && typeof error.message === 'string' ? error.message : undefined,
  }
}

function History({ workspaceId, flowId }: { workspaceId: string; flowId: string }) {
  const { t } = useTranslation('pages.console-flow-history-page')
  const location = useLocation()
  const announce = useAnnounce()
  const [query, setQuery] = useState({ filters: emptyFilters, tokens: [] as string[], attempt: 0 })
  const key = JSON.stringify(query)
  const token = query.tokens.at(-1)
  const [result, setResult] = useState<{ key: string; data: ExecutionPage | null; error: Failure | null }>({ key: '', data: null, error: null })
  const request = useRef<{ key: string; promise: Promise<ExecutionPage> } | null>(null)
  const version = useRef<HTMLInputElement>(null)
  const busy = result.key !== key
  const data = result.data
  const error = busy ? null : result.error
  const rows = data?.items ?? []
  const count = Object.values(query.filters).filter(Boolean).length
  const trigger = (location.state as { flowTrigger?: { flowId: string; scheduleId: string } } | null)?.flowTrigger
  const retry = () => setQuery((current) => ({ ...current, attempt: current.attempt + 1 }))
  useEffect(() => {
    let active = true
    // StrictMode effect replay shares the same request; new filters/tokens always get a new one.
    if (request.current?.key !== key) request.current = { key, promise: listExecutions(workspaceId, flowId, query.filters, token) }
    void request.current.promise.then((response) => {
      if (active) setResult({ key, data: { items: response.items ?? [], nextPageToken: response.nextPageToken ?? null }, error: null })
    }).catch((cause: unknown) => {
      if (active) setResult({ key, data: null, error: failureFrom(cause) })
    })
    return () => { active = false }
  }, [workspaceId, flowId, key])
  useEffect(() => { if (error) announce(t('errorTitle')) }, [error, announce, t])
  const change = (name: keyof ExecutionFilters, value: string) => setQuery((current) => ({ filters: { ...current.filters, [name]: value }, tokens: [], attempt: 0 }))
  const clear = () => { setQuery({ filters: emptyFilters, tokens: [], attempt: 0 }); version.current?.focus() }
  const link = (href: string, label: string) => <Link href={href} tone="primary" underline="always" external={false} externalLabel="" className={focus}>{label}</Link>
  const hidden = 'hidden sm:table-cell'
  const columns: DataTableColumn<ExecutionSummary>[] = [
    { id: 'execution', header: t('execution'), sortable: false, variant: 'mono', cell: (item) => <span className="block max-w-32 truncate sm:max-w-none" title={item.executionId}>{t('executionId', { id: item.executionId.slice(0, 32) })}</span> },
    { id: 'status', header: t('statusLabel'), sortable: false, className: hidden, headClassName: hidden, cell: (item) => {
      const status = item.status?.trim() || 'unknown'
      const known = Object.hasOwn(runStatusTones, status)
      const label = known ? t(`status.${status}`) : status || t('missing')
      return <StatusTag status={status} label={label} statuses={{ [status]: { label, tone: known ? runStatusTones[status as keyof typeof runStatusTones] : 'neutral' } }} uppercase={false} />
    } },
    { id: 'trigger', header: t('triggerLabel'), sortable: false, className: hidden, headClassName: hidden, accessor: (item) => triggers.includes(item.triggerType as typeof triggers[number]) ? t(`trigger.${item.triggerType}`) : item.triggerType ?? t('missing') },
    { id: 'version', header: t('version'), sortable: false, className: hidden, headClassName: hidden, accessor: (item) => item.version ?? t('missing') },
    { id: 'started', header: t('started'), sortable: false, className: hidden, headClassName: hidden, accessor: (item) => item.startedAt ?? t('missing') },
    { id: 'actions', header: t('actions'), sortable: false, align: 'right', cell: (item) => <Link href={`/console/flows/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(item.executionId)}`} tone="primary" underline="always" external={false} externalLabel="" aria-label={t('openExecution', { id: item.executionId })} className={focus}>{t('open')}</Link> },
  ]
  const errorPanel = (failure: Failure) => <ErrorPanel title={t('errorTitle')} message={t('errorDescription')} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={false}
    retryLabel={t('retry')} retrying={busy} onRetry={retry} className="min-w-0"
    labels={{ title: t('errorTitle'), message: t('errorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-flow-history min-w-0 space-y-4 wrap-anywhere" data-testid="console-flow-history-page"
    header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={flowId} breadcrumbs={[{ label: t('flows'), href: '/console/flows' }]} status="" statuses={{}} meta={[]} tabs={null} actions={[]}
      labels={{ title: t('title'), description: flowId, moreActions: t('actions'), sections: t('actions') }} />}>
    {trigger?.flowId === flowId && <section role="status" data-testid="flow-trigger-success">
      <InlineCallout tone="success" title={t('triggerTitle')} description={t('triggerDescription', { scheduleId: trigger.scheduleId })}
        actions={[{ id: 'refresh', label: t('refresh'), variant: 'secondary', disabled: busy, onClick: retry }]}
        labels={{ title: t('triggerTitle'), description: t('triggerDescription', { scheduleId: trigger.scheduleId }), upgrade: '', viewUsage: '' }}
        icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" />
    </section>}
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('filters')} searchPlaceholder={t('filters')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('filters')} className="console-flow-history-toolbar min-w-0"
      filters={<div className="grid w-full min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field invalid={false}><FieldLabel htmlFor="flow-version">{t('version')}</FieldLabel><Input ref={version} id="flow-version" value={query.filters.flowVersion} onChange={(event) => change('flowVersion', event.target.value)} placeholder={t('anyVersion')} type="text" className="w-full min-w-0" /></Field>
        <Field invalid={false}><FieldLabel htmlFor="flow-status">{t('statusLabel')}</FieldLabel><SimpleSelect id="flow-status" value={query.filters.status} defaultValue="" onValueChange={(value) => change('status', value ?? '')} placeholder={t('anyStatus')} clearable={false} size="md" className="w-full min-w-0"
          items={[{ value: '', label: t('anyStatus') }, ...filterStatuses.map((value) => ({ value, label: t(`status.${value}`) }))]} /></Field>
        <Field invalid={false}><FieldLabel htmlFor="flow-trigger">{t('triggerLabel')}</FieldLabel><SimpleSelect id="flow-trigger" value={query.filters.triggerType} defaultValue="" onValueChange={(value) => change('triggerType', value ?? '')} placeholder={t('anyTrigger')} clearable={false} size="md" className="w-full min-w-0"
          items={[{ value: '', label: t('anyTrigger') }, ...triggers.map((value) => ({ value, label: t(`trigger.${value}`) }))]} /></Field>
        {(['startedAfter', 'startedBefore'] as const).map((name) => <Field key={name} invalid={false} className="min-w-0"><FieldLabel htmlFor={`flow-${name}`}>{t(name)}</FieldLabel><Input id={`flow-${name}`} type="datetime-local" value={query.filters[name]} onChange={(event) => change(name, event.target.value)} className="w-full min-w-0" /></Field>)}
      </div>} />
    {error?.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0"
      labels={{ title: () => t('noAccess'), description: () => error.message || t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : error?.status === 404 ? <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} action={link('/console/flows', t('back'))} titleAs="h2" bordered={false} className="min-w-0" />
      : error ? errorPanel(error)
      : busy && !data ? <div role="status" aria-label={t('loading')} aria-busy={true}><Text variant="body" tone="muted">{t('loadingDescription')}</Text><TableSkeleton rows={6} columns={6} label={t('loading')} className="min-w-0" /></div>
      : rows.length ? <div aria-busy={busy} className="min-w-0 max-w-full">
        <DataTable rows={rows} columns={columns} getRowId={(item) => item.executionId} getRowLabel={(item) => item.executionId} caption={t('caption')} showCaption={true}
          paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
          sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
          resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false}
          labels={{ scrollRegion: t('caption'), emptyTitle: t('empty'), emptyDescription: t('emptyDescription'), loading: () => t('loading') }} />
      </div>
      : count ? <NoResultsEmpty query="" filterCount={count} entity={t('title')} onClearFilters={clear} onClearSearch={undefined} titleAs="h2" bordered={false} className="min-w-0"
        labels={{ title: () => t('noResults'), queryTitle: () => t('noResults'), description: () => t('noResultsDescription'), clearFilters: t('clear'), clearSearch: t('clear') }} />
        : <EmptyState icon={undefined} title={t('empty')} description={t('emptyDescription')} primaryAction={link(`/console/flows/${encodeURIComponent(flowId)}`, t('designer'))} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />}
    <Toolbar variant="plain" aria-label={t('paging')} className="flex min-w-0 flex-wrap justify-between gap-2">
      <ToolbarButton variant="secondary" size="sm" icon={undefined} disabled={busy || query.tokens.length === 0} className={focus}
        onClick={() => { if (!busy && query.tokens.length) setQuery((current) => ({ ...current, tokens: current.tokens.slice(0, -1) })) }}>{t('previous')}</ToolbarButton>
      <Text variant="supporting" tone="muted" aria-live="polite" aria-atomic={true}>{busy ? t('loadingCount') : t('count', { count: rows.length })}</Text>
      <ToolbarButton variant="secondary" size="sm" icon={undefined} disabled={busy || !data?.nextPageToken} className={focus}
        onClick={() => { if (!busy && data?.nextPageToken) setQuery((current) => ({ ...current, tokens: [...current.tokens, data.nextPageToken!] })) }}>{t('next')}</ToolbarButton>
    </Toolbar>
  </Page>
}

function WorkspaceGate() {
  const { t } = useTranslation('pages.console-flow-history-page')
  const context = useConsoleContext()
  const { can } = usePermissions()
  const [workspace, setWorkspace] = useState('')
  const [retriedError, setRetriedError] = useState<typeof context.error>(null)
  // The shell bootstrap retry also reloads workspaces. A fresh failure has a new error identity;
  // the shell can retain the previous workspace error after a successful reload.
  if (context.loading) return <section role="status" aria-label={t('workspaceLoading')}><Text variant="body" tone="default">{t('workspaceLoading')}</Text><TableSkeleton rows={2} columns={1} label={t('workspaceLoadingDescription')} className="min-w-0" /></section>
  if (context.error && context.error !== retriedError) return <ErrorPanel title={t('workspaceError')} message={t('workspaceErrorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} onRetry={async () => { setRetriedError(context.error); await context.reloadTenants?.() }} className="min-w-0"
    labels={{ title: t('workspaceError'), message: t('workspaceErrorDescription'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
  return <EmptyState icon={undefined} title={t('blocked')} description={t('workspaceDescription')} titleAs="h2" bordered={false} secondaryAction={null} className="min-w-0" primaryAction={context.workspaces.length ?
    <Field invalid={false} className="w-full min-w-0"><FieldLabel htmlFor="flow-workspace">{t('workspaceLabel')}</FieldLabel><SimpleSelect id="flow-workspace" value={workspace} defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" className="w-full min-w-0"
      items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) { setWorkspace(value); context.selectWorkspace(value) } }} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('createWorkspace')}</Link>
      : <Text variant="body" tone="muted">{t('workspaceDenied')}</Text>} />
}

export default function ConsoleFlowHistoryPage() {
  const { t, i18n: language } = useTranslation('pages.console-flow-history-page')
  const { flowId } = useParams()
  const { activeWorkspaceId } = useConsoleContext()
  return <I18nProvider locale={language.language}><LiveAnnouncer>
    {!flowId ? <EmptyState icon={undefined} title={t('blocked')} description={t('missingFlow')} primaryAction={<Link href="/console/flows" tone="primary" underline="always" external={false} externalLabel="" className={focus}>{t('back')}</Link>} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />
      : !activeWorkspaceId ? <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="min-w-0 space-y-4 wrap-anywhere"
        header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={flowId} breadcrumbs={[{ label: t('flows'), href: '/console/flows' }]} status="" statuses={{}} meta={[]} tabs={null} actions={[]}
          labels={{ title: t('title'), description: flowId, moreActions: t('actions'), sections: t('actions') }} />}><WorkspaceGate /></Page> : <History key={`${activeWorkspaceId}:${flowId}`} workspaceId={activeWorkspaceId} flowId={flowId} />}
  </LiveAnnouncer></I18nProvider>
}
