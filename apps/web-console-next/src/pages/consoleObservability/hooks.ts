import { useCallback, useEffect, useRef, useState } from 'react'
import { exportAudit, exportBody, failureOf, loadAuditPage, loadMetrics, type AuditFilters, type ExportBody, type ExportResult, type Failure, type MetricWindow, type Scope } from './api'
import { isManifest, normalizeAuditPage, normalizeMetrics, type AuditRecord, type Manifest, type MetricsView } from './model'

// Every result is tagged with the scope key (and filters) it was requested for plus a generation number.
// A response is applied only while its tag is still the current one, so a late reply for an old tenant,
// workspace, window or filter set is neither rendered nor appended.
export const scopeKey = (scope: Scope | null) => scope ? `${scope.tenantId}|${scope.workspaceId ?? ''}` : ''

type MetricsData = { key: string; gen: number } & ({ status: 'loading' } | { status: 'ready'; view: MetricsView } | { status: 'error'; failure: Failure })
export function useMetrics(scope: Scope | null, window: MetricWindow) {
  const applied = scope?.workspaceId ? window : null
  const key = scope ? `${scopeKey(scope)}|${applied ?? 'tenant'}` : ''
  const [data, setData] = useState<MetricsData | null>(null)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  useEffect(() => {
    if (!scope) { setData(null); return }
    const gen = ++generation.current
    setData({ key, gen, status: 'loading' })
    void loadMetrics(scope, applied).then(
      ({ overview, usage, series }) => { if (gen === generation.current) setData({ key, gen, status: 'ready', view: normalizeMetrics(overview, usage, series) }) },
      (cause: unknown) => { if (gen === generation.current) setData({ key, gen, status: 'error', failure: failureOf(cause) }) })
    return () => { generation.current++ }
  }, [key, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => setAttempt((count) => count + 1), [])
  return { data: data?.key === key ? data : null, retry }
}

export interface AuditData {
  key: string; gen: number; status: 'loading' | 'ready' | 'error'; failure?: Failure
  records: AuditRecord[]; nextCursor: string | null; hasMore: boolean
  more: { status: 'idle' | 'loading' | 'error'; failure?: Failure }; append: { seq: number; count: number }
}
export function useAudit(scope: Scope | null, filters: AuditFilters) {
  const key = scope ? `${scopeKey(scope)}|${JSON.stringify(filters)}` : ''
  const [data, setData] = useState<AuditData | null>(null)
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const latest = useRef({ data, scope, filters, key })
  latest.current = { data, scope, filters, key }
  useEffect(() => {
    if (!scope) { setData(null); return }
    const gen = ++generation.current
    const base = { key, gen, records: [], nextCursor: null, hasMore: false, more: { status: 'idle' as const }, append: { seq: 0, count: 0 } }
    setData({ ...base, status: 'loading' })
    void loadAuditPage(scope, filters).then(
      (response) => { if (gen === generation.current) setData({ ...base, ...normalizeAuditPage(response), status: 'ready' }) },
      (cause: unknown) => { if (gen === generation.current) setData({ ...base, status: 'error', failure: failureOf(cause) }) })
    return () => { generation.current++ }
  }, [key, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => setAttempt((count) => count + 1), [])
  // The cursor, filters and scope are those of the loaded pages; a failure leaves rows, cursor and counts unchanged.
  const loadMore = useCallback((cursor?: string) => {
    const { data: current, scope: target, filters: applied, key: currentKey } = latest.current
    if (!current || !target || current.key !== currentKey || current.status !== 'ready' || current.more.status === 'loading') return
    const after = cursor ?? current.nextCursor
    if (!after) return
    const { gen } = current
    const pending = (next: (data: AuditData) => AuditData) => setData((data) => data && data.gen === gen ? next(data) : data)
    pending((data) => ({ ...data, more: { status: 'loading' } }))
    void loadAuditPage(target, applied, after).then(
      (response) => {
        const page = normalizeAuditPage(response)
        pending((data) => ({ ...data, records: [...data.records, ...page.records], nextCursor: page.nextCursor, hasMore: page.hasMore, more: { status: 'idle' }, append: { seq: data.append.seq + 1, count: page.records.length } }))
      },
      (cause: unknown) => pending((data) => ({ ...data, more: { status: 'error', failure: failureOf(cause) } })))
  }, [])
  return { data: data?.key === key ? data : null, retry, loadMore }
}

export interface ExportSnapshot { scope: Scope; body: ExportBody }
export type ExportState = { scopeKey: string; gen: number; snapshot: ExportSnapshot } &
  ({ status: 'running' } | { status: 'manifest'; manifest: Manifest & Record<string, unknown> } | { status: 'unavailable'; result: ExportResult } | { status: 'error'; failure: Failure })
export function useExport(scope: Scope | null, filters: AuditFilters) {
  const key = scopeKey(scope)
  const [state, setState] = useState<ExportState | null>(null)
  const generation = useRef(0)
  const latest = useRef({ scope, filters, state })
  latest.current = { scope, filters, state }
  // A scope switch discards feedback and orphans any request still in flight.
  useEffect(() => { generation.current++; setState(null) }, [key])
  const run = useCallback((snapshot: ExportSnapshot) => {
    const gen = ++generation.current
    const tag = scopeKey(snapshot.scope)
    const settle = (next: { status: 'manifest'; manifest: Manifest & Record<string, unknown> } | { status: 'unavailable'; result: ExportResult } | { status: 'error'; failure: Failure }) => {
      if (gen === generation.current) setState({ scopeKey: tag, gen, snapshot, ...next })
    }
    setState({ scopeKey: tag, gen, snapshot, status: 'running' })
    void exportAudit(snapshot.scope, snapshot.body).then(
      (result) => settle(isManifest(result) ? { status: 'manifest', manifest: result } : { status: 'unavailable', result }),
      (cause: unknown) => settle({ status: 'error', failure: failureOf(cause) }))
  }, [])
  const start = useCallback(() => {
    const { scope: target, filters: applied } = latest.current
    if (target) run({ scope: target, body: exportBody(applied) })
  }, [run])
  // Re-POST exactly the body and scope of the failed attempt, whatever the filters are now.
  const retry = useCallback(() => { const current = latest.current.state; if (current?.status === 'error') run(current.snapshot) }, [run])
  return { state: state?.scopeKey === key ? state : null, start, retry }
}
