import { useState } from 'react'
import type { PlanChangeHistoryEntry } from '@/services/planManagementApi'
import { Button } from '@/components/ui/button'
import { PlanImpactSummaryCard } from './PlanImpactSummaryCard'
import { PlanQuotaImpactTable } from './PlanQuotaImpactTable'
import { PlanCapabilityImpactTable } from './PlanCapabilityImpactTable'

const changeDirectionLabels: Record<PlanChangeHistoryEntry['changeDirection'], string> = {
  upgrade: 'Subida de plan',
  downgrade: 'Bajada de plan',
  lateral: 'Cambio lateral',
  equivalent: 'Equivalente',
  initial_assignment: 'Asignación inicial'
}

export function PlanImpactHistoryTable({ items, loading, error }: { items: PlanChangeHistoryEntry[]; loading?: boolean; error?: string | null }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (loading) return <div className="rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">Cargando historial de cambios del plan…</div>
  if (error) return <div className="rounded-2xl border border-destructive bg-card/70 p-4 text-sm text-destructive">{error}</div>
  if (!items.length) return <div className="rounded-2xl border border-border bg-card/70 p-4 text-sm text-muted-foreground">No hay historial de cambios del plan disponible.</div>
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
      <div className="font-semibold text-foreground">Historial de cambios del plan</div>
      {items.map((item) => {
        const expanded = expandedId === item.historyEntryId
        return (
          <article key={item.historyEntryId} className="space-y-3 rounded-xl border border-border/80 bg-background/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 text-sm leading-6">
                <div className="font-semibold text-foreground">{item.effectiveAt}</div>
                <div className="break-words text-muted-foreground">{item.actorId} · {(item.previousPlanId ?? 'ninguno')} → {item.newPlanId}</div>
                <div className="text-muted-foreground"><span aria-label={`dirección del cambio ${changeDirectionLabels[item.changeDirection]}`}>{changeDirectionLabels[item.changeDirection]}</span> · por encima del límite: {item.overLimitDimensionCount}</div>
              </div>
              <Button className="shrink-0 whitespace-nowrap" variant="outline" size="sm" type="button" onClick={() => setExpandedId(expanded ? null : item.historyEntryId)}>
                {expanded ? 'Ocultar detalles' : 'Mostrar detalles'}
              </Button>
            </div>
            {expanded ? <div className="space-y-3"><PlanImpactSummaryCard entry={item} /><PlanQuotaImpactTable items={item.quotaImpacts} /><PlanCapabilityImpactTable items={item.capabilityImpacts} /></div> : null}
          </article>
        )
      })}
    </div>
  )
}
