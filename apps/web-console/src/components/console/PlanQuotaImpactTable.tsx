import type { CurrentEffectiveEntitlementSummary, PlanQuotaImpact, UsageStatus } from '@/services/planManagementApi'

const quotaComparisonLabels: Record<string, string> = {
  increased: 'Aumentó',
  decreased: 'Disminuyó',
  unchanged: 'Sin cambios',
  added: 'Añadida',
  removed: 'Eliminada',
  current: 'Actual'
}

const usageStatusLabels: Record<UsageStatus, string> = {
  within_limit: 'Dentro del límite',
  approaching_limit: 'Cerca del límite',
  at_limit: 'En el límite',
  over_limit: 'Por encima del límite',
  unknown: 'Desconocido'
}

function renderValue(kind?: string, value?: number | null) {
  if (kind === 'unlimited') return 'Sin límite'
  if (kind === 'missing') return '—'
  return value ?? '—'
}

function formatQuotaComparison(value: string): string {
  return quotaComparisonLabels[value] ?? value.replace(/_/g, ' ')
}

function QuotaComparisonCell({ value }: { value: string }) {
  const label = formatQuotaComparison(value)
  return <span aria-label={`comparación ${label}`}>{label}</span>
}

type QuotaImpactRow = PlanQuotaImpact | CurrentEffectiveEntitlementSummary['quotaDimensions'][number]

function isPlanQuotaImpact(item: QuotaImpactRow): item is PlanQuotaImpact {
  return 'comparison' in item
}

export function PlanQuotaImpactTable({ items, title = 'Impacto de cuotas' }: { items: PlanQuotaImpact[] | CurrentEffectiveEntitlementSummary['quotaDimensions']; title?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm" aria-label={title}>
          <caption className="mb-3 text-left font-semibold text-foreground">{title}</caption>
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-3 py-2 font-medium">Dimensión</th>
              <th scope="col" className="px-3 py-2 font-medium">Anterior</th>
              <th scope="col" className="px-3 py-2 font-medium">Nuevo / efectivo</th>
              <th scope="col" className="px-3 py-2 font-medium">Comparación</th>
              <th scope="col" className="px-3 py-2 font-medium">Uso</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {items.map((item) => {
              const isImpact = isPlanQuotaImpact(item)
              const newKind = isImpact ? item.newEffectiveValueKind : item.effectiveValueKind
              const newValue = isImpact ? item.newEffectiveValue : item.effectiveValue

              return (
                <tr key={item.dimensionKey}>
                  <td className="max-w-[16rem] whitespace-normal break-words px-3 py-3 font-medium text-foreground">{item.displayLabel ?? item.dimensionKey}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{isImpact ? renderValue(item.previousEffectiveValueKind, item.previousEffectiveValue) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{renderValue(newKind, newValue)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground"><QuotaComparisonCell value={isImpact ? item.comparison : 'current'} /></td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-muted-foreground">{item.observedUsage ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground"><span aria-label={`estado de uso ${usageStatusLabels[item.usageStatus]}`}>{usageStatusLabels[item.usageStatus]}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
