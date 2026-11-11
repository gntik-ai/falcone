import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import es from '../../locales/es/pages.console-storage-page.json'
import en from '../../locales/en/pages.console-storage-page.json'
i18n.addResourceBundle('es', 'pages.console-storage-page', es)
i18n.addResourceBundle('en', 'pages.console-storage-page', en)
export const useCopy = () => useTranslation('pages.console-storage-page')
export const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
export const focus = (id: string) => document.getElementById(id)?.focus()
export function bytes(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  if (value < 1024) return `${value} B`
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let amount = value / 1024
  let unit = 1
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++ }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]}`
}
export function relativeDate(value: string | null | undefined, t: (key: string, values?: { count: number }) => string) {
  if (!value) return t('none')
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000))
  if (minutes < 1) return t('relativeLessMinute')
  if (minutes === 1) return t('relativeMinute')
  if (minutes < 60) return t('relativeMinutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours === 1) return t('relativeHour')
  if (hours < 24) return t('relativeHours', { count: hours })
  const days = Math.round(hours / 24)
  return t(days === 1 ? 'relativeDay' : 'relativeDays', { count: days })
}
