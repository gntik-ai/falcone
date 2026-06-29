import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Button } from '@/components/ui/button'
import { PlanStatusBadge } from '@/components/console/PlanStatusBadge'
import * as api from '@/services/planManagementApi'

export function ConsolePlanCatalogPage() {
  const navigate = useNavigate()
  const [state, setState] = useState({ items: [] as api.PlanRecord[], total: 0, page: 1, pageSize: 20, loading: true, error: '' as string | null, status: 'all' as api.PlanStatus | 'all' })
  useEffect(() => { api.listPlans({ status: state.status, page: state.page, pageSize: state.pageSize }).then((response) => setState((current) => ({ ...current, ...response, loading: false, error: null }))).catch((error) => setState((current) => ({ ...current, loading: false, error: error.message ?? 'Error' }))) }, [state.page, state.pageSize, state.status])
  if (state.loading) return <ConsolePageState kind="loading" title="Loading plans" description="Fetching plan catalog." />
  if (state.error) return <ConsolePageState kind="error" title="Failed to load plans" description={state.error} />
  if (!state.items.length) return <ConsolePageState kind="empty" title="No plans found" description="Create your first plan." actionLabel="Create plan" onAction={() => navigate('/console/plans/new')} />
  return (
    <main className="space-y-6">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Plan catalog</h1>
            <p className="text-sm text-muted-foreground">Review, filter, and open the platform billing plans available to tenants.</p>
          </div>
          <Button type="button" onClick={() => navigate('/console/plans/new')}>Create Plan</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="space-y-2 text-sm" htmlFor="plan-status-filter">
            <span className="font-medium text-foreground">Filter by status</span>
            <select
              id="plan-status-filter"
              aria-label="status-filter"
              className="block w-48 rounded-xl border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              value={state.status}
              onChange={(e) => { const status = e.currentTarget.value as api.PlanStatus | 'all'; setState((current) => ({ ...current, status, page: 1 })) }}
            >
              <option value="all">All</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="deprecated">Deprecated</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">
            {state.total} {state.total === 1 ? 'plan' : 'plans'}
          </p>
        </div>
      </header>
      <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <table className="min-w-full divide-y divide-border text-sm" aria-label="Plan catalog">
          <thead className="bg-muted/40">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">Slug</th>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Assigned</th>
              <th scope="col" className="px-4 py-3 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {state.items.map((plan) => (
              <tr
                key={plan.id}
                className="cursor-pointer transition-colors hover:bg-accent/40 focus-within:bg-accent/40"
                onClick={() => navigate(`/console/plans/${plan.id}`)}
              >
                <td className="px-4 py-4 font-medium text-foreground">
                  <Link
                    to={`/console/plans/${plan.id}`}
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {plan.slug}
                  </Link>
                </td>
                <td className="px-4 py-4 text-foreground">{plan.displayName}</td>
                <td className="px-4 py-4"><PlanStatusBadge status={plan.status} /></td>
                <td className="px-4 py-4 text-muted-foreground">{plan.assignedTenantCount ?? 0}</td>
                <td className="px-4 py-4 text-muted-foreground">{plan.updatedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}
