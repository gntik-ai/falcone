import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { CapabilityStatusGrid } from '@/components/console/CapabilityStatusGrid'
import { QuotaConsumptionTable } from '@/components/console/QuotaConsumptionTable'
import * as api from '@/services/planManagementApi'

export function ConsoleWorkspaceDashboardPage() {
  const { workspaceId = '' } = useParams()
  const [data, setData] = useState<api.WorkspaceConsumptionResponse | null>(null)
  const [consumptionUnavailable, setConsumptionUnavailable] = useState(false)

  useEffect(() => {
    setData(null)
    setConsumptionUnavailable(false)
    api.getWorkspaceConsumption(workspaceId).then(setData).catch(() => setConsumptionUnavailable(true))
  }, [workspaceId])

  if (consumptionUnavailable) {
    return (
      <ConsolePageState
        kind="empty"
        title="Consumption data unavailable"
        description="This workspace does not have consumption data available right now. You can still manage the workspace and check tenant-level quotas from the plan pages."
      />
    )
  }
  if (!data) return <ConsolePageState kind="loading" title="Loading workspace dashboard" description="Fetching workspace consumption and inherited capabilities." />

  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">Workspace dashboard</h1>
        <p>{data.workspaceId}</p>
      </header>
      <QuotaConsumptionTable rows={data.dimensions.map((row) => ({ dimensionKey: row.dimensionKey, displayLabel: row.displayLabel, unit: row.unit, effectiveValue: row.workspaceLimit ?? row.tenantEffectiveValue, source: row.workspaceSource === 'workspace_sub_quota' ? 'override' : 'plan', currentUsage: row.currentUsage, usageStatus: row.usageStatus, usageUnknownReason: row.usageUnknownReason }))} title="Workspace consumption" />
      {data.capabilities ? <CapabilityStatusGrid capabilities={data.capabilities.map((item) => ({ capabilityKey: item.capabilityKey, displayLabel: item.displayLabel ?? item.capabilityKey, enabled: item.enabled, source: item.source ?? 'catalog_default' }))} /> : null}
    </main>
  )
}
