import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CapabilityStatusGrid } from '@/components/console/CapabilityStatusGrid'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { QuotaConsumptionTable } from '@/components/console/QuotaConsumptionTable'
import { getConsolePlatformRoles, isTenantlessPlatformPrincipal } from '@/lib/console-principal'
import { readConsoleShellSession } from '@/lib/console-session'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantPlanOverviewPage() {
  const navigate = useNavigate()
  const principal = readConsoleShellSession()?.principal
  const platformRoles = getConsolePlatformRoles(principal)
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

    // Load-bearing fetch: guarded with .catch() so a rejection (e.g. a superadmin or
    // otherwise tenant-less principal that slips past the check above, or any other
    // backend error) renders the accessible error state below instead of reaching the
    // route error boundary.
    setError(null)
    api.getEffectiveEntitlements(undefined, { includeConsumption: true }).then(setSummary).catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el resumen del plan'))
  }, [tenantlessPlatformPrincipal])

  if (tenantlessPlatformPrincipal) {
    return (
      <ConsolePageState
        kind="empty"
        title="Sin plan personal de organización"
        description={canOpenPlanCatalog
          ? 'Esta cuenta de nivel plataforma no está asociada a una organización, así que no hay un plan personal de organización para mostrar. Abre el catálogo de planes y elige una página de plan de organización para revisar o gestionar sus derechos.'
          : 'Esta cuenta de nivel plataforma no está asociada a una organización, así que no hay un plan personal de organización para mostrar. Los derechos de la organización se revisan desde páginas específicas de organización cuando tu rol tiene acceso.'}
        actionLabel={canOpenPlanCatalog ? 'Abrir catálogo de planes' : undefined}
        onAction={canOpenPlanCatalog ? () => navigate('/console/plans') : undefined}
      />
    )
  }
  if (error) return <ConsolePageState kind="error" title="Resumen del plan no disponible" description={error} />
  if (!summary) return <ConsolePageState kind="loading" title="Cargando resumen del plan" description="Consultando los derechos efectivos actuales." />

  // The effective-entitlements API (services/provisioning-orchestrator
  // EffectiveEntitlementProfile, served verbatim by GET /v1/tenant/plan/effective-
  // entitlements) returns per-tenant quota limits under `quantitativeLimits` (per-item
  // `currentUsage`) — there is no `quotaDimensions`/`observedUsage`/`noAssignment` field
  // on this response. Guard so an absent or empty collection renders the empty state
  // below instead of throwing. See docs/reference/architecture/console-effective-
  // entitlements-mapping.md.
  const limits = summary.quantitativeLimits ?? []
  const overLimitDimensionCount = limits.filter((item) => item.usageStatus === 'over_limit').length
  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">Mi plan</h1>
        <p>{summary.planSlug ?? 'Sin plan asignado'}</p>
      </header>
      {overLimitDimensionCount > 0 ? <section className="rounded-3xl border border-amber-500 bg-amber-50 p-4">{overLimitDimensionCount} dimensiones están actualmente por encima del límite.</section> : null}
      {limits.length ? (
        <QuotaConsumptionTable title="Cuotas efectivas actuales" rows={limits.map((item) => ({ dimensionKey: item.dimensionKey, displayLabel: item.displayLabel ?? item.dimensionKey, unit: item.unit, effectiveValue: item.effectiveValue ?? -1, source: 'plan', currentUsage: item.currentUsage ?? null, usageStatus: item.usageStatus, usageUnknownReason: item.usageUnknownReason }))} />
      ) : (
        <ConsolePageState kind="empty" title="Sin cuotas" description="No se devolvieron dimensiones de cuota para tu organización. Los valores predeterminados del catálogo siguen vigentes." />
      )}
      <CapabilityStatusGrid capabilities={summary.capabilities.map((item) => ({ capabilityKey: item.capabilityKey, displayLabel: item.displayLabel ?? item.capabilityKey, enabled: item.enabled, source: 'plan' }))} />
    </main>
  )
}
