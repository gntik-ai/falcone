/**
 * Badge component showing the global risk level of a preflight conflict report.
 */

interface PreflightRiskBadgeProps {
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  size?: 'sm' | 'md' | 'lg'
}

const LEVEL_CONFIG: Record<string, { tone: string; label: string }> = {
  low:      { tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', label: 'Sin conflictos' },
  medium:   { tone: 'border-amber-500/30 bg-amber-500/10 text-amber-300',       label: 'Riesgo medio' },
  high:     { tone: 'border-orange-500/30 bg-orange-500/10 text-orange-300',   label: 'Riesgo alto' },
  critical: { tone: 'border-red-500/30 bg-red-500/10 text-red-300',            label: 'Riesgo crítico' },
}

const SIZE_CLASSES: Record<string, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1 text-sm',
  lg: 'px-4 py-1.5 text-base',
}

export function PreflightRiskBadge({ riskLevel, size = 'md' }: PreflightRiskBadgeProps) {
  const config = LEVEL_CONFIG[riskLevel] ?? LEVEL_CONFIG.medium
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${config.tone} ${sizeClass}`}
      data-testid="risk-badge"
      data-risk-level={riskLevel}
      aria-label={`Nivel de riesgo: ${config.label}`}
    >
      {config.label}
    </span>
  )
}
