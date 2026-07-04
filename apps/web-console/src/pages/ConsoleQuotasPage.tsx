import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { ConsoleQuotaPostureBadge } from '@/components/console/ConsoleQuotaPostureBadge'
import { QuotaAdjustDialog, type QuotaAdjustTarget } from '@/components/console/QuotaAdjustDialog'
import { useConsoleContext } from '@/lib/console-context'
import { useConsoleQuotas, type ConsoleQuotaDimensionView } from '@/lib/console-quotas'
import { readConsoleShellSession } from '@/lib/console-session'
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
  const roles = readConsoleShellSession()?.principal?.platformRoles ?? []
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
        <p className="text-xs text-muted-foreground">{dimensionCount} {dimensionCount === 1 ? 'dimensión' : 'dimensiones'}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <caption className="sr-only">Postura de cuotas: {title}</caption>
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-3 font-medium">Dimensión</th>
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
                  dimension.isExceeded ? 'bg-red-500/10' : dimension.isWarning ? 'bg-amber-500/10' : 'hover:bg-muted/20'
                )}
              >
                <th scope="row" className="max-w-[16rem] whitespace-normal break-words px-4 py-3 text-left font-medium text-foreground">{dimension.displayName}</th>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">{dimension.hardLimit ?? 'sin límite'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">{dimension.measuredValue}</td>
                <td
                  className={cn(
                    'whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums',
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
