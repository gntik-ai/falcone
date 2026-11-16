import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-kafka-page.json'
import en from '../../locales/en/pages.console-kafka-page.json'
i18n.addResourceBundle('es', 'pages.console-kafka-page', es)
i18n.addResourceBundle('en', 'pages.console-kafka-page', en)
export const useCopy = () => useTranslation('pages.console-kafka-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
import type { KafkaQuotaStatus } from './types'
export function useFormat() {
 const { t } = useCopy()
function formatEnumLabel(value?: string): string {
  if (!value) return t('missingValueLabel')
  const normalized = value.toLowerCase()
  const labels: Record<string, string> = {
    active: t('activeLabel'),
    at_least_once: t('atLeastOnce'),
    at_most_once: t('atMostOnce'),
    available: t('available'),
    compact: t('compact'),
    compact_and_delete: t('compactAndDelete'),
    delete: t('delete'),
    degraded: t('degradedStatus'),
    disabled: t('disabled'),
    enabled: t('enabled'),
    exactly_once: t('exactlyOnce'),
    failed: t('failed'),
    hard: t('hard'),
    healthy: t('healthy'),
    none: t('none'),
    planned: t('planned'),
    prefix: t('prefix'),
    provider_managed: t('providerManaged'),
    provisioning: t('provisioning'),
    shared_cluster: t('sharedCluster'),
    soft: t('soft'),
    suspended: t('suspended')
  }
  if (labels[normalized]) return labels[normalized]
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatRelativeDate(value?: string): string {
  if (!value) return t('missingValueLabel')
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return value
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (diffMinutes < 1) return t('lessThanMinute')
  if (diffMinutes === 1) return t('minuteAgo')
  if (diffMinutes < 60) return t('minutesAgo', { count: diffMinutes })
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours === 1) return t('hourAgo')
  if (diffHours < 24) return t('hoursAgo', { count: diffHours })
  const diffDays = Math.round(diffHours / 24)
  return diffDays === 1 ? t('dayAgo') : t('daysAgo', { count: diffDays })
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return t('missingValueLabel')
  if (typeof value === 'boolean') return value ? t('yes') : t('no')
  if (typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value)) return formatEnumLabel(value)
  return String(value)
}

function formatCleanupPolicy(value?: string): string {
  switch (value) {
    case 'delete':
      return t('delete')
    case 'compact':
      return t('compact')
    case 'compact_and_delete':
    case 'compact,delete':
      return t('compactDelete')
    default:
      return formatEnumLabel(value)
  }
}

function formatDeliverySemantics(value?: string): string {
  switch (value) {
    case 'at_least_once':
      return t('atLeastOnce')
    case 'at_most_once':
      return t('atMostOnce')
    case 'exactly_once':
      return t('exactlyOnce')
    case 'exactly_once_candidate':
      return t('exactlyOnceCandidate')
    default:
      return formatEnumLabel(value)
  }
}

function quotaLabel(quota?: KafkaQuotaStatus): string | null {
  if (!quota) return null
  if (quota.remaining === 0) return t('quotaExhausted')
  if (quota.enforcementMode && quota.enforcementMode !== 'none') return t('limitEnforcementActive')
  return null
}

function quotaHighlighted(quota?: KafkaQuotaStatus): boolean {
  return Boolean(quota && (quota.remaining === 0 || (quota.enforcementMode && quota.enforcementMode !== 'none')))
}

function statusTone(value?: string): 'success' | 'warning' | 'destructive' | 'neutral' {
  const normalized = value?.toLowerCase()
  if (normalized === 'active' || normalized === 'healthy' || normalized === 'allow') return 'success'
  if (normalized === 'provisioning' || normalized === 'planned') return 'warning'
  if (normalized === 'deny' || normalized === 'degraded' || normalized === 'failed' || normalized === 'error' || normalized === 'paused' || normalized === 'suspended') {
    return 'destructive'
  }
  return 'neutral'
}

function lagTone(totalLag?: number): { label: string; tone: 'success' | 'warning' | 'destructive' | 'neutral' } {
  if (typeof totalLag !== 'number') return { label: t('unavailable'), tone: 'neutral' }
  if (totalLag < 1000) return { label: t('low'), tone: 'success' }
  if (totalLag <= 10_000) return { label: t('medium'), tone: 'warning' }
  return { label: t('high'), tone: 'destructive' }
}


return { formatEnumLabel, formatRelativeDate, formatValue, formatCleanupPolicy, formatDeliverySemantics, quotaLabel, quotaHighlighted, statusTone, lagTone }
}
