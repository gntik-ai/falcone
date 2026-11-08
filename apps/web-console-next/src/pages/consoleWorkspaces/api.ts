import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { createRequestId, type ApiError } from '@in-falcone/console-api/http'

export interface WorkspaceData { name: string; description: string; maxFunctions: string; maxDatabases: string }
export type Failure = Pick<Partial<ApiError>, 'status' | 'code' | 'message' | 'requestId'>
export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: error.status, code: error.code, message: error.message, requestId: error.requestId ?? error.correlationId }
}
interface Quotas { dimensions?: { dimensionId?: string; hardLimit?: number | null; measuredValue?: number }[]; hardLimitBreaches?: string[] }
interface Overview { hardLimitDimensions?: string[] }
export async function readQuota(tenantId: string, signal: AbortSignal) {
  // Wait for both reads before allowing a retry. No workspace posture is requested.
  const results = await Promise.allSettled([
    requestConsoleSessionJson<Quotas>(`/v1/metrics/tenants/${tenantId}/quotas`, { method: 'GET', signal }),
    requestConsoleSessionJson<Overview>(`/v1/metrics/tenants/${tenantId}/overview`, { method: 'GET', signal }),
  ])
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const quotas = (results[0] as PromiseFulfilledResult<Quotas>).value
  const overview = (results[1] as PromiseFulfilledResult<Overview>).value
  const dimension = quotas.dimensions?.find((item) => item.dimensionId === 'workspaces.count')
  // Preserve normalizeQuotaPosture/useWizardQuotaCheck, including the platform exception.
  return tenantId === 'platform' || !dimension || !(
    (dimension.hardLimit && dimension.hardLimit > 0 && Math.round((dimension.measuredValue ?? 0) / dimension.hardLimit * 100) >= 100) ||
    [...(quotas.hardLimitBreaches ?? []), ...(overview.hardLimitDimensions ?? [])].includes('workspaces.count')
  )
}
export function createWorkspace(tenantId: string, data: WorkspaceData) {
  return requestConsoleSessionJson<{ workspaceId: string }>(`/v1/tenants/${tenantId}/workspaces`, {
    method: 'POST', body: { name: data.name, description: data.description, initialLimits: { maxFunctions: Number(data.maxFunctions.trim()), maxDatabases: Number(data.maxDatabases.trim()) } },
    idempotent: true, headers: { 'X-Request-Id': createRequestId('wiz') },
  })
}
// Keep text until validation, so invalid numeric syntax is neither clamped nor silently coerced.
export function integerError(value: string): 'requiredInteger' | 'invalidInteger' | 'integerRange' | null {
  const text = value.trim()
  if (!text) return 'requiredInteger'
  if (!/^-?\d+$/.test(text)) return 'invalidInteger'
  const number = Number(text)
  return !Number.isSafeInteger(number) || number < 1 || number > Number.MAX_SAFE_INTEGER ? 'integerRange' : null
}
