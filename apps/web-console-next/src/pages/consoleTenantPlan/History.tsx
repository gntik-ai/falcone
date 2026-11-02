import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Collapsible, CollapsiblePanel, CollapsibleTrigger, EmptyState, Pagination, StatusTag, Text, Timestamp } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, ListSkeleton, StatusTimeline, type DataTableColumn } from '@gntik-ai/blocks'
import { HISTORY_PAGE_SIZE, type HistoryPage, type PlanCapabilityImpact, type PlanChangeHistoryEntry, type PlanQuotaImpact } from './api'
import { FailureSurface } from './Feedback'
import { direction as directionOf, directionTones, readable, usageStatus, usageTones } from './format'
import type { Remote } from './remote'

function ImpactTable<T>({ rows, columns, getRowId, getRowLabel, caption }: { rows: T[]; columns: DataTableColumn<T>[]; getRowId: (row: T) => string; getRowLabel: (row: T) => string; caption: string }) {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  return <DataTable rows={rows} columns={columns} getRowId={getRowId} getRowLabel={getRowLabel} caption={caption} showCaption={false}
    paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
    sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
    resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: caption, emptyTitle: t('history.noImpacts'), emptyDescription: '', loading: () => t('loadingHistory') }} />
}

function QuotaImpacts({ items }: { items: PlanQuotaImpact[] }) {
  const { t, i18n } = useTranslation('pages.console-tenant-plan-page')
  const value = (kind: string | undefined, amount: number | null | undefined) => kind === 'unlimited' ? t('summary.unlimited') : kind === 'missing' ? t('summary.dash') : String(amount ?? t('summary.dash'))
  const comparison = (key: string) => i18n.exists(`quotaComparison.${key}`, { ns: 'pages.console-tenant-plan-page' }) ? t(`quotaComparison.${key}`) : readable(key)
  const columns: DataTableColumn<PlanQuotaImpact>[] = [
    { id: 'dimension', header: t('summary.dimension'), sortable: false, accessor: (row) => row.displayLabel ?? row.dimensionKey },
    { id: 'previous', header: t('history.previous'), sortable: false, accessor: (row) => value(row.previousEffectiveValueKind, row.previousEffectiveValue) },
    { id: 'new', header: t('history.newEffective'), sortable: false, accessor: (row) => value(row.newEffectiveValueKind, row.newEffectiveValue) },
    { id: 'comparison', header: t('history.comparison'), sortable: false, accessor: (row) => comparison(row.comparison) },
    { id: 'usage', header: t('history.usage'), sortable: false, align: 'right', accessor: (row) => String(row.observedUsage ?? t('summary.dash')) },
    { id: 'state', header: t('summary.state'), sortable: false, cell: (row) => {
      const status = usageStatus(row.usageStatus)
      return <StatusTag status={status} label={t(`usage.${status}`)} statuses={{ [status]: { label: t(`usage.${status}`), tone: usageTones[status] } }} uppercase={false} />
    } },
  ]
  return <section className="min-w-0 space-y-2"><h4 className="text-sm font-semibold">{t('history.quotaImpact')}</h4>
    {items.length ? <ImpactTable rows={items} columns={columns} getRowId={(row) => row.dimensionKey} getRowLabel={(row) => row.displayLabel ?? row.dimensionKey} caption={t('history.quotaImpact')} />
      : <Text tone="muted">{t('history.noImpacts')}</Text>}
  </section>
}

function CapabilityImpacts({ items }: { items: PlanCapabilityImpact[] }) {
  const { t, i18n } = useTranslation('pages.console-tenant-plan-page')
  const state = (value: boolean | null | undefined) => value === null || value === undefined ? t('summary.dash') : t(value ? 'history.enabled' : 'history.disabled')
  const comparison = (key: string) => i18n.exists(`capabilityComparison.${key}`, { ns: 'pages.console-tenant-plan-page' }) ? t(`capabilityComparison.${key}`) : readable(key)
  const columns: DataTableColumn<PlanCapabilityImpact>[] = [
    { id: 'capability', header: t('history.capability'), sortable: false, accessor: (row) => row.displayLabel ?? row.capabilityKey },
    { id: 'previous', header: t('history.previous'), sortable: false, accessor: (row) => state(row.previousState) },
    { id: 'new', header: t('history.newEffective'), sortable: false, accessor: (row) => state(row.newState) },
    { id: 'comparison', header: t('history.comparison'), sortable: false, accessor: (row) => comparison(row.comparison) },
  ]
  return <section className="min-w-0 space-y-2"><h4 className="text-sm font-semibold">{t('history.capabilityImpact')}</h4>
    {items.length ? <ImpactTable rows={items} columns={columns} getRowId={(row) => row.capabilityKey} getRowLabel={(row) => row.displayLabel ?? row.capabilityKey} caption={t('history.capabilityImpact')} />
      : <Text tone="muted">{t('history.noImpacts')}</Text>}
  </section>
}

