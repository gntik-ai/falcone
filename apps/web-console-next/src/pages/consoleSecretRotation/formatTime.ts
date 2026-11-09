export function formatRotationTime(value: string | null | undefined, locale: string, fallback: string) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    : fallback
}
