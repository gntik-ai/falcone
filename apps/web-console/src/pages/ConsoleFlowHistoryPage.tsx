// Console flow run-history list page (change: add-console-flow-monitoring / #366).
//
// A paginated, filterable list of a flow's executions. Filters: flowVersion, status, triggerType,
// and an ISO time range (startedAfter / startedBefore). The list is STRICTLY tenant-scoped — the
// #361 list endpoint AND-joins the verified tenant/workspace into the Temporal visibility query
// and strips any client tenantId clause, so these filters can only narrow the result set. Paging
// uses the continuation token from the list response.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useConsoleContext } from '@/lib/console-context'
import {
  listExecutions,
  type ExecutionListFilters,
  type ExecutionSummary
} from '@/services/flowsMonitoringApi'

const STATUS_OPTIONS = ['', 'Running', 'Completed', 'Failed', 'Canceled', 'Terminated', 'TimedOut']
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
        setError(caught instanceof Error ? caught.message : 'Failed to load runs')
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
          Flows
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-base font-semibold">Run history</h1>
        <span className="text-xs text-muted-foreground">{flowId}</span>
      </header>

      <section className="flex flex-wrap items-end gap-2" data-testid="run-history-filters">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Version</span>
          <Input
            className="h-9 w-28 text-xs"
            value={filters.flowVersion}
            onChange={(event) => setFilter('flowVersion')(event.target.value)}
            data-testid="filter-flow-version"
            placeholder="any"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Status</span>
          <Select
            className="h-9 w-36 text-xs"
            value={filters.status}
            onChange={(event) => setFilter('status')(event.target.value)}
            data-testid="filter-status"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === '' ? 'Any status' : option}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Trigger</span>
          <Select
            className="h-9 w-36 text-xs"
            value={filters.triggerType}
            onChange={(event) => setFilter('triggerType')(event.target.value)}
            data-testid="filter-trigger-type"
          >
            {TRIGGER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === '' ? 'Any trigger' : option}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Started after</span>
          <Input
            type="datetime-local"
            className="h-9 w-48 text-xs"
            value={filters.startedAfter}
            onChange={(event) => setFilter('startedAfter')(event.target.value)}
            data-testid="filter-started-after"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Started before</span>
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
          No executions match the applied filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-sm" data-testid="run-history-table">
            <caption className="sr-only">Flow run history</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2">Execution</th>
                <th scope="col" className="py-2">Status</th>
                <th scope="col" className="py-2">Trigger</th>
                <th scope="col" className="py-2">Version</th>
                <th scope="col" className="py-2">Started</th>
                <th scope="col" className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.executionId} className="border-b border-border/60" data-testid="run-history-row">
                  <td className="py-2 font-mono text-xs" title={item.executionId}>
                    {item.executionId.slice(0, 32)}…
                  </td>
                  <td className="py-2">{item.status ?? '—'}</td>
                  <td className="py-2">{item.triggerType ?? '—'}</td>
                  <td className="py-2">{item.version ?? '—'}</td>
                  <td className="py-2 text-xs text-muted-foreground">{item.startedAt ?? '—'}</td>
                  <td className="py-2 text-right">
                    <Link
                      className="text-xs text-primary hover:underline"
                      to={`/console/flows/${encodeURIComponent(flowId)}/runs/${encodeURIComponent(item.executionId)}`}
                      aria-label={`Open details for run ${item.executionId}`}
                    >
                      Open details
                    </Link>
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
          Previous
        </Button>
        <span className="text-xs text-muted-foreground">{loading ? 'Loading…' : `${items.length} runs`}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={onNextPage}
          disabled={loading || !nextPageToken}
          data-testid="run-history-next"
        >
          Next
        </Button>
      </footer>
    </div>
  )
}

export function ConsoleFlowHistoryPage() {
  const { flowId } = useParams<{ flowId: string }>()
  const { activeWorkspaceId } = useConsoleContext()

  if (!flowId) {
    return <p className="p-6 text-sm text-muted-foreground">Missing flow identifier.</p>
  }
  if (!activeWorkspaceId) {
    return <p className="p-6 text-sm text-muted-foreground">Select a workspace to view run history.</p>
  }

  return <HistoryList workspaceId={activeWorkspaceId} flowId={flowId} />
}
