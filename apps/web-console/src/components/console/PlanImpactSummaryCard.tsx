import type { PlanChangeHistoryEntry } from '@/services/planManagementApi'

const changeDirectionLabels: Record<PlanChangeHistoryEntry['changeDirection'], string> = {
  upgrade: 'Subida de plan',
  downgrade: 'Bajada de plan',
  lateral: 'Cambio lateral',
  equivalent: 'Equivalente',
  initial_assignment: 'Asignación inicial'
}

const usageCollectionLabels: Record<PlanChangeHistoryEntry['usageCollectionStatus'], string> = {
  complete: 'Completa',
  partial: 'Parcial',
  unavailable: 'No disponible'
}

export function PlanImpactSummaryCard({ entry }: { entry: PlanChangeHistoryEntry }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card/70 p-4 shadow-sm" aria-labelledby={`impact-summary-${entry.historyEntryId}`}>
      <h3 id={`impact-summary-${entry.historyEntryId}`} className="text-base font-semibold text-foreground">Resumen del impacto del plan</h3>
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <div className="min-w-0 break-words"><strong className="text-foreground">Actor:</strong> {entry.actorId}</div>
        <div className="min-w-0 break-words"><strong className="text-foreground">Vigente desde:</strong> {entry.effectiveAt}</div>
        <div className="min-w-0 break-words"><strong className="text-foreground">Correlación:</strong> {entry.correlationId ?? '—'}</div>
        <div className="min-w-0 break-words"><strong className="text-foreground">Motivo:</strong> {entry.changeReason ?? '—'}</div>
        <div className="min-w-0 break-words"><strong className="text-foreground">Dirección:</strong> <span aria-label={`dirección del cambio ${changeDirectionLabels[entry.changeDirection]}`}>{changeDirectionLabels[entry.changeDirection]}</span></div>
        <div className="min-w-0 break-words"><strong className="text-foreground">Recolección de uso:</strong> <span aria-label={`recolección de uso ${usageCollectionLabels[entry.usageCollectionStatus]}`}>{usageCollectionLabels[entry.usageCollectionStatus]}</span></div>
        <div className="min-w-0 break-words"><strong className="text-foreground">Cambio de plan:</strong> {(entry.previousPlanId ?? 'ninguno')} → {entry.newPlanId}</div>
        <div className="min-w-0 break-words"><strong className="text-foreground">Dimensiones por encima del límite:</strong> {entry.overLimitDimensionCount}</div>
      </div>
    </section>
  )
}
