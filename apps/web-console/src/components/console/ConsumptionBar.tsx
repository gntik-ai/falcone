import { cn } from '@/lib/utils'

function getTone(current: number, limit: number) {
  if (limit <= 0) return current > 0 ? 'bg-red-500' : 'bg-red-400'
  const ratio = current / limit
  if (ratio >= 1) return 'bg-red-500'
  if (ratio >= 0.8) return 'bg-amber-500'
  return 'bg-emerald-500'
}

export function ConsumptionBar({ current, limit, label }: { current: number | null; limit: number; label?: string }) {
  if (limit === -1) {
    return <div aria-label={label ?? 'Uso sin límite'} className="break-words text-sm"><span>{current ?? '—'}</span> <span className="text-muted-foreground">/ Sin límite</span></div>
  }
  if (current === null) {
    return <div aria-label={label ?? 'Uso no disponible'} className="text-sm text-muted-foreground">Datos no disponibles</div>
  }
  const percentage = limit <= 0 ? 100 : Math.min((current / limit) * 100, 100)
  const ariaMax = limit > 0 ? limit : 100
  const ariaNow = limit > 0 ? Math.min(current, limit) : current > 0 ? 100 : 0
  const ariaValueText = limit > 0
    ? `${current} de ${limit}${current > limit ? ', por encima del límite' : ''}`
    : `${current} usado con límite cero`
  return (
    <div className="space-y-2">
      <div className="break-words text-sm">{current} / {limit}</div>
      <div
        role="progressbar"
        aria-label={label ?? 'Progreso de consumo'}
        aria-valuemin={0}
        aria-valuemax={ariaMax}
        aria-valuenow={ariaNow}
        aria-valuetext={ariaValueText}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div data-testid="consumption-bar-fill" className={cn('h-full rounded-full transition-all', getTone(current, limit))} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  )
}
