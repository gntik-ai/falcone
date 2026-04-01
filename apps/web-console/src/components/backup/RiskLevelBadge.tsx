import type { RiskLevel } from '@/services/backupOperationsApi'

export function RiskLevelBadge({ riskLevel }: { riskLevel: RiskLevel }) {
  const styles =
    riskLevel === 'critical'
      ? 'border-red-300 bg-red-100 text-red-800'
      : riskLevel === 'elevated'
        ? 'border-amber-300 bg-amber-100 text-amber-800'
        : 'border-emerald-300 bg-emerald-100 text-emerald-800'

  const icon = riskLevel === 'critical' ? '🚫' : riskLevel === 'elevated' ? '⚠️' : 'ℹ️'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>
      <span aria-hidden>{icon}</span>
      <span className="capitalize">{riskLevel}</span>
    </span>
  )
}
