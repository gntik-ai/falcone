import { useState } from 'react'
import type { PlanChangeHistoryEntry } from '@/services/planManagementApi'
import { PlanImpactSummaryCard } from './PlanImpactSummaryCard'
import { PlanQuotaImpactTable } from './PlanQuotaImpactTable'
import { PlanCapabilityImpactTable } from './PlanCapabilityImpactTable'

export function PlanImpactHistoryTable({ items, loading, error }: { items: PlanChangeHistoryEntry[]; loading?: boolean; error?: string | null }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (loading) return <div className="rounded-2xl border border-border bg-card/70 p-4">Loading plan change history…</div>
  if (error) return <div className="rounded-2xl border border-destructive bg-card/70 p-4">{error}</div>
  if (!items.length) return <div className="rounded-2xl border border-border bg-card/70 p-4">No plan change history available.</div>
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4 space-y-3">
      <div className="font-semibold">Plan change history</div>
      {items.map((item) => {
        const expanded = expandedId === item.historyEntryId
        return (
          <article key={item.historyEntryId} className="rounded-xl border border-border p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <div><strong>{item.effectiveAt}</strong></div>
                <div>{item.actorId} · {(item.previousPlanId ?? 'none')} → {item.newPlanId}</div>
                <div><span aria-label={`change direction ${item.changeDirection}`}>{item.changeDirection}</span> · over-limit: {item.overLimitDimensionCount}</div>
              </div>
              <button className="rounded border px-3 py-1" type="button" onClick={() => setExpandedId(expanded ? null : item.historyEntryId)}>
                {expanded ? 'Hide details' : 'Show details'}
              </button>
            </div>
            {expanded ? <div className="space-y-3"><PlanImpactSummaryCard entry={item} /><PlanQuotaImpactTable items={item.quotaImpacts} /><PlanCapabilityImpactTable items={item.capabilityImpacts} /></div> : null}
          </article>
        )
      })}
    </div>
  )
}
