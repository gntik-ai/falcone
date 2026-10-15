import i18n from './index'

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(i18n.language, options).format(value)
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(i18n.language, options).format(value)
}
export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) {
  return new Intl.RelativeTimeFormat(i18n.language, options).format(value, unit)
}
