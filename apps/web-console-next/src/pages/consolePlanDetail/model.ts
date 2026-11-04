import type { Failure, PlanStatus } from './api'

export const lifecycleOrder: PlanStatus[] = ['draft', 'active', 'deprecated', 'archived']
export const statusTones = { draft: 'neutral', active: 'success', deprecated: 'warning', archived: 'neutral' } as const
export type LifecycleTarget = 'active' | 'deprecated' | 'archived'
export type DialogKind = 'deprecate' | 'archive' | 'delete' | 'reset'

// One user-initiated request. A retry re-sends exactly this object.
export type Action =
  | { kind: 'activate' }
  | { kind: 'deprecate' }
  | { kind: 'archive' }
  | { kind: 'delete' }
  | { kind: 'set'; key: string; value: number }
  | { kind: 'reset'; key: string }

export const targetOf: Record<'activate' | 'deprecate' | 'archive', LifecycleTarget> = { activate: 'active', deprecate: 'deprecated', archive: 'archived' }
export const isLifecycle = (action: Action): action is { kind: 'activate' | 'deprecate' | 'archive' } => action.kind === 'activate' || action.kind === 'deprecate' || action.kind === 'archive'
export const isDialogAction = (action: Action) => action.kind !== 'activate' && action.kind !== 'set'

export function lifecycleActionFor(status: PlanStatus): 'activate' | 'deprecate' | 'archive' | null {
  return status === 'draft' ? 'activate' : status === 'active' ? 'deprecate' : status === 'deprecated' ? 'archive' : null
}

export type Validation = { valid: true; value: number } | { valid: false; message: 'limitRequired' | 'limitInvalid' }
// -1 means unlimited. The input has no min, so every value below -1 is rejected here.
export function validateLimit(draft: number | null): Validation {
  if (draft === null || draft === undefined) return { valid: false, message: 'limitRequired' }
  if (!Number.isFinite(draft) || !Number.isInteger(draft) || draft < -1) return { valid: false, message: 'limitInvalid' }
  return { valid: true, value: draft }
}

export const knownCodes = ['INVALID_LIMIT_VALUE', 'PLAN_LIMITS_FROZEN', 'PLAN_HAS_ASSIGNMENT_HISTORY', 'PLAN_HAS_ACTIVE_ASSIGNMENTS', 'PLAN_ACTIVE', 'INVALID_TRANSITION'] as const
export const isKnownCode = (code?: string) => Boolean(code) && (knownCodes as readonly string[]).includes(code!)
// A 5xx or a lost response can be sent again; other statuses are decisions of the backend.
export const retryable = (failure: Failure) => failure.status === undefined || failure.status >= 500
