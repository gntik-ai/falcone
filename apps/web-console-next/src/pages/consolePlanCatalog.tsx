import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, Field, FieldLabel, I18nProvider, Link, LiveAnnouncer, Page, Pagination, SimpleSelect, StatusTag, Text, Timestamp, useAnnounce } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, FirstRunEmpty, NoAccessEmpty, NotFoundEmpty, PageHeader, PageToolbar, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../shell/context'
import i18n from '../i18n'
import es from '../locales/es/pages.console-plan-catalog-page.json'
import en from '../locales/en/pages.console-plan-catalog-page.json'
import { listPlans, type PlanPage, type PlanQuery, type PlanRecord } from './consolePlanCatalog/api'
import './consolePlanCatalog/page.css'

i18n.addResourceBundle('es', 'pages.console-plan-catalog-page', es)
i18n.addResourceBundle('en', 'pages.console-plan-catalog-page', en)
const tones = { draft: 'neutral', active: 'success', deprecated: 'warning', archived: 'neutral' } as const
const statuses = ['all', 'draft', 'active', 'deprecated', 'archived'] as const
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>

function PlanCatalog() {
  const { t, i18n: language } = useTranslation('pages.console-plan-catalog-page')
  const navigate = useNavigate()
  const announce = useAnnounce()
  const { loading: bootstrap } = useConsoleContext()
  const [query, setQuery] = useState<PlanQuery>({ status: 'all', page: 1, pageSize: 20 })
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([query, attempt])
  const [result, setResult] = useState<{ key: string; data: PlanPage | null; error: Failure | null }>({ key: '', data: null, error: null })
  const previousTotal = useRef(0)
  const filter = useRef<HTMLButtonElement>(null)
  const table = useRef<HTMLDivElement>(null)
  const footer = useRef<HTMLDivElement>(null)
  const recovery = useRef(false)
  const paging = useRef(false)
  const loading = bootstrap || result.key !== key
  const data = !loading ? result.data : null
  const error = !loading ? result.error : null
  const total = data?.total ?? previousTotal.current

  useEffect(() => {
    if (bootstrap) return
    let cancelled = false
    void listPlans(query).then((response) => {
      if (cancelled) return
      previousTotal.current = response.total
      setResult({ key, data: response, error: null })
    }).catch((cause: unknown) => {
      if (cancelled) return
      const failure = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
      setResult({ key, data: null, error: {
        status: typeof failure.status === 'number' ? failure.status : undefined,
        requestId: typeof failure.requestId === 'string' ? failure.requestId : typeof failure.correlationId === 'string' ? failure.correlationId : '',
      } })
    })
    return () => { cancelled = true }
  }, [key, bootstrap])

  useEffect(() => {
    const caption = table.current?.querySelector('caption')
    if (caption) caption.tabIndex = -1
    if (loading) return
    if (data && recovery.current) { caption?.focus(); recovery.current = false; announce(t('loaded', { count: data.total })) }
    if (error) { recovery.current = false; if (error.status !== 401) announce(t('errorTitle')) }
    if (paging.current) {
      const active = document.activeElement
      if (!active || active === document.body || !active.isConnected || active.hasAttribute('disabled')) footer.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
      paging.current = false
    }
  }, [data, error, loading, announce, t])

  const clear = () => { setQuery((current) => ({ ...current, status: 'all', page: 1 })); filter.current?.focus() }
  const create = () => navigate('/console/plans/new')
  const planLink = (plan: PlanRecord, action = false) => <Link render={<RouterLink to={`/console/plans/${plan.id}`} />}
    tone="primary" underline="always" external={false} externalLabel="" aria-label={action ? t('openPlan', { name: plan.displayName }) : undefined}>{action ? t('open') : plan.slug}</Link>
  const columns: DataTableColumn<PlanRecord>[] = [
    { id: 'slug', header: t('slug'), sortable: false, cell: (plan) => planLink(plan) },
    { id: 'name', header: t('name'), sortable: false, accessor: (plan) => plan.displayName },
    { id: 'status', header: t('statusLabel'), sortable: false, cell: (plan) => <StatusTag status={plan.status} label={t(`status.${plan.status}`)} statuses={{ [plan.status]: { label: t(`status.${plan.status}`), tone: tones[plan.status] } }} uppercase={false} /> },
    { id: 'assigned', header: t('assigned'), align: 'right', sortable: false, accessor: (plan) => plan.assignedTenantCount ?? 0 },
    { id: 'updated', header: t('updated'), sortable: false, cell: (plan) => plan.updatedAt ? <Timestamp value={plan.updatedAt} locale={language.language} format="absolute" live={false} tooltip={false} fallback={t('missing')} dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} /> : t('missing') },
    { id: 'action', header: t('action'), align: 'right', sortable: false, cell: (plan) => planLink(plan, true) },
  ]
  if (error?.status === 401) return null // The shared session transport and shell own refresh and redirect.

  // Compose resource-index slots explicitly: all rows come from the server, with no kit samples.
  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')}
    className="console-plan-catalog min-w-0 space-y-4 wrap-anywhere"
    header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={null} status="" statuses={{}} meta={[]} tabs={null}
      actions={[{ id: 'create', label: t('create'), variant: 'primary', disabled: false, onClick: create }]}
      labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />}>
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('filter')} searchPlaceholder={t('filter')}
      views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('filter')} className="console-plan-catalog-toolbar min-w-0"
      filters={<div className="flex min-w-0 flex-wrap items-end gap-4">
        <Field invalid={false} className="min-w-0"><FieldLabel htmlFor="plan-status-filter">{t('filter')}</FieldLabel>
          <SimpleSelect ref={filter} id="plan-status-filter" value={query.status} defaultValue="all" aria-label={t('filter')} placeholder={t('status.all')}
            items={statuses.map((value) => ({ value, label: t(`status.${value}`) }))} clearable={false} size="md" className="w-full min-w-0 sm:w-48"
            onValueChange={(value) => { if (value) setQuery((current) => ({ ...current, status: value, page: 1 })) }} />
        </Field>
        <Text variant="supporting" tone="muted" aria-live="polite" aria-atomic={true}>{loading ? t('loading') : error ? '' : t('count', { count: data?.total ?? 0 })}</Text>
      </div>} />
    {loading ? <div role="status" aria-label={t('loading')} aria-busy={true}><div aria-hidden={true}><TableSkeleton rows={6} columns={6} label={t('loading')} className="min-w-0" /></div></div>
      : error?.status === 403 ? <NoAccessEmpty resource={t('title')} owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
        labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
        : error?.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} titleAs="h2" bordered={false}
          action={<Link render={<RouterLink to="/console/overview" />} underline="always" external={false} externalLabel="">{t('overview')}</Link>} />
          : error ? <ErrorPanel title={t('errorTitle')} message={t('errorMessage')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={false}
            onRetry={() => { recovery.current = true; setAttempt((value) => value + 1) }} retrying={false} retryLabel={t('retry')}
            labels={{ title: t('errorTitle'), message: t('errorMessage'), support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
            : data?.items.length ? <div ref={table} className="min-w-0 max-w-full">
              <DataTable rows={data.items} columns={columns} getRowId={(plan) => plan.id} getRowLabel={(plan) => plan.displayName} caption={t('caption')} showCaption={true}
                paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
                sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
                resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('caption'), emptyTitle: t('empty'), emptyDescription: '', loading: () => t('loading') }} />
            </div> : query.status === 'all' ? <FirstRunEmpty title={t('empty')} description={t('emptyDescription')} steps={[]} actionLabel={t('create')} onAction={create} secondary={null} titleAs="h2" bordered={false}
              labels={{ title: t('empty'), description: t('emptyDescription'), action: t('create'), guide: '' }} />
              : <EmptyState title={t('noResults', { status: t(`status.${query.status}`) })} description={t('noResultsDescription')} titleAs="h2" bordered={false}
                primaryAction={null} secondaryAction={null}>
                <div className="flex w-full flex-col gap-2 sm:flex-row"><Button type="button" variant="secondary" onClick={clear}>{t('clear')}</Button><Button type="button" variant="primary" onClick={create}>{t('create')}</Button></div>
              </EmptyState>}
    {!error && total > 0 && <div ref={footer} className="flex min-w-0 flex-wrap items-center justify-between gap-4">
      <Text variant="supporting" tone="muted">{t('range', { from: (query.page - 1) * query.pageSize + 1, to: Math.min(query.page * query.pageSize, total), total, pages: Math.ceil(total / query.pageSize) })}</Text>
      <Field invalid={false}><FieldLabel htmlFor="plans-page-size">{t('rowsPerPage')}</FieldLabel><SimpleSelect id="plans-page-size" value={String(query.pageSize)} defaultValue="20" aria-label={t('rowsPerPage')} placeholder={t('rowsPerPage')}
        items={[20, 50, 100].map((size) => ({ value: String(size), label: String(size) }))} clearable={false} size="md"
        onValueChange={(value) => { if (value) setQuery((current) => ({ ...current, pageSize: Number(value), page: 1 })) }} /></Field>
      <Pagination page={query.page} pageCount={Math.ceil(total / query.pageSize)} siblingCount={1} size="sm" labels={{ nav: t('pagination'), previous: t('previous'), next: t('next'), page: (page) => t('page', { page }) }}
        onPageChange={(page) => { paging.current = true; setQuery((current) => ({ ...current, page })) }} />
    </div>}
  </Page>
}
export default function ConsolePlanCatalogPage() {
  const { i18n: language } = useTranslation('pages.console-plan-catalog-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer><PlanCatalog /></LiveAnnouncer></I18nProvider>
}
