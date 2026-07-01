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
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
  },
  approaching_limit: {
    label: 'Approaching limit',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700'
  },
  at_limit: {
    label: 'At limit',
    className: 'border-amber-600/40 bg-amber-600/10 text-amber-800'
  },
  over_limit: {
    label: 'Over limit',
    className: 'border-red-500/40 bg-red-500/10 text-red-700'
  },
  unknown: {
    label: 'Unknown',
    className: 'border-border bg-secondary text-secondary-foreground'
  }
}

export function QuotaConsumptionTable({ rows, showOverrideDetails = false, title = 'Quota consumption' }: { rows: QuotaDimensionRow[]; showOverrideDetails?: boolean; title?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
      <table className="w-full min-w-[44rem] text-left text-sm" aria-label={title}>
        <caption className="mb-2 text-left font-semibold">{title}</caption>
        <thead>
          <tr className="border-b border-border text-xs font-medium uppercase text-muted-foreground">
            <th scope="col" className="px-3 py-2">Dimension</th>
            <th scope="col" className="px-3 py-2">Limit</th>
            <th scope="col" className="px-3 py-2">Source</th>
            <th scope="col" className="px-3 py-2">Consumption</th>
            <th scope="col" className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-sm text-muted-foreground" colSpan={5}>
                No quota dimensions were returned.
              </td>
            </tr>
          ) : null}
          {rows.map((row) => (
            <tr key={row.dimensionKey} className="border-t border-border align-top">
              <td className="px-3 py-3">
                <div className="font-medium">{row.displayLabel}</div>
                {showOverrideDetails && row.source === 'override' && row.originalPlanValue !== undefined && row.originalPlanValue !== null ? <div className="mt-2"><OverrideIndicatorBadge overriddenFromValue={row.originalPlanValue} overrideValue={row.effectiveValue} /></div> : null}
              </td>
              <td className="px-3 py-3">{row.effectiveValue === -1 ? 'Unlimited' : row.effectiveValue}</td>
              <td className="px-3 py-3"><Badge variant="outline">{sourceLabels[row.source]}</Badge></td>
              <td className="px-3 py-3">
                <ConsumptionBar current={row.currentUsage} limit={row.effectiveValue} label={`${row.displayLabel} consumption`} />
                {row.usageStatus === 'unknown' ? <div className="mt-1 text-xs text-muted-foreground">Data unavailable</div> : null}
              </td>
              <td className="px-3 py-3">
                <UsageStatusBadge status={row.usageStatus} label={row.displayLabel} />
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
    <Badge className={cn('border', meta.className)} aria-label={`${label} status: ${meta.label}`}>
      {meta.label}
    </Badge>
  )
}
