import { useCallback, useEffect, useRef, useState } from 'react'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { ApiError } from '@in-falcone/console-api/http'

export type OperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'
export type OperationResultType = 'success' | 'failure' | 'pending'

export interface PaginationParams { limit?: number; offset?: number }

export interface OperationDetailResponse {
  queryType: 'detail'
  operationId: string
  status: OperationStatus
  operationType: string
  tenantId: string
  workspaceId: string | null
  actorId: string
  actorType: string
  correlationId?: string
  idempotencyKey: string | null
  sagaId: string | null
  createdAt: string
  updatedAt: string
  errorSummary: { code?: string; message?: string; failedStep?: string | null } | null
}

export interface OperationLogEntry {
  logEntryId: string
  level: 'info' | 'warning' | 'error'
  message: string
  occurredAt: string
}

export interface OperationLogsResponse {
  queryType: 'logs'
  operationId: string
  entries: OperationLogEntry[]
  total: number
  pagination: Required<PaginationParams>
}

export interface OperationResultResponse {
  queryType: 'result'
  operationId: string
  status: OperationStatus
  resultType: OperationResultType
  summary: string | null
  failureReason: string | null
  retryable: boolean | null
  completedAt: string | null
}


export type QueryType = 'detail' | 'logs' | 'result'
export type QueryError = Partial<ApiError>
export const endpoint = '/v1/async-operation-query'

export function queryOperation<T>(queryType: QueryType, operationId: string, offset = 0, signal?: AbortSignal) {
  return requestConsoleSessionJson<T>(endpoint, {
    method: 'POST', body: { queryType, operationId, pagination: { limit: 20, offset } },
    idempotent: true, signal,
  })
}

export function useOperationQuery<T>(queryType: QueryType, operationId: string | undefined, offset = 0) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<QueryError | null>(null)
  const [isLoading, setLoading] = useState(Boolean(operationId))
  const [retrying, setRetrying] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const run = useCallback(async (manual = false) => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    if (!operationId) { setLoading(false); return false }
    setData(undefined) // Never present logs from an earlier offset or failed request as current.
    if (manual) setRetrying(true)
    else { setLoading(true); setError(null) }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await queryOperation<T>(queryType, operationId, offset, next.signal)
        if (next.signal.aborted) return false
        setData(response); setError(null); setLoading(false); setRetrying(false)
        return true
      } catch (cause) {
        if (next.signal.aborted) return false
        const failure = cause as QueryError
        // Session transport owns 401 refresh; other query errors retain the legacy retry delays.
        if (failure.status === 401 || attempt === 2) {
          setError(failure); setData(undefined); setLoading(false); setRetrying(false)
          return false
        }
        await new Promise<void>((resolve) => {
          const finish = () => { window.clearTimeout(timer); next.signal.removeEventListener('abort', finish); resolve() }
          const timer = window.setTimeout(finish, [1000, 3000][attempt])
          next.signal.addEventListener('abort', finish, { once: true })
        })
        if (next.signal.aborted) return false
      }
    }
    return false
  }, [queryType, operationId, offset])
  useEffect(() => { void run(); return () => controller.current?.abort() }, [run])
  const refetch = useCallback(() => run(true), [run])
  return { data, error, isLoading, retrying, refetch }
}
