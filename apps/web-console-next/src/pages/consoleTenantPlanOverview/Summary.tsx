import { useTranslation } from 'react-i18next'
import { Badge, EmptyState, Meter, StatusTag, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, InlineCallout, type DataTableColumn } from '@gntik-ai/blocks'
import type { EffectiveEntitlements, EntitlementCapability, EntitlementLimit } from './api'
import { isPlanStatus, planTones, usageStatus, usageTones } from './format'

const ns = 'pages.console-tenant-plan-overview-page'
const noop = (value: string) => value

function ColumnLabel({ children }: { children: string }) {
  // Visible only when the table is stacked; the header row carries the name otherwise.
  return <Text as="span" className="mb-1 block text-sm text-muted-foreground md:hidden">{children}</Text>
}

function ConsumptionBar({ row }: { row: EntitlementLimit }) {
  const { t, i18n } = useTranslation(ns)
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value)
  const limit = row.effectiveValue ?? -1
  const used = row.currentUsage ?? null
  const name = row.displayLabel ?? row.dimensionKey
  // Legacy ConsumptionBar: unlimited shows the raw usage, unknown usage shows no data.
  if (limit === -1) return <Text as="span">{t('usageUnlimited', { used: used === null ? t('dash') : number(used) })}</Text>
  if (used === null) return <Text as="span" tone="muted">{t('noData')}</Text>
  const over = limit > 0 ? used >= limit : used > 0
  const label = t('usageOf', { used: number(used), limit: number(limit) })
  const valueText = t(used > limit ? 'usageValueOver' : 'usageValue', { used: number(used), limit: number(limit) })
  return <div className="min-w-0 space-y-1">
    <Meter value={limit > 0 ? Math.min(used, limit) : over ? 1 : 0} min={0} max={limit > 0 ? limit : 1} size="sm" label={null} aria-label={t('usageName', { dimension: name })}
      aria-valuetext={valueText} valueLabel={label} hideValue={false} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={over ? t('usage.over_limit') : null} />
  </div>
}

function Consumption({ row }: { row: EntitlementLimit }) {
  const { t } = useTranslation(ns)
  // Legacy shows the unavailable-data note for every unknown usageStatus, unlimited limits included;
  // a bounded limit without usage already shows it in place of the meter.
  const showNote = row.usageStatus === 'unknown' && !((row.effectiveValue ?? -1) !== -1 && (row.currentUsage ?? null) === null)
  return <div className="min-w-0 space-y-1">
    <ConsumptionBar row={row} />
    {showNote && <Text as="span" tone="muted" className="block">{t('noData')}</Text>}
  </div>
}

