import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'
import { I18nProvider, Page, Input, Field, FieldLabel, SimpleSelect, Link, StatusTag, Timestamp, EmptyState, LiveAnnouncer, useAnnounce } from '@gntik-ai/ui'
import { PageHeader, PageToolbar, DataTable, PaginationFooter, NoResultsEmpty, NotFoundEmpty, NoAccessEmpty, TableSkeleton, ErrorPanel, type DataTableColumn } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import i18n from '../i18n'
import es from '../locales/es/pages.console-operations-page.json'
import en from '../locales/en/pages.console-operations-page.json'
import { normalizeFilters, operationTypes, useOperations, PAGE_SIZE, type OperationSummary } from './consoleOperations/query'
import { useReconnectStateSync } from './consoleOperations/reconnect'
import { OperationStatusBanner } from './consoleOperations/banner'
import type { ReconciliationDelta } from './consoleOperations/reconcile-operations.runtime.mjs'
import './consoleOperations/page.css'

i18n.addResourceBundle('es', 'pages.console-operations-page', es)
i18n.addResourceBundle('en', 'pages.console-operations-page', en)
export const statusTones = { pending: 'neutral', running: 'info', completed: 'success', failed: 'destructive', timed_out: 'warning', cancelled: 'neutral' } as const
export function OperationStatusBadge({ status }: { status: OperationSummary['status'] }) {
  const { t } = useTranslation('pages.console-operations-page')
  const label = t(`status.${status}`)
  return <StatusTag status={status} statuses={{ [status]: { label, tone: statusTones[status] } }} label={label} uppercase={false} />
}
function Operations() {
  const { t, i18n: language } = useTranslation('pages.console-operations-page')
  const { activeTenantId, activeWorkspaceId } = useConsoleContext()
  const announce = useAnnounce()
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [offset, setOffset] = useState(0)
  const [delta, setDelta] = useState<ReconciliationDelta | null>(null)
  const query = useOperations(normalizeFilters(status, type, workspace), offset)
  const { data, error, busy } = query
  const table = useRef<HTMLDivElement>(null)
  const pagination = useRef<HTMLDivElement>(null)
  const paging = useRef(false)
  const recovery = useRef(false)
  const focusCaption = () => table.current?.querySelector('caption')?.focus()
  const dismiss = useCallback(() => setDelta(null), [])
  const filterCount = [status, type.trim(), workspace.trim()].filter(Boolean).length
  useReconnectStateSync(activeTenantId, activeWorkspaceId, data?.items ?? [], (next) => {
    setDelta(next)
    if (next.updated.length || next.added.length || next.unavailable.length) void query.refetch()
  })
  useEffect(() => {
    const caption = table.current?.querySelector('caption')
    if (caption) caption.tabIndex = -1
    if (!busy && !error && recovery.current) { focusCaption(); recovery.current = false }
    if (!busy && paging.current) {
      const active = document.activeElement
      if (!active || active === document.body || !active.isConnected || active.hasAttribute('disabled')) pagination.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
      paging.current = false
    }
  }, [data, busy, error])
  useEffect(() => {
    if (error && error.status !== 401) announce(t('errorTitle'))
  }, [error, announce, t])
  const change = (setter: (value: string) => void, value: string) => { setOffset(0); setter(value) }
  const clear = () => { setOffset(0); setStatus(''); setType(''); setWorkspace('') }
  const paginationLabels = {
    rowsPerPage: t('rowsPerPage'), rowsPerPageLabel: t('rowsPerPage'), rangeSummary: (from: number, to: number, total: number) => t('range', { from, to, total }),
    paginationNav: () => t('pagination'), previous: t('previous'), next: t('next'), page: (page: number) => t('page', { page }),
  }
  const columns: DataTableColumn<OperationSummary>[] = [
    { id: 'type', header: t('type'), sortable: false, accessor: (row) => row.operationType, cell: (row) => <Link render={<RouterLink to={`/console/operations/${encodeURIComponent(row.operationId)}`} />} tone="primary" underline="always" external={false} externalLabel="">{row.operationType}</Link> },
    { id: 'status', header: t('statusLabel'), sortable: false, cell: (row) => <OperationStatusBadge status={row.status} /> },
    { id: 'actor', header: t('actor'), sortable: false, accessor: (row) => row.actorId },
    { id: 'workspace', header: t('workspace'), sortable: false, accessor: (row) => row.workspaceId ?? t('missing') },
    { id: 'created', header: t('created'), sortable: false, cell: (row) => <Timestamp value={row.createdAt} locale={language.language} format="absolute" live={false} tooltip={false} fallback={row.createdAt} dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} /> },
  ]
  if (error?.status === 401) return null // Shared session transport and shell own refresh and redirect.
  const back = <Link href="/console/overview" underline="always">{t('back')}</Link>
  const forbidden = error?.status === 403
  const notFound = error?.status === 404
  // Compose the resource-index kit pattern with the existing shell and server-owned data.
  return <Page width="wide" actions={null} actionBar={null} className="console-operations min-w-0 space-y-4 wrap-anywhere"
    header={<PageHeader as="div" title={<span className="block whitespace-normal wrap-anywhere">{t('title')}</span>} description={t('description')}
      breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
      labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />}>
    {activeTenantId && import.meta.env.VITE_CONSOLE_RECONNECT_SYNC_ENABLED !== 'false' && <OperationStatusBanner delta={delta} onDismiss={dismiss} onClose={() => { dismiss(); focusCaption() }} />}
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('filters')} searchPlaceholder={t('filters')} views={[]} view="" defaultView="" onViewChange={undefined}
      primaryAction={null} aria-label={t('filters')} className="console-operations-toolbar w-full min-w-0"
      filters={<div className="grid w-full min-w-0 gap-4 md:grid-cols-3">
        <Field><FieldLabel>{t('statusLabel')}</FieldLabel><SimpleSelect value={status} onValueChange={(value) => change(setStatus, value ?? '')} aria-label={t('filterStatus')} placeholder={t('all')}
          items={[{ value: '', label: t('all') }, ...Object.keys(statusTones).map((value) => ({ value, label: t(`status.${value}`) }))]} className="w-full min-w-0" /></Field>
        <Field><FieldLabel>{t('type')}</FieldLabel><SimpleSelect value={type} onValueChange={(value) => change(setType, value ?? '')} aria-label={t('filterType')} placeholder={t('all')}
          items={[{ value: '', label: t('all') }, ...operationTypes(data?.items ?? []).map((value) => ({ value, label: value }))]} className="w-full min-w-0" /></Field>
        <Field><FieldLabel>{t('workspace')}</FieldLabel><Input aria-label={t('filterWorkspace')} placeholder={t('workspacePlaceholder')} value={workspace} onChange={(event) => change(setWorkspace, event.target.value)} className="w-full min-w-0" /></Field>
      </div>} />
    {forbidden ? <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={{ href: '/console/overview', label: t('back') }} defaultRequested={false} titleAs="h2" bordered={false}
      labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
      : notFound ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={back} titleAs="h2" bordered={false} />
      : <>
        {error && <ErrorPanel title={t('errorTitle')} message={t('errorMessage')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={false}
          retryLabel={t('retry')} retrying={busy} onRetry={async () => { recovery.current = true; if (!await query.refetch()) recovery.current = false }}
          labels={{ title: t('errorTitle'), message: t('errorMessage'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />}
        {query.isLoading && !error && <div role="status" aria-label={t('loading')} aria-busy="true"><TableSkeleton rows={6} columns={5} label="" /></div>}
        {data && <>
          {error && <p role="status">{t('stale')}</p>}
          {data.items.length ? <div ref={table} className="min-w-0 max-w-full" aria-busy={busy} aria-label={error ? t('stale') : undefined}>
            <DataTable rows={data.items} columns={columns} getRowId={(row) => row.operationId} getRowLabel={(row) => row.operationType} caption={t('table')} showCaption={true}
              paginated={false} selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
              sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
              resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false}
              labels={{ ...paginationLabels, scrollRegion: t('table'), emptyTitle: t('empty'), emptyDescription: '', loading: () => t('loading') }} />
          </div> : !error && (filterCount ? <NoResultsEmpty query="" filterCount={filterCount} entity={t('title')} onClearFilters={clear} onClearSearch={undefined} titleAs="h2" bordered={false}
            labels={{ title: () => t('noResults'), queryTitle: () => t('noResults'), description: () => t('noResultsDescription'), clearFilters: t('clearFilters'), clearSearch: t('clearFilters') }} />
            : <EmptyState title={t('empty')} description={t('description')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} />)}
          <div ref={pagination} aria-disabled={busy} className="min-w-0"><PaginationFooter total={data.total} page={offset / PAGE_SIZE + 1} defaultPage={1} pageSize={PAGE_SIZE} defaultPageSize={PAGE_SIZE} pageSizeOptions={[PAGE_SIZE]}
            noun={t('title')} locale={language.language} onPageSizeChange={undefined} onPageChange={(page) => { if (!busy) { paging.current = true; setOffset((page - 1) * PAGE_SIZE) } }} labels={paginationLabels} /></div>
        </>}
      </>}
  </Page>
}
export default function ConsoleOperationsPage() {
  const { i18n: language } = useTranslation('pages.console-operations-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer><Operations /></LiveAnnouncer></I18nProvider>
}
