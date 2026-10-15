import { expect, test } from 'vitest'
import { changeLocale } from '../src/i18n'
import { formatDate, formatNumber, formatRelativeTime } from '../src/i18n/format'

test('Intl helpers follow the active locale with explicit formatting options', async () => {
  const date = new Date('2026-01-02T12:00:00Z')
  await changeLocale('es')
  expect(formatNumber(1234.5, { useGrouping: false })).toBe('1234,5')
  expect(formatDate(date, { month: 'long', timeZone: 'UTC' })).toBe('enero')
  expect(formatRelativeTime(-1, 'day', { numeric: 'auto' })).toBe('ayer')
  await changeLocale('en')
  expect(formatNumber(1234.5, { useGrouping: false })).toBe('1234.5')
  expect(formatDate(date, { month: 'long', timeZone: 'UTC' })).toBe('January')
  expect(formatRelativeTime(-1, 'day', { numeric: 'auto' })).toBe('yesterday')
})
