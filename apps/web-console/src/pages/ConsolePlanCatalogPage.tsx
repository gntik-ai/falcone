import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ConsolePageState } from '@/components/console/ConsolePageState'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PlanStatusBadge } from '@/components/console/PlanStatusBadge'
import * as api from '@/services/planManagementApi'
import { ArrowRight } from 'lucide-react'

const statusFilterLabels: Record<api.PlanStatus | 'all', string> = {
  all: 'Todos',
  draft: 'Borrador',
  active: 'Activo',
  deprecated: 'Obsoleto',
  archived: 'Archivado'
}

export function ConsolePlanCatalogPage() {
  const navigate = useNavigate()
  const [state, setState] = useState({ items: [] as api.PlanRecord[], total: 0, page: 1, pageSize: 20, loading: true, error: '' as string | null, status: 'all' as api.PlanStatus | 'all' })

  useEffect(() => {
    let cancelled = false

    setState((current) => ({ ...current, loading: true, error: null }))
    api.listPlans({ status: state.status, page: state.page, pageSize: state.pageSize })
      .then((response) => {
        if (!cancelled) setState((current) => ({ ...current, ...response, loading: false, error: null }))
      })
      .catch((error) => {
        if (!cancelled) setState((current) => ({ ...current, loading: false, error: error.message ?? 'Error' }))
      })

    return () => {
      cancelled = true
    }
  }, [state.page, state.pageSize, state.status])

  if (state.loading) return <ConsolePageState kind="loading" title="Cargando planes" description="Consultando el catálogo de planes." />
  if (state.error) return <ConsolePageState kind="error" title="No se pudieron cargar los planes" description={state.error} />
  if (!state.items.length && state.status === 'all') return <ConsolePageState kind="empty" title="No se encontraron planes" description="Crea el primer plan." actionLabel="Crear plan" onAction={() => navigate('/console/plans/new')} />

  function clearStatusFilter() {
    setState((current) => ({ ...current, status: 'all', page: 1, loading: true, error: null }))
  }

  return (
    <section className="space-y-6" aria-labelledby="plan-catalog-heading">
      <header className="rounded-3xl border border-border bg-card/70 p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 id="plan-catalog-heading" className="text-2xl font-semibold tracking-tight text-foreground">Catálogo de planes</h1>
            <p className="text-sm text-muted-foreground">Revisa, filtra y abre los planes de facturación de plataforma disponibles para organizaciones.</p>
          </div>
          <Button type="button" onClick={() => navigate('/console/plans/new')}>Crear plan</Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="space-y-2 text-sm" htmlFor="plan-status-filter">
            <span className="font-medium text-foreground">Filtrar por estado</span>
            <Select
              id="plan-status-filter"
              aria-label="Filtro de estado"
              className="w-48"
              value={state.status}
              onChange={(e) => { const status = e.currentTarget.value as api.PlanStatus | 'all'; setState((current) => ({ ...current, status, page: 1, loading: true, error: null })) }}
            >
              <option className="bg-card text-foreground" value="all">{statusFilterLabels.all}</option>
              <option className="bg-card text-foreground" value="draft">{statusFilterLabels.draft}</option>
              <option className="bg-card text-foreground" value="active">{statusFilterLabels.active}</option>
              <option className="bg-card text-foreground" value="deprecated">{statusFilterLabels.deprecated}</option>
              <option className="bg-card text-foreground" value="archived">{statusFilterLabels.archived}</option>
            </Select>
          </label>
          <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">
            {state.total} {state.total === 1 ? 'plan' : 'planes'}
          </p>
        </div>
      </header>
      {state.items.length ? (
        <Table aria-label="Catálogo de planes" containerClassName="bg-card shadow-sm">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Slug</TableHead>
              <TableHead scope="col">Nombre</TableHead>
              <TableHead scope="col">Estado</TableHead>
              <TableHead scope="col" className="text-right">Asignados</TableHead>
              <TableHead scope="col">Actualizado</TableHead>
              <TableHead scope="col" className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((plan) => (
              <TableRow
                key={plan.id}
                className="transition-colors hover:bg-accent/40 focus-within:bg-accent/40"
              >
                <TableCell className="py-4 font-medium text-foreground">
                  <Link
                    to={`/console/plans/${plan.id}`}
                    className="rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {plan.slug}
                  </Link>
                </TableCell>
                <TableCell className="py-4 text-foreground">{plan.displayName}</TableCell>
                <TableCell className="py-4"><PlanStatusBadge status={plan.status} /></TableCell>
                <TableCell className="py-4 text-right tabular-nums text-foreground">{plan.assignedTenantCount ?? 0}</TableCell>
                <TableCell className="py-4 text-muted-foreground">{plan.updatedAt ?? '—'}</TableCell>
                <TableCell className="py-4 text-right">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/console/plans/${plan.id}`} aria-label={`Abrir plan ${plan.displayName}`}>
                      Abrir
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ConsolePageState
          kind="empty"
          title={`No hay planes con estado ${statusFilterLabels[state.status]}`}
          description="Cambia el filtro para volver al catálogo completo o crea un plan nuevo si necesitas ampliar la oferta."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={clearStatusFilter}>
              Ver todos los planes
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={() => navigate('/console/plans/new')}>
              Crear plan
            </Button>
          </div>
        </ConsolePageState>
      )}
    </section>
  )
}
