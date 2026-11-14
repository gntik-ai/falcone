import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { changeLocale } from '../src/i18n'
import { collectPostgresDataLocaleValues } from './parity/pages/console-postgres-data-page.locale.mjs'
import { enterTarget, loaded, open, setup } from './consolePostgresData-support'
import es from '../src/locales/es/pages.console-postgres-data-page.json'
import en from '../src/locales/en/pages.console-postgres-data-page.json'

const flatten = (object: Record<string, unknown>, prefix = ''): string[] => Object.entries(object).flatMap(([key, value]) => typeof value === 'string' ? [prefix + key] : flatten(value as Record<string, unknown>, `${prefix}${key}.`))
const lookup = (object: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], object)
const source = (directory: string) => readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name)).map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8')).join('\n')
beforeEach(() => { vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList) })

test('the es and en catalogs have the same keys and no empty copy', () => {
  expect(flatten(es).sort()).toEqual(flatten(en).sort())
  for (const catalog of [es, en]) for (const key of flatten(catalog)) expect((lookup(catalog, key) as string).trim(), key).not.toBe('')
})
test('every literal t() key used by the page exists in both catalogs, and the dynamic key families are complete', () => {
  const code = source(join(__dirname, '../src/pages/consolePostgresData')) + readFileSync(join(__dirname, '../src/pages/consolePostgresData.tsx'), 'utf8')
  const used = new Set([...code.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]))
  for (const key of ['operators.eq', 'operators.neq', 'operators.gt', 'operators.gte', 'operators.lt', 'operators.lte', 'operators.like', 'operators.ilike', 'operators.in', 'keys.types.anon', 'keys.types.service', 'keys.statuses.active', 'keys.statuses.revoked', 'errors.rows', 'errors.keys', 'errors.workspace', 'resources.rows', 'resources.keys', 'resources.workspace', 'noAccessDescription.rows', 'noAccessDescription.keys', 'noAccessDescription.workspace', 'jsonInvalid', 'jsonObjectExpected']) used.add(key)
  expect(used.size).toBeGreaterThan(80)
  for (const key of used) for (const catalog of [es, en]) expect(typeof lookup(catalog, key), key).toBe('string')
})
test.each(['es', 'en'] as const)('the rendered page in %s shows no raw translation keys and its target heading is exempt data', async (locale) => {
  const server = setup(); await changeLocale(locale); open()
  fireEvent.change(screen.getByLabelText(locale === 'es' ? 'Base de datos' : 'Database'), { target: { value: 'app_db' } }); fireEvent.change(screen.getByLabelText(locale === 'es' ? 'Tabla' : 'Table'), { target: { value: 'accounts' } })
  await screen.findByText('acc_01')
  for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'innerText', { configurable: true, get: () => element.textContent })
  const values = collectPostgresDataLocaleValues()
  expect(values.filter((text) => /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(text))).toEqual([])
  expect(screen.getByRole('heading', { name: 'public.accounts' })).toBeVisible(); expect(values).not.toContain('public.accounts')
  expect(values).toContain(locale === 'es' ? 'Editor de datos' : 'Data editor'); expect(values).toContain(locale === 'es' ? 'Emitir clave anónima' : 'Issue anon key')
  server.verify(); void loaded; void enterTarget
})
test('the same dotted text outside the target heading is still reported', () => {
  render(<><div data-pgdata-target=""><header><h2>public.accounts</h2></header></div><span>pages.untranslated</span><button aria-label="public.accounts">x</button></>)
  for (const element of document.querySelectorAll('*')) Object.defineProperty(element, 'innerText', { configurable: true, get: () => element.textContent })
  const values = collectPostgresDataLocaleValues()
  expect(values.filter((text) => text === 'public.accounts')).toHaveLength(1); expect(values).toContain('pages.untranslated')
})
