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
    <div className="rounded-2xl border border-border bg-card/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">{dimension.displayName}</h3>
          <p className="text-sm text-muted-foreground">{dimension.dimensionId}</p>
        </div>
        <div className="text-right text-sm">
          {dimension.pctUsed !== null ? (
            <p
              className={cn(
                'mt-0.5 inline-flex items-center justify-end gap-1.5',
                dimension.isExceeded ? 'font-semibold text-red-300' : dimension.isWarning ? 'font-medium text-amber-300' : 'text-muted-foreground'
              )}
            >
              {dimension.isExceeded ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
              <span>{dimension.pctUsed}% usado</span>
              {dimension.isExceeded ? <Badge variant="destructive">Por encima del límite</Badge> : null}
            </p>
          ) : (
            <p className="text-muted-foreground">Sin límite fijo</p>
          )}
        </div>
      </div>
      <div className="mt-3">
        <ConsumptionBar current={dimension.measuredValue} limit={limit} label={`Uso de ${dimension.displayName}`} formatValue={formatValue} />
      </div>
      {dimension.isExceeded ? (
        <Link
          to="/console/quotas"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-300 underline-offset-2 hover:underline"
        >
          Ver cuotas de la organización
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  )
}
