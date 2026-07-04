import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { ConsoleQuotaPostureBadge } from '@/components/console/ConsoleQuotaPostureBadge'
import { QuotaAdjustDialog, type QuotaAdjustTarget } from '@/components/console/QuotaAdjustDialog'
import { useConsoleContext } from '@/lib/console-context'
import { useConsoleQuotas, type ConsoleQuotaDimensionView } from '@/lib/console-quotas'
import { readConsoleShellSession } from '@/lib/console-session'

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
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <p className="text-sm text-muted-foreground">{activeTenant?.label ?? 'Organización activa'}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Cuotas</h1>
          <ConsoleQuotaPostureBadge posture={posture?.overallPosture ?? null} />
        </div>
        <p className="mt-2 text-sm text-muted-foreground">Última evaluación: {posture?.evaluatedAt ?? 'n/a'}</p>
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

      <QuotaAdjustDialog target={adjustTarget} onClose={() => setAdjustTarget(null)} onAdjusted={reload} />
    </section>
  )
}

function QuotaTable({ title, posture, isSuperadmin, onAdjust }: { title: string; posture: { dimensions: ConsoleQuotaDimensionView[] }; isSuperadmin: boolean; onAdjust: (dimension: ConsoleQuotaDimensionView) => void }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card/70">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-3 font-medium">Dimensión</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Límite</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Consumo</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">% uso</th>
              <th scope="col" className="px-4 py-3 font-medium">Modo</th>
              <th scope="col" className="px-4 py-3 font-medium">Actualidad</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {posture.dimensions.map((dimension) => (
              <tr key={`${title}-${dimension.dimensionId}`} className={dimension.isExceeded ? 'bg-red-500/5' : dimension.isWarning ? 'bg-amber-500/5' : ''}>
                <td className="max-w-[16rem] whitespace-normal break-words px-4 py-3 font-medium text-foreground">{dimension.displayName}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">{dimension.hardLimit ?? 'sin límite'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">{dimension.measuredValue}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">{dimension.pctUsed !== null ? `${dimension.pctUsed}%` : '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{policyModeLabels[dimension.policyMode] ?? dimension.policyMode.replace(/_/g, ' ')}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{freshnessStatusLabels[dimension.freshnessStatus] ?? dimension.freshnessStatus.replace(/_/g, ' ')}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {isSuperadmin ? (
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
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
