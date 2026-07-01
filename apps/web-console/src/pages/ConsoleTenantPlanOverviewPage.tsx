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
  if (summary.noAssignment) return <ConsolePageState kind="empty" title="Sin plan asignado" description="Tu organización no tiene una asignación de plan actualmente. Los valores predeterminados del catálogo siguen activos." />

  const overLimitDimensionCount = summary.quotaDimensions.filter((item) => item.usageStatus === 'over_limit').length
  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">Mi plan</h1>
        <p>{summary.planDisplayName}</p>
        <p>{summary.planSlug}</p>
        <p>Última entrada del historial: {summary.latestHistoryEntryId ?? '—'}</p>
      </header>
      {overLimitDimensionCount > 0 ? <section className="rounded-3xl border border-amber-500 bg-amber-50 p-4">{overLimitDimensionCount} dimensiones están actualmente por encima del límite.</section> : null}
      <QuotaConsumptionTable title="Cuotas efectivas actuales" rows={summary.quotaDimensions.map((item) => ({ dimensionKey: item.dimensionKey, displayLabel: item.displayLabel ?? item.dimensionKey, unit: item.unit, effectiveValue: item.effectiveValue ?? -1, source: 'plan', currentUsage: item.observedUsage ?? null, usageStatus: item.usageStatus, usageUnknownReason: item.usageUnknownReason }))} />
      <CapabilityStatusGrid capabilities={summary.capabilities.map((item) => ({ capabilityKey: item.capabilityKey, displayLabel: item.displayLabel ?? item.capabilityKey, enabled: item.enabled, source: 'plan' }))} />
    </main>
  )
}
