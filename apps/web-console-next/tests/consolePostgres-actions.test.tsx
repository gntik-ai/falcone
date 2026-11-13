import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import es from '../src/locales/es/pages.console-postgres-page.json'
import { Preview } from '../src/pages/consolePostgres/Preview'
import { LiveAnnouncer } from '@gntik-ai/ui'
import { renderWithSession, strictFetch, login } from './shell-support'
import { choose, click, contextValue, open, section, selectSchema, selectTable, startWizard, tab, wizardEngine } from './consolePostgres-support'
import * as pg from './parity/fixtures/postgres'

const context = vi.hoisted(() => ({ value: {} as ReturnType<typeof contextValue> }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
let server: ReturnType<typeof strictFetch>
beforeEach(() => { context.value = contextValue(); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => server?.verify())
const serve = (overrides = {}) => server = strictFetch({ ...pg.reads(), ...Object.fromEntries(pg.quotaPaths.map((path) => [`GET ${path}`, path.endsWith('/quotas') ? pg.quotasAvailable : {}])), ...overrides })
const writes = () => server.mock.mock.calls.filter(([, init]) => init?.method !== 'GET')
const fields = { tenantId: 't-1', workspaceId: 'ws-1', databaseName: 'app_db', schemaName: 'public', dryRun: true, executionMode: 'preview' }
async function preview(kind: 'table' | 'view' | 'matview') {
  if (kind === 'table') await selectTable()
  else { await selectSchema(); tab(es[kind === 'view' ? 'views' : 'matviews']) }
  fireEvent.click(await screen.findByRole('button', { name: es.previewAction }))
}

test.each(['table', 'view', 'matview'] as const)('%s DDL preview sends the exact dry-run PUT and renders risk, warnings, safeguards and statements', async (kind) => {
  const path = kind === 'table' ? pg.detail : `${pg.objects}/${kind === 'view' ? 'views/active_accounts' : 'materialized-views/accounts_snapshot'}`
  serve({ [`PUT ${path}`]: pg.ddl }); open(); await preview(kind)
  expect(await screen.findByText(pg.ddl.ddlPreview.statements[0].sql)).toBeVisible()
  expect(screen.getByText('Exclusive lock possible')).toBeVisible()
  expect(screen.getByText('preview_only')).toBeVisible()
  expect(screen.getByText('Bloqueos: 1')).toBeVisible()
  expect(screen.getAllByText('High').length).toBeGreaterThan(0)
  expect(screen.getByText('Exclusive lock possible').closest('[data-severity]')).toHaveAttribute('data-severity', 'high')
  const body = kind === 'table' ? { ...fields, tableName: 'accounts' } : kind === 'view' ? { ...fields, viewName: pg.view.viewName, query: pg.view.query, columns: pg.view.columns, securityBarrier: true } : { ...fields, viewName: pg.matview.viewName, query: pg.matview.query, columns: pg.matview.columns, withData: true, refreshPolicy: pg.matview.refreshPolicy }
  expect(writes()).toHaveLength(1)
  expect(writes()[0][0]).toBe(path); expect(JSON.parse(writes()[0][1]?.body as string)).toEqual(body)
  click(es.close, within(screen.getByTestId('pg-preview')))
  expect(screen.queryByTestId('pg-preview')).toBeNull()
  expect(screen.getByRole('button', { name: es.previewAction })).toHaveFocus()
})

test.each(['view', 'matview'] as const)('%s without query shows the legacy inline error and sends no PUT', async (kind) => {
  const id = kind === 'view' ? 'views' : 'matviews'
  serve({ [`GET ${pg.paths[id]}${pg.query}`]: { items: [{ ...(kind === 'view' ? pg.view : pg.matview), query: undefined }] } })
  open(); await preview(kind)
  expect(await screen.findByText(es[kind === 'view' ? 'previewMissingQuery' : 'previewMissingMatQuery'])).toBeVisible()
  expect(writes()).toEqual([])
})

test('missing preview prerequisites show the legacy inline error without PUT at component level', async () => {
  serve(); login()
  renderWithSession(<LiveAnnouncer><Preview context={{ tenant: 't-1', workspace: null, database: 'app_db', schema: 'public' }} target={{ kind: 'table', name: 'accounts' }} trigger={null} close={() => {}} /></LiveAnnouncer>)
  expect(await screen.findByText(es.previewPrerequisite)).toBeVisible()
  expect(server.mock.mock.calls).toHaveLength(0)
})

test('a response without ddlPreview shows the inline error and retry repeats the PUT once', async () => {
  let calls = 0
  serve({ [`PUT ${pg.detail}`]: () => Response.json(++calls === 1 ? {} : pg.ddl) }); open(); await preview('table')
  expect(await screen.findByText(es.previewMissingDdl)).toBeVisible()
  click(es.retry, within(screen.getByTestId('pg-preview')))
  expect(await screen.findByText(pg.ddl.ddlPreview.statements[0].sql)).toBeVisible()
  expect(writes()).toHaveLength(2)
})

test('a pending DDL PUT shows a loading status while inventory remains available', async () => {
  let release!: (response: Response) => void
  serve({ [`PUT ${pg.detail}`]: () => new Promise<Response>((resolve) => { release = resolve }) }); open(); await preview('table')
  expect(screen.getByRole('status', { name: es.previewLoading })).toBeVisible()
  expect(section('columns').getByRole('table')).toBeVisible()
  await act(async () => release(Response.json(pg.ddl)))
  expect(await screen.findByText('Exclusive lock possible')).toBeVisible()
})

test.each(['postgresql', 'mongodb'] as const)('wizard submits the original spaced name and engine-specific items for %s', async (engine) => {
  serve({ 'POST /v1/workspaces/ws-1/databases': { databaseId: 'created-db' } }); open()
  await wizardEngine()
  if (engine === 'mongodb') await choose(es.engine, es.mongodb)
  const options = engine === 'postgresql' ? ['uuid-ossp', 'pgcrypto'] : ['users', 'orders']
  click(es.next)
  for (const item of options) fireEvent.click(screen.getByRole('checkbox', { name: item }))
  click(es.next)
  const value = Array.from(screen.getByRole('dialog').querySelectorAll('dd')).find((item) => item.textContent === ' ventas ')
  expect(value).toBeDefined()
  click(es.confirm)
  expect(await screen.findByRole('link', { name: es.openResource })).toHaveAttribute('href', engine === 'mongodb' ? '/console/mongo' : '/console/postgres')
  expect(writes()).toHaveLength(1)
  expect(writes()[0][0]).toBe('/v1/workspaces/ws-1/databases')
  expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ engine, name: ' ventas ', extensions: engine === 'postgresql' ? options : [], collections: engine === 'mongodb' ? options : [] })
  expect(new Headers(writes()[0][1]?.headers).get('X-Request-Id')).toMatch(/^wiz/)
  expect(server.mock.mock.calls.filter(([path]) => pg.quotaPaths.includes(String(path))).map(([path]) => path)).toEqual(pg.quotaPaths)
  expect(screen.getAllByText('Recurso creado correctamente: created-db').length).toBeGreaterThan(0)
})

test('wizard rejects a blank trimmed name, clears selected items on engine changes, and restores trigger focus on close', async () => {
  serve(); open(); await wizardEngine('   ')
  expect(screen.getByRole('button', { name: es.next })).toBeDisabled()
  expect(screen.getAllByText(es.nameRequired).length).toBeGreaterThan(0)
  expect(writes()).toEqual([])
  fireEvent.change(screen.getByRole('textbox', { name: es.name }), { target: { value: 'ventas' } }); click(es.next)
  fireEvent.click(screen.getByRole('checkbox', { name: 'pgcrypto' })); click(es.previous)
  await choose(es.engine, es.mongodb); click(es.next)
  expect(screen.queryByRole('checkbox', { name: 'pgcrypto' })).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'users' })).not.toBeChecked()
  click(es.previous); await choose(es.engine, es.postgresql); click(es.next)
  expect(screen.getByRole('checkbox', { name: 'pgcrypto' })).not.toBeChecked()
  click(es.previous); click(es.previous); click(es.cancel)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByRole('button', { name: es.newDatabase })).toHaveFocus()
})

