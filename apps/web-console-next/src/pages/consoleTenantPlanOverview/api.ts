import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

// Legacy planManagementApi.ts:326-329; only the own-tenant consumption read is used.
export type UsageStatus = 'within_limit' | 'approaching_limit' | 'at_limit' | 'over_limit' | 'unknown'
export type PlanStatus = 'draft' | 'active' | 'deprecated' | 'archived'
export interface QuantitativeLimit {
  dimensionKey: string
  displayLabel?: string
  unit?: string | null
  effectiveValue?: number | null
  currentUsage?: number | null
  usageStatus: UsageStatus
  usageUnknownReason?: string | null
}
export interface EffectiveEntitlements {
  tenantId: string
  planSlug?: string
  planStatus?: PlanStatus
  quantitativeLimits?: QuantitativeLimit[]
  capabilities: Array<{ capabilityKey: string; displayLabel?: string; enabled: boolean }>
}
export function getEffectiveEntitlements() {
  return requestConsoleSessionJson<EffectiveEntitlements>('/v1/tenant/plan/effective-entitlements?include=consumption', { method: 'GET' })
}
