import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-workspace-database-page.json'
import en from '../../locales/en/pages.console-workspace-database-page.json'

i18n.addResourceBundle('es', 'pages.console-workspace-database-page', es)
i18n.addResourceBundle('en', 'pages.console-workspace-database-page', en)
export const useCopy = () => useTranslation('pages.console-workspace-database-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
export type Operation = 'load' | 'provision' | 'rotate'
export interface Failure { status?: number; code?: string; requestId: string; operation: Operation }
// Retain only structured metadata. Raw server messages never enter interface copy or announcements.
export function failureOf(cause: unknown, operation: Operation): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { operation, status: typeof error.status === 'number' ? error.status : undefined,
    code: typeof error.code === 'string' ? error.code : undefined,
    requestId: typeof error.requestId === 'string' ? error.requestId : typeof error.correlationId === 'string' ? error.correlationId : '' }
}
export function describeFailure(t: TFunction, failure: Failure) {
  if (failure.code === 'DB_SHARED_MODE') return t('sharedConflict')
  switch (failure.status) {
    case 401: return t('errors.expired')
    case 403: return t('errors.forbidden')
    case 404: return t('errors.notFound')
    case 409: return t('errors.conflict')
    case 429: return t('errors.rateLimited')
    default: return t(typeof failure.status === 'number' && failure.status >= 500 ? 'errors.service' : `errors.${failure.operation}`)
  }
}
export const knownSharedReason = 'shared-mode database has no dedicated credential to rotate'
export const notRotatedKey = (mode?: string, reason?: string) => mode === 'shared' || !reason || reason === knownSharedReason ? 'notRotated' : 'notRotatedFallback'
