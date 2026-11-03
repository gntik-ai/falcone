import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import ConsoleRealtimeChangesPage from '../src/pages/consoleRealtimeChanges'
import { ANNOUNCE_WINDOW_MS } from '../src/pages/consoleRealtimeChanges/Console'
import { DEFAULT_RETRY_MS } from '../src/pages/consoleRealtimeChanges/stream'
import { change, errorResponse, flush, frame, sseResponse, stubFetch } from './consoleRealtimeChanges-support'
import i18n from '../src/i18n'
import es from '../src/locales/es/pages.console-realtime-changes-page.json'
import en from '../src/locales/en/pages.console-realtime-changes-page.json'

const context = vi.hoisted(() => ({ value: {} as Record<string, unknown>, roles: ['superadmin'] }))
vi.mock('../src/shell/context', () => ({ useConsoleContext: () => context.value }))
vi.mock('../src/shell/permissions', () => ({ usePermissions: () => getConsolePermissions(context.roles) }))

const key = 'synthetic-anon-key'
const mongoUrl = `/v1/realtime/workspaces/ws-1/data/app_db/collections/orders/changes?apikey=${key}`
const pgUrl = `/v1/realtime/workspaces/ws-1/data/app_db/schemas/public/tables/accounts/changes?apikey=${key}`
const open = () => render(<StrictMode><MemoryRouter><ConsoleRealtimeChangesPage /></MemoryRouter></StrictMode>)
const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const type = (name: string, value: string) => fireEvent.change(textbox(name), { target: { value } })
const keyField = (copy = es) => screen.getByLabelText(copy.anonKey, { selector: 'input' }) as HTMLInputElement
const fillMongo = (copy = es) => { type(copy.database, ' app_db '); type(copy.collection, ' orders '); fireEvent.change(keyField(copy), { target: { value: ` ${key} ` } }) }
const subscribe = (copy = es) => fireEvent.click(screen.getByRole('button', { name: copy.subscribe }))
const polite = () => Array.from(document.querySelectorAll('[aria-live="polite"]')).map((node) => node.textContent).join('|')
async function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }))
  const item = await screen.findByRole('option', { name: option }); fireEvent.pointerDown(item); fireEvent.click(item)
}
type Server = { calls: Array<[string, RequestInit]>; streams: ReturnType<typeof sseResponse>[] }
function serve(respond?: (call: number) => Response | ReturnType<typeof sseResponse>): Server {
  const server: Server = { calls: [], streams: [] }
  stubFetch((url, init, call) => {
    server.calls.push([url, init])
    const next = respond ? respond(call) : sseResponse()
    if (next instanceof Response) return next
    server.streams.push(next); return next.response
  })
  return server
}
const stage = async () => { await act(async () => { await flush() }) }
const feed = async (stream: ReturnType<typeof sseResponse>, text: string) => { await act(async () => { stream.send(text); await flush() }) }
const lineTexts = () => Array.from(document.querySelectorAll('[data-slot="log-line"]')).map((row) => row.textContent ?? '')

beforeEach(async () => {
  await i18n.changeLanguage('es'); context.roles = ['superadmin']
  context.value = { activeTenantId: 't1', activeWorkspaceId: 'ws-1', loading: false, error: null, workspaces: [{ workspaceId: 'ws-1', displayName: 'Workspace one' }, { workspaceId: 'ws-2', displayName: 'Workspace two' }], selectWorkspace: vi.fn(), reloadWorkspaces: vi.fn() }
})

test('renders the form and first-run state and sends no request on open', async () => {
  const server = serve(); open()
  expect(screen.getByRole('heading', { level: 1, name: es.title })).toBeVisible()
  expect(screen.getByText(es.description)).toBeVisible()
  expect(screen.getByRole('heading', { name: es.firstRunTitle })).toBeVisible()
  expect(screen.getByRole('button', { name: es.subscribe })).toBeVisible()
  expect(screen.getByText(es.statusDisconnected)).toBeVisible()
  expect(keyField()).toHaveAttribute('type', 'password')
  await stage()
  expect(server.calls).toEqual([])
})

