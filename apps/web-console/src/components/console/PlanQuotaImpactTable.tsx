import type { CurrentEffectiveEntitlementSummary, PlanQuotaImpact } from '@/services/planManagementApi'

function renderValue(kind?: string, value?: number | null) {
  if (kind === 'unlimited') return 'Unlimited'
  if (kind === 'missing') return '—'
  return value ?? '—'
}

export function PlanQuotaImpactTable({ items, title = 'Quota impact' }: { items: PlanQuotaImpact[] | CurrentEffectiveEntitlementSummary['quotaDimensions']; title?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <table className="w-full text-sm" aria-label={title}>
        <caption className="mb-2 text-left font-semibold">{title}</caption>
        <thead>
          <tr className="text-left">
            <th>Dimension</th><th>Previous</th><th>New / Effective</th><th>Comparison</th><th>Usage</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.dimensionKey} className="border-t border-border">
              <td>{item.displayLabel ?? item.dimensionKey}</td>
              <td>{'previousEffectiveValueKind' in item ? renderValue(item.previousEffectiveValueKind, item.previousEffectiveValue) : '—'}</td>
              <td>{renderValue(item.newEffectiveValueKind ?? item.effectiveValueKind, item.newEffectiveValue ?? item.effectiveValue)}</td>
              <td><span aria-label={`comparison ${'comparison' in item ? item.comparison : 'current'}`}>{'comparison' in item ? item.comparison : 'current'}</span></td>
              <td>{item.observedUsage ?? '—'}</td>
              <td><span aria-label={`usage status ${item.usageStatus}`}>{item.usageStatus}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
