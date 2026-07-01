import type { CurrentEffectiveEntitlementSummary, PlanCapabilityImpact } from '@/services/planManagementApi'

const capabilityComparisonLabels: Record<string, string> = {
  enabled: 'Habilitada',
  disabled: 'Deshabilitada',
  unchanged: 'Sin cambios'
}

function formatCapabilityState(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value ? 'Habilitada' : 'Deshabilitada'
}

function formatCapabilityComparison(value: string): string {
  return capabilityComparisonLabels[value] ?? value.replace(/_/g, ' ')
}

function CapabilityComparisonCell({ value }: { value: string }) {
  const label = formatCapabilityComparison(value)
  return <span aria-label={`estado de capacidad ${label}`}>{label}</span>
}

type CapabilityImpactRow = PlanCapabilityImpact | CurrentEffectiveEntitlementSummary['capabilities'][number]

function isPlanCapabilityImpact(item: CapabilityImpactRow): item is PlanCapabilityImpact {
  return 'comparison' in item
}

export function PlanCapabilityImpactTable({ items, title = 'Impacto de capacidades' }: { items: PlanCapabilityImpact[] | CurrentEffectiveEntitlementSummary['capabilities']; title?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm" aria-label={title}>
          <caption className="mb-3 text-left font-semibold text-foreground">{title}</caption>
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-3 py-2 font-medium">Capacidad</th>
              <th scope="col" className="px-3 py-2 font-medium">Anterior</th>
              <th scope="col" className="px-3 py-2 font-medium">Nuevo / efectivo</th>
              <th scope="col" className="px-3 py-2 font-medium">Comparación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {items.map((item) => {
              const isImpact = isPlanCapabilityImpact(item)
              const comparison = isImpact ? item.comparison : item.enabled ? 'enabled' : 'disabled'

              return (
                <tr key={item.capabilityKey}>
                  <td className="max-w-[16rem] whitespace-normal break-words px-3 py-3 font-medium text-foreground">{item.displayLabel ?? item.capabilityKey}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{isImpact ? formatCapabilityState(item.previousState) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{isImpact ? formatCapabilityState(item.newState) : formatCapabilityState(item.enabled)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground"><CapabilityComparisonCell value={comparison} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
