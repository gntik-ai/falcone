import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-functions-page.json'
import en from '../../locales/en/pages.console-functions-page.json'
import type { Failure, FunctionAction } from './api'

i18n.addResourceBundle('es', 'pages.console-functions-page', es)
i18n.addResourceBundle('en', 'pages.console-functions-page', en)
export const useCopy = () => useTranslation('pages.console-functions-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

export type Section = 'inventory' | 'detail' | 'versions' | 'activations' | 'activation' | 'logs' | 'result' | 'invoke' | 'deploy' | 'rollback' | 'delete'
// The statuses the shared console error helper maps explicitly (console-errors.ts:41-62).
export const isMappedStatus = (status?: number) => status === 401 || status === 403 || status === 404 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500)

// Mapped statuses use the shared copy; any other status, or none, shows the section's page fallback.
export function describeFailure(t: TFunction, failure: Failure, section: Section): string {
  const { status } = failure
  if (status === 401 || status === 403 || status === 404 || status === 409 || status === 429) return t(`errors.${status}`)
  if (typeof status === 'number' && status >= 500) return t('errors.5xx')
  return t(`errors.${section}`)
}
// Legacy :345-365: a missing activation and forbidden logs have their own copy.
export function describeActivationFailure(t: TFunction, failure: Failure, section: 'activation' | 'logs' | 'result'): string {
  if (failure.status === 404) return t('errors.activationGone')
  if (section === 'logs' && failure.status === 403) return t('errors.logsForbidden')
  return describeFailure(t, failure, section)
}
export const titleKey = (section: Section) => `errors.title${section[0].toUpperCase()}${section.slice(1)}`
// Legacy :1387 matched copy text; the hint now follows the status or code only.
export const showLimitsHint = (failure: Failure) => failure.status === 429 || failure.code === 'QUOTA_EXCEEDED'

// Legacy :392-419: the provisioning state, else the status, decides whether writes are blocked.
export function writeDisabledKey(action: FunctionAction | null): 'provisioning' | 'degraded' | 'suspended' | 'unavailable' | 'deletion_pending' | null {
  const state = action?.provisioning?.state?.toLowerCase().trim() || action?.status?.toLowerCase().trim() || null
  return state === 'provisioning' || state === 'degraded' || state === 'suspended' || state === 'unavailable' || state === 'deletion_pending' ? state : null
}

export const formatEnumLabel = (value?: string | null) => (value ? value.replace(/_/g, ' ') : '—')
export function formatValue(t: TFunction, value: unknown): string {
  if (value === null || value === undefined || value === '') return t('fields.none')
  if (typeof value === 'boolean') return t(value ? 'fields.yes' : 'fields.no')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
export const statusLabel = (t: TFunction, value?: string | null) => {
  const key = value?.toLowerCase()
  return key && i18n.exists(`pages.console-functions-page:status.${key}`) ? t(`status.${key}`) : formatEnumLabel(value)
}
