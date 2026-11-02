import type { PlanStatus, UsageStatus } from './api'

export const planTones = { draft: 'neutral', active: 'success', deprecated: 'warning', archived: 'neutral' } as const satisfies Record<PlanStatus, string>
export const usageTones = { within_limit: 'success', approaching_limit: 'warning', at_limit: 'warning', over_limit: 'destructive', unknown: 'neutral' } as const satisfies Record<UsageStatus, string>

// Unknown server enums fall back to the neutral "unknown" label instead of throwing.
export const usageStatus = (value: string): UsageStatus => Object.hasOwn(usageTones, value) ? value as UsageStatus : 'unknown'
export const isPlanStatus = (value: string): value is PlanStatus => Object.hasOwn(planTones, value)