test('the first-run action moves focus to the database field', () => {
  serve(); open()
  fireEvent.click(screen.getByRole('button', { name: es.firstRunAction }))
  expect(textbox(es.database)).toHaveFocus()
})

test('subscribing sends exactly one stream GET with the trimmed values and only the anon key as credential', async () => {
  const server = serve(); open(); fillMongo(); subscribe()
  await stage()
  expect(server.calls).toHaveLength(1)
  expect(server.calls[0][0]).toBe(mongoUrl)
  expect(server.calls[0][1]).toMatchObject({ method: 'GET' })
  expect(server.calls[0][1].headers).toEqual({ Accept: 'text/event-stream' })
  expect(server.calls[0][1].body).toBeUndefined()
  expect(screen.getByRole('button', { name: es.stop })).toBeVisible()
  expect(screen.getByText(es.listeningMongo)).toBeVisible()
  expect(screen.getByText(es.statusLive)).toBeVisible()
  expect(document.body.textContent).not.toContain(key)
})

test('the connecting state shows skeletons and Conectando until the response is accepted', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const stream = sseResponse(); const calls: string[] = []
  stubFetch(async (url) => { calls.push(url); await held; return stream.response })
  open(); fillMongo(); subscribe()
  expect(screen.getByText(es.connecting).closest('[aria-busy="true"]')).not.toBeNull()
  expect(polite()).toContain(es.announceConnecting)
  expect(screen.getByText(es.statusConnecting)).toBeVisible()
  expect(screen.getByRole('button', { name: es.stop })).toBeVisible()
  expect(screen.queryByText(es.listeningMongo)).toBeNull()
  release(); await stage()
  expect(screen.queryByText(es.connecting)).toBeNull()
  expect(screen.getByText(es.statusLive)).toBeVisible()
  expect(screen.getByText(es.listeningMongo)).toBeVisible()
  expect(calls).toHaveLength(1)
})

test('postgres uses the schema default public and the legacy per-source required-field messages', async () => {
  const server = serve(); open()
  await choose(es.source, es.sourcePostgres)
  expect(textbox(es.schema)).toHaveValue('public')
  subscribe()
  expect(screen.getByText(es.validationPostgres)).toBeVisible()
  type(es.database, 'app_db'); type(es.schema, '  '); type(es.table, 'accounts'); fireEvent.change(keyField(), { target: { value: key } })
  subscribe(); await stage()
  expect(server.calls.map(([url]) => url)).toEqual([pgUrl])
  expect(screen.queryByText(es.validationPostgres)).toBeNull()
  expect(screen.getByText(es.listeningPostgres)).toBeVisible()
})

test.each([['database', 'collection', 'validationMongo'], ['collection', 'database', 'validationMongo'], ['anonKey', 'database', 'validationMongo']] as const)('a blank %s shows the Mongo message and opens no stream', async (blank, _other, message) => {
  const server = serve(); open(); fillMongo()
  if (blank === 'anonKey') fireEvent.change(keyField(), { target: { value: '  ' } }); else type(es[blank], ' ')
  subscribe(); await stage()
  expect(screen.getByText(es[message])).toBeVisible()
  expect(server.calls).toEqual([])
})

