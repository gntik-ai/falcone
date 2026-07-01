// Console flow run-history list page (change: add-console-flow-monitoring / #366).
//
// A paginated, filterable list of a flow's executions. Filters: flowVersion, status, triggerType,
// and an ISO time range (startedAfter / startedBefore). The list is STRICTLY tenant-scoped — the
// #361 list endpoint AND-joins the verified tenant/workspace into the Temporal visibility query
// and strips any client tenantId clause, so these filters can only narrow the result set. Paging
// uses the continuation token from the list response.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

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

function HistoryList({ workspaceId, flowId }: { workspaceId: string; flowId: string }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS)
  const [items, setItems] = useState<ExecutionSummary[]>([])
  const [pageStack, setPageStack] = useState<string[]>([]) // continuation tokens consumed so far
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
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
        <p className="text-xs text-destructive" data-testid="run-history-error">
          {error}
        </p>
      ) : null}

      {isEmpty ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="run-history-empty">
          No hay ejecuciones que coincidan con los filtros aplicados.
        </p>
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
                  <td className="hidden px-4 py-3 sm:table-cell">{item.status ?? '—'}</td>
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
  const { flowId } = useParams<{ flowId: string }>()
  const { activeWorkspaceId } = useConsoleContext()

  if (!flowId) {
    return <p className="p-6 text-sm text-muted-foreground">Falta el identificador del flujo.</p>
  }
  if (!activeWorkspaceId) {
    return <p className="p-6 text-sm text-muted-foreground">Selecciona un área de trabajo para ver el historial de ejecuciones.</p>
  }

  return <HistoryList workspaceId={activeWorkspaceId} flowId={flowId} />
}
