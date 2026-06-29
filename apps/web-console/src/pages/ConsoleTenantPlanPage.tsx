import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Button } from '@/components/ui/button'
import { PlanStatusBadge } from '@/components/console/PlanStatusBadge'
import { PlanAssignmentDialog } from '@/components/console/PlanAssignmentDialog'
import { PlanImpactHistoryTable } from '@/components/console/PlanImpactHistoryTable'
import { QuotaConsumptionTable } from '@/components/console/QuotaConsumptionTable'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantPlanPage() {
  const { tenantId = '' } = useParams()
  const [data, setData] = useState<any>(null)
  const [summary, setSummary] = useState<api.CurrentEffectiveEntitlementSummary | null>(null)
  const [history, setHistory] = useState<api.PaginationEnvelope<api.PlanChangeHistoryEntry>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [plans, setPlans] = useState<api.PlanRecord[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    // The assignment and entitlements fetches are load-bearing for the page: surface a
    // dedicated, accessible error state if either rejects (otherwise a reject would only
    // reach the route error boundary). History and the plan catalog are secondary, so
    // their failures must never block the page — swallow them to empty defaults.
    setError(null)
    api.getTenantCurrentPlan(tenantId).then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tenant plan'))
    api.getEffectiveEntitlements(tenantId, { includeConsumption: true }).then(setSummary).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load tenant entitlements'))
    api.getPlanChangeHistory(tenantId).then(setHistory).catch(() => undefined)
    api.listPlans({ status: 'active' }).then((response) => setPlans(response.items)).catch(() => undefined)
  }, [tenantId])
  if (error) return <ConsolePageState kind="error" title="Tenant plan unavailable" description={error} />
  if (!data || !summary) return <ConsolePageState kind="loading" title="Loading tenant plan" description="Fetching assignment, entitlements and impact history." />
  const planDisplayName = data?.plan?.displayName ?? null
  const planStatus = data?.plan?.status as api.PlanStatus | undefined
  const isAssigned = Boolean(data?.assignment)
  const limits = summary.quantitativeLimits ?? []
  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm" aria-labelledby="tenant-plan-heading">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" to="/console/tenants">
            Tenants
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-foreground" aria-current="page">Tenant plan</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 id="tenant-plan-heading" className="text-2xl font-semibold tracking-tight text-foreground">Tenant plan</h1>
            <p className="font-mono text-xs text-muted-foreground" title="Tenant identifier">{tenantId}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-medium text-foreground">{planDisplayName ?? 'No plan assigned'}</span>
              {planStatus ? <PlanStatusBadge status={planStatus} /> : null}
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setDialogOpen(true)}
            aria-busy={assigning}
            aria-haspopup="dialog"
          >
            {isAssigned ? 'Change plan' : 'Assign plan'}
          </Button>
        </div>
      </header>
      <section className="space-y-3" aria-labelledby="tenant-plan-entitlements-heading">
        <h2 id="tenant-plan-entitlements-heading" className="sr-only">Entitlements and consumption</h2>
        {limits.length ? (
          <QuotaConsumptionTable title="Entitlements & Consumption" showOverrideDetails rows={limits.map((item) => ({ dimensionKey: item.dimensionKey, displayLabel: item.displayLabel ?? item.dimensionKey, unit: item.unit, effectiveValue: item.effectiveValue ?? -1, source: 'plan', currentUsage: item.currentUsage ?? null, usageStatus: item.usageStatus, usageUnknownReason: item.usageUnknownReason, originalPlanValue: item.effectiveValue ?? null }))} />
        ) : (
          <div className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="font-semibold text-foreground">Entitlements &amp; Consumption</div>
            <p className="mt-2 text-sm text-muted-foreground">
              {isAssigned
                ? 'This plan defines no quantitative limits. Catalog defaults remain in effect.'
                : 'No plan is assigned, so no quantitative limits apply. Assign a plan to set entitlements.'}
            </p>
          </div>
        )}
      </section>
      <section className="space-y-3" aria-labelledby="tenant-plan-history-heading">
        <h2 id="tenant-plan-history-heading" className="sr-only">Plan change history</h2>
        <PlanImpactHistoryTable items={history.items} />
      </section>
      <PlanAssignmentDialog open={dialogOpen} tenantId={tenantId} currentPlanId={data?.assignment?.planId ?? null} activePlans={plans.map((plan) => ({ id: plan.id, displayName: plan.displayName, status: plan.status }))} onConfirm={async (planId) => { setAssigning(true); try { await api.assignPlan(tenantId, { planId, assignedBy: 'console' }); setDialogOpen(false) } finally { setAssigning(false) } }} onCancel={() => setDialogOpen(false)} />
    </main>
  )
}
