import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const postureLabels: Record<string, string> = {
  within_limit: 'Dentro del límite',
  warning_threshold_reached: 'Umbral de advertencia',
  hard_limit_breached: 'Límite duro superado',
  soft_limit_breached: 'Límite blando superado',
  exceeded: 'Superado',
  unknown: 'Desconocido'
}

export function ConsoleQuotaPostureBadge({ posture, linkTo }: { posture: string | null; linkTo?: string }) {
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

  const label = postureLabels[normalized] ?? normalized.replace(/_/g, ' ')

  // #766 wayfinding: the Observability header summarizes quota posture but offered no path to the
  // Quotas page it describes. When `linkTo` is provided, wrap the badge in a focusable link (opt-in
  // — omitting `linkTo` keeps every pre-existing render, which never provided a Router context,
  // unchanged; the Quotas page itself deliberately omits it to avoid a self-link to the page you
  // are already on) and surface a forward-arrow affordance so a clickable badge reads as navigable,
  // not merely decorative. The arrow is decorative (`aria-hidden`); the link's own `aria-label`
  // carries the "Ver cuotas" intent for assistive tech.
  if (!linkTo) return <Badge className={className}>{label}</Badge>

  return (
    <Link
      to={linkTo}
      aria-label={`${label}. Ver cuotas.`}
      className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Badge className={cn(className, 'gap-1')}>
        {label}
        <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      </Badge>
    </Link>
  )
}
