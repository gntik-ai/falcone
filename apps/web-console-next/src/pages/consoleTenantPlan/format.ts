import type { ChangeDirection, UsageStatus } from './api'

export const usageTones = { within_limit: 'success', approaching_limit: 'warning', at_limit: 'warning', over_limit: 'destructive', unknown: 'neutral' } as const
export const directionTones = { upgrade: 'success', downgrade: 'warning', lateral: 'info', equivalent: 'neutral', initial_assignment: 'primary' } as const

export const usageStatus = (value: string): UsageStatus => Object.hasOwn(usageTones, value) ? value as UsageStatus : 'unknown'
export const direction = (value: string): ChangeDirection | null => Object.hasOwn(directionTones, value) ? value as ChangeDirection : null
// Unknown server enums fall back to a readable form of the raw key, as the legacy tables did.
export const readable = (value: string) => value.replace(/_/g, ' ')
