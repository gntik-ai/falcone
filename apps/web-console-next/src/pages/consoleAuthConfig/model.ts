import type { ApiError } from '@in-falcone/console-api/http'
import type { TenantAuthConfig, TenantAuthConfigBooleanKey, TenantAuthConfigBooleanPatch } from '@in-falcone/console-api/auth-config'

// Same order as the legacy form.
export const BOOLEAN_KEYS: readonly TenantAuthConfigBooleanKey[] = ['registrationAllowed', 'loginWithEmailAllowed', 'resetPasswordAllowed', 'rememberMe', 'verifyEmail']
export type BooleanDraft = Record<TenantAuthConfigBooleanKey, boolean>
export const ALIAS_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
export const LIMITS = { alias: 64, displayName: 256, clientId: 4096, defaultScope: 4096, clientSecret: 4096 } as const

export interface Failure { status?: number; requestId?: string }

export function failureFrom(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined, requestId: error.requestId ?? error.correlationId }
}

export function draftFromConfig(config: TenantAuthConfig): BooleanDraft {
  return {
    registrationAllowed: config.registrationAllowed,
    loginWithEmailAllowed: config.loginWithEmailAllowed,
    resetPasswordAllowed: config.resetPasswordAllowed,
    rememberMe: config.rememberMe,
    verifyEmail: config.verifyEmail,
  }
}

export function isDirty(config: TenantAuthConfig, draft: BooleanDraft): boolean {
  return BOOLEAN_KEYS.some((key) => draft[key] !== config[key])
}

// Only the keys whose value differs from the loaded config go to the server.
export function buildPatch(config: TenantAuthConfig, draft: BooleanDraft): TenantAuthConfigBooleanPatch {
  const patch: TenantAuthConfigBooleanPatch = {}
  for (const key of BOOLEAN_KEYS) if (draft[key] !== config[key]) patch[key] = draft[key]
  return patch
}

// Status-based copy keys: a failed request never shows the raw backend or transport message.
export function errorKey(status: number | undefined): 'errors.401' | 'errors.403' | 'errors.404' | 'errors.409' | 'errors.429' | 'errors.5xx' | null {
  if (status === 401 || status === 403 || status === 404 || status === 409 || status === 429) return `errors.${status}`
  return typeof status === 'number' && status >= 500 ? 'errors.5xx' : null
}

export function callbackPath(realm: string, alias: string): string {
  return `/realms/${encodeURIComponent(realm)}/broker/${encodeURIComponent(alias)}/endpoint`
}

// Maps a failed request to catalog copy by status; without a mapped status the page fallback is used.
export function describeFailure(t: (key: string) => string, cause: unknown, fallback: string): string {
  const key = errorKey(failureFrom(cause).status)
  return key ? t(key) : fallback
}
