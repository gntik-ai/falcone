import { useCallback, useEffect, useRef, useState } from 'react'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { QueryError, OperationStatus } from '../operationDetail/query'

export interface OperationSummary {
  operationId: string; status: OperationStatus; operationType: string; tenantId: string
  workspaceId: string | null; actorId: string; actorType: string; createdAt: string; updatedAt: string; correlationId: string
}
export interface OperationFilters {
  status?: OperationStatus | OperationStatus[]; operationType?: string; workspaceId?: string; tenantId?: string
}
export interface OperationListResponse {
  queryType: 'list'; items: OperationSummary[]; total: number; pagination: { limit: number; offset: number }
}
export const PAGE_SIZE = 20
export function listOperations(filters: OperationFilters, offset = 0, limit = PAGE_SIZE, signal?: AbortSignal) {
  return requestConsoleSessionJson<OperationListResponse>('/v1/async-operation-query', {
    method: 'POST', body: { queryType: 'list', filters: { ...filters }, pagination: { limit, offset } }, idempotent: true, signal,
  })
}
export function normalizeFilters(status: string, operationType: string, workspaceId: string): OperationFilters {
  return { status: (status || undefined) as OperationStatus | undefined, operationType: operationType.trim() || undefined, workspaceId: workspaceId.trim() || undefined }
}
export function operationTypes(items: OperationSummary[]) { return Array.from(new Set(items.map((item) => item.operationType))).sort() }
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = window.setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}
export function useOperations(filters: OperationFilters, offset: number) {
  const [data, setData] = useState<OperationListResponse>()
  const [error, setError] = useState<QueryError | null>(null)
  const [busy, setBusy] = useState(true)
  const controller = useRef<AbortController | null>(null)
  const poll = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const key = JSON.stringify(filters)
  const run = useCallback(async (manual = false) => {
    clearTimeout(poll.current)
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setBusy(true)
    // Keep the failed retry control and stale data mounted until recovery.
    if (!manual) setError(null)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await listOperations(JSON.parse(key) as OperationFilters, offset, PAGE_SIZE, next.signal)
        if (next.signal.aborted) return false
        setData(response); setError(null); setBusy(false)
        if (response.items.some((item) => item.status === 'pending' || item.status === 'running')) {
          poll.current = setTimeout(() => { void run() }, 30_000)
        }
        return true
      } catch (cause) {
        if (next.signal.aborted) return false
        const failure = cause as QueryError
        if (failure.status === 401 || attempt === 2) {
          setError(failure); setBusy(false)
          return false
        }
        await delay([1000, 3000][attempt], next.signal)
        if (next.signal.aborted) return false
      }
    }
    return false
  }, [key, offset])
  useEffect(() => {
    void run()
    return () => { controller.current?.abort(); clearTimeout(poll.current) }
  }, [run])
  const refetch = useCallback(() => run(true), [run])
  return { data, error, busy, isLoading: busy && !data, refetch }
}
