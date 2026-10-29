import { useEffect, useId, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Card, Grid, I18nProvider, Link, Meter, Page, StatusTag, Text, Timestamp } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, ErrorPanel, ListSkeleton, NoAccessEmpty, NoResultsEmpty, NotFoundEmpty, PageHeader, PageSkeleton, SectionHeader, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import { getWorkspaceConsumption, type WorkspaceConsumptionResponse } from '@in-falcone/console-api/clients'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../i18n'
import es from '../locales/es/pages.console-workspace-dashboard-page.json'
import en from '../locales/en/pages.console-workspace-dashboard-page.json'

i18n.addResourceBundle('es', 'pages.console-workspace-dashboard-page', es)
i18n.addResourceBundle('en', 'pages.console-workspace-dashboard-page', en)

type Dimension = WorkspaceConsumptionResponse['dimensions'][number]
type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>

export default function ConsoleWorkspaceDashboard() {
  const { workspaceId = '' } = useParams()
  // A route change synchronously removes the old data and its pending retry/focus state.
  return <WorkspaceDashboard key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceDashboard({ workspaceId }: { workspaceId: string }) {
  const { t, i18n: language } = useTranslation('pages.console-workspace-dashboard-page')
  const [data, setData] = useState<WorkspaceConsumptionResponse | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const inFlight = useRef(false)
  const retryRequested = useRef(false)
  const capabilitiesId = useId()
  useEffect(() => {
    let active = true
    inFlight.current = true
    setLoading(true)
    setData(null)
    void getWorkspaceConsumption(workspaceId).then((next) => {
      if (!active) return
      setData(next)
      setFailure(null)
    }).catch((cause: unknown) => {
      if (!active) return
      const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
      setFailure({ status: typeof error.status === 'number' ? error.status : undefined,
        requestId: typeof error.requestId === 'string' ? error.requestId : undefined })
    }).finally(() => {
      if (active) { inFlight.current = false; setLoading(false) }
    })
    return () => { active = false }
  }, [workspaceId, attempt])
  useEffect(() => {
    if (loading || !retryRequested.current) return
    if (failure && ![401, 403, 404].includes(failure.status ?? 0)) retry.current?.focus()
    else heading.current?.focus()
    retryRequested.current = false
  }, [loading, failure])
  const back = <Link href="/console/my-plan" underline="always">{t('myPlan')}</Link>
  const retryable = failure && ![401, 403, 404].includes(failure.status ?? 0)
  const message = t(failure?.status ? 'errorDescription' : 'networkDescription')
  const empty = (kind: 'dimensionsEmpty' | 'capabilitiesEmpty') => <NoResultsEmpty query="" filterCount={0} entity={t(kind)}
    onClearFilters={undefined} onClearSearch={undefined} titleAs="h3" bordered={false} className="min-w-0"
    labels={{ title: () => t(kind), queryTitle: () => t(kind), description: () => '', clearFilters: '', clearSearch: '' }} />
  // Home-dashboard's Page/Header composition, using only the approved header and body regions.
  // Its full template always renders KPI, chart and activity regions with fixture defaults.
  return <I18nProvider locale={language.language === 'en' ? 'en' : 'es'}><Page width="wide" title={null} description={null} actions={null}
    actionBar={null} actionBarLabel={t('actions')} className="workspace-dashboard min-w-0 wrap-anywhere"
    header={<PageHeader as="div" title={t('title')} description={t('description')} titleRef={heading} wrapTitle={true}
      breadcrumbs={null} status="workspace" statuses={{ workspace: { label: t('workspace'), tone: 'neutral' } }}
      meta={[]} actions={[]} tabs={null} tab={undefined} defaultTab={undefined} onTabChange={undefined} className="min-w-0"
      labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('capabilities') }} />}>
    {failure?.status === 403 ? <>
      <NoAccessEmpty resource={t('workspace')} owner="" onRequestAccess={undefined} showRequestAccess={false}
        action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0"
        labels={{ title: () => t('noAccess'), description: () => t('noAccessDescription', { workspaceId }), request: '', requested: '', sent: '' }} />
      {back}
    </> : failure?.status === 404 ? <NotFoundEmpty title={t('unavailable')} description={t('unavailableDescription', { workspaceId })}
      action={back} titleAs="h2" bordered={false} className="min-w-0" />
      : retryable ? <div className="space-y-4" data-testid="workspace-error">
        <ErrorPanel title={t('errorTitle')} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''}
          details="" onRetry={undefined} retrying={loading} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true} className="min-w-0"
          labels={{ title: t('errorTitle'), message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'),
            requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: '' }} />
        <div className="flex flex-wrap items-center gap-4">{back}
          <Button ref={retry} type="button" variant="secondary" aria-disabled={loading} aria-busy={loading}
            onClick={() => { if (inFlight.current) return; inFlight.current = true; retryRequested.current = true; setAttempt((value) => value + 1) }}>{t(loading ? 'retrying' : 'retry')}</Button>
        </div>
      </div> : loading || failure?.status === 401 ? <section role="status" aria-label={t('loading')} aria-busy={true} className="min-w-0 space-y-4">
        <Text>{t('loadingDescription', { workspaceId })}</Text>
        <div aria-hidden={true} className="min-w-0 space-y-4">
          <PageSkeleton stats={0} rows={0} label={t('loading')} className="min-w-0" />
          <ListSkeleton rows={3} label={t('loading')} className="min-w-0" />
          <TableSkeleton rows={4} columns={5} label={t('loading')} className="min-w-0" />
          <ListSkeleton rows={2} label={t('loading')} className="min-w-0" />
        </div>
      </section> : data && <div className="min-w-0 space-y-6">
        <DescriptionListCard title={t('workspace')} description="" wrap={true} columns={3} titleAs="h2"
          onEdit={undefined} editLabel="" onCopy={undefined} className="min-w-0"
          labels={{ title: t('workspace'), description: '', edit: '', copy: (label) => t('copyLabel', { label }), copied: (label) => t('copiedLabel', { label }), copiedToClipboard: t('copied') }}
          items={[
            { id: 'workspace', label: t('workspace'), value: data.workspaceId, render: undefined, status: undefined, mono: true, copyable: true, copyValue: data.workspaceId },
            { id: 'tenant', label: t('tenant'), value: data.tenantId, render: undefined, status: undefined, mono: true, copyable: true, copyValue: data.tenantId },
            { id: 'snapshot', label: t('snapshot'), value: data.snapshotAt, status: undefined, mono: false, copyable: false, copyValue: data.snapshotAt,
              render: <Timestamp value={data.snapshotAt} format="absolute" locale={language.language} live={false} tooltip={false}
                dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} fallback={data.snapshotAt} tone="default" /> },
          ]} />
        <section aria-label={t('tableTitle')} className="min-w-0">
          {data.dimensions.length ? <QuotaTable rows={data.dimensions} /> : <>
            <SectionHeader title={t('tableTitle')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId={undefined} className="min-w-0" />
            {empty('dimensionsEmpty')}
          </>}
        </section>
        {data.capabilities !== undefined && <section aria-labelledby={capabilitiesId} className="min-w-0 space-y-4">
          <SectionHeader title={t('capabilities')} description={null} count={undefined} actions={[]} as="h2" bordered={false} headingId={capabilitiesId} className="min-w-0" />
          {data.capabilities.length === 0 ? <div role="status">{empty('capabilitiesEmpty')}</div> : <Grid as="ul" cols={{ base: 1, md: 2, xl: 3 }} gap={3} align="stretch" flow="row">
            {data.capabilities.map((item) => {
              const label = item.displayLabel ?? item.capabilityKey
              return <li key={item.capabilityKey} className="min-w-0"><Card className="h-full min-w-0 space-y-2 p-4">
                <Text as="p" className="font-medium">{label}</Text><div className="flex flex-wrap gap-2">
                  <StatusTag status={item.enabled ? 'enabled' : 'disabled'} uppercase={false} label={t(item.enabled ? 'enabled' : 'disabled')}
                    statuses={{ enabled: { label: t('enabled'), tone: 'success' }, disabled: { label: t('disabled'), tone: 'neutral' } }}
                    aria-label={t(item.enabled ? 'capabilityEnabledName' : 'capabilityDisabledName', { label })} />
                  <Badge tone="neutral" variant="outline">{t(item.source === 'plan' ? 'plan' : 'platformDefault')}</Badge>
                </div>
              </Card></li>
            })}
          </Grid>}
        </section>}
      </div>}
  </Page></I18nProvider>
}

