import type { PlanChangeHistoryEntry } from '@/services/planManagementApi'

export function PlanImpactSummaryCard({ entry }: { entry: PlanChangeHistoryEntry }) {
  return (
    <section className="rounded-2xl border border-border bg-card/70 p-4 space-y-2" aria-labelledby={`impact-summary-${entry.historyEntryId}`}>
      <h3 id={`impact-summary-${entry.historyEntryId}`} className="text-lg font-semibold">Plan impact summary</h3>
      <div className="grid gap-2 md:grid-cols-2 text-sm">
        <div><strong>Actor:</strong> {entry.actorId}</div>
        <div><strong>Effective at:</strong> {entry.effectiveAt}</div>
        <div><strong>Correlation:</strong> {entry.correlationId ?? '—'}</div>
        <div><strong>Reason:</strong> {entry.changeReason ?? '—'}</div>
        <div><strong>Direction:</strong> <span aria-label={`change direction ${entry.changeDirection}`}>{entry.changeDirection}</span></div>
        <div><strong>Usage collection:</strong> <span aria-label={`usage collection ${entry.usageCollectionStatus}`}>{entry.usageCollectionStatus}</span></div>
        <div><strong>Plan change:</strong> {(entry.previousPlanId ?? 'none')} → {entry.newPlanId}</div>
        <div><strong>Over-limit dimensions:</strong> {entry.overLimitDimensionCount}</div>
      </div>
    </section>
  )
}
