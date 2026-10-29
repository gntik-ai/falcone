import { createRequestId, requestJson, type ApiError } from '@in-falcone/console-api/http'
import { ensureConsoleSession, refreshConsoleShellSession, requestConsoleSessionJson } from '@in-falcone/console-api/session'

export interface TenantBody { name: string; planId: string; region: string; preferences: { locale: string } }
export interface ActivePlan { id: string; slug: string; displayName: string }
export type Failure = { status?: number; requestId?: string; renewed?: boolean }
export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError> & { renewed?: boolean }
  return { status: typeof error.status === 'number' ? error.status : undefined, requestId: typeof error.requestId === 'string' ? error.requestId : '', renewed: error.renewed === true }
}
export async function listActivePlans() {
  const response = await requestConsoleSessionJson<{ items?: ActivePlan[]; plans?: ActivePlan[] }>('/v1/plans?status=active&page=1&pageSize=100', { method: 'GET' })
  return { items: response.items ?? response.plans ?? [] }
}
export async function checkPlatformQuotas() {
  // Both requests always run, including when either fails. Their payloads never block creation.
  const results = await Promise.allSettled([
    requestConsoleSessionJson('/v1/metrics/tenants/platform/quotas'),
    requestConsoleSessionJson('/v1/metrics/tenants/platform/overview'),
  ])
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
export async function createTenant(body: TenantBody, idempotencyKey: string) {
  const session = await ensureConsoleSession()
  const accessToken = session?.tokenSet?.accessToken?.trim()
  if (!accessToken) throw { status: 401 }
  try {
    return await requestJson<{ tenantId: string; tenantSlug?: string }>('/v1/tenants', {
      method: 'POST', body: { ...body }, idempotent: true,
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Request-Id': createRequestId('wiz'), 'Idempotency-Key': idempotencyKey },
    })
  } catch (cause) {
    if (failureOf(cause).status !== 401) throw cause
    const refreshed = await refreshConsoleShellSession()
    // A refreshed session permits a later explicit submit; never replay this write.
    throw { ...failureOf(cause), renewed: Boolean(refreshed?.tokenSet?.accessToken) }
  }
}
