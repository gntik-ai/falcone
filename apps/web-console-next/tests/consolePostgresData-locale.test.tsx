import { render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import es from '../src/locales/es/pages.console-postgres-data-page.json'
import en from '../src/locales/en/pages.console-postgres-data-page.json'
import { collectPostgresDataLocaleValues } from './parity/pages/console-postgres-data-page.locale.mjs'
import { open, setup, type } from './consolePostgresData-support'

const catalog = (locale: string) => (locale === 'es' ? es : en) as Record<string, unknown>
const flat = (object: Record<string, unknown>, prefix = ''): string[] => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [prefix + key] : flat(value as Record<string, unknown>, `${prefix}${key}.`))
const raw = (text: string) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text)
beforeEach(() => { vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList) })

test('the es and en catalogs define the same keys and the same placeholders', () => {
  expect(flat(catalog('es')).sort()).toEqual(flat(catalog('en')).sort())
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)/g)].map((match) => match[1]).sort()
  for (const key of flat(catalog('es'))) {
    const get = (locale: string) => key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], catalog(locale)) as string
    expect(placeholders(get('en')), key).toEqual(placeholders(get('es')))
  }
})
test('the schema.table heading and fixture cells are marked as data; labels and buttons stay checked', () => {
  render(<main><section data-testid="pgdata-rows"><div><div><h2 id="pgdata-target-heading">public.accounts</h2></div></div><table><tbody><tr><td>cell.value</td><td><button type="button">pages.untranslated</button></td></tr></tbody></table></section><p>pages.untranslated.copy</p></main>)
  // Like a browser, every element reports innerText, so wrappers repeat their descendants' text.
  for (const element of document.querySelectorAll('main, main *')) Object.defineProperty(element, 'innerText', { value: element.textContent })
  const values = collectPostgresDataLocaleValues()
  expect(values).not.toContain('public.accounts'); expect(values).not.toContain('cell.value')
  expect([...new Set(values.filter(raw))].sort()).toEqual(['pages.untranslated', 'pages.untranslated.copy'])
})
for (const locale of ['es', 'en'] as const) test(`no raw translation key is rendered in ${locale}`, async () => {
  const server = setup(); await changeLocale(locale); open(); type(locale === 'es' ? 'Base de datos' : 'Database', 'app_db'); type(locale === 'es' ? 'Tabla' : 'Table', 'accounts')
  await screen.findByRole('table', { name: catalog(locale).tableLabel as string }); await screen.findByRole('table', { name: catalog(locale).keysTableLabel as string })
  // The shared collector marks the schema.table heading and fixture cells as data.
  expect(collectPostgresDataLocaleValues().filter(raw)).toEqual([])
  expect(screen.getByRole('heading', { name: 'public.accounts' })).toBeVisible()
  server.verify()
})
