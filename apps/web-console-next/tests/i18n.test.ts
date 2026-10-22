import { beforeEach, expect, test, vi } from 'vitest'

beforeEach(() => { vi.resetModules() })

test.each([
  [null, 'en-US', 'en', 'About'],
  [null, 'es-ES', 'en', 'About'],
  ['en', 'en-US', 'en', 'About'],
  ['es', 'en-US', 'es', 'Acerca de'],
  ['xx', 'en-US', 'en', 'About'],
  ['{broken', 'en-US', 'en', 'About'],
])('initial locale respects only supported stored preferences: %s, browser %s', async (stored, browserLanguage, language, about) => {
  if (stored !== null) localStorage.setItem('falcone-next-locale', stored)
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(browserLanguage)
  const { default: i18n } = await import('../src/i18n')
  expect(i18n.language).toBe(language)
  expect(document.documentElement.lang).toBe(language)
  expect(i18n.t('shell.about')).toBe(about)
})

test('language changes update HTML, persist and format ICU messages', async () => {
  const { default: i18n, changeLocale } = await import('../src/i18n')
  await changeLocale('en')
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('falcone-next-locale')).toBe('en')
  expect(i18n.t('pagination.summary', { count: 2 })).toBe('2 items')
  await changeLocale('es')
  expect(document.documentElement.lang).toBe('es')
  expect(localStorage.getItem('falcone-next-locale')).toBe('es')
  expect(i18n.t('pagination.summary', { count: 1 })).toBe('1 elemento')
})

test('unsupported language changes fall back to English', async () => {
  const { default: i18n } = await import('../src/i18n')
  await i18n.changeLanguage('xx')
  expect(document.documentElement.lang).toBe('en')
  expect(i18n.t('shell.about')).toBe('About')
})

test('unavailable local storage does not prevent startup or switching', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
  const { default: i18n, changeLocale } = await import('../src/i18n')
  expect(i18n.language).toBe('en')
  expect(document.documentElement.lang).toBe('en')
  await changeLocale('es')
  expect(document.documentElement.lang).toBe('es')
  await changeLocale('en')
  expect(document.documentElement.lang).toBe('en')
})
