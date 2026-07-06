import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CapabilityStatusGrid } from '@/components/console/CapabilityStatusGrid'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { PlanStatusBadge } from '@/components/console/PlanStatusBadge'
import { QuotaConsumptionTable } from '@/components/console/QuotaConsumptionTable'
import { describeConsoleError } from '@/lib/console-errors'
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
  const [reloadNonce, setReloadNonce] = useState(0)

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
    api.getEffectiveEntitlements(undefined, { includeConsumption: true }).then(setSummary).catch((err) => setError(describeConsoleError(err, 'No se pudo cargar el resumen del plan')))
  }, [tenantlessPlatformPrincipal, reloadNonce])

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
  if (error) return <ConsolePageState kind="error" title="Resumen del plan no disponible" description={error} actionLabel="Reintentar" onAction={() => setReloadNonce((nonce) => nonce + 1)} />
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
    <div className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mi plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">Estos son los derechos efectivos y el consumo actual de tu organización.</p>
        <dl className="mt-4 space-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Plan actual</dt>
          <dd className="flex flex-wrap items-center gap-2.5">
            <span className={summary.planSlug ? 'text-lg font-semibold leading-none text-foreground' : 'text-lg font-medium leading-none text-muted-foreground'}>{summary.planSlug ?? 'Sin plan asignado'}</span>
            {summary.planStatus ? <PlanStatusBadge status={summary.planStatus} /> : null}
          </dd>
        </dl>
      </header>
      {overLimitDimensionCount > 0 ? (
        <p role="status" className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-800 shadow-sm dark:text-amber-200">
          {overLimitDimensionCount === 1
            ? '1 dimensión está actualmente por encima del límite.'
            : `${overLimitDimensionCount} dimensiones están actualmente por encima del límite.`}
        </p>
      ) : null}
      {limits.length ? (
        <QuotaConsumptionTable title="Cuotas efectivas actuales" rows={limits.map((item) => ({ dimensionKey: item.dimensionKey, displayLabel: item.displayLabel ?? item.dimensionKey, unit: item.unit, effectiveValue: item.effectiveValue ?? -1, source: 'plan', currentUsage: item.currentUsage ?? null, usageStatus: item.usageStatus, usageUnknownReason: item.usageUnknownReason }))} />
      ) : (
        <ConsolePageState kind="empty" title="Sin cuotas" description="No se devolvieron dimensiones de cuota para tu organización. Los valores predeterminados del catálogo siguen vigentes." />
      )}
      <CapabilityStatusGrid capabilities={summary.capabilities.map((item) => ({ capabilityKey: item.capabilityKey, displayLabel: item.displayLabel ?? item.capabilityKey, enabled: item.enabled, source: 'plan' }))} />
    </div>
  )
}
