import { Badge } from '@/components/ui/badge'

const postureLabels: Record<string, string> = {
  within_limit: 'Dentro del límite',
  warning_threshold_reached: 'Umbral de advertencia',
  hard_limit_breached: 'Límite duro superado',
  soft_limit_breached: 'Límite blando superado',
  exceeded: 'Superado',
  unknown: 'Desconocido'
}

export function ConsoleQuotaPostureBadge({ posture }: { posture: string | null }) {
  const normalized = posture ?? 'unknown'
  const className = normalized.includes('breach') || normalized.includes('exceeded')
    ? 'border-red-500/40 bg-red-500/10 text-red-700'
    : normalized.includes('warning')
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700'
      : normalized === 'within_limit'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700'
        : 'border-border bg-secondary text-secondary-foreground'

  return <Badge className={className}>{postureLabels[normalized] ?? normalized.replace(/_/g, ' ')}</Badge>
}
