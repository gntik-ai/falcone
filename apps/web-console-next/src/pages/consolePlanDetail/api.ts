import { requestJson, type ApiError } from '@in-falcone/console-api/http'
import { ensureConsoleSession, refreshConsoleShellSession, requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { PlanRecord, PlanStatus } from '../consolePlanCatalog/api'

export type { PlanRecord, PlanStatus }
export type LimitSource = 'default' | 'explicit' | 'unlimited'
export interface LimitRow {
  dimensionKey: string
  displayLabel: string
  unit?: string | null
  effectiveValue: number
  source: LimitSource
}
export interface LimitsProfile { planId: string; profile: LimitRow[] }
export interface LifecycleResponse { planId?: string; previousStatus?: PlanStatus; newStatus?: PlanStatus; transitionedAt?: string }
export interface LimitSetResponse { planId?: string; dimensionKey?: string; newValue?: number; source?: LimitSource }
export interface LimitRemoveResponse { planId?: string; dimensionKey?: string; effectiveValue?: number; source?: LimitSource }
export interface Failure { status?: number; code?: string; requestId?: string; sessionRenewed?: boolean }

// Only the numeric status, a machine code and the request id survive: transport messages and details never reach state or the DOM.
export function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError> & { sessionRenewed?: boolean }
  const requestId = typeof error.requestId === 'string' && error.requestId ? error.requestId : typeof error.correlationId === 'string' ? error.correlationId : ''
  return {
    status: typeof error.status === 'number' ? error.status : undefined,
    code: typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : undefined,
    requestId,
    ...(error.sessionRenewed ? { sessionRenewed: true } : {}),
  }
}

const planUrl = (planId: string) => `/v1/plans/${encodeURIComponent(planId)}`
const limitUrl = (planId: string, key: string) => `${planUrl(planId)}/limits/${encodeURIComponent(key)}`

export function getPlan(planId: string) {
  return requestConsoleSessionJson<PlanRecord>(planUrl(planId), { method: 'GET' })
}
export function getLimits(planId: string) {
  return requestConsoleSessionJson<LimitsProfile>(`${planUrl(planId)}/limits`, { method: 'GET' })
}
export function setLimit(planId: string, key: string, value: number) {
  return requestConsoleSessionJson<LimitSetResponse>(limitUrl(planId, key), { method: 'PUT', body: { value } })
}
export function removeLimit(planId: string, key: string) {
  return requestConsoleSessionJson<LimitRemoveResponse>(limitUrl(planId, key), { method: 'DELETE' })
}

// The shared transport replays a request once after a 401 refresh. A lifecycle transition and a plan deletion are
// non-idempotent writes, so they authenticate once and, on a 401, refresh the session and report it instead of
// sending the request again. Only an explicit user action sends it a second time.
async function sendOnce<T>(url: string, method: 'POST' | 'DELETE', body?: { targetStatus: PlanStatus }): Promise<T> {
  const session = await ensureConsoleSession()
  const accessToken = session?.tokenSet?.accessToken?.trim()
  if (!accessToken) throw { status: 401, code: 'HTTP_401', message: 'No console session' } satisfies ApiError
  try {
    return await requestJson<T>(url, { method, ...(body ? { body } : {}), headers: { Authorization: `Bearer ${accessToken}` } })
  } catch (cause) {
    if ((cause as Partial<ApiError> | null)?.status !== 401) throw cause
    const renewed = await refreshConsoleShellSession()
    throw { ...(cause as ApiError), sessionRenewed: Boolean(renewed?.tokenSet?.accessToken?.trim()) }
  }
}
export function transitionPlan(planId: string, targetStatus: PlanStatus) {
  return sendOnce<LifecycleResponse>(`${planUrl(planId)}/lifecycle`, 'POST', { targetStatus })
}
export function deletePlan(planId: string) {
  return sendOnce<{ planId?: string; deleted?: boolean }>(planUrl(planId), 'DELETE')
}
