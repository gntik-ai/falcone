// Console flow run-history list page (change: add-console-flow-monitoring / #366).
//
// A paginated, filterable list of a flow's executions. Filters: flowVersion, status, triggerType,
// and an ISO time range (startedAfter / startedBefore). The list is STRICTLY tenant-scoped — the
// #361 list endpoint AND-joins the verified tenant/workspace into the Temporal visibility query
// and strips any client tenantId clause, so these filters can only narrow the result set. Paging
// uses the continuation token from the list response.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import { ConsolePageState } from '@/components/console/ConsolePageState'
import { WorkspaceRequiredState } from '@/components/console/WorkspaceRequiredState'
import { RunStatusBadge } from '@/components/flows/FlowStatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConsoleContext } from '@/lib/console-context'
import {
  listExecutions,
  type ExecutionListFilters,
  type ExecutionSummary
} from '@/services/flowsMonitoringApi'

const STATUS_OPTIONS = [
  { value: '', label: 'Cualquier estado' },
  { value: 'Running', label: 'En ejecución' },
  { value: 'Completed', label: 'Completada' },
  { value: 'Failed', label: 'Fallida' },
  { value: 'Canceled', label: 'Cancelada' },
  { value: 'Terminated', label: 'Terminada' },
  { value: 'TimedOut', label: 'Expirada' }
]
const TRIGGER_OPTIONS = ['', 'manual', 'cron', 'webhook', 'platform_event']

interface FilterState {
  flowVersion: string
  status: string
  triggerType: string
  startedAfter: string
  startedBefore: string
}

const EMPTY_FILTERS: FilterState = {
  flowVersion: '',
  status: '',
  triggerType: '',
  startedAfter: '',
  startedBefore: ''
}

interface FlowTriggerLocationState {
  flowTrigger?: {
    flowId: string
    scheduleId: string
    triggeredAt: string
  }
}

