import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import { collectMongoDataLocaleValues } from './parity/pages/console-mongo-data-page.locale.mjs'
import { enterTarget, loaded, open, setup } from './consoleMongoData-support'
import es from '../src/locales/es/pages.console-mongo-data-page.json'
import en from '../src/locales/en/pages.console-mongo-data-page.json'

const flatten = (object: Record<string, unknown>, prefix = ''): string[] => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [prefix + key] : flatten(value as Record<string, unknown>, `${prefix}${key}.`))
const lookup = (object: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], object)
const source = (directory: string) => readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name)).map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8')).join('\n')
beforeEach(() => { vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList) })

test('the es and en catalogs have the same keys and no empty copy', () => {
  expect(flatten(es).sort()).toEqual(flatten(en).sort())
  for (const catalog of [es, en]) for (const key of flatten(catalog)) expect((lookup(catalog, key) as string).trim(), key).not.toBe('')
})
test('every literal t() key used by the page exists in both catalogs, and the dynamic key families are complete', () => {
  const code = source(join(__dirname, '../src/pages/consoleMongoData')) + readFileSync(join(__dirname, '../src/pages/consoleMongoData.tsx'), 'utf8')
  const used = new Set([...code.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]))
  for (const key of ['errors.documents', 'errors.workspace', 'resources.documents', 'resources.workspace', 'noAccessDescription.documents', 'noAccessDescription.workspace', 'jsonInvalid', 'jsonObjectExpected', 'deleteConfirm.failedTitle', 'confirm.instruction', 'confirm.mismatch']) used.add(key)
  expect(used.size).toBeGreaterThan(60)
  for (const key of used) for (const catalog of [es, en]) expect(typeof lookup(catalog, key), key).toBe('string')
})
test.each(['es', 'en'] as const)('the rendered page in %s shows no raw translation keys and its target heading is exempt data', async (locale) => {
  const server = setup(); await changeLocale(locale); open()
  fireEvent.change(screen.getByLabelText(locale === 'es' ? 'Base de datos' : 'Database'), { target: { value: 'catalog' } }); fireEvent.change(screen.getByLabelText(locale === 'es' ? 'Colección' : 'Collection'), { target: { value: 'orders' } })
  await screen.findByText(/ord_01/)
  for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'innerText', { configurable: true, get: () => element.textContent })
  const values = collectMongoDataLocaleValues()
  expect(values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text))).toEqual([])
  expect(screen.getByRole('heading', { name: 'catalog.orders' })).toBeVisible(); expect(values).not.toContain('catalog.orders')
  expect(values).toContain(locale === 'es' ? 'Editor de datos Mongo' : 'Mongo data editor'); expect(values).toContain(locale === 'es' ? 'Emitir clave anónima' : 'Issue anonymous key')
  server.verify(); void loaded; void enterTarget
})
test('the same dotted text outside the target heading and the data viewers is still reported', () => {
  render(<><div data-mongodata-target=""><header><h2>catalog.orders</h2></header></div><div data-mongodata-data=""><span>shop.example</span></div><span>pages.untranslated</span><button aria-label="catalog.orders">x</button></>)
  for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'innerText', { configurable: true, get: () => element.textContent })
  const values = collectMongoDataLocaleValues()
  expect(values.filter((text) => text === 'catalog.orders')).toHaveLength(1); expect(values).not.toContain('shop.example'); expect(values).toContain('pages.untranslated')
})
