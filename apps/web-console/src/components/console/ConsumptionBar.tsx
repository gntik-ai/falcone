import type { CSSProperties } from 'react'
import { AlertTriangle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

function getTone(current: number, limit: number) {
  if (limit <= 0) return current > 0 ? 'bg-red-500' : 'bg-red-400'
  const ratio = current / limit
  if (ratio >= 1) return 'bg-red-500'
  if (ratio >= 0.8) return 'bg-amber-500'
  return 'bg-emerald-500'
}

// #766: a diagonal hazard-stripe overlay drawn on top of the fill when the dimension is at or
// over its limit. The fill's WIDTH is still capped at 100% (an overflowing track would break
// every table/card layout this primitive is embedded in), but the width clamp must never be the
// only signal — a 245%-over-limit bar must look visibly different from a barely-at-100% one, not
// just identically "full" (that was the native `<progress>` clamp bug in
// `ConsoleMetricDimensionRow`). The stripe + the breach badge below are the non-color cues
// (WCAG 1.4.1) layered on top of the existing red tone.
const OVER_LIMIT_STRIPE_BACKGROUND_IMAGE =
  'repeating-linear-gradient(135deg, rgba(255,255,255,0.5) 0px, rgba(255,255,255,0.5) 3px, transparent 3px, transparent 6px)'

export function ConsumptionBar({
  current,
  limit,
  label,
  formatValue = (value: number) => String(value)
}: {
  current: number | null
  limit: number
  label?: string
  formatValue?: (value: number) => string
}) {
  if (limit === -1) {
    return (
      <div aria-label={label ?? 'Uso sin límite'} className="break-words text-sm tabular-nums">
        <span className="font-medium text-foreground">{current !== null ? formatValue(current) : '—'}</span> <span className="text-muted-foreground">/ Sin límite</span>
      </div>
    )
  }
  if (current === null) {
    return <div aria-label={label ?? 'Uso no disponible'} className="text-sm text-muted-foreground">Datos no disponibles</div>
  }
  const percentage = limit <= 0 ? 100 : Math.min((current / limit) * 100, 100)
  const ariaMax = limit > 0 ? limit : 100
  const ariaNow = limit > 0 ? Math.min(current, limit) : current > 0 ? 100 : 0
  // Matches the app's own `isExceeded = pctUsed >= 100` severity taxonomy (console-quotas.ts /
  // console-metrics.ts): a dimension exactly AT its limit is already "exceeded", not merely
  // "full and healthy", so the breach marker (and the ratio>=1 red tone above) covers it too.
  const isOverLimit = limit > 0 && current >= limit
  const ariaValueText = limit > 0
    ? `${formatValue(current)} de ${formatValue(limit)}${current > limit ? ', por encima del límite' : ''}`
    : `${formatValue(current)} usado con límite cero`
  const fillStyle: CSSProperties = {
    width: `${percentage}%`,
    ...(isOverLimit ? { backgroundImage: OVER_LIMIT_STRIPE_BACKGROUND_IMAGE } : {})
  }
  return (
    <div className="space-y-2">
      <div className={cn('break-words text-sm tabular-nums', isOverLimit ? 'font-semibold text-red-300' : 'font-medium text-foreground')}>
        {formatValue(current)} / {formatValue(limit)}
      </div>
      <div
        role="progressbar"
        aria-label={label ?? 'Progreso de consumo'}
        aria-valuemin={0}
        aria-valuemax={ariaMax}
        aria-valuenow={ariaNow}
        aria-valuetext={ariaValueText}
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div data-testid="consumption-bar-fill" className={cn('h-full rounded-full transition-all', getTone(current, limit))} style={fillStyle} />
      </div>
      {isOverLimit ? (
        <Badge
          data-testid="consumption-bar-breach-marker"
          className="gap-1 border-red-500/40 bg-red-500/15 text-red-300"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          Por encima del límite
        </Badge>
      ) : null}
    </div>
  )
}