function Entry({ entry, locale, itemRef }: { entry: PlanChangeHistoryEntry; locale: string; itemRef?: (node: HTMLLIElement | null) => void }) {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  const [open, setOpen] = useState(false)
  const kind = directionOf(entry.changeDirection)
  const label = kind ? t(`direction.${kind}`) : readable(entry.changeDirection)
  const change = `${entry.previousPlanId ?? t('history.none')} → ${entry.newPlanId}`
  const collection = t(`collection.${entry.usageCollectionStatus}`, { defaultValue: readable(String(entry.usageCollectionStatus)) })
  const date = <Timestamp value={entry.effectiveAt} locale={locale} format="absolute" live={false} tooltip={false} fallback={entry.effectiveAt} dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} />
  const items = [
    { id: 'actor', label: t('history.actor'), value: entry.actorId, mono: false, copyable: false },
    { id: 'effective', label: t('history.effectiveFrom'), value: entry.effectiveAt, mono: false, copyable: false, render: date },
    { id: 'correlation', label: t('history.correlation'), value: entry.correlationId ?? t('summary.dash'), mono: true, copyable: false },
    { id: 'reason', label: t('history.reason'), value: entry.changeReason ?? t('summary.dash'), mono: false, copyable: false },
    { id: 'direction', label: t('history.direction'), value: label, mono: false, copyable: false },
    { id: 'collection', label: t('history.usageCollection'), value: collection, mono: false, copyable: false },
    { id: 'change', label: t('history.planChange'), value: change, mono: false, copyable: false },
    { id: 'overLimit', label: t('history.overLimitCount'), value: String(entry.overLimitDimensionCount), mono: false, copyable: false },
  ]
  return <li ref={itemRef} tabIndex={-1} className="min-w-0 space-y-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring" data-testid="plan-history-entry">
    <StatusTimeline events={[{ id: entry.historyEntryId, status: label, tone: kind ? directionTones[kind] : 'neutral', title: change, description: t('history.overLimit', { count: entry.overLimitDimensionCount }), at: entry.effectiveAt, actor: entry.actorId }]}
      label={t('history.entryLabel', { change })} emptyLabel={t('history.empty')} showFewerLabel={t('history.showFewer')} showEarlierLabel={(count) => t('history.showEarlier', { count })} actorLabel={t('history.actorPrefix')} maxVisible={undefined} timeFormat="absolute" className="min-w-0" />
    <Collapsible open={open} onOpenChange={setOpen} variant="subtle" className="min-w-0">
      <CollapsibleTrigger showChevron={true} aria-label={t(open ? 'history.hideDetailsFor' : 'history.showDetailsFor', { change })}>{t(open ? 'history.hideDetails' : 'history.showDetails')}</CollapsibleTrigger>
      <CollapsiblePanel className="min-w-0 space-y-4">
        {open && <>
          <DescriptionListCard title={t('history.impactSummary')} description="" items={items} wrap={true} columns={2} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h3" className="min-w-0"
            labels={{ title: t('history.impactSummary'), description: '', edit: '', copy: (name) => name, copied: (name) => name, copiedToClipboard: '' }} />
          <QuotaImpacts items={entry.quotaImpacts ?? []} />
          <CapabilityImpacts items={entry.capabilityImpacts ?? []} />
        </>}
      </CollapsiblePanel>
    </Collapsible>
  </li>
}

export function History({ remote, page, onPageChange, onBackToSummary, locale }: { remote: Remote<HistoryPage>; page: number; onPageChange: (page: number) => void; onBackToSummary: () => void; locale: string }) {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  const total = useRef(0)
  const first = useRef<HTMLLIElement | null>(null)
  const focusFirst = useRef(false)
  if (remote.data) total.current = remote.data.total
  useEffect(() => {
    if (remote.phase !== 'ready' || !focusFirst.current) return
    focusFirst.current = false
    first.current?.focus()
  }, [remote.phase, remote.data])
  const blocked = remote.failure?.status === 403 || remote.failure?.status === 404
  const pageCount = Math.ceil(total.current / HISTORY_PAGE_SIZE)
  const footer = pageCount > 1 && !blocked && <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
    <Text variant="supporting" tone="muted" aria-live="polite" aria-atomic={true}>{t('history.range', { from: (page - 1) * HISTORY_PAGE_SIZE + 1, to: Math.min(page * HISTORY_PAGE_SIZE, total.current), total: total.current })}</Text>
    <Pagination page={page} pageCount={pageCount} siblingCount={1} size="sm" labels={{ nav: t('history.pagination'), previous: t('history.previousPage'), next: t('history.nextPage'), page: (value) => t('history.page', { page: value }) }}
      onPageChange={(next) => { focusFirst.current = true; onPageChange(next) }} />
  </div>
  const loading = remote.phase === 'loading' || remote.failure?.status === 401
  return <section className="min-w-0 space-y-4" aria-labelledby="tenant-plan-history-heading" data-testid="tenant-plan-history">
    <h2 id="tenant-plan-history-heading" className="text-base font-semibold">{t('history.title')}</h2>
    {loading ? <section role="status" aria-label={t('loadingHistory')} aria-busy={true}><div aria-hidden={true}><ListSkeleton rows={4} label={t('loadingHistory')} className="min-w-0" /></div></section>
      : remote.phase === 'error' && remote.failure ? <FailureSurface scope="history" failure={remote.failure} retrying={remote.retrying} onRetry={remote.retry} titleAs="h3"
        notFoundAction={<Button type="button" variant="secondary" onClick={onBackToSummary}>{t('history.backToSummary')}</Button>} />
      : !remote.data?.items.length ? <EmptyState title={t('history.empty')} description={null} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} className="min-w-0" />
      : <ol className="min-w-0 space-y-6" aria-label={t('history.title')}>
        {remote.data.items.map((entry, index) => <Entry key={entry.historyEntryId} entry={entry} locale={locale} itemRef={index === 0 ? (node) => { first.current = node } : undefined} />)}
      </ol>}
    {footer}
  </section>
}
