import { AlertTriangle, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { ConsumptionBar } from '@/components/console/ConsumptionBar'
import type { ConsoleMetricDimensionView } from '@/lib/console-metrics'
import { formatDimensionValue } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ConsoleMetricDimensionRow({ dimension }: { dimension: ConsoleMetricDimensionView }) {
  // #766: the previous native `<progress max={100} value={pctUsed ?? 0}>` clamps its rendered
  // fill to `max` whenever `value` exceeds it — so a 245%-over-limit dimension rendered visually
  // IDENTICAL to a healthy 100% one (a full, unremarkable bar). Replace it with the shared
  // `ConsumptionBar` (already used by the Quotas plan/workspace tables), which renders an
  // honest, non-clamping-only breach cue, and add a destructive badge/icon on the value itself
  // so the breach is never color-only (WCAG 1.4.1).
  const formatValue = (value: number) => formatDimensionValue(value, dimension.unit, dimension.dimensionId)
  const limit = dimension.hardLimit ?? -1

  return (
    <div
      className={cn(
        // #766 breach language: the card surface itself carries the tone so an exceeded card reads
        // as "in breach" before you parse the numbers — the same red-500/40 border + tint used by
        // the breach chip, the posture badge and the Quotas rows. Warning is a calmer amber wash
        // with no chip, so breach keeps clear visual priority.
        'rounded-2xl border p-4 transition-colors',
        dimension.isExceeded
          ? 'border-red-500/40 bg-red-500/10'
          : dimension.isWarning
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-border bg-card/50'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground">{dimension.displayName}</h3>
          <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{dimension.dimensionId}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-sm">
          {dimension.pctUsed !== null ? (
            <>
              <span
                className={cn(
                  'tabular-nums',
                  dimension.isExceeded ? 'font-semibold text-red-300' : dimension.isWarning ? 'font-medium text-amber-300' : 'text-muted-foreground'
                )}
              >
                {dimension.pctUsed}% usado
              </span>
              {dimension.isExceeded ? (
                <Badge className="gap-1 border-red-500/40 bg-red-500/15 text-red-300">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  Por encima del límite
                </Badge>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">Sin límite fijo</span>
          )}
        </div>
      </div>
      <div className="mt-3">
        <ConsumptionBar current={dimension.measuredValue} limit={limit} label={`Uso de ${dimension.displayName}`} formatValue={formatValue} />
      </div>
      {dimension.isExceeded ? (
        <Link
          to="/console/quotas"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-red-300 underline-offset-2 hover:underline"
        >
          Ver cuotas de la organización
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  )
}
