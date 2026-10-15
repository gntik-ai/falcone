import { beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => { vi.resetModules() })

test.each([null, 'en', 'xx', '{broken'])('initial locale respects only supported stored preferences: %s', async (stored) => {
  if (stored !== null) localStorage.setItem('falcone-next-locale', stored)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US')
  const { default: i18n } = await import('../src/i18n')
  expect(i18n.language).toBe(stored === 'en' ? 'en' : 'es')
  expect(document.documentElement.lang).toBe(stored === 'en' ? 'en' : 'es')
  expect(i18n.t('shell.about')).toBe(stored === 'en' ? 'About' : 'Acerca de')
})

test('language changes update HTML, persist and format ICU messages', async () => {
  const { default: i18n, changeLocale } = await import('../src/i18n')
  await changeLocale('en')
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('falcone-next-locale')).toBe('en')
  expect(i18n.t('pagination.summary', { count: 2 })).toBe('2 items')
  await changeLocale('es')
  expect(i18n.t('pagination.summary', { count: 1 })).toBe('1 elemento')
})

test('unavailable local storage does not prevent startup or switching', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
  const { default: i18n, changeLocale } = await import('../src/i18n')
  expect(i18n.language).toBe('es')
  await changeLocale('en')
  expect(document.documentElement.lang).toBe('en')
})
