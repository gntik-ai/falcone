import { useTranslation } from 'react-i18next'
import { Badge, EmptyState, Meter, StatusTag, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, InlineCallout, type DataTableColumn } from '@gntik-ai/blocks'
import type { EffectiveEntitlements, QuantitativeLimit } from './api'

const usageTones = { within_limit: 'success', approaching_limit: 'warning', at_limit: 'warning', over_limit: 'destructive', unknown: 'neutral' } as const
const planTones = { draft: 'neutral', active: 'success', deprecated: 'warning', archived: 'neutral' } as const

function Consumption({ row }: { row: QuantitativeLimit }) {
  const { t } = useTranslation('pages.console-tenant-plan-overview-page')
  const limit = row.effectiveValue ?? -1
  const used = row.currentUsage ?? null
  const name = row.displayLabel ?? row.dimensionKey
  if (limit === -1) return <div><Text as="span" aria-label={t('usageName', { dimension: name })}>{t('unlimitedUsage', { used: used ?? t('dash') })}</Text>
    {row.usageStatus === 'unknown' && <Text as="span" tone="muted" className="block">{t('noData')}</Text>}</div>
  if (used === null) return <Text as="span" tone="muted" aria-label={t('usageName', { dimension: name })}>{t('noData')}</Text>
  const breached = limit > 0 && used >= limit
  const label = t(limit > 0 ? 'usageOf' : 'zeroUsage', { used, limit }) + (limit > 0 && used > limit ? t('overUsage') : '')
  return <div className="min-w-0 space-y-2">
    <Text as="span">{t('usageRatio', { used, limit })}</Text>
    <Meter value={limit > 0 ? Math.min(used, limit) : used > 0 ? 100 : 0} min={0} max={limit > 0 ? limit : 100} size="sm"
      label={null} aria-label={t('usageName', { dimension: name })} aria-valuetext={label} valueLabel={null} hideValue={true}
      thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={null} />
    {breached && <Badge tone="destructive" variant="soft" size="auto" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className="max-w-full whitespace-normal">{t('usage.over_limit')}</Badge>}
    {row.usageStatus === 'unknown' && <Text as="span" tone="muted">{t('noData')}</Text>}
  </div>
}

export function Summary({ data }: { data: EffectiveEntitlements }) {
  const { t } = useTranslation('pages.console-tenant-plan-overview-page')
  const limits = data.quantitativeLimits ?? []
  const count = limits.filter((row) => row.usageStatus === 'over_limit').length
  const status = data.planStatus
  const labels = (title: string) => ({ title, description: '', edit: '', copy: (label: string) => label, copied: (label: string) => label, copiedToClipboard: '' })
  const mobile = (key: string) => <Text as="span" className="mb-1 block text-sm text-muted-foreground md:hidden">{t(key)}</Text>
  const columns: DataTableColumn<QuantitativeLimit>[] = [
    { id: 'dimension', header: t('dimension'), sortable: false, cell: (row) => <>{mobile('dimension')}<Text as="span">{row.displayLabel ?? row.dimensionKey}</Text></> },
    { id: 'limit', header: t('limit'), sortable: false, cell: (row) => <>{mobile('limit')}<Text as="span">{(row.effectiveValue ?? -1) === -1 ? t('unlimited') : String(row.effectiveValue)}</Text></> },
    { id: 'origin', header: t('origin'), sortable: false, cell: () => <>{mobile('origin')}<Text as="span">{t('originPlan')}</Text></> },
    { id: 'consumption', header: t('consumption'), sortable: false, cell: (row) => <>{mobile('consumption')}<Consumption row={row} /></> },
    { id: 'status', header: t('state'), sortable: false, cell: (row) => {
      const value = Object.hasOwn(usageTones, row.usageStatus) ? row.usageStatus : 'unknown'
      return <>{mobile('state')}<StatusTag status={value} label={t(`usage.${value}`)}
        aria-label={t('statusName', { dimension: row.displayLabel ?? row.dimensionKey, status: t(`usage.${value}`) })}
        statuses={{ [value]: { label: t(`usage.${value}`), tone: usageTones[value] } }} uppercase={false} className="max-w-full whitespace-normal text-left" /></>
    } },
  ]
  return <div className="min-w-0 space-y-6">
    <DescriptionListCard title={t('planCard')} description="" wrap={true} columns={1} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="min-w-0"
      labels={labels(t('planCard'))} items={[
        { id: 'plan', label: t('currentPlan'), value: data.planSlug ?? t('noPlan'), mono: false, copyable: false,
          render: <Text as="span" tone={data.planSlug ? 'default' : 'muted'}>{data.planSlug ?? t('noPlan')}</Text> },
        ...(status ? [{ id: 'status', label: t('planStatus'), value: t(`planStatuses.${status}`), mono: false, copyable: false,
          render: <StatusTag status={status} label={t(`planStatuses.${status}`)} statuses={{ [status]: { label: t(`planStatuses.${status}`), tone: planTones[status] } }} uppercase={false} className="max-w-full whitespace-normal text-left" /> }] : []),
      ]} />
    {count > 0 && <InlineCallout tone="destructive" title={t('overLimit', { count })} description="" actions={[]} icon={null}
      dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title: t('overLimit', { count }), description: '', upgrade: '', viewUsage: '' }} />}
    <section className="my-plan-limits min-w-0 space-y-3" aria-labelledby="my-plan-limits-heading">
      <h2 id="my-plan-limits-heading" className="text-base font-semibold">{t('tableTitle')}</h2>
      {limits.length ? <DataTable rows={limits} columns={columns} getRowId={(row) => row.dimensionKey} getRowLabel={(row) => row.displayLabel ?? row.dimensionKey}
        caption={t('tableTitle')} showCaption={false} paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false}
        rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null}
        showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false}
        virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('tableTitle'), emptyTitle: t('noLimits'), emptyDescription: t('noLimitsDescription'), loading: () => t('loading') }} />
        : <EmptyState title={t('noLimits')} description={t('noLimitsDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={false} size="md" children={null} />}
    </section>
    <DescriptionListCard title={t('capabilities')} description={data.capabilities.length ? '' : t('noCapabilities')} wrap={true} columns={3}
      onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="my-plan-capabilities min-w-0" labels={labels(t('capabilities'))}
      items={data.capabilities.map((item) => ({ id: item.capabilityKey, label: item.displayLabel ?? item.capabilityKey, value: t(item.enabled ? 'enabled' : 'disabled'), mono: false, copyable: false,
        render: <div className="flex flex-wrap gap-2"><StatusTag status={item.enabled ? 'enabled' : 'disabled'} label={t(item.enabled ? 'enabled' : 'disabled')}
          aria-label={t('capabilityName', { capability: item.displayLabel ?? item.capabilityKey, state: t(item.enabled ? 'enabledName' : 'disabledName') })}
          statuses={{ enabled: { label: t('enabled'), tone: 'success' }, disabled: { label: t('disabled'), tone: 'neutral' } }} uppercase={false} className="max-w-full whitespace-normal text-left" />
          <Badge tone="neutral" variant="outline" size="auto" shape="rounded" dot={false} onRemove={undefined} removeLabel="" className="max-w-full whitespace-normal">{t('originPlan')}</Badge></div> }))} />
  </div>
}