test('lists changes newest first with the count and follows the newest until one is selected', async () => {
  const server = serve(); open(); fillMongo(); subscribe(); await stage()
  await feed(server.streams[0], frame('insert', change('insert', 'o1')) + frame('update', change('update', 'o2')) + frame('replace', change('replace', 'o3', { total: 3 })))
  expect(screen.getByRole('heading', { name: es.logTitle })).toBeVisible()
  expect(screen.getByText('(3)')).toBeVisible()
  const rows = lineTexts()
  expect(rows).toHaveLength(3)
  expect(rows[0]).toContain('replace'); expect(rows[0]).toContain('{"_id":"o3","total":3}')
  expect(rows[1]).toContain('update'); expect(rows[2]).toContain('insert')
  const log = screen.getByRole('log', { name: es.logTitle })
  expect(log).toHaveAttribute('aria-live', 'off')
  const viewer = screen.getByRole('tree', { name: es.jsonLabel })
  expect(viewer).toHaveTextContent('o3')
  // Selecting o1 through the log keeps order and count and sends no request.
  fireEvent.click(screen.getAllByRole('button', { name: /^Inspeccionar el cambio/ })[2])
  expect(screen.getByRole('tree', { name: es.jsonLabel })).toHaveTextContent('o1')
  expect(screen.getByRole('tree', { name: es.jsonLabel })).not.toHaveTextContent('o3')
  await feed(server.streams[0], frame('delete', change('delete', 'o4')))
  expect(screen.getByText('(4)')).toBeVisible()
  expect(lineTexts()[0]).toContain('delete')
  expect(screen.getByRole('tree', { name: es.jsonLabel })).toHaveTextContent('o1')
  expect(server.calls).toHaveLength(1)
})

test('keeps only 100 changes and a selection evicted by the cap falls back to the newest', async () => {
  const server = serve(); open(); fillMongo(); subscribe(); await stage()
  await feed(server.streams[0], frame('insert', change('insert', 'first')))
  fireEvent.click(screen.getAllByRole('button', { name: /^Inspeccionar el cambio/ })[0])
  expect(screen.getByRole('tree', { name: es.jsonLabel })).toHaveTextContent('first')
  const many = Array.from({ length: 100 }, (_, index) => frame('insert', change('insert', `n${index}`))).join('')
  await feed(server.streams[0], many)
  expect(screen.getByText('(100)')).toBeVisible()
  expect(screen.getByRole('tree', { name: es.jsonLabel })).toHaveTextContent('n99')
  expect(screen.getByRole('tree', { name: es.jsonLabel })).not.toHaveTextContent('first')
})

test('drops an unparsable frame without a console error and renders b above a', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const unhandled = vi.fn(); process.on('unhandledRejection', unhandled)
  const server = serve(); open(); fillMongo(); subscribe(); await stage()
  await feed(server.streams[0], frame('insert', change('insert', 'a')) + frame('insert', '{broken') + frame('ping', { type: 'insert' }) + frame('update', change('update', 'b')))
  const rows = lineTexts()
  expect(rows).toHaveLength(2)
  expect(rows[0]).toContain('"_id":"b"'); expect(rows[1]).toContain('"_id":"a"')
  expect(screen.getByRole('tree', { name: es.jsonLabel })).toHaveTextContent('b')
  await stage()
  process.off('unhandledRejection', unhandled)
  expect(error).not.toHaveBeenCalled(); expect(unhandled).not.toHaveBeenCalled()
})

test.each([401, 403])('a stream %s shows the no-access state, focuses the anon key from its action and never refreshes', async (status) => {
  const server = serve(() => errorResponse(status)); open(); fillMongo(); subscribe(); await stage()
  expect(screen.getByText(es.streamError)).toBeVisible()
  expect(screen.getByRole('heading', { name: es.noAccessTitle })).toBeVisible()
  expect(screen.getByRole('button', { name: es.subscribe })).toBeVisible()
  expect(textbox(es.database)).toHaveValue(' app_db ')
  fireEvent.click(screen.getByRole('button', { name: es.noAccessAction }))
  expect(keyField()).toHaveFocus()
  await stage()
  expect(server.calls).toHaveLength(1)
  expect(server.calls.every(([url]) => !url.includes('/refresh') && !url.includes('login-sessions'))).toBe(true)
  expect(JSON.stringify(server.calls.map(([, init]) => init.headers))).not.toMatch(/authorization/i)
})