function QuotaTable({ rows }: { rows: Dimension[] }) {
  const { t } = useTranslation('pages.console-workspace-dashboard-page')
  const tones = { within_limit: 'success', approaching_limit: 'warning', at_limit: 'warning', over_limit: 'destructive', unknown: 'neutral' } as const
  const columns: DataTableColumn<Dimension>[] = [
    { id: 'dimension', header: t('dimension'), cell: (row: Dimension) => <Text as="span" className="font-medium">{row.displayLabel}</Text> },
    { id: 'limit', header: t('limit'), cell: (row: Dimension) => <Text as="span">{(row.workspaceLimit ?? row.tenantEffectiveValue) === -1 ? t('unlimited') : row.workspaceLimit ?? row.tenantEffectiveValue}</Text> },
    { id: 'source', header: t('source'), cell: (row: Dimension) => <Badge tone="neutral" variant="outline">{t(row.workspaceSource === 'workspace_sub_quota' ? 'override' : 'plan')}</Badge> },
    { id: 'consumption', header: t('consumption'), cell: (row: Dimension) => <Consumption row={row} /> },
    { id: 'status', header: t('status'), cell: (row: Dimension) => <StatusTag status={row.usageStatus} label={t(row.usageStatus)} uppercase={false}
      statuses={{ [row.usageStatus]: { label: t(row.usageStatus), tone: tones[row.usageStatus] } }}
      aria-label={t('statusName', { label: row.displayLabel, status: t(row.usageStatus) })} /> },
  ].map((column) => ({ ...column, sortable: false, hideable: false, defaultHidden: false, resizable: false, pinnable: false, editable: false,
    align: 'left', className: 'whitespace-normal wrap-anywhere', headClassName: 'whitespace-normal' }))
  return <DataTable rows={rows} columns={columns} getRowId={(row) => row.dimensionKey} getRowLabel={(row) => row.displayLabel}
    caption={t('tableTitle')} showCaption={true} paginated={false} paginationMode="client" selectable={false} selectionMode="none"
    selectedIds={[]} defaultSelectedIds={[]} onSelectionChange={undefined} preserveSelection={false} selectAllMatching={false} hideSelectAll={true}
    bulkActions={undefined} selectionSummary={false} rowActions={undefined} sort={null} defaultSort={null} onSortChange={undefined} manualSorting={false}
    density="comfortable" defaultDensity="comfortable" onDensityChange={undefined} showDensityToggle={false} showColumnMenu={false}
    loading={false} loadingRows={0} emptyState={null} groupBy={undefined} groupLabel={undefined} collapsibleGroups={false}
    hiddenColumns={[]} onHiddenColumnsChange={undefined} resizable={false} columnWidths={{}} defaultColumnWidths={{}} onColumnWidthsChange={undefined}
    pinnedColumns={{}} defaultPinnedColumns={{}} onPinnedColumnsChange={undefined} showPinMenu={false} virtualize={false} onCellEdit={undefined}
    views={[]} defaultViews={[]} onViewsChange={undefined} activeViewId={null} defaultActiveViewId={null} onActiveViewChange={undefined} showViewSwitcher={false}
    filters={null} onFiltersChange={undefined} toolbar={null} className="min-w-0 max-w-full"
    labels={{ scrollRegion: t('tableTitle'), loading: () => t('loading'), emptyTitle: t('dimensionsEmpty'), emptyDescription: '' }} />
}

