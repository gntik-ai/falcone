import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

// Pinned to the legacy planManagementApi.ts contract (getEffectiveEntitlements without a tenant id and
// with includeConsumption) until the plans OpenAPI is published. The tenant is resolved by the token.
export type PlanStatus = 'draft' | 'active' | 'deprecated' | 'archived'
export type UsageStatus = 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'

export interface EntitlementLimit {
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
export interface EntitlementCapability { capabilityKey: string; displayLabel?: string; enabled: boolean }
export interface EffectiveEntitlements {
  tenantId: string
  planId?: string
  planSlug?: string
  planStatus?: PlanStatus
  quantitativeLimits?: EntitlementLimit[]
  capabilities?: EntitlementCapability[]
}

export const ENTITLEMENTS_PATH = '/v1/tenant/plan/effective-entitlements?include=consumption'

export function getEffectiveEntitlements() {
  return requestConsoleSessionJson<EffectiveEntitlements>(ENTITLEMENTS_PATH, { method: 'GET' })
}
