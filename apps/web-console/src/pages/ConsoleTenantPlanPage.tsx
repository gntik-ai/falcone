import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Button } from '@/components/ui/button'
import { PlanAssignmentDialog } from '@/components/console/PlanAssignmentDialog'
import { PlanImpactHistoryTable } from '@/components/console/PlanImpactHistoryTable'
import * as api from '@/services/planManagementApi'

export function ConsoleTenantPlanPage() {
  const { tenantId = '' } = useParams()
  const [data, setData] = useState<any>(null)
  const [history, setHistory] = useState<api.PaginationEnvelope<api.PlanChangeHistoryEntry>>({ items: [], total: 0, page: 1, pageSize: 20 })
  const [plans, setPlans] = useState<api.PlanRecord[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  useEffect(() => {
    api.getTenantCurrentPlan(tenantId).then(setData)
    api.getPlanChangeHistory(tenantId).then(setHistory)
    api.listPlans({ status: 'active' }).then((response) => setPlans(response.items))
  }, [tenantId])
  if (!data) return <ConsolePageState kind="loading" title="Loading tenant plan" description="Fetching assignment and impact history." />
  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6">
        <h1 className="text-2xl font-semibold">Tenant plan</h1>
        <p>{data?.plan?.displayName ?? 'No plan assigned'}</p>
        <Button type="button" onClick={() => setDialogOpen(true)}>{data?.assignment ? 'Change plan' : 'Assign plan'}</Button>
      </header>
      <PlanImpactHistoryTable items={history.items} />
      <PlanAssignmentDialog open={dialogOpen} tenantId={tenantId} currentPlanId={data?.assignment?.planId ?? null} activePlans={plans.map((plan) => ({ id: plan.id, displayName: plan.displayName, status: plan.status }))} onConfirm={async (planId) => { await api.assignPlan(tenantId, { planId, assignedBy: 'console' }); setDialogOpen(false) }} onCancel={() => setDialogOpen(false)} />
    </main>
  )
}