test('wizard blocks the engine step on exhausted workspace databases.count', async () => {
  serve({ 'GET /v1/metrics/workspaces/ws-1/quotas': pg.quotasExhausted }); open(); await wizardEngine()
  expect(await screen.findByText(es.quotaExhausted)).toBeVisible()
  expect(screen.getByRole('button', { name: es.next })).toBeDisabled()
  expect(writes()).toEqual([])
})

test('delayed metrics do not block the engine step and the workspace pair follows the tenant pair', async () => {
  let release!: (response: Response) => void
  serve({ 'GET /v1/metrics/tenants/t-1/quotas': () => new Promise<Response>((resolve) => { release = resolve }) }); open(); await wizardEngine()
  expect(screen.getByRole('button', { name: es.next })).toBeEnabled()
  expect(server.mock.mock.calls.some(([path]) => String(path).includes('/metrics/workspaces/'))).toBe(false)
  click(es.next)
  expect(screen.getByRole('checkbox', { name: 'pgcrypto' })).toBeVisible()
  await act(async () => release(Response.json(pg.quotasAvailable)))
  await waitFor(() => expect(server.mock.mock.calls.filter(([path]) => String(path).includes('/metrics/workspaces/'))).toHaveLength(2))
})

test('permission denial shows only blocked content and still sends all four quota GETs', async () => {
  serve(); open(['tenant_viewer']); startWizard()
  expect(screen.getByRole('heading', { name: es.blocked })).toBeVisible()
  expect(screen.getByText(es.denyViewer)).toBeVisible()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('textbox', { name: es.name })).toBeNull()
  await waitFor(() => expect(server.mock.mock.calls.filter(([path]) => pg.quotaPaths.includes(String(path)))).toHaveLength(4))
  expect(writes()).toEqual([])
})

