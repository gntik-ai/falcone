import type { RiskLevel } from '@/services/backupOperationsApi'

export function RiskLevelBadge({ riskLevel }: { riskLevel: RiskLevel }) {
  const styles =
    riskLevel === 'critical'
      ? 'border-red-500/30 bg-red-500/10 text-red-300'
      : riskLevel === 'elevated'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'

  const icon = riskLevel === 'critical' ? '🚫' : riskLevel === 'elevated' ? '⚠️' : 'ℹ️'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles}`}>
      <span aria-hidden>{icon}</span>
      <span className="capitalize">{riskLevel}</span>
    </span>
  )
}
