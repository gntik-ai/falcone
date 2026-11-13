import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import es from '../src/locales/es/pages.console-postgres-page.json'
import * as pg from './parity/fixtures/postgres'
import { strictFetch, workspaceUrl } from './shell-support'
import { choose, click, contextValue, open, section, selectDatabase, selectSchema, selectTable, tab } from './consolePostgres-support'

const context = vi.hoisted(() => ({ value: {} as ReturnType<typeof contextValue> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
let server: ReturnType<typeof strictFetch>
beforeEach(() => { context.value = contextValue() })
afterEach(() => server?.verify())
const serve = (overrides = {}) => server = strictFetch({ ...pg.reads(), ...overrides })
type Section = keyof typeof pg.paths
const names: Section[] = Object.keys(pg.paths) as Section[]
const collections = names.filter((name) => name !== 'security')
const requestPath = (name: Section) => pg.paths[name] + (name === 'security' ? '' : pg.query)
async function reach(name: Section, wait = true) {
  if (name === 'databases') return
  if (name === 'schemas') return selectDatabase()
  if (['tables', 'views', 'matviews'].includes(name)) { await selectSchema(); if (name !== 'tables') tab(es[name as 'views' | 'matviews']); return }
  // selectTable waits for columns; held/failed/empty columns must not be awaited.
  await selectSchema(); fireEvent.click(await section('tables').findByRole('button', { name: 'accounts' }))
  if (name !== 'columns') tab(es[name as 'indexes' | 'policies' | 'security'])
  if (wait) await waitFor(() => expect(section(name).queryByRole('status')).toBeNull())
}

test.each(names)('%s independently shows its loading skeleton while other sections remain usable', async (name) => {
  let release!: (value: Response) => void
  serve({ [`GET ${requestPath(name)}`]: () => new Promise<Response>((resolve) => { release = resolve }) })
  open(); await reach(name, false)
  expect(await section(name).findByRole('status', { name: es[`${name}Loading`] })).toBeVisible()
  if (!['databases', 'schemas'].includes(name)) expect(section('databases').getByRole('table')).toBeVisible()
  await act(async () => release(Response.json(pg.fixtures[name])))
  await waitFor(() => expect(section(name).queryByRole('status')).toBeNull())
})

test.each(names)('%s shows its own legacy empty state', async (name) => {
  serve({ [`GET ${requestPath(name)}`]: name === 'security' ? null : { items: [] } })
  open(); await reach(name, false)
  expect(await section(name).findByText(es[`${name}Empty`])).toBeVisible()
})

test.each(names)('%s retries only its own URL once, preserves selections and focuses the recovered section', async (name) => {
  let attempts = 0
  serve({ [`GET ${requestPath(name)}`]: () => {
    if (++attempts === 1) {
      if (name === 'databases') throw new TypeError('Synthetic network failure')
      return Response.json({ status: 500, message: 'untrusted server copy', requestId: 'pg-request' }, { status: 500 })
    }
    return Response.json(pg.fixtures[name])
  } })
  open(); await reach(name, false)
  await section(name).findByRole('button', { name: es.retry })
  if (name !== 'databases') expect(section(name).getByText('pg-request')).toBeVisible()
  expect(document.body.textContent).not.toContain('untrusted server copy')
  const before = server.mock.mock.calls.length
  click(es.retry, section(name))
  await waitFor(() => expect(section(name).queryByRole('button', { name: es.retry })).toBeNull())
  expect(server.mock.mock.calls.slice(before).map(([path, init]) => [init?.method, path, init?.body])).toEqual([['GET', requestPath(name), undefined]])
  expect(attempts).toBe(2)
  await waitFor(() => expect(screen.getByTestId(`pg-${name}`)).toHaveFocus())
  if (name !== 'databases') expect(section('databases').getByRole('button', { name: 'app_db' })).toHaveAttribute('aria-pressed', 'true')
})

test.each(collections)('%s uses nextCursor and retains Anterior on the terminal page without totals or page numbers', async (name) => {
  const response = pg.fixtures[name] as { items: unknown[] }
  const first = requestPath(name), second = `${first}&page%5Bafter%5D=opaque%2Fnext%2B100`
  serve({ [`GET ${first}`]: { ...response, page: { nextCursor: 'opaque/next+100' } }, [`GET ${second}`]: response })
  open(); await reach(name, false)
  await section(name).findByRole('button', { name: es.next })
  expect(section(name).queryByRole('button', { name: es.previous })).toBeNull()
  click(es.next, section(name))
  expect(await section(name).findByRole('button', { name: es.previous })).toBeVisible()
  expect(section(name).queryByRole('button', { name: es.next })).toBeNull()
  expect(server.mock.mock.calls.filter(([path]) => path === second)).toHaveLength(1)
  click(es.previous, section(name))
  await section(name).findByRole('button', { name: es.next })
  expect(server.mock.mock.calls.filter(([path]) => path === first)).toHaveLength(2)
  expect(section(name).queryByRole('button', { name: es.previous })).toBeNull()
  expect(section(name).getByText(`Mostrados: ${response.items.length}`)).toBeVisible()
  expect(section(name).queryByText(/total|página \d|page \d/i)).toBeNull()
})

test('the paged tables list renders all 100 items and its shown count', async () => {
  serve({ [`GET ${pg.paths.tables}${pg.query}`]: pg.tablesPage1 }); open(); await selectSchema()
  expect(await section('tables').findByText('table_99')).toBeVisible()
  expect(section('tables').getAllByRole('row')).toHaveLength(101)
  expect(section('tables').getByText('Mostrados: 100')).toBeVisible()
})

test('a later cursor network failure clears stale rows and retries the same cursor', async () => {
  let attempts = 0
  const second = `${pg.base}${pg.query}&page%5Bafter%5D=next`
  serve({ [`GET ${pg.base}${pg.query}`]: { ...pg.fixtures.databases, page: { nextCursor: 'next' } }, [`GET ${second}`]: () => { if (++attempts === 1) throw new TypeError('offline'); return Response.json({ items: [{ ...pg.database, databaseName: 'page_two' }] }) } })
  open(); fireEvent.click(await section('databases').findByRole('button', { name: es.next }))
  await section('databases').findByRole('button', { name: es.retry })
  expect(section('databases').queryByText('app_db')).toBeNull()
  click(es.retry, section('databases'))
  expect(await section('databases').findByText('page_two')).toBeVisible()
  expect(server.mock.mock.calls.filter(([path]) => path === second)).toHaveLength(2)
})

test.each([403, 404, 500])('a section %s renders the specified state and never renders backend copy', async (status) => {
  serve({ [`GET ${pg.schemas}${pg.query}`]: () => Response.json({ status, message: 'internal-message', requestId: 'pg-request' }, { status }) })
  open(); await selectDatabase()
  expect(await section('schemas').findByRole('heading', { name: status === 403 ? es.noAccess : status === 404 ? es.notFound : es.schemasError })).toBeVisible()
  expect(document.body.textContent).not.toContain('internal-message')
  if (status !== 500) expect(section('schemas').queryByRole('button', { name: es.retry })).toBeNull()
  if (status === 404) expect(within(screen.getByRole('navigation', { name: es.navigation })).getByRole('button', { name: es.databases })).toBeVisible()
})

test('policies with RLS disabled use the distinct empty copy', async () => {
  serve({ [`GET ${pg.paths.policies}${pg.query}`]: { items: [] }, [`GET ${pg.paths.security}`]: { ...pg.security, rlsEnabled: false } })
  open(); await selectTable(); tab(es.policies)
  expect(await section('policies').findByText(es.policiesDisabled)).toBeVisible()
})

test('workspace required: loading sends no schemas GET', async () => {
  context.value = { ...context.value, activeWorkspaceId: null, loading: true }
  serve(); open(); await selectDatabase()
  expect(screen.getByRole('status', { name: es.workspaceLoading })).toBeVisible()
  expect(server.mock.mock.calls.map(([path]) => path)).toEqual([pg.base + pg.query])
})
test.each([403, 404, 500])('workspace required: %s retry calls reloadWorkspaces and sends one shell workspace GET', async (status) => {
  context.value = { ...context.value, activeWorkspaceId: null, error: { status }, reloadWorkspaces: vi.fn(async () => { await fetch(workspaceUrl('t-1'), { method: 'GET' }) }) }
  serve({ [`GET ${workspaceUrl('t-1')}`]: { items: [] } }); open(); await selectDatabase()
  click(es.retry)
  await waitFor(() => expect(context.value.reloadWorkspaces).toHaveBeenCalledTimes(1))
  expect(server.mock.mock.calls.map(([path]) => path)).toEqual([pg.base + pg.query, workspaceUrl('t-1')])
})
test('workspace required: picker chooses ws-1 and loads schemas once', async () => {
  context.value = { ...context.value, activeWorkspaceId: null, selectWorkspace: vi.fn((id: string) => { context.value = { ...context.value, activeWorkspaceId: id } }) }
  serve(); const view = open(); await selectDatabase()
  await choose(es.workspacePicker, 'Workspace Alpha'); view.update()
  await section('schemas').findByRole('table')
  expect(server.mock.mock.calls.map(([path]) => path)).toEqual([pg.base + pg.query, pg.schemas + pg.query])
})
test('workspace required: empty with create permission links to workspaces', async () => {
  context.value = { ...context.value, activeWorkspaceId: null, workspaces: [] }
  serve(); open(); await selectDatabase()
  expect(screen.getByRole('link', { name: es.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  expect(server.mock.mock.calls).toHaveLength(1)
})
test('workspace required: empty without create permission shows the denial note', async () => {
  context.value = { ...context.value, activeWorkspaceId: null, workspaces: [] }
  serve(); open(['tenant_viewer']); await selectDatabase()
  expect(screen.getByText(es.workspaceDenied)).toBeVisible()
  expect(screen.queryByRole('link', { name: es.createWorkspace })).toBeNull()
  expect(server.mock.mock.calls).toHaveLength(1)
})
