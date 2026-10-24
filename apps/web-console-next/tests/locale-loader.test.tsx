import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import i18n, { changeLocale, localeStorageKey } from '../src/i18n'
import { createLocaleBundleLoader, loadLocale, registerLocaleBundles, retryLocale, useLocaleLoader } from '../src/i18n/locale-loader'

for (const [from, to] of [['es', 'en'], ['en', 'es']] as const) {
  test(`loads every bundle before committing ${to}, preserves ${from} on failure and retries`, async () => {
    await changeLocale(from)
    const change = vi.spyOn(i18n, 'changeLanguage')
    const loaded = vi.fn().mockRejectedValueOnce(new Error('synthetic bundle failure')).mockResolvedValue({ title: 'Loaded' })
    const remove = registerLocaleBundles('loader-test', { es: loaded, en: loaded })
    const { result } = renderHook(useLocaleLoader)
    try {
      await act(async () => { expect(await loadLocale(to)).toBe(false) })
      expect(change).not.toHaveBeenCalled()
      expect(result.current.error).toBe(true)
      expect(i18n.language).toBe(from)
      expect(document.documentElement.lang).toBe(from)
      expect(localStorage.getItem(localeStorageKey)).toBe(from)
      await act(async () => { expect(await retryLocale()).toBe(true) })
      expect(loaded.mock.calls).toEqual([[false], [true]])
      expect(i18n.getResource(to, 'loader-test', 'title')).toBe('Loaded')
      expect(i18n.language).toBe(to)
      expect(document.documentElement.lang).toBe(to)
      expect(localStorage.getItem(localeStorageKey)).toBe(to)
      expect(result.current.error).toBe(false)
    } finally { act(remove) }
  })
}

test('pending serializes both controls and resources are committed atomically', async () => {
  let finish!: (bundle: Record<string, unknown>) => void
  const delayed = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { finish = resolve }))
  const remove = registerLocaleBundles('pending-test', { es: delayed, en: delayed })
  const { result } = renderHook(useLocaleLoader)
  let request!: Promise<boolean>
  try {
    act(() => { request = loadLocale('en') })
    expect(result.current.pending).toBe(true)
    expect(loadLocale('es')).toBe(request)
    expect(i18n.language).toBe('es')
    expect(localStorage.getItem(localeStorageKey)).toBeNull()
    await act(async () => { finish({ title: 'Ready' }); await request })
    expect(result.current.pending).toBe(false)
    expect(i18n.language).toBe('en')
    expect(delayed).toHaveBeenCalledTimes(1)
  } finally { act(remove) }
})

test('one failing namespace prevents all resource and preference writes', async () => {
  const first = registerLocaleBundles('atomic-first', { es: async () => ({}), en: async () => ({ title: 'Partial' }) })
  const second = registerLocaleBundles('atomic-second', { es: async () => ({}), en: async () => { throw new Error('synthetic failure') } })
  try {
    expect(await loadLocale('en')).toBe(false)
    expect(i18n.getResource('en', 'atomic-first', 'title')).toBeUndefined()
    expect(i18n.language).toBe('es')
  } finally { first(); second() }
})

test('without a registered page switches directly and does not fetch', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect(await loadLocale('en')).toBe(true)
  await waitFor(() => expect(i18n.language).toBe('en'))
  expect(fetch).not.toHaveBeenCalled()
})


test('a cached import failure recovers through the local JSON asset and stays recoverable', async () => {
  const importer = vi.fn().mockRejectedValue(new Error('synthetic cached module failure'))
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValue(Response.json({ title: 'Recovered' }))
  vi.stubGlobal('fetch', fetch)
  const loader = createLocaleBundleLoader(importer, '/next/assets/synthetic-locale.json')
  await expect(loader(false)).rejects.toThrow('synthetic cached module failure')
  await expect(loader(true)).rejects.toThrow('Locale bundle unavailable')
  await expect(loader(true)).resolves.toEqual({ title: 'Recovered' })
  fetch.mockResolvedValue(Response.json({ title: 'Recovered again' }))
  await expect(loader(false)).resolves.toEqual({ title: 'Recovered again' })
  expect(importer).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledWith('/next/assets/synthetic-locale.json', { cache: 'reload' })
})
