import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ConsumptionBar } from './ConsumptionBar'
import { OverrideIndicatorBadge } from './OverrideIndicatorBadge'

type UsageStatus = 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'

export interface QuotaDimensionRow {
  dimensionKey: string
  displayLabel: string
  unit?: string | null
  effectiveValue: number
  source: 'override' | 'plan' | 'catalog_default'
  quotaType?: 'hard' | 'soft'
  currentUsage: number | null
  usageStatus: UsageStatus
  usageUnknownReason?: string | null
  overriddenFromValue?: number | null
  originalPlanValue?: number | null
}

const sourceLabels: Record<QuotaDimensionRow['source'], string> = {
  override: 'Override',
  plan: 'Plan',
  catalog_default: 'Catalog default'
}

const usageStatusMeta: Record<UsageStatus, { label: string; className: string }> = {
  within_limit: {
    label: 'Within limit',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  approaching_limit: {
    label: 'Approaching limit',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  },
  at_limit: {
    label: 'At limit',
    className: 'border-amber-600/40 bg-amber-600/10 text-amber-800 dark:text-amber-200'
  },
  over_limit: {
    label: 'Over limit',
    className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
  },
  unknown: {
    label: 'Unknown',
    className: 'border-border bg-secondary text-secondary-foreground'
  }
}

export function QuotaConsumptionTable({ rows, showOverrideDetails = false, title = 'Quota consumption' }: { rows: QuotaDimensionRow[]; showOverrideDetails?: boolean; title?: string }) {
  return (
    <div className="rounded-3xl border border-border bg-card/70 p-4 shadow-sm sm:p-5">
      <table className="w-full text-left text-sm" aria-label={title}>
        <caption className="mb-3 block text-left text-base font-semibold text-foreground">{title}</caption>
        <thead className="sr-only md:not-sr-only md:table-header-group">
          <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
            <th scope="col" className="px-3 py-2">Dimension</th>
            <th scope="col" className="px-3 py-2">Limit</th>
            <th scope="col" className="px-3 py-2">Source</th>
            <th scope="col" className="px-3 py-2">Consumption</th>
            <th scope="col" className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="block md:table-row-group">
          {rows.length === 0 ? (
            <tr className="block rounded-2xl border border-dashed border-border/70 bg-background/50 md:table-row md:rounded-none md:border-0 md:bg-transparent">
              <td className="block px-4 py-6 text-sm text-muted-foreground md:table-cell md:px-3" colSpan={5}>
                No quota dimensions were returned.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.dimensionKey} className="mb-3 block rounded-2xl border border-border/70 bg-background/50 p-3 align-top last:mb-0 md:mb-0 md:table-row md:rounded-none md:border-t md:border-border md:bg-transparent md:p-0">
              <td className="block min-w-0 px-0 py-2 md:table-cell md:px-3 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Dimension</span>
                <div className="break-words font-medium text-foreground">{row.displayLabel}</div>
                {showOverrideDetails && row.source === 'override' && row.originalPlanValue !== undefined && row.originalPlanValue !== null ? <div className="mt-2"><OverrideIndicatorBadge overriddenFromValue={row.originalPlanValue} overrideValue={row.effectiveValue} /></div> : null}
              </td>
              <td className="block min-w-0 px-0 py-2 md:table-cell md:px-3 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Limit</span>
                <span className="font-mono text-sm text-foreground">{row.effectiveValue === -1 ? 'Unlimited' : row.effectiveValue}</span>
              </td>
              <td className="block min-w-0 px-0 py-2 md:table-cell md:px-3 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Source</span>
                <div className="flex flex-wrap gap-2"><Badge variant="outline">{sourceLabels[row.source]}</Badge></div>
              </td>
              <td className="block min-w-0 px-0 py-2 md:table-cell md:min-w-[9rem] md:px-3 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Consumption</span>
                <ConsumptionBar current={row.currentUsage} limit={row.effectiveValue} label={`${row.displayLabel} consumption`} />
                {row.usageStatus === 'unknown' ? <div className="mt-1 text-xs text-muted-foreground">Data unavailable</div> : null}
              </td>
              <td className="block min-w-0 px-0 py-2 md:table-cell md:min-w-[10rem] md:px-3 md:py-3">
                <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">Status</span>
                <div className="flex flex-wrap gap-2"><UsageStatusBadge status={row.usageStatus} label={row.displayLabel} /></div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UsageStatusBadge({ status, label }: { status: UsageStatus; label: string }) {
  const meta = usageStatusMeta[status]
  return (
    <Badge className={cn('whitespace-nowrap border', meta.className)} aria-label={`${label} status: ${meta.label}`}>
      {meta.label}
    </Badge>
  )
}