test('a stream 404 shows not-found with links to Mongo and Postgres and returns focus to the database field', async () => {
  serve(() => errorResponse(404, { code: 'NO_ROUTE' })); open(); fillMongo(); subscribe(); await stage()
  expect(screen.getByText(es.streamError)).toBeVisible()
  expect(screen.getByRole('heading', { name: es.notFoundTitle })).toBeVisible()
  expect(screen.getByRole('link', { name: es.notFoundMongo })).toHaveAttribute('href', '/console/mongo')
  expect(screen.getByRole('link', { name: es.notFoundPostgres })).toHaveAttribute('href', '/console/postgres')
  expect(textbox(es.database)).toHaveFocus()
  expect(screen.queryByText(es.statusLive)).toBeNull()
})

test('a stream 500 shows the error panel with the request id; Reintentar opens exactly one new stream', async () => {
  const server = serve((call) => call === 0 ? errorResponse(500, { status: 500, requestId: 'synthetic-request-id' }) : sseResponse())
  open(); fillMongo(); subscribe(); await stage()
  expect(screen.getByText(es.streamError)).toBeVisible()
  expect(screen.getByRole('heading', { name: es.errorTitle })).toBeVisible()
  expect(screen.getByText('synthetic-request-id')).toBeVisible()
  expect(screen.getByRole('button', { name: es.retry })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: es.retry })); await stage()
  expect(server.calls.map(([url]) => url)).toEqual([mongoUrl, mongoUrl])
  expect(screen.queryByRole('heading', { name: es.errorTitle })).toBeNull()
  expect(screen.getByText(es.statusLive)).toBeVisible()
})

test('a 500 without a request id says that none is available', async () => {
  serve(() => errorResponse(500, { status: 500 })); open(); fillMongo(); subscribe(); await stage()
  expect(screen.getByText(new RegExp(es.noRequestId))).toBeVisible()
})

test('a dropped connection keeps stale-marked lines, reconnects to the same URL and clears on the next frame', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = serve(); open(); fillMongo(); subscribe(); await stage()
  await feed(server.streams[0], frame('insert', change('insert', 'a')))
  await act(async () => { server.streams[0].end(); await flush() })
  expect(screen.getByText(es.statusDisconnected)).toBeVisible()
  expect(screen.getByRole('heading', { name: es.droppedTitle })).toBeVisible()
  expect(lineTexts()[0]).toContain(es.stale)
  expect(screen.getByRole('button', { name: es.retry })).toHaveFocus()
  expect(server.calls).toHaveLength(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_MS); await flush() })
  expect(server.calls.map(([url]) => url)).toEqual([mongoUrl, mongoUrl])
  expect(lineTexts()[0]).toContain(es.stale)
  await feed(server.streams[1], frame('update', change('update', 'b')))
  expect(screen.queryByRole('heading', { name: es.droppedTitle })).toBeNull()
  expect(lineTexts().join('|')).not.toContain(es.stale)
  expect(lineTexts()).toHaveLength(2)
  expect(screen.getByText(es.statusLive)).toBeVisible()
})

test('Reintentar before the held reconnect cancels it and opens exactly one stream with only its frames', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = serve(); open(); fillMongo(); subscribe(); await stage()
  await feed(server.streams[0], frame('insert', change('insert', 'a')) + frame('insert', change('insert', 'b')))
  await act(async () => { server.streams[0].end(); await flush() })
  fireEvent.click(screen.getByRole('button', { name: es.retry })); await stage()
  expect(server.calls).toHaveLength(2)
  expect(lineTexts()).toHaveLength(0)
  await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_MS * 3); await flush() })
  expect(server.calls).toHaveLength(2)
  await feed(server.streams[1], frame('insert', change('insert', 'c')) + frame('insert', change('insert', 'd')))
  expect(lineTexts()).toHaveLength(2)
  expect(server.streams[0].response.body?.locked).toBe(true)
})

