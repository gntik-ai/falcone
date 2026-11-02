import { ensureConsoleSession, refreshConsoleShellSession, requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { requestJson, type ApiError } from '@in-falcone/console-api/http'

// Pinned to the legacy planManagementApi.ts contract (lines 290-299, 313, 314, 326-329, 342-343)
// until the plans OpenAPI is published. Paths, query order and the POST body stay field for field.
export type PlanStatus = 'draft' | 'active' | 'deprecated' | 'archived'
export type UsageStatus = 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'
export type EffectiveValueKind = 'bounded' | 'unlimited' | 'missing'
export type QuotaComparison = 'increased' | 'decreased' | 'unchanged' | 'added' | 'removed'
export type CapabilityComparison = 'enabled' | 'disabled' | 'unchanged'
export type ChangeDirection = 'upgrade' | 'downgrade' | 'lateral' | 'equivalent' | 'initial_assignment'

export const HISTORY_PAGE_SIZE = 20

export interface TenantPlanAssignment {
  assignment?: { planId?: string | null } | null
  plan?: { displayName?: string | null; status?: PlanStatus } | null
}
export interface QuantitativeLimit {
  dimensionKey: string
  displayLabel?: string
  unit?: string | null
  effectiveValue?: number | null
  source?: 'override' | 'plan' | 'catalog_default'
  quotaType?: 'hard' | 'soft'
  currentUsage?: number | null
  usageStatus: UsageStatus
  usageUnknownReason?: string | null
}
export interface EffectiveEntitlements { tenantId: string; planSlug?: string; planStatus?: PlanStatus; quantitativeLimits?: QuantitativeLimit[] }
export interface PlanQuotaImpact {
  dimensionKey: string
  displayLabel?: string
  unit?: string | null
  previousEffectiveValueKind?: EffectiveValueKind
  previousEffectiveValue?: number | null
  newEffectiveValueKind: EffectiveValueKind
  newEffectiveValue?: number | null
  comparison: QuotaComparison
  observedUsage?: number | null
  usageStatus: UsageStatus
}
export interface PlanCapabilityImpact {
  capabilityKey: string
  displayLabel?: string
  previousState?: boolean | null
  newState?: boolean | null
  comparison: CapabilityComparison
}
export interface PlanChangeHistoryEntry {
  historyEntryId: string
  tenantId: string
  previousPlanId?: string | null
  newPlanId: string
  actorId: string
  effectiveAt: string
  correlationId?: string | null
  changeReason?: string | null
  changeDirection: ChangeDirection
  usageCollectionStatus: 'complete' | 'partial' | 'unavailable'
  overLimitDimensionCount: number
  quotaImpacts: PlanQuotaImpact[]
  capabilityImpacts: PlanCapabilityImpact[]
}
export interface HistoryPage { items: PlanChangeHistoryEntry[]; total: number; page: number; pageSize: number }
export interface ActivePlan { id: string; displayName: string; status: PlanStatus }
export interface Failure { status?: number; requestId?: string; sessionRenewed?: boolean }

export function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError> & { sessionRenewed?: boolean }
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    requestId: typeof error.requestId === 'string' ? error.requestId : typeof error.correlationId === 'string' ? error.correlationId : undefined,
    ...(error.sessionRenewed ? { sessionRenewed: true } : {}),
  }
}

const planUrl = (tenantId: string) => `/v1/tenants/${tenantId}/plan`

export function getTenantPlan(tenantId: string) {
  return requestConsoleSessionJson<TenantPlanAssignment>(planUrl(tenantId), { method: 'GET' })
}
export function getEffectiveEntitlements(tenantId: string) {
  return requestConsoleSessionJson<EffectiveEntitlements>(`${planUrl(tenantId)}/effective-entitlements?include=consumption`, { method: 'GET' })
}
export async function getPlanChangeHistory(tenantId: string, page: number): Promise<HistoryPage> {
  const response = await requestConsoleSessionJson<Partial<HistoryPage>>(`${planUrl(tenantId)}/history-impact?page=${page}&pageSize=${HISTORY_PAGE_SIZE}`, { method: 'GET' })
  const items = response.items ?? []
  return { items, total: response.total ?? items.length, page: response.page ?? page, pageSize: response.pageSize ?? HISTORY_PAGE_SIZE }
}
export async function listActivePlans(): Promise<ActivePlan[]> {
  const response = await requestConsoleSessionJson<{ items?: ActivePlan[]; plans?: ActivePlan[] }>('/v1/plans?status=active&page=1&pageSize=20', { method: 'GET' })
  return response.items ?? response.plans ?? []
}

// The shared transport replays a request after a 401 refresh. A privileged write must never be
// replayed without an explicit user action, so this request authenticates once and, on a 401,
// refreshes the session and reports it instead of sending the POST again.
export async function assignPlan(tenantId: string, planId: string) {
  const session = await ensureConsoleSession()
  const accessToken = session?.tokenSet?.accessToken?.trim()
  if (!accessToken) throw { status: 401, code: 'HTTP_401', message: 'No console session' } satisfies ApiError
  try {
    return await requestJson<unknown>(planUrl(tenantId), { method: 'POST', body: { planId, assignedBy: 'console' }, headers: { Authorization: `Bearer ${accessToken}` } })
  } catch (cause) {
    if ((cause as Partial<ApiError> | null)?.status !== 401) throw cause
    const renewed = await refreshConsoleShellSession()
    throw { ...(cause as ApiError), sessionRenewed: Boolean(renewed?.tokenSet?.accessToken?.trim()) }
  }
}
