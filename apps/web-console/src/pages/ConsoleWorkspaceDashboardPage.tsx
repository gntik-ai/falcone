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
        title="Consumption data unavailable"
        description={`This workspace does not have consumption data available right now${workspaceId ? ` for ${workspaceId}` : ''}. You can still manage the workspace and check tenant-level quotas from the plan pages.`}
        actionLabel="Open my plan"
        onAction={() => navigate('/console/my-plan')}
      />
    )
  }
  if (!data) {
    return (
      <ConsolePageState
        kind="loading"
        title="Loading workspace dashboard"
        description={`Fetching workspace consumption and inherited capabilities${workspaceId ? ` for ${workspaceId}` : ''}.`}
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
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,34rem)] lg:items-start">
          <div className="min-w-0 space-y-2">
            <Badge variant="outline">Workspace</Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Workspace dashboard</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Consumption and inherited capabilities for this workspace.
              </p>
            </div>
          </div>
          <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-3 lg:gap-4">
            <div className="min-w-0 rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace</dt>
              <dd className="mt-1 break-all font-mono text-sm text-foreground">{data.workspaceId}</dd>
            </div>
            <div className="min-w-0 rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Tenant</dt>
              <dd className="mt-1 break-all font-mono text-sm text-foreground">{data.tenantId}</dd>
            </div>
            <div className="min-w-0 rounded-2xl border border-border/70 bg-background/50 px-4 py-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Snapshot</dt>
              <dd className="mt-1 text-sm text-foreground">
                <time dateTime={data.snapshotAt}>{formatDateTime(data.snapshotAt)}</time>
              </dd>
            </div>
          </dl>
        </div>
      </header>
      <QuotaConsumptionTable rows={quotaRows} title="Workspace consumption" />
      {capabilities ? <CapabilityStatusGrid capabilities={capabilities} /> : null}
    </main>
  )
}

function formatDateTime(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}