function Consumption({ row }: { row: Dimension }) {
  const { t } = useTranslation('pages.console-workspace-dashboard-page')
  const limit = row.workspaceLimit ?? row.tenantEffectiveValue
  const current = row.currentUsage
  const label = t('meterName', { label: row.displayLabel })
  if (limit === -1) return <div><Text aria-label={label}>{t('usageUnlimited', { current: current ?? t('dash'), limit: t('unlimited') })}</Text>
    {(current === null || row.usageStatus === 'unknown') && <Text tone="muted">{t('unavailableData')}</Text>}</div>
  if (current === null) return <Text aria-label={label} tone="muted">{t('unavailableData')}</Text>
  const breach = current >= limit
  const value = t('usageValue', { current, limit })
  return <div className="space-y-2">
    <Text>{value}</Text>
    <Meter value={limit <= 0 ? 100 : Math.min(current, limit)} min={0} max={limit <= 0 ? 100 : limit} size="sm"
      label={null} aria-label={label} aria-valuetext={t(limit <= 0 ? 'zeroLimitUsage' : 'usageValue', { current, limit })}
      valueLabel={null} hideValue={true} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={null} />
    {breach && <Badge tone="destructive" variant="soft">{t('over_limit')}</Badge>}
    {row.usageStatus === 'unknown' && <Text tone="muted">{t('unavailableData')}</Text>}
  </div>
}
