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
  // Tones are authored for the dark `:root` the console always renders (it never toggles the
  // `.dark` class, so `dark:` variants would be dead). Light `-300` text on a `-500/10` tint is
  // the dark-safe posture idiom shared with `ConsoleCredentialStatusBadge`; the previous `-700`
  // text rendered dark-on-dark and was effectively unreadable.
  const className = normalized.includes('breach') || normalized.includes('exceeded')
    ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : normalized.includes('warning')
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
      : normalized === 'within_limit'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
        : 'border-border bg-secondary text-secondary-foreground'

  return <Badge className={className}>{postureLabels[normalized] ?? normalized.replace(/_/g, ' ')}</Badge>
}
