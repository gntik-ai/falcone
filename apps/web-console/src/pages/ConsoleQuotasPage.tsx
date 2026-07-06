import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { ConsoleQuotaPostureBadge } from '@/components/console/ConsoleQuotaPostureBadge'
import { QuotaAdjustDialog, type QuotaAdjustTarget } from '@/components/console/QuotaAdjustDialog'
import { useConsoleContext } from '@/lib/console-context'
import { useConsoleQuotas, type ConsoleQuotaDimensionView } from '@/lib/console-quotas'
import { useConsolePermissions } from '@/lib/console-permissions'
import { formatDimensionValue } from '@/lib/format'
import { cn } from '@/lib/utils'

const policyModeLabels: Record<string, string> = {
  enforced: 'Aplicada',
  unbounded: 'Sin límite'
}

const freshnessStatusLabels: Record<string, string> = {
  fresh: 'Actual',
  degraded: 'Degradada',
  unavailable: 'No disponible'
}

export function ConsoleQuotasPage() {
  const { activeTenant, activeTenantId, activeWorkspaceId } = useConsoleContext()
  const { posture, workspacePosture, loading, error, reload } = useConsoleQuotas(activeTenantId, activeWorkspaceId)
  // Delegates the raw `platformRoles` read to the single console permission source (#761) instead
  // of re-reading the session directly — same boolean, one fewer place that inspects roles.
  const { roles } = useConsolePermissions()
  const isSuperadmin = roles.includes('superadmin') || roles.includes('platform_operator')
  const [adjustTarget, setAdjustTarget] = useState<QuotaAdjustTarget | null>(null)

  if (!activeTenantId) {
    return <ConsolePageState kind="blocked" title="Cuotas bloqueadas" description="Selecciona una organización para consultar la postura de cuotas." />
  }

  function openAdjustDialog(tableKey: string, dimension: ConsoleQuotaDimensionView) {
    if (!activeTenantId) return
    setAdjustTarget({ tenantId: activeTenantId, dimension, tableKey: `${tableKey}-${dimension.dimensionId}` })
  }

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-5 shadow-sm sm:p-6">
        <p className="text-sm font-medium text-muted-foreground">{activeTenant?.label ?? 'Organización activa'}</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Cuotas</h1>
          {/* #766 UX pass: no `linkTo` here — this badge already sits on the Quotas page, so
              linking it to `/console/quotas` is a self-link to the page you are already on. The
              posture cross-link stays only where it navigates somewhere new (Observability header +
              exceeded metric rows → Quotas). */}
          <ConsoleQuotaPostureBadge posture={posture?.overallPosture ?? null} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Última evaluación: {posture?.evaluatedAt ?? 'n/a'}</p>
      </header>

      {loading ? <ConsolePageState kind="loading" title="Cargando cuotas" description="Consultando postura y resumen de uso." /> : null}
      {error ? <ConsolePageState kind="error" title="No se pudieron cargar las cuotas" description={error} actionLabel="Reintentar" onAction={reload} /> : null}
      {!loading && !error && posture && posture.dimensions.length === 0 ? <ConsolePageState kind="empty" title="Sin dimensiones de cuota" description="No hay cuotas publicadas para esta organización." /> : null}

      {posture ? (
        <QuotaTable title="Organización" posture={posture} isSuperadmin={isSuperadmin} onAdjust={(dimension) => openAdjustDialog('Organización', dimension)} />
      ) : null}
      {workspacePosture ? (
        <QuotaTable title="Área de trabajo" posture={workspacePosture} isSuperadmin={isSuperadmin} onAdjust={(dimension) => openAdjustDialog('Área de trabajo', dimension)} />
      ) : null}

      <QuotaAdjustDialog key={adjustTarget?.tableKey ?? 'closed'} target={adjustTarget} onClose={() => setAdjustTarget(null)} onAdjusted={reload} />
    </section>
  )
}

function QuotaTable({ title, posture, isSuperadmin, onAdjust }: { title: string; posture: { dimensions: ConsoleQuotaDimensionView[] }; isSuperadmin: boolean; onAdjust: (dimension: ConsoleQuotaDimensionView) => void }) {
  const dimensionCount = posture.dimensions.length
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card/70 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border px-5 py-4 sm:px-6">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="text-xs tabular-nums text-muted-foreground">{dimensionCount} {dimensionCount === 1 ? 'dimensión' : 'dimensiones'}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">Postura de cuotas: {title}</caption>
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="border-l-4 border-l-transparent px-4 py-3 font-medium">Dimensión</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Límite</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Consumo</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">% uso</th>
              <th scope="col" className="px-4 py-3 font-medium">Modo</th>
              <th scope="col" className="px-4 py-3 font-medium">Actualidad</th>
              {isSuperadmin ? <th scope="col" className="px-4 py-3 text-right font-medium">Acción</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {posture.dimensions.map((dimension) => (
              <tr
                key={`${title}-${dimension.dimensionId}`}
                className={cn(
                  'transition-colors',
                  // #766: the exceeded tint is strengthened (10 -> 15) and paired with a left
                  // accent border on the leading cell below — color is never the only cue.
                  dimension.isExceeded ? 'bg-red-500/15 hover:bg-red-500/20' : dimension.isWarning ? 'bg-amber-500/10' : 'hover:bg-muted/20'
                )}
              >
                <th
                  scope="row"
                  className={cn(
                    'max-w-[16rem] whitespace-normal break-words border-l-4 px-4 py-3 text-left font-medium text-foreground',
                    dimension.isExceeded ? 'border-l-red-500' : dimension.isWarning ? 'border-l-amber-500' : 'border-l-transparent'
                  )}
                >
                  {dimension.displayName}
                </th>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {dimension.hardLimit !== null ? formatDimensionValue(dimension.hardLimit, dimension.unit, dimension.dimensionId) : 'sin límite'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {formatDimensionValue(dimension.measuredValue, dimension.unit, dimension.dimensionId)}
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        dimension.pctUsed === null
                          ? 'text-muted-foreground'
                          : dimension.isExceeded
                            ? 'text-red-300'
                            : dimension.isWarning
                              ? 'text-amber-300'
                              : 'text-foreground'
                      )}
                    >
                      {dimension.pctUsed !== null ? `${dimension.pctUsed}%` : '—'}
                    </span>
                    {/* #766 breach language: the exceeded chip shares the ConsumptionBar marker /
                        metric-card idiom (soft red tint + hazard icon) instead of the loud solid
                        destructive Badge, so every breach cue across Quotas + Observability reads
                        as one deliberate treatment. */}
                    {dimension.isExceeded ? (
                      <Badge className="gap-1 border-red-500/40 bg-red-500/15 text-red-300">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        Superado
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{policyModeLabels[dimension.policyMode] ?? dimension.policyMode.replace(/_/g, ' ')}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{freshnessStatusLabels[dimension.freshnessStatus] ?? dimension.freshnessStatus.replace(/_/g, ' ')}</td>
                {isSuperadmin ? (
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="whitespace-nowrap"
                      data-quota-adjust-trigger={`${title}-${dimension.dimensionId}`}
                      aria-label={`Ajustar cuota de ${dimension.displayName}`}
                      onClick={() => onAdjust(dimension)}
                    >
                      Ajustar cuota
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
