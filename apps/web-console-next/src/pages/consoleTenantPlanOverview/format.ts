import type { PlanStatus, UsageStatus } from './api'

export const planTones = { draft: 'neutral', active: 'success', deprecated: 'warning', archived: 'neutral' } as const
export const usageTones = { within_limit: 'success', approaching_limit: 'warning', at_limit: 'warning', over_limit: 'destructive', unknown: 'neutral' } as const

export const usageStatus = (value: string): UsageStatus => Object.hasOwn(usageTones, value) ? value as UsageStatus : 'unknown'
export const planStatus = (value: string): PlanStatus | null => Object.hasOwn(planTones, value) ? value as PlanStatus : null
