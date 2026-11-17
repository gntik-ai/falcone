import { Meter, Skeleton } from '@gntik-ai/ui'
import { DataTable, KpiRow, PageToolbar, type DataTableColumn } from '@gntik-ai/blocks'
import type { FunctionAction, FunctionInventory } from './api'
import { describeFailure, formatValue, useCopy } from './copy'
import { Empty, FailurePanel, FunctionStatus, Loading, NoAccess } from './States'
import type { Fn } from './useFunctions'

export const INVENTORY_TITLE_ID = 'functions-inventory-title'

function Summary({ data }: { data: FunctionInventory }) {
  const { t } = useCopy()
  const counts = data.counts
  const quota = data.quotaStatus
  const limit = quota?.limit
  // value = used, or limit minus remaining when used is absent (legacy :974, spec "quota meter").
  const used = typeof quota?.used === 'number' ? quota.used : typeof limit === 'number' && typeof quota?.remaining === 'number' ? limit - quota.remaining : undefined
  const remaining = typeof quota?.remaining === 'number' ? quota.remaining : typeof limit === 'number' && typeof used === 'number' ? limit - used : undefined
  return <div className="min-w-0 space-y-4">
    {counts && <KpiRow label={t('kpi.label')} variant="cards" showTrends={false} className="min-w-0" containerClassName="min-w-0"
      items={[
        { id: 'actions', label: t('kpi.actions'), value: formatValue(t, counts.actions), delta: undefined, trend: undefined, trendTone: undefined },
        { id: 'packages', label: t('kpi.packages'), value: formatValue(t, counts.packages), delta: undefined, trend: undefined, trendTone: undefined },
        { id: 'triggers', label: t('kpi.triggers'), value: formatValue(t, counts.triggers), delta: undefined, trend: undefined, trendTone: undefined },
        { id: 'httpExposures', label: t('kpi.httpExposures'), value: formatValue(t, counts.httpExposures), delta: undefined, trend: undefined, trendTone: undefined },
      ]} />}
    {typeof limit === 'number' && typeof used === 'number' && <div data-testid="functions-quota" className="min-w-0">
      <Meter value={used} min={0} max={limit} size="md" label={t('quota.label')} valueLabel={t('quota.value', { remaining: remaining ?? 0, limit })} hideValue={false} thresholds={undefined} higherIsBetter={false} note={undefined} className="min-w-0" />
    </div>}
  </div>
}

function SummarySkeleton() {
  return <div aria-hidden={true} className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((index) => <Skeleton key={index} shape="block" className="h-16 w-full" />)}</div>
}

export function Inventory({ s }: { s: Fn }) {
  const { t } = useCopy()
  const { inventory } = s
  const rows = inventory.data?.actions ?? []
  const columns: DataTableColumn<FunctionAction>[] = [
    { id: 'name', header: t('inventory.name'), sortable: false, hideable: false, className: 'font-medium text-foreground', cell: (row) => <span className="block max-w-48 break-words whitespace-normal">{row.actionName}</span> },
    { id: 'status', header: t('inventory.status'), sortable: false, cell: (row) => <FunctionStatus value={row.provisioning?.state ?? row.status} /> },
    { id: 'runtime', header: t('inventory.runtime'), sortable: false, variant: 'mono', cell: (row) => row.execution?.runtime ?? t('fields.none') },
    { id: 'version', header: t('inventory.version'), sortable: false, variant: 'mono', cell: (row) => <span className="block max-w-32 break-all whitespace-normal">{row.activeVersionId ?? t('fields.none')}</span> },
  ]
  let body
  if (inventory.phase === 'idle' || (inventory.phase === 'loading' && !inventory.retrying)) body = <Loading label={t('inventory.loading')} rows={4} columns={4} />
  else if (inventory.failure) {
    body = inventory.failure.status === 403
      ? <NoAccess title={t('noAccess.inventory')} message={describeFailure(t, inventory.failure, 'inventory')} />
      : <FailurePanel section="inventory" failure={inventory.failure} retry={s.retryInventory} retrying={inventory.phase === 'loading'} />
  } else if (inventory.phase === 'loading') body = <Loading label={t('inventory.loading')} rows={4} columns={4} />
  else if (rows.length === 0) body = <Empty title={t('inventory.empty')} testId="functions-inventory-empty" />
  else {
    body = <DataTable rows={rows} columns={columns} getRowId={(row) => row.resourceId} getRowLabel={(row) => row.actionName} caption={t('inventory.caption')} showCaption={false} paginated={false}
      selectionMode="single" selectionName="functions-function" aria-label={t('inventory.caption')} selectedId={s.selectedId} onSelectedIdChange={s.select} isRowDisabled={() => false}
      rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false}
      views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0"
      labels={{ scrollRegion: t('inventory.caption'), selection: t('inventory.selection'), selectRow: (label: string) => label, emptyTitle: t('inventory.empty'), emptyDescription: t('inventory.empty'), loading: () => t('inventory.loading') }} />
  }
  return <section aria-labelledby={INVENTORY_TITLE_ID} aria-busy={inventory.phase === 'loading'} className="min-w-0 space-y-4" data-testid="functions-inventory">
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('inventory.title')} searchPlaceholder={t('inventory.title')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null}
      aria-label={t('inventory.title')} className="functions-toolbar min-w-0"
      filters={<h2 id={INVENTORY_TITLE_ID} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">{t('inventory.title')}</h2>} />
    {inventory.data ? <Summary data={inventory.data} /> : inventory.phase === 'loading' && !inventory.failure ? <SummarySkeleton /> : null}
    {body}
  </section>
}
