import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import es from '../src/locales/es/pages.console-postgres-page.json'
import en from '../src/locales/en/pages.console-postgres-page.json'
import i18n from '../src/i18n'
import * as pg from './parity/fixtures/postgres'
import { strictFetch } from './shell-support'
import { click, contextValue, open, section, selectDatabase, selectSchema, selectTable, tab } from './consolePostgres-support'

const context = vi.hoisted(() => ({ value: {} as ReturnType<typeof contextValue> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
let server: ReturnType<typeof strictFetch>
beforeEach(() => { context.value = contextValue() })
afterEach(() => server?.verify())
const serve = (overrides = {}) => server = strictFetch({ ...pg.reads(), ...overrides })
const requests = () => server.mock.mock.calls.map(([path, init]) => ({ path: String(path), method: init?.method, body: init?.body }))

test('ports the legacy inventory fields and hierarchy requests without requests on tab or breadcrumb changes', async () => {
  serve(); open()
  expect(await screen.findByRole('heading', { level: 1, name: es.title })).toBeVisible()
  expect(screen.getByText('Tenant Alpha')).toBeVisible(); expect(screen.getByText('Workspace Alpha')).toBeVisible()
  await section('databases').findByRole('table', { name: es.databasesTable })
  expect(section('databases').getAllByRole('row')).toHaveLength(4)
  expect(section('databases').getAllByText('postgres_owner')).toHaveLength(3)
  expect(section('databases').getAllByText('Schema Per Tenant')).toHaveLength(3)
  expect(screen.queryByRole('searchbox')).toBeNull()
  expect(screen.queryByRole('button', { name: es.next })).toBeNull(); expect(screen.queryByRole('button', { name: es.previous })).toBeNull()
  await selectTable()
  expect(section('schemas').getByText('1 tablas · 1 vistas · 1 materializadas · 2 índices')).toBeVisible()
  for (const value of ['id', 'uuid', 'NOT NULL', 'gen_random_uuid()', '1']) expect(section('columns').getByText(value)).toBeVisible()
  tab(es.indexes)
  for (const value of ['accounts_pkey', 'btree', es.unique, 'id', 'email']) expect(section('indexes').getByText(value)).toBeVisible()
  tab(es.policies)
  for (const value of ['accounts_select_policy', 'Permissive', 'SELECT', 'tenant_user', pg.policy.usingExpression]) expect(section('policies').getByText(value)).toBeVisible()
  tab(es.security)
  for (const value of [es.rlsEnabled, es.forceRls, es.policyCount, 'Tenant Scoped', 'Review Required']) expect(section('security').getByText(value)).toBeVisible()
  tab(es.views)
  for (const value of ['active_accounts', 'id, email', es.yes]) expect(section('views').getByText(value)).toBeVisible()
  tab(es.matviews)
  for (const value of ['accounts_snapshot', 'daily refresh', 'loaded', es.yes]) expect(section('matviews').getByText(value)).toBeVisible()
  expect(requests()).toEqual(Object.entries(pg.paths).map(([key, path]) => ({ path: path + (key === 'security' ? '' : pg.query), method: 'GET', body: undefined })))
  const count = requests().length
  const navigation = within(screen.getByRole('navigation', { name: es.navigation }))
  click('app_db', navigation)
  expect(screen.queryByTestId('pg-tables')).toBeNull()
  expect(screen.getByRole('navigation', { name: es.navigation }).querySelector('[aria-current]')).toHaveFocus()
  click(es.databases, navigation)
  expect(screen.queryByTestId('pg-schemas')).toBeNull()
  expect(screen.queryByRole('heading', { name: es.snippets })).toBeNull()
  expect(requests()).toHaveLength(count)
})

test('without a tenant no page GET is sent and the new database action remains visible', async () => {
  context.value = { ...context.value, activeTenantId: null, activeWorkspaceId: null }
  serve(); open()
  expect(screen.getAllByText(es.tenantDescription).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: es.newDatabase })).toBeVisible()
  await act(async () => {})
  expect(requests()).toEqual([])
})

test('a workspace switch preserves the database, resets descendants and reloads schemas only', async () => {
  serve(); const view = open(); await selectTable()
  context.value = { ...context.value, activeWorkspaceId: 'ws-2', workspaces: [{ workspaceId: 'ws-2', displayName: 'Workspace Beta' }] }; view.update()
  await section('schemas').findByRole('table')
  expect(screen.queryByTestId('pg-columns')).toBeNull()
  expect(requests().filter(({ path }) => path === pg.schemas + pg.query)).toHaveLength(2)
  expect(requests().filter(({ path }) => path === pg.base + pg.query)).toHaveLength(1)
})

test('a tenant switch clears the whole selection and ignores a late prior response', async () => {
  let release!: (response: Response) => void
  serve({ [`GET ${pg.schemas}${pg.query}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  const view = open(); await selectDatabase()
  await waitFor(() => expect(release).toBeDefined())
  context.value = { ...context.value, activeTenantId: 't-2', tenants: [{ tenantId: 't-2', displayName: 'Tenant Beta' }] }; view.update()
  await section('databases').findByRole('table')
  await act(async () => release(Response.json(pg.fixtures.schemas)))
  expect(screen.queryByTestId('pg-schemas')).toBeNull()
  expect(screen.queryByText('public')).toBeNull()
  expect(requests().filter(({ path }) => path === pg.base + pg.query)).toHaveLength(2)
})

test.each(['es', 'en'] as const)('renders translated inventory chrome and table names in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  serve(); open(); await selectTable()
  expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(section('columns').getByRole('table', { name: copy.columnsTable })).toBeVisible()
  tab(copy.security); expect(section('security').getByText(copy.rlsEnabled)).toBeVisible()
  expect(document.body.textContent).not.toMatch(/pages\.console-postgres-page|\bdatabasesLoading\b/)
})

test('copies the exact legacy connection templates with placeholders and announces the result', async () => {
  const write = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
  serve(); open(); await selectDatabase()
  const snippets = within(screen.getByRole('region', { name: es.snippets }))
  expect(snippets.getByText('postgresql://<PG_USER>:<YOUR_SECRET>@<RESOURCE_HOST>:5432/app_db?sslmode=require')).toBeVisible()
  click(es.copy, within(snippets.getAllByRole('button', { name: es.copy })[0].parentElement!))
  await waitFor(() => expect(write).toHaveBeenCalledWith('postgresql://<PG_USER>:<YOUR_SECRET>@<RESOURCE_HOST>:5432/app_db?sslmode=require'))
  expect(await snippets.findByText(es.snippetCopied)).toBeVisible()
})

test('clicking a non-button row cell selects the database, schema and table', async () => {
  serve(); open()
  await section('databases').findByRole('table')
  fireEvent.click(section('databases').getAllByText('postgres_owner')[0])
  fireEvent.click(await section('schemas').findByText('postgres_owner'))
  await section('tables').findByRole('table')
  fireEvent.click(section('tables').getByText('2'))
  expect(await section('columns').findByText('gen_random_uuid()')).toBeVisible()
})
