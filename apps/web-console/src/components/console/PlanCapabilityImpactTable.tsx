import type { CurrentEffectiveEntitlementSummary, PlanCapabilityImpact } from '@/services/planManagementApi'

export function PlanCapabilityImpactTable({ items, title = 'Capability impact' }: { items: PlanCapabilityImpact[] | CurrentEffectiveEntitlementSummary['capabilities']; title?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <table className="w-full text-sm" aria-label={title}>
        <caption className="mb-2 text-left font-semibold">{title}</caption>
        <thead>
          <tr className="text-left"><th>Capability</th><th>Previous</th><th>New / Effective</th><th>Comparison</th></tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.capabilityKey} className="border-t border-border">
              <td>{item.displayLabel ?? item.capabilityKey}</td>
              <td>{'previousState' in item ? String(item.previousState ?? '—') : '—'}</td>
              <td>{'newState' in item ? String(item.newState ?? '—') : String(item.enabled)}</td>
              <td><span aria-label={`capability state ${'comparison' in item ? item.comparison : item.enabled ? 'enabled' : 'disabled'}`}>{'comparison' in item ? item.comparison : item.enabled ? 'enabled' : 'disabled'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
