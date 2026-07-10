import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { CapabilityStatusGrid } from '@/components/console/CapabilityStatusGrid'
import { QuotaConsumptionTable } from '@/components/console/QuotaConsumptionTable'
import { Badge } from '@/components/ui/badge'
import * as api from '@/services/planManagementApi'

export function ConsoleWorkspaceDashboardPage() {
  const { workspaceId = '' } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<api.WorkspaceConsumptionResponse | null>(null)
  const [consumptionUnavailable, setConsumptionUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    setData(null)
    setConsumptionUnavailable(false)
    api.getWorkspaceConsumption(workspaceId)
      .then((nextData) => {
        if (active) setData(nextData)
      })
      .catch(() => {
        if (active) setConsumptionUnavailable(true)
      })

    return () => {
      active = false
    }
  }, [workspaceId])

  if (consumptionUnavailable) {
    return (
      <ConsolePageState
        kind="empty"
        title="Datos de consumo no disponibles"
        description={`Esta área de trabajo no tiene datos de consumo disponibles ahora${workspaceId ? ` para ${workspaceId}` : ''}. Puedes seguir gestionándola y consultar las cuotas de la organización desde las páginas de planes.`}
        actionLabel="Abrir mi plan"
        onAction={() => navigate('/console/my-plan')}
      />
    )
  }
  if (!data) {
    return (
      <ConsolePageState
        kind="loading"
        title="Cargando panel del área de trabajo"
        description={`Consultando consumo del área de trabajo y capacidades heredadas${workspaceId ? ` para ${workspaceId}` : ''}.`}
      />
    )
  }

  const quotaRows = data.dimensions.map((row) => ({
    dimensionKey: row.dimensionKey,
    displayLabel: row.displayLabel,
    unit: row.unit,
    effectiveValue: row.workspaceLimit ?? row.tenantEffectiveValue,
    source: row.workspaceSource === 'workspace_sub_quota' ? ('override' as const) : ('plan' as const),
    currentUsage: row.currentUsage,
    usageStatus: row.usageStatus,
    usageUnknownReason: row.usageUnknownReason
  }))
  const capabilities = data.capabilities?.map((item) => ({
    capabilityKey: item.capabilityKey,
    displayLabel: item.displayLabel ?? item.capabilityKey,
    enabled: item.enabled,
    source: item.source ?? ('catalog_default' as const)
  }))

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,34rem)] lg:items-start">
          <div className="min-w-0 space-y-2">
            <Badge variant="outline">Área de trabajo</Badge>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Panel del área de trabajo</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Consumo y capacidades heredadas de esta área de trabajo.
              </p>
            </div>
          </div>
          <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-3 lg:gap-4">
            <div className="min-w-0 rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
              <dt className="text-[11px] font-medium uppercase text-muted-foreground">Área de trabajo</dt>
              <dd className="mt-1 break-all font-mono text-sm text-foreground">{data.workspaceId}</dd>
            </div>
            <div className="min-w-0 rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
              <dt className="text-[11px] font-medium uppercase text-muted-foreground">Organización</dt>
              <dd className="mt-1 break-all font-mono text-sm text-foreground">{data.tenantId}</dd>
            </div>
            <div className="min-w-0 rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
              <dt className="text-[11px] font-medium uppercase text-muted-foreground">Instantánea</dt>
              <dd className="mt-1 text-sm text-foreground">
                <time dateTime={data.snapshotAt}>{formatDateTime(data.snapshotAt)}</time>
              </dd>
            </div>
          </dl>
        </div>
      </header>
      <QuotaConsumptionTable rows={quotaRows} title="Consumo del área de trabajo" />
      {capabilities ? <CapabilityStatusGrid capabilities={capabilities} /> : null}
    </section>
  )
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}
