import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CapabilityStatusGrid } from '@/components/console/CapabilityStatusGrid'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { QuotaConsumptionTable } from '@/components/console/QuotaConsumptionTable'
import { readConsoleShellSession, type ConsoleShellSession } from '@/lib/console-session'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantPlanOverviewPage() {
  const navigate = useNavigate()
  const principal = readConsoleShellSession()?.principal
  const platformRoles = getPlatformRoles(principal)
  const tenantlessPlatformPrincipal = isTenantlessPlatformPrincipal(principal)
  const canOpenPlanCatalog = platformRoles.includes('superadmin')
  const [summary, setSummary] = useState<api.CurrentEffectiveEntitlementSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tenantlessPlatformPrincipal) {
      setSummary(null)
      setError(null)
      return
    }

    api.getEffectiveEntitlements(undefined, { includeConsumption: true }).then(setSummary).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load plan overview'))
  }, [tenantlessPlatformPrincipal])

  if (tenantlessPlatformPrincipal) {
    return (
      <ConsolePageState
        kind="empty"
        title="No personal tenant plan"
        description={canOpenPlanCatalog
          ? 'This platform-level account is not attached to a tenant, so there is no personal tenant plan to display. Open the plan catalog and choose a tenant plan page to review or manage tenant entitlements.'
          : 'This platform-level account is not attached to a tenant, so there is no personal tenant plan to display. Tenant entitlements are reviewed from tenant-specific plan pages when your role has access.'}
        actionLabel={canOpenPlanCatalog ? 'Open plan catalog' : undefined}
        onAction={canOpenPlanCatalog ? () => navigate('/console/plans') : undefined}
      />
    )
  }
  if (error) return <ConsolePageState kind="error" title="Plan overview unavailable" description={error} />
  if (!summary) return <ConsolePageState kind="loading" title="Loading plan overview" description="Fetching current effective entitlements." />
  if (summary.noAssignment) return <ConsolePageState kind="empty" title="No plan assigned" description="Your tenant does not currently have a plan assignment. Catalog defaults remain active." />

  const overLimitDimensionCount = summary.quotaDimensions.filter((item) => item.usageStatus === 'over_limit').length
  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">My plan</h1>
        <p>{summary.planDisplayName}</p>
        <p>{summary.planSlug}</p>
        <p>Latest history entry: {summary.latestHistoryEntryId ?? '—'}</p>
      </header>
      {overLimitDimensionCount > 0 ? <section className="rounded-3xl border border-amber-500 bg-amber-50 p-4">{overLimitDimensionCount} dimensions are currently over limit.</section> : null}
      <QuotaConsumptionTable title="Current effective quotas" rows={summary.quotaDimensions.map((item) => ({ dimensionKey: item.dimensionKey, displayLabel: item.displayLabel ?? item.dimensionKey, unit: item.unit, effectiveValue: item.effectiveValue ?? -1, source: 'plan', currentUsage: item.observedUsage ?? null, usageStatus: item.usageStatus, usageUnknownReason: item.usageUnknownReason }))} />
      <CapabilityStatusGrid capabilities={summary.capabilities.map((item) => ({ capabilityKey: item.capabilityKey, displayLabel: item.displayLabel ?? item.capabilityKey, enabled: item.enabled, source: 'plan' }))} />
    </main>
  )
}

function isTenantlessPlatformPrincipal(principal: ConsoleShellSession['principal'] | undefined): boolean {
  const roles = getPlatformRoles(principal)
  const tenantIds = Array.isArray(principal?.tenantIds) ? principal.tenantIds.filter(Boolean) : []
  const isPlatformPrincipal = roles.includes('superadmin') || roles.includes('platform_admin') || roles.includes('platform_operator')

  return isPlatformPrincipal && tenantIds.length === 0
}

function getPlatformRoles(principal: ConsoleShellSession['principal'] | undefined): string[] {
  return Array.isArray(principal?.platformRoles) ? principal.platformRoles : []
}
