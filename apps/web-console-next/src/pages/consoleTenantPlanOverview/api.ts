import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import type { ApiError } from '@in-falcone/console-api/http'

// Pinned to the legacy planManagementApi.ts contract (CurrentEffectiveEntitlementSummary, lines 202-243,
// and getEffectiveEntitlements, lines 326-329) until the plans OpenAPI is published.
export type PlanStatus = 'draft' | 'active' | 'deprecated' | 'archived'
export type UsageStatus = 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'

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
export interface Capability { capabilityKey: string; displayLabel?: string; enabled: boolean }
export interface PlanOverview {
  tenantId: string
  planId?: string
  planSlug?: string
  planStatus?: PlanStatus
  quantitativeLimits?: QuantitativeLimit[]
  capabilities?: Capability[]
}
export type Failure = Pick<Partial<ApiError>, 'status' | 'requestId'>

// Own-tenant URL only: legacy calls it with tenantId undefined, so no /v1/tenants/{id} variant exists here.
export function getPlanOverview() {
  return requestConsoleSessionJson<PlanOverview>('/v1/tenant/plan/effective-entitlements?include=consumption', { method: 'GET' })
}

export function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined,
    requestId: typeof error.requestId === 'string' ? error.requestId : undefined }
}
