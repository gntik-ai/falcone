import type { ApiError, JsonValue } from '@in-falcone/console-api/http'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

// Same method, path, query and payload shape as apps/web-console/src/lib/console-metrics.ts:252-366.
// GET /v1/metrics/tenants/{}/series is deliberately absent: the legacy page never sends it.
export type MetricWindow = '24h' | '7d' | '30d'
export const metricWindows: MetricWindow[] = ['24h', '7d', '30d']
export interface Scope { tenantId: string; workspaceId: string | null }
export interface AuditFilters { actorId: string; category: string; result: '' | 'success' | 'failure'; from: string; to: string }
export const emptyFilters: AuditFilters = { actorId: '', category: '', result: '', from: '', to: '' }
export type Failure = { status?: number; requestId: string }

export interface OverviewResponse {
  generatedAt?: string
  overallPosture?: string
  hardLimitDimensions?: string[]
  dimensions?: Array<{ dimensionId?: string; displayName?: string; measuredValue?: number; hardLimit?: number | null
    policyMode?: 'enforced' | 'unbounded' | 'not_enforced'; freshnessStatus?: 'fresh' | 'degraded' | 'unavailable'; unit?: string }>
}
export interface UsageResponse {
  measuredAt?: string
  dimensions?: Array<{ metricKey?: string; dimensionId?: string; value?: number; measuredValue?: number; points?: Array<{ timestamp?: string; value?: number }> }>
}
export interface SeriesResponse { points?: Array<{ timestamp?: string; value?: number }> }
export interface AuditCollectionResponse {
  items?: Array<Record<string, any>>
  page?: { hasMore?: boolean; nextCursor?: string | null }
}
export interface ExportBody {
  filters: { actorId?: string; actionCategory?: string; outcome?: string; occurredAfter?: string; occurredBefore?: string }
}
export type ExportResult = Record<string, unknown> | null

export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined, requestId: error.requestId ?? error.correlationId ?? '' }
}
const base = (scope: Scope) => scope.workspaceId ? `/v1/metrics/workspaces/${scope.workspaceId}` : `/v1/metrics/tenants/${scope.tenantId}`

// Overview and usage carry no query string. Only the workspace series carries the window.
export async function loadMetrics(scope: Scope, window: MetricWindow | null) {
  const root = base(scope)
  const [overview, usage, series] = await Promise.all([
    requestConsoleSessionJson<OverviewResponse>(`${root}/overview`),
    requestConsoleSessionJson<UsageResponse>(`${root}/usage`),
    scope.workspaceId && window ? requestConsoleSessionJson<SeriesResponse>(`${root}/series?metricKey=api_requests&window=${window}`) : Promise.resolve(null),
  ])
  return { overview, usage, series }
}

export async function loadAuditPage(scope: Scope, filters: AuditFilters, after?: string) {
  const search = new URLSearchParams({ 'page[size]': '50', sort: '-eventTimestamp' })
  if (filters.actorId) search.set('filter[actorId]', filters.actorId)
  if (filters.category) search.set('filter[actionCategory]', filters.category)
  if (filters.result) search.set('filter[outcome]', filters.result === 'success' ? 'succeeded' : 'failed')
  if (filters.from) search.set('filter[occurredAfter]', filters.from)
  if (filters.to) search.set('filter[occurredBefore]', filters.to)
  if (after) search.set('page[after]', after)
  return requestConsoleSessionJson<AuditCollectionResponse>(`${base(scope)}/audit-records?${search.toString()}`)
}

export function exportBody(filters: AuditFilters): ExportBody {
  return { filters: {
    actorId: filters.actorId || undefined,
    actionCategory: filters.category || undefined,
    outcome: filters.result === 'success' ? 'succeeded' : filters.result === 'failure' ? 'failed' : undefined,
    occurredAfter: filters.from || undefined,
    occurredBefore: filters.to || undefined,
  } }
}

// The body is frozen when the export starts so a retry re-sends exactly what failed.
export async function exportAudit(scope: Scope, body: ExportBody) {
  return requestConsoleSessionJson<ExportResult>(`${base(scope)}/audit-exports`, { method: 'POST', body: body as unknown as JsonValue })
}