test('wizard without workspace cannot advance the first step', async () => {
  context.value = { ...context.value, activeWorkspaceId: null }
  serve(); open(); startWizard()
  expect(await screen.findByText(/Selecciona un área de trabajo\./)).toBeVisible()
  expect(screen.getByRole('button', { name: es.next })).toBeDisabled()
  expect(writes()).toEqual([])
})

test('a preview server error stays inline and shows the legacy service message with its request id', async () => {
  serve({ [`PUT ${pg.detail}`]: () => Response.json({ message: 'internal-preview-error', requestId: 'pg-preview-request' }, { status: 500 }) })
  open(); await preview('table')
  const panel = within(screen.getByTestId('pg-preview'))
  expect(await panel.findByText(es.http500)).toBeVisible()
  expect(panel.getByText('ID de solicitud: pg-preview-request')).toBeVisible()
  expect(document.body.textContent).not.toContain('internal-preview-error')
})

test('wizard preserves a create conflict message, retains its data and retries the same original body', async () => {
  let attempts = 0
  serve({ 'POST /v1/workspaces/ws-1/databases': () => ++attempts === 1 ? Response.json({ message: 'Synthetic create conflict' }, { status: 409 }) : Response.json({ databaseId: 'created-db' }) })
  open(); await wizardEngine(); click(es.next); click(es.next); click(es.confirm)
  expect(await screen.findByText('Synthetic create conflict')).toBeVisible()
  click(es.confirm)
  expect(await screen.findByRole('link', { name: es.openResource })).toBeVisible()
  expect(writes()).toHaveLength(2)
  expect(JSON.parse(writes()[0][1]?.body as string)).toEqual(JSON.parse(writes()[1][1]?.body as string))
})