function HistoryList({ workspaceId, flowId }: { workspaceId: string; flowId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [items, setItems] = useState<ExecutionSummary[]>([])
  const [pageStack, setPageStack] = useState<string[]>([]) // continuation tokens consumed so far
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const buildQuery = useCallback(
    (pageToken?: string): ExecutionListFilters => ({
      flowId,
      flowVersion: filters.flowVersion || undefined,
      status: filters.status || undefined,
      triggerType: filters.triggerType || undefined,
      startedAfter: filters.startedAfter || undefined,
      startedBefore: filters.startedBefore || undefined,
      pageToken
    }),
    [flowId, filters]
  )

  const fetchPage = useCallback(
    async (pageToken?: string) => {
      setLoading(true)
      setError(null)
      try {
        const response = await listExecutions(workspaceId, buildQuery(pageToken))
        setItems(response.items ?? [])
        setNextPageToken(response.nextPageToken ?? null)
        setLoaded(true)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'No se pudieron cargar las ejecuciones')
      } finally {
        setLoading(false)
      }
    },
    [workspaceId, buildQuery]
  )

  // Re-query whenever the applied filters change, resetting pagination.
  useEffect(() => {
    setPageStack([])
    void fetchPage(undefined)
  }, [fetchPage])

  const setFilter = (key: keyof FilterState) => (value: string) =>
    setFilters((current) => ({ ...current, [key]: value }))

  const onNextPage = () => {
    if (!nextPageToken) return
    setPageStack((stack) => [...stack, nextPageToken])
    void fetchPage(nextPageToken)
  }

  const onPrevPage = () => {
    if (pageStack.length === 0) return
    const prevStack = pageStack.slice(0, -1)
    setPageStack(prevStack)
    void fetchPage(prevStack.at(-1))
  }

  const isEmpty = useMemo(() => loaded && !loading && items.length === 0, [loaded, loading, items])
  const filtersActive = useMemo(() => Object.values(filters).some(Boolean), [filters])
  const triggerNotice = (location.state as FlowTriggerLocationState | null)?.flowTrigger
  const showTriggerNotice = triggerNotice?.flowId === flowId
  const clearFilters = () => setFilters(EMPTY_FILTERS)

  return (
    <div className="space-y-4 p-4" data-testid="console-flow-history-page">
      <header className="flex flex-wrap items-center gap-2">
        <Link className="text-sm text-muted-foreground hover:underline" to="/console/flows">
          Flujos
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-base font-semibold">Historial de ejecuciones</h1>
        <span className="text-xs text-muted-foreground">{flowId}</span>
      </header>

      {showTriggerNotice ? (
        <section
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm shadow-sm"
          role="status"
          data-testid="flow-trigger-success"
        >
          <p className="font-medium text-foreground">Ejecución solicitada.</p>
          <p className="mt-1 text-muted-foreground">
            El disparo fue aceptado para el schedule <span className="font-mono">{triggerNotice.scheduleId}</span>. Actualiza el historial y abre el detalle cuando aparezca la nueva ejecución.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
            onClick={() => void fetchPage(pageStack.at(-1))}
            disabled={loading}
          >
            Actualizar historial
          </Button>
        </section>
      ) : null}

      <section className="flex flex-wrap items-end gap-2" data-testid="run-history-filters">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Versión</span>
          <Input
            className="h-9 w-28 text-xs"
            value={filters.flowVersion}
            onChange={(event) => setFilter('flowVersion')(event.target.value)}
            data-testid="filter-flow-version"
            placeholder="cualquiera"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Estado</span>
          <Select
            className="h-9 w-36 text-xs"
            value={filters.status}
            onChange={(event) => setFilter('status')(event.target.value)}
            data-testid="filter-status"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Disparador</span>
          <Select
            className="h-9 w-36 text-xs"
            value={filters.triggerType}
            onChange={(event) => setFilter('triggerType')(event.target.value)}
            data-testid="filter-trigger-type"
          >
            {TRIGGER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === '' ? 'Cualquier disparador' : option}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Iniciada después de</span>
          <Input
            type="datetime-local"
            className="h-9 w-48 text-xs"
            value={filters.startedAfter}
            onChange={(event) => setFilter('startedAfter')(event.target.value)}
            data-testid="filter-started-after"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Iniciada antes de</span>
          <Input
            type="datetime-local"
            className="h-9 w-48 text-xs"
            value={filters.startedBefore}
            onChange={(event) => setFilter('startedBefore')(event.target.value)}
            data-testid="filter-started-before"
          />
        </label>
      </section>

      {error ? (
        <ConsolePageState
          kind="error"
          title="No se pudieron cargar las ejecuciones"
          description={error}
          actionLabel="Reintentar"
          onAction={() => void fetchPage(pageStack.at(-1))}
        />
      ) : null}

      {error ? null : loading && !loaded ? (
        <ConsolePageState
          kind="loading"
          title="Cargando historial"
          description="Consultando ejecuciones del flujo seleccionado."
        />
      ) : isEmpty ? (
        <div data-testid="run-history-empty">
          <ConsolePageState
            kind="empty"
            title={filtersActive ? 'No hay ejecuciones con estos filtros' : 'Todavía no hay ejecuciones'}
            description={
              filtersActive
                ? 'No hay ejecuciones que coincidan con los filtros aplicados.'
                : 'Ejecuta un flujo publicado y actualiza este historial para abrir el detalle de la ejecución cuando aparezca.'
            }
            actionLabel={filtersActive ? 'Quitar filtros' : 'Abrir diseñador'}
            onAction={filtersActive ? clearFilters : () => navigate(`/console/flows/${encodeURIComponent(flowId)}`)}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full table-fixed border-collapse text-sm sm:min-w-[48rem] sm:table-auto" data-testid="run-history-table">
            <caption className="sr-only">Historial de ejecuciones del flujo</caption>
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Ejecución</th>
                <th scope="col" className="hidden w-28 px-4 py-3 font-medium sm:table-cell">Estado</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Disparador</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Versión</th>
                <th scope="col" className="hidden px-4 py-3 font-medium sm:table-cell">Inicio</th>
                <th scope="col" className="w-36 px-4 py-3 text-right font-medium sm:w-auto">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.executionId} className="border-t border-border transition-colors hover:bg-muted/20" data-testid="run-history-row">
                  <td className="px-4 py-3 font-mono text-xs" title={item.executionId}>
                    <span className="block max-w-[8rem] truncate sm:max-w-none">{item.executionId.slice(0, 32)}…</span>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <RunStatusBadge status={item.status} />
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">{item.triggerType ?? '—'}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">{item.version ?? '—'}</td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground sm:table-cell">{item.startedAt ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" className="w-full justify-start sm:w-auto sm:justify-center" asChild>
                      <Link
                        to={`/console/flows/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(item.executionId)}`}
                        aria-label={`Abrir detalles de ejecución ${item.executionId}`}
                      >
                        Abrir detalles
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="flex items-center justify-between">
        <Button
          size="sm"
          variant="outline"
          onClick={onPrevPage}
          disabled={loading || pageStack.length === 0}
          data-testid="run-history-prev"
        >
          Anterior
        </Button>
        <span className="text-xs text-muted-foreground">{loading ? 'Cargando…' : `${items.length} ejecuciones`}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={onNextPage}
          disabled={loading || !nextPageToken}
          data-testid="run-history-next"
        >
          Siguiente
        </Button>
      </footer>
    </div>
  )
}

export function ConsoleFlowHistoryPage() {
  const navigate = useNavigate()
  const { flowId } = useParams<{ flowId: string }>()
  const { activeWorkspaceId } = useConsoleContext()

  if (!flowId) {
    return (
      <section className="p-6">
        <ConsolePageState
          kind="blocked"
          title="Historial bloqueado"
          description="Falta el identificador del flujo."
          actionLabel="Volver a Flujos"
          onAction={() => navigate('/console/flows')}
        />
      </section>
    )
  }
  if (!activeWorkspaceId) {
    return (
      <section className="p-6">
        <WorkspaceRequiredState title="Historial bloqueado" description="Selecciona un área de trabajo para ver el historial de ejecuciones." />
      </section>
    )
  }

  return <HistoryList workspaceId={activeWorkspaceId} flowId={flowId} />
}