function Limits({ limits }: { limits: EntitlementLimit[] }) {
  const { t, i18n } = useTranslation(ns)
  const name = (row: EntitlementLimit) => row.displayLabel ?? row.dimensionKey
  const limitText = (row: EntitlementLimit) => (row.effectiveValue ?? -1) === -1 ? t('unlimited') : new Intl.NumberFormat(i18n.language).format(row.effectiveValue as number)
  const columns: DataTableColumn<EntitlementLimit>[] = [
    { id: 'dimension', header: t('dimension'), sortable: false, accessor: name, cell: (row) => <><ColumnLabel>{t('dimension')}</ColumnLabel><Text as="span" className="font-medium">{name(row)}</Text></> },
    { id: 'limit', header: t('limit'), sortable: false, accessor: limitText, cell: (row) => <><ColumnLabel>{t('limit')}</ColumnLabel><Text as="span">{limitText(row)}</Text></> },
    { id: 'origin', header: t('origin'), sortable: false, accessor: () => t('originPlan'), cell: () => <><ColumnLabel>{t('origin')}</ColumnLabel><Badge tone="neutral" variant="outline">{t('originPlan')}</Badge></> },
    { id: 'consumption', header: t('consumption'), sortable: false, cell: (row) => <><ColumnLabel>{t('consumption')}</ColumnLabel><Consumption row={row} /></> },
    { id: 'usageStatus', header: t('state'), sortable: false, cell: (row) => {
      const value = usageStatus(row.usageStatus)
      const label = t(`usage.${value}`)
      return <><ColumnLabel>{t('state')}</ColumnLabel>
        <StatusTag role="group" aria-label={t('usageStatusName', { dimension: name(row), status: label })} status={value} label={label} statuses={{ [value]: { label, tone: usageTones[value] } }} uppercase={false} /></>
    } },
  ]
  return <section className="min-w-0 space-y-3" aria-labelledby="my-plan-limits-heading">
    <h2 id="my-plan-limits-heading" className="text-base font-semibold">{t('limitsTitle')}</h2>
    {limits.length ? <div className="my-plan-limits min-w-0 max-w-full">
      <DataTable rows={limits} columns={columns} getRowId={(row) => row.dimensionKey} getRowLabel={name} caption={t('limitsTitle')} showCaption={false}
        paginated={false} paginationMode="client" selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null}
        sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]}
        resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} labels={{ scrollRegion: t('limitsTitle'), emptyTitle: t('noLimits'), emptyDescription: '', loading: () => t('loading') }} />
    </div> : <EmptyState title={t('noLimits')} description={t('noLimitsDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} className="min-w-0" />}
  </section>
}

function Capabilities({ capabilities }: { capabilities: EntitlementCapability[] }) {
  const { t } = useTranslation(ns)
  if (!capabilities.length) {
    return <section className="min-w-0 space-y-3" aria-labelledby="my-plan-capabilities-heading">
      <h2 id="my-plan-capabilities-heading" className="text-base font-semibold">{t('capabilitiesTitle')}</h2>
      <EmptyState title={t('noCapabilities')} description={null} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} className="min-w-0" />
    </section>
  }
  const items = capabilities.map((capability) => {
    const name = capability.displayLabel ?? capability.capabilityKey
    const state = capability.enabled ? 'enabled' : 'disabled'
    return { id: capability.capabilityKey, label: name, value: t(state), mono: false, copyable: false,
      render: <span className="flex flex-wrap items-center gap-2">
        <StatusTag role="group" aria-label={t(`capability.${state}`, { capability: name })} status={state} label={t(state)} statuses={{ [state]: { label: t(state), tone: capability.enabled ? 'success' : 'neutral' } }} uppercase={false} />
        <Badge tone="neutral" variant="outline">{t('originPlan')}</Badge>
      </span> }
  })
  return <DescriptionListCard title={t('capabilitiesTitle')} description="" items={items} wrap={true} columns={3} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="min-w-0"
    labels={{ title: t('capabilitiesTitle'), description: '', edit: '', copy: noop, copied: noop, copiedToClipboard: '' }} />
}

export function Summary({ data }: { data: EffectiveEntitlements }) {
  const { t } = useTranslation(ns)
  // An absent or empty collection renders its empty state instead of throwing.
  const limits = data.quantitativeLimits ?? []
  const overLimit = limits.filter((item) => item.usageStatus === 'over_limit').length
  const status = data.planStatus
  const statusLabel = status ? isPlanStatus(status) ? t(`status.${status}`) : status : ''
  const items = [
    { id: 'plan', label: t('currentPlan'), value: data.planSlug ?? t('noPlan'), mono: false, copyable: false,
      render: data.planSlug ? <Text as="span" className="text-lg font-semibold">{data.planSlug}</Text> : <Text as="span" tone="muted">{t('noPlan')}</Text> },
    ...(status ? [{ id: 'status', label: t('planStatus'), value: statusLabel, mono: false, copyable: false,
      render: <StatusTag status={status} label={statusLabel} statuses={{ [status]: { label: statusLabel, tone: isPlanStatus(status) ? planTones[status] : 'neutral' } }} uppercase={false} /> }] : []),
  ]
  const message = t('overLimit', { count: overLimit })
  return <div className="min-w-0 space-y-6" data-testid="my-plan-summary">
    <DescriptionListCard title={t('planCard')} description="" items={items} wrap={true} columns={2} onEdit={undefined} editLabel="" onCopy={undefined} titleAs="h2" className="min-w-0"
      labels={{ title: t('planCard'), description: '', edit: '', copy: noop, copied: noop, copiedToClipboard: '' }} />
    {overLimit > 0 && <InlineCallout tone="destructive" title={message} description="" actions={[]} icon={undefined} dismissible={false} open={undefined} onDismiss={undefined} className="min-w-0"
      labels={{ title: message, description: '', upgrade: '', viewUsage: '' }} />}
    <Limits limits={limits} />
    <Capabilities capabilities={data.capabilities ?? []} />
  </div>
}