test('subscribing again closes the previous stream and clears the list; Detener and unmount close the stream', async () => {
  const signals: AbortSignal[] = []
  const server: Server = { calls: [], streams: [] }
  stubFetch((url, init) => { signals.push(init.signal as AbortSignal); const next = sseResponse(); server.streams.push(next); server.calls.push([url, init]); return next.response })
  const view = open(); fillMongo(); subscribe(); await stage()
  await feed(server.streams[0], frame('insert', change('insert', 'a')))
  fireEvent.click(screen.getByRole('button', { name: es.stop })); await stage()
  expect(signals[0].aborted).toBe(true)
  expect(screen.getByRole('button', { name: es.subscribe })).toBeVisible()
  subscribe(); await stage()
  expect(signals).toHaveLength(2); expect(lineTexts()).toHaveLength(0)
  view.unmount()
  expect(signals[1].aborted).toBe(true)
  expect(server.calls).toHaveLength(2)
})

test('a burst of 50 changes renders 50 lines and is announced once with its size', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = serve(); open(); fillMongo(); subscribe(); await stage()
  await feed(server.streams[0], Array.from({ length: 50 }, (_, index) => frame('insert', change('insert', `b${index}`))).join(''))
  expect(screen.getByText('(50)')).toBeVisible()
  expect(polite()).not.toContain('50 cambios')
  await act(async () => { await vi.advanceTimersByTimeAsync(ANNOUNCE_WINDOW_MS * 3) })
  expect(polite().match(/50 cambios nuevos/g)).toHaveLength(1)
})

test('a workspace error offers Reintentar that calls reloadWorkspaces once, without a stream', async () => {
  const server = serve(); const reload = vi.fn()
  context.value = { ...context.value, activeWorkspaceId: null, error: { status: 500 }, reloadWorkspaces: reload }
  open()
  expect(screen.getByRole('heading', { name: es.workspaceError })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: es.retry }))
  expect(reload).toHaveBeenCalledTimes(1)
  await stage(); expect(server.calls).toEqual([])
})

test('the workspace gate shows loading, the picker, the create link by permission and the denial note', async () => {
  const server = serve(); const selectWorkspace = vi.fn()
  context.value = { ...context.value, activeWorkspaceId: null, loading: true }
  let view = open()
  expect(screen.getByRole('status', { name: es.workspaceLoading })).toBeVisible()
  view.unmount()
  context.value = { ...context.value, loading: false, selectWorkspace }
  view = open()
  expect(screen.getByText(es.workspaceDescription)).toBeVisible()
  await choose(es.workspaceLabel, 'Workspace two')
  expect(selectWorkspace).toHaveBeenCalledWith('ws-2')
  view.unmount()
  context.value = { ...context.value, workspaces: [] }
  view = open()
  expect(screen.getByRole('link', { name: es.createWorkspace })).toHaveAttribute('href', '/console/workspaces')
  view.unmount()
  context.roles = ['tenant_viewer']
  open()
  expect(screen.queryByRole('link', { name: es.createWorkspace })).toBeNull()
  expect(screen.getByText(es.workspaceDenied)).toBeVisible()
  expect(server.calls).toEqual([])
})

test.each(['es', 'en'] as const)('renders only catalog copy in %s', async (locale) => {
  await i18n.changeLanguage(locale)
  const copy = locale === 'es' ? es : en
  serve(); open()
  expect(screen.getByRole('heading', { level: 1, name: copy.title })).toBeVisible()
  expect(screen.getByRole('combobox', { name: copy.source })).toBeVisible()
  for (const label of [copy.database, copy.collection]) expect(textbox(label)).toBeVisible()
  expect(keyField(copy)).toHaveAttribute('placeholder', copy.anonKeyPlaceholder)
  fireEvent.click(screen.getByRole('button', { name: copy.showKey }))
  expect(keyField(copy)).toHaveAttribute('type', 'text')
  expect(screen.getByRole('button', { name: copy.hideKey })).toHaveAttribute('aria-pressed', 'true')
  const text = document.body.textContent ?? ''
  expect(text).not.toMatch(/pages\.console-realtime-changes-page|\b(firstRunTitle|statusLive|logTitle)\b/)
  if (locale === 'es') for (const name of ['subscribe', 'source', 'database', 'anonKey', 'firstRunTitle'] as const) expect(text).not.toContain(en[name])
})
