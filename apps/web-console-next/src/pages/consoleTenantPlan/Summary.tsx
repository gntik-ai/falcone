import { useTranslation } from 'react-i18next'
import { EmptyState, Meter, StatusTag, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, type DataTableColumn } from '@gntik-ai/blocks'
import type { EffectiveEntitlements, PlanStatus, QuantitativeLimit, TenantPlanAssignment } from './api'
import { usageStatus, usageTones } from './format'

const planTones = { draft: 'neutral', active: 'success', deprecated: 'warning', archived: 'neutral' } as const

function Consumption({ row }: { row: QuantitativeLimit }) {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  const limit = row.effectiveValue ?? -1
  const used = row.currentUsage ?? null
  const name = row.displayLabel ?? row.dimensionKey
  // Legacy ConsumptionBar: unlimited shows the raw usage, unknown usage shows no data.
  if (limit === -1) return <Text as="span">{t('summary.unlimitedUsage', { used: used ?? t('summary.dash') })}</Text>
  if (used === null) return <Text as="span" tone="muted">{t('summary.noData')}</Text>
  const label = t('summary.usageOf', { used, limit })
  const over = limit > 0 ? used >= limit : used > 0
  return <div className="min-w-0 space-y-1">
    <Meter value={limit > 0 ? Math.min(used, limit) : over ? 1 : 0} min={0} max={limit > 0 ? limit : 1} size="sm" label={null} aria-label={t('summary.usageName', { dimension: name })}
      aria-valuetext={label} valueLabel={label} hideValue={false} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={over ? t('usage.over_limit') : null} />
    {row.usageStatus === 'unknown' && <Text as="span" tone="muted">{t('summary.noData')}</Text>}
  </div>
}

export function Summary({ tenantId, assignment, entitlements }: { tenantId: string; assignment: TenantPlanAssignment; entitlements: EffectiveEntitlements }) {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  const name = assignment.plan?.displayName ?? null
  const status = assignment.plan?.status as PlanStatus | undefined
  const assigned = Boolean(assignment.assignment)
  const limits = entitlements.quantitativeLimits ?? []
  const statusLabel = status ? Object.hasOwn(planTones, status) ? t(`status.${status}`) : status : ''
  const items = [
    { id: 'plan', label: t('summary.currentPlan'), value: name ?? t('summary.noPlan'), mono: false, copyable: false },
    ...(status ? [{ id: 'status', label: t('summary.planStatus'), value: statusLabel, mono: false, copyable: false,
      render: <StatusTag status={status} label={statusLabel} statuses={{ [status]: { label: statusLabel, tone: planTones[status] ?? 'neutral' } }} uppercase={false} /> }] : []),
    { id: 'tenant', label: t('summary.tenant'), value: tenantId, mono: true, copyable: false },
  ]
  const columns: DataTableColumn<QuantitativeLimit>[] = [
    { id: 'dimension', header: t('summary.dimension'), sortable: false, accessor: (row) => row.displayLabel ?? row.dimensionKey },
    { id: 'limit', header: t('summary.limit'), sortable: false, accessor: (row) => (row.effectiveValue ?? -1) === -1 ? t('summary.unlimited') : String(row.effectiveValue) },
    { id: 'origin', header: t('summary.origin'), sortable: false, accessor: () => t('summary.originPlan') },
    { id: 'consumption', header: t('summary.consumption'), sortable: false, cell: (row) => <Consumption row={row} /> },
    { id: 'usageStatus', header: t('summary.state'), sortable: false, cell: (row) => {
      const value = usageStatus(row.usageStatus)
      return <StatusTag status={value} label={t(`usage.${value}`)} statuses={{ [value]: { label: t(`usage.${value}`), tone: usageTones[value] } }} uppercase={false} />
    } },
  ]
  return <div className="min-w-0 space-y-6" data-testid="tenant-plan-summary">
    <DescriptionListCard title={t('summary.planCard')} description="" items={items} wrap={true} columns={3} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="min-w-0"
      labels={{ title: t('summary.planCard'), description: '', edit: '', copy: (label) => label, copied: (label) => label, copiedToClipboard: '' }} />
    <section className="min-w-0 space-y-3" aria-labelledby="tenant-plan-entitlements-heading">
      <h2 id="tenant-plan-entitlements-heading" className="text-base font-semibold">{t('summary.entitlementsTitle')}</h2>
      {limits.length ? <div className="min-w-0 max-w-full">
        <DataTable rows={limits} columns={columns} getRowId={(row) => row.dimensionKey} getRowLabel={(row) => row.displayLabel ?? row.dimensionKey} caption={t('summary.entitlementsTitle')} showCaption={false}
          paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
          sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
          resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('summary.entitlementsTitle'), emptyTitle: t('summary.noLimits'), emptyDescription: '', loading: () => t('loadingPlan') }} />
      </div> : <EmptyState title={t('summary.noLimits')} description={t(assigned ? 'summary.noLimitsAssigned' : 'summary.noLimitsUnassigned')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} className="min-w-0" />}
    </section>
  </div>
}
