import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Badge, Button, EmptyState, Field, FieldDescription, FieldLabel, Link, Meter, SimpleSelect, SimpleTooltip, StatusTag, Text, Timestamp, useAnnounce } from '@gntik-ai/ui'
import { ChartCard, PageToolbar, TableSkeleton } from '@gntik-ai/blocks'
import { metricWindows, type MetricWindow, type Scope } from './api'
import { FailureState } from './Failure'
import type { useMetrics } from './hooks'
import { formatDimensionValue, type Dimension, type MetricsView } from './model'

type Row = Record<string, string | number>
const stat = (values: number[], pick: (values: number[]) => number) => values.length ? pick(values) : 0

function Series({ view, window, loading }: { view: MetricsView | null; window: MetricWindow; loading: boolean }) {
  const { t, i18n } = useTranslation('pages.console-observability-page')
  const locale = i18n.language
  const numbers = new Intl.NumberFormat(locale)
  const label = t('series.label')
  // The chart's screen-reader table takes its column headers from these keys, so both are localized.
  const period = t('series.period')
  const points = view?.seriesPoints ?? []
  const windowText = t(`series.window${window}`)
  const time = new Intl.DateTimeFormat(locale, window === '24h' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' })
  // The legend shows the category key, so the localized label is the data key.
  const rows: Row[] = points.map((point) => {
    const date = new Date(point.timestamp)
    return { [period]: Number.isNaN(date.getTime()) ? point.timestamp : time.format(date), [label]: point.value }
  })
  const values = points.map((point) => point.value)
  const summary = points.length ? t('series.summary', { latest: numbers.format(values[values.length - 1]), min: numbers.format(stat(values, (list) => Math.min(...list))), max: numbers.format(stat(values, (list) => Math.max(...list))), window: windowText }) : null
  // One window select owns the range: the card's own toggle is hidden and its only option is the selected window.
  return <ChartCard<Row> title={t('series.title')} description={t('series.description')} titleAs="h2" kind="area" stacked={false} height={240}
    ranges={[{ value: window, label: windowText }]} dataByRange={{ [window]: rows }} range={window} defaultRange={window} onRangeChange={undefined} showRangeToggle={false}
    index={period} categories={[label]} colors={['primary']} showLegend={true} valueFormatter={(value) => numbers.format(value)}
    state={loading ? 'loading' : rows.length ? 'ready' : 'empty'} emptyMessage={t('series.empty')} errorMessage={undefined} onRetry={undefined} dataTable={true}
    action={undefined} footer={summary ? <span>{summary}</span> : undefined} className="min-w-0" />
}

function DimensionRow({ dimension }: { dimension: Dimension }) {
  const { t } = useTranslation('pages.console-observability-page')
  const format = (value: number) => formatDimensionValue(value, dimension)
  const percent = dimension.pctUsed
  return <li className="min-w-0 space-y-3 py-4" data-dimension={dimension.dimensionId}>
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium text-foreground">{dimension.displayName}</h3>
        {dimension.policyMode === 'not_enforced' && <Badge tone="neutral" variant="outline">{t('metrics.notEnforced')}</Badge>}
        <Text variant="caption" tone="muted" className="block break-all font-mono">{dimension.dimensionId}</Text>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm">
        {percent !== null ? <>
          <span className={`tabular-nums ${dimension.isExceeded ? 'font-semibold text-destructive-text' : dimension.isWarning ? 'font-medium text-warning-text' : 'text-muted-foreground'}`}>{t('metrics.percentUsed', { percent })}</span>
          {dimension.isExceeded && <Badge tone="destructive" variant="soft"><AlertTriangle aria-hidden={true} className="size-3" />{t('metrics.exceeded')}</Badge>}
        </> : <span className="text-muted-foreground">{t('metrics.unlimited')}</span>}
      </div>
    </div>
    <Meter value={Math.min(percent ?? 0, 100)} min={0} max={100} size="md" label={null}
      valueLabel={dimension.hardLimit === null ? t('metrics.usageNoLimit', { used: format(dimension.measuredValue) }) : t('metrics.usage', { used: format(dimension.measuredValue), limit: format(dimension.hardLimit) })} hideValue={false}
      aria-label={t('metrics.meterLabel', { dimension: dimension.displayName })} aria-valuetext={percent === null ? t('metrics.unlimited') : t('metrics.percentUsed', { percent })}
      thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={null} />
    {dimension.isExceeded && <Link render={<RouterLink to="/console/quotas" />} tone="primary" underline="always" external={false} externalLabel="">{t('metrics.quotasLink')}</Link>}
  </li>
}

export function MetricsPanel({ scope, window, onWindow, metrics }: { scope: Scope; window: MetricWindow; onWindow: (window: MetricWindow) => void; metrics: ReturnType<typeof useMetrics> }) {
  const { t, i18n } = useTranslation('pages.console-observability-page')
  const announce = useAnnounce()
  const { data, retry } = metrics
  const [search, setSearch] = useState('')
  const workspaceScope = Boolean(scope.workspaceId)
  const view = data?.status === 'ready' ? data.view : null
  // A scope change starts a new search; filtering is local and never sends a request.
  useEffect(() => { setSearch('') }, [scope.tenantId, scope.workspaceId])
  useEffect(() => { if (view) announce(t('metrics.loaded', { count: view.dimensions.length })) }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = view?.dimensions.filter((row) => `${row.displayName} ${row.dimensionId}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? []
  const items = workspaceScope ? metricWindows.map((value) => ({ value, label: t(`metrics.window${value}`) })) : [{ value: '24h', label: t('metrics.windowNone') }]
  const select = <SimpleSelect value={workspaceScope ? window : '24h'} onValueChange={(value) => { if (workspaceScope && metricWindows.includes(value as MetricWindow)) onWindow(value as MetricWindow) }}
    items={items} aria-label={t('metrics.windowLabel')} disabled={!workspaceScope} clearable={false} size="md" placeholder={t('metrics.windowLabel')} className="w-full min-w-0" />
  return <section aria-label={t('metrics.section')} className="min-w-0 space-y-4">
    <PageToolbar search={search} defaultSearch="" onSearchChange={setSearch} searchLabel={t('metrics.searchLabel')} searchPlaceholder={t('metrics.searchPlaceholder')}
      views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('metrics.windowGroup')} className="min-w-0 [&>div:first-child]:flex-wrap"
      filters={<div className="w-full min-w-0 sm:max-w-xs">
        <Field><div className="flex flex-wrap items-center gap-2"><FieldLabel>{t('metrics.windowLabel')}</FieldLabel>{!workspaceScope && <StatusTag status="notApplicable" label={t('metrics.windowNotApplicable')} statuses={{ notApplicable: { label: t('metrics.windowNotApplicable'), tone: 'neutral' } }} uppercase={false} />}</div>
          {workspaceScope ? select : <SimpleTooltip content={t('metrics.windowReason')} side="top" align="start" kbd="" variant="solid" arrow={true} delay={300} disabled={false} className="max-w-xs">
            <span tabIndex={0} className="block min-w-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">{select}</span>
          </SimpleTooltip>}
          {!workspaceScope && <FieldDescription className="sr-only">{t('metrics.windowReason')}</FieldDescription>}
        </Field>
      </div>} />
    {!data || data.status === 'loading' ? <section role="status" aria-busy={true} aria-label={t('metrics.loading')} className="space-y-4">
        <Text>{t('metrics.loadingDescription')}</Text>
        <div aria-hidden={true} className="space-y-4"><Series view={null} window={window} loading={true} /><TableSkeleton rows={3} columns={2} label={t('metrics.loading')} className="min-w-0" /></div>
      </section>
      : data.status === 'error' ? <FailureState area="metrics" failure={data.failure} onRetry={retry} />
      : <>
        <Series view={view} window={workspaceScope ? window : '24h'} loading={false} />
        <section aria-labelledby="observability-dimensions" className="min-w-0 space-y-2">
          <h2 id="observability-dimensions" className="text-base font-semibold">{t('metrics.dimensions')}</h2>
          <Text variant="body" tone="muted" className="block"><span className="font-medium">{t('metrics.lastUpdated')}</span>{' '}<Timestamp value={view!.generatedAt} locale={i18n.language} format="absolute" dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} live={false} tooltip={false} fallback={t('metrics.unavailable')} /></Text>
          {!view!.dimensions.length ? <EmptyState title={t('metrics.empty')} description={t('metrics.emptyDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false} />
            : !rows.length ? <EmptyState title={t('metrics.noResults')} description={t('metrics.noResultsDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false}>
              <Button type="button" variant="secondary" onClick={() => setSearch('')}>{t('metrics.clearSearch')}</Button>
            </EmptyState>
            : <ul className="min-w-0 divide-y divide-border" aria-label={t('metrics.dimensionCount', { count: rows.length })}>{rows.map((row) => <DimensionRow key={row.dimensionId} dimension={row} />)}</ul>}
        </section>
      </>}
  </section>
}
