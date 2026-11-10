import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-workspace-secrets-page.json'
import en from '../../locales/en/pages.console-workspace-secrets-page.json'
import { VALUE_MAX, type Failure } from './api'

i18n.addResourceBundle('es', 'pages.console-workspace-secrets-page', es)
i18n.addResourceBundle('en', 'pages.console-workspace-secrets-page', en)
export const useCopy = () => useTranslation('pages.console-workspace-secrets-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

export type WriteKind = 'create' | 'replace' | 'delete'
// How a failed request is shown: no-access and not-found replace the surface, retry keeps the entered
// values behind a Reintentar panel, and inline keeps the legacy console-owned message in place.
export type FailureClass = 'no-access' | 'not-found' | 'retry' | 'inline'

export function classify(failure: Failure): FailureClass {
  if (failure.status === 403) return 'no-access'
  if (failure.status === 404) return 'not-found'
  if (failure.status === undefined || (failure.status >= 500 && failure.status !== 501 && failure.status !== 502)) return 'retry'
  return 'inline'
}

// Legacy ConsoleWorkspaceSecretsPage.tsx:53-81 (describeSecretError). The raw server message is never
// part of this text; it only appears in the error panel's technical details.
// Only replace and delete (context mutate) can say the secret is gone; list and create 404s stay non-leaking.
export type ErrorContext = 'list' | 'create' | 'mutate'
export function describeSecretError(t: TFunction, failure: Failure, context: ErrorContext): string {
  if (failure.status === undefined) return t('errors.network')
  const corr = failure.correlationId ? t('errors.correlation', { id: failure.correlationId }) : ''
  switch (failure.status) {
    case 400: return t('errors.badRequest') + corr
    case 403: return t('errors.forbidden') + corr
    case 404: return (context === 'mutate' && failure.code === 'SECRET_NOT_FOUND' ? t('errors.secretGone') : t('errors.notAvailable')) + corr
    case 409: return t('errors.conflict') + corr
    case 413: return t('errors.tooLarge', { max: VALUE_MAX }) + corr
    case 429: return t('errors.rateLimited') + corr
    case 501: return t('errors.unavailable')
    case 502: return t('errors.backend') + corr
    default: return t('errors.failed') + corr
  }
}

// Legacy useDestructiveOp.ts:30-54 and console-errors.ts:41-62 (describeConsoleError) for delete.
export function describeDeleteError(t: TFunction, failure: Failure): string {
  switch (failure.status) {
    case 401: return t('errors.deleteExpired')
    case 409: return t('errors.deleteConflict')
    case 429: return t('errors.deleteRateLimited')
    default: return typeof failure.status === 'number' && failure.status >= 500 ? t('errors.deleteService') : t('errors.deleteFallback')
  }
}

export const describeWrite = (t: TFunction, kind: WriteKind, failure: Failure) =>
  kind === 'delete' ? describeDeleteError(t, failure) : describeSecretError(t, failure, kind === 'create' ? 'create' : 'mutate')

export const requestIdOf = (failure: Failure) => failure.requestId ?? failure.correlationId ?? ''
